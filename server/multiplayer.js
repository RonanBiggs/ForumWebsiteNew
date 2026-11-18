// server/multiplayer.js - WebSocket at /ws: relays where everyone is standing,
// and pushes new threads/replies to every open page so the hotel updates live.
//
// Client -> server: { type: 'pose', room: <thread_id>|null, x, y, z, ry }   (y = height off the floor when launched)
//                   { type: 'shot', room, x, y, z, dx, dy, dz }   (fired the gun: everyone else sees the ball)
//                   { type: 'hit', id, room, dx, dz }              (our ball hit player `id`: they get launched)
//                   { type: 'hb' }   (heartbeat, ignored)
//   Positions inside/near a room are sent RELATIVE to that room, because rooms
//   can be in a different order on different screens for a moment.
// Server -> client: { type: 'welcome', id, players: [{ id, name, room, x, y, z, ry }] }
//                   { type: 'name', id, name }   (a player's username, shown above their pill)
//                   { type: 'pose', id, room, x, y, z, ry }
//                   { type: 'shot', id, room, x, y, z, dx, dy, dz }   { type: 'hit', from, room, dx, dz }
//                   { type: 'leave', id }
//                   { type: 'thread', thread }   { type: 'reply', reply }

import { WebSocketServer } from 'ws';
import { getUsername } from './db.js';

const MAX_MSGS_PER_SEC = 60;          // positions (10/s) + gun spam

const num = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e5;
const cleanRoom = (room) => (room ?? null) === null ? null : (Number.isInteger(room) && room > 0 ? room : undefined);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The visitor's IP, worked out the same way as Express's req.ip with 'trust proxy' = 1
// (Render's proxy adds the real address as the last X-Forwarded-For entry).
function clientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    return xff ? xff.split(',').pop().trim() : req.socket.remoteAddress;
}

function cleanPose(msg) {
    const room = cleanRoom(msg.room);
    if (room === undefined) return null;
    if (!num(msg.x) || !num(msg.z) || !num(msg.ry)) return null;
    const y = num(msg.y) ? clamp(msg.y, 0, 3) : 0;
    return { room, x: msg.x, y, z: msg.z, ry: msg.ry };
}

function cleanShot(msg) {
    const room = cleanRoom(msg.room);
    if (room === undefined) return null;
    if (![msg.x, msg.y, msg.z, msg.dx, msg.dy, msg.dz].every(num)) return null;
    const { x, y, z, dx, dy, dz } = msg;
    return { room, x, y, z, dx, dy, dz };
}

function cleanHit(msg) {
    const room = cleanRoom(msg.room);
    if (room === undefined || !Number.isInteger(msg.id) || !num(msg.dx) || !num(msg.dz)) return null;
    const len = Math.hypot(msg.dx, msg.dz);
    if (len < 1e-3) return null;
    return { room, dx: msg.dx / len, dz: msg.dz / len };    // direction only: the strength is fixed
}

export function attachMultiplayer(server) {
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
    const players = new Map();           // ws -> { id, pose, alive, msgs, windowStart }
    const byId = new Map();              // id -> ws
    let nextId = 1;

    const send = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
    const broadcast = (msg, except = null) => {
        const data = JSON.stringify(msg);
        for (const ws of players.keys()) if (ws !== except && ws.readyState === ws.OPEN) ws.send(data);
    };

    wss.on('connection', (ws, req) => {
        const me = { id: nextId++, ip: clientIp(req), name: null, pose: null, alive: true, msgs: 0, windowStart: Date.now() };
        players.set(ws, me);
        byId.set(me.id, ws);
        send(ws, {
            type: 'welcome',
            id: me.id,
            players: [...players.values()].filter((p) => p !== me && p.pose).map((p) => ({ id: p.id, name: p.name, ...p.pose })),
        });
        getUsername(me.ip).then((name) => {
            if (name && players.has(ws)) { me.name = name; broadcast({ type: 'name', id: me.id, name }, ws); }
        }).catch((err) => console.error('Username lookup failed:', err.message));

        ws.on('pong', () => { me.alive = true; });
        ws.on('message', (data) => {
            me.alive = true;
            const now = Date.now();
            if (now - me.windowStart > 1000) { me.windowStart = now; me.msgs = 0; }
            if (++me.msgs > MAX_MSGS_PER_SEC) return;            // flooding: drop
            let msg;
            try { msg = JSON.parse(data); } catch { return; }
            if (msg?.type === 'pose') {
                const pose = cleanPose(msg);
                if (!pose) return;
                me.pose = pose;
                broadcast({ type: 'pose', id: me.id, ...pose }, ws);
            } else if (msg?.type === 'shot') {
                const shot = cleanShot(msg);
                if (shot) broadcast({ type: 'shot', id: me.id, ...shot }, ws);
            } else if (msg?.type === 'hit') {
                const hit = cleanHit(msg);
                const target = hit && msg.id !== me.id && byId.get(msg.id);
                if (target) send(target, { type: 'hit', from: me.id, ...hit });
            }
        });
        ws.on('close', () => {
            players.delete(ws);
            byId.delete(me.id);
            broadcast({ type: 'leave', id: me.id });
        });
        ws.on('error', () => ws.terminate());
    });

    // Drop connections that stopped answering (closed laptop, lost wifi...).
    const heartbeat = setInterval(() => {
        for (const [ws, p] of players) {
            if (!p.alive) { ws.terminate(); continue; }
            p.alive = false;
            ws.ping();
        }
    }, 30000);
    wss.on('close', () => clearInterval(heartbeat));

    // A name was just chosen: label every open connection from that IP.
    function setName(ip, name) {
        for (const [ws, p] of players) {
            if (p.ip !== ip || p.name === name) continue;
            p.name = name;
            broadcast({ type: 'name', id: p.id, name }, ws);
        }
    }

    return { broadcast, setName, count: () => players.size };
}
