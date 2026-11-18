// server/multiplayer.js - WebSocket at /ws: relays where everyone is standing,
// and pushes new threads/replies to every open page so the hotel updates live.
//
// Client -> server: { type: 'pose', room: <thread_id>|null, x, z, ry }
//                   { type: 'hb' }   (heartbeat, ignored)
//   Positions inside/near a room are sent RELATIVE to that room, because rooms
//   can be in a different order on different screens for a moment.
// Server -> client: { type: 'welcome', id, players: [{ id, room, x, z, ry }] }
//                   { type: 'pose', id, room, x, z, ry }
//                   { type: 'leave', id }
//                   { type: 'thread', thread }   { type: 'reply', reply }

import { WebSocketServer } from 'ws';

const MAX_MSGS_PER_SEC = 30;

function cleanPose(msg) {
    const num = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e5;
    const room = msg.room ?? null;
    if (room !== null && !(Number.isInteger(room) && room > 0)) return null;
    if (!num(msg.x) || !num(msg.z) || !num(msg.ry)) return null;
    return { room, x: msg.x, z: msg.z, ry: msg.ry };
}

export function attachMultiplayer(server) {
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
    const players = new Map();           // ws -> { id, pose, alive, msgs, windowStart }
    let nextId = 1;

    const send = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
    const broadcast = (msg, except = null) => {
        const data = JSON.stringify(msg);
        for (const ws of players.keys()) if (ws !== except && ws.readyState === ws.OPEN) ws.send(data);
    };

    wss.on('connection', (ws) => {
        const me = { id: nextId++, pose: null, alive: true, msgs: 0, windowStart: Date.now() };
        players.set(ws, me);
        send(ws, {
            type: 'welcome',
            id: me.id,
            players: [...players.values()].filter((p) => p !== me && p.pose).map((p) => ({ id: p.id, ...p.pose })),
        });

        ws.on('pong', () => { me.alive = true; });
        ws.on('message', (data) => {
            me.alive = true;
            const now = Date.now();
            if (now - me.windowStart > 1000) { me.windowStart = now; me.msgs = 0; }
            if (++me.msgs > MAX_MSGS_PER_SEC) return;            // flooding: drop
            let msg;
            try { msg = JSON.parse(data); } catch { return; }
            if (msg?.type !== 'pose') return;
            const pose = cleanPose(msg);
            if (!pose) return;
            me.pose = pose;
            broadcast({ type: 'pose', id: me.id, ...pose }, ws);
        });
        ws.on('close', () => {
            players.delete(ws);
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

    return { broadcast, count: () => players.size };
}
