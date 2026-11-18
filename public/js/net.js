// net.js - multiplayer over a WebSocket (/ws on the same server).
//
// - Sends where you are ~10 times a second (only when you moved).
// - Shows every other connected player as a plain pill.
// - Receives new threads / replies that other people post, so the hotel updates live.
// - Gun (gun.js): sends our shots so others see the balls, and tells the server
//   when one of our balls hit someone; receives the same from others.
//
// Positions inside or next to a room are sent RELATIVE to that room (its thread id),
// so a pill stays in the right room even if rooms are in a different order on
// someone else's screen for a moment.

import * as THREE from 'three';

const SEND_EVERY = 0.1;          // seconds
const PILL_RADIUS = 0.3;
const PILL_HEIGHT = 1.7;         // total height, feet on the floor
const NAME_HEIGHT = 0.32;        // username label above the pill: height in metres
const NAME_FONT = '64px "Pirata One", cursive';   // silly pirate font (loaded in index.html)

// A floating label with the player's name (always faces the camera).
function nameSprite(name) {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const font = NAME_FONT;
    g.font = font;
    c.width = Math.ceil(g.measureText(name).width) + 40;
    c.height = 96;
    g.font = font;
    g.fillStyle = 'rgba(0, 0, 0, 0.55)';
    g.beginPath();
    g.roundRect(0, 0, c.width, c.height, 18);
    g.fill();
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText(name, c.width / 2, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, toneMapped: false }));
    sprite.scale.set(NAME_HEIGHT * (c.width / c.height), NAME_HEIGHT, 1);
    sprite.position.y = PILL_HEIGHT / 2 + 0.25;
    return sprite;
}

export class Multiplayer {
    constructor({ scene, camera, hotel, onThread, onReply, onShot, onHit, onWallImage }) {
        this.scene = scene;
        this.camera = camera;
        this.hotel = hotel;
        this.onThread = onThread;
        this.onReply = onReply;
        this.onShot = onShot;          // (origin, dir) in world space: someone else fired
        this.onHit = onHit;            // (dir) in world space: one of their balls hit US
        this.onWallImage = onWallImage;   // (slot, url): someone changed a lobby/corridor picture
        this.getAir = () => 0;         // our height above the floor (set by main.js)
        this.ws = null;
        this.players = new Map();          // id -> { mesh, pose, ready, label }
        this.names = new Map();            // id -> username (can arrive before or after their position)
        this.sendTimer = 0;
        this.lastSent = '';
        this.retry = 1000;
        this._v = new THREE.Vector3();
        this._e = new THREE.Euler(0, 0, 0, 'YXZ');

        this.pillGeometry = new THREE.CapsuleGeometry(PILL_RADIUS, PILL_HEIGHT - 2 * PILL_RADIUS, 6, 16);
        this.pillMaterial = new THREE.MeshStandardMaterial({ color: 0x4a7bd0, roughness: 0.6 });
        setInterval(() => this.send({ type: 'hb' }), 25000);     // keeps idle connections open
    }

    get online() { return this.players.size + (this.ws?.readyState === WebSocket.OPEN ? 1 : 0); }

    connect() {
        const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
        const ws = (this.ws = new WebSocket(url));
        ws.onopen = () => { this.retry = 1000; this.lastSent = ''; };
        ws.onmessage = (e) => {
            let msg;
            try { msg = JSON.parse(e.data); } catch { return; }
            this.handle(msg);
        };
        ws.onclose = () => {
            // server restarted / free instance woke up / wifi blip: clear pills and reconnect
            for (const id of [...this.players.keys()]) this.removePlayer(id);
            this.names.clear();
            setTimeout(() => this.connect(), this.retry);
            this.retry = Math.min(this.retry * 2, 30000);
        };
    }

    send(msg) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    }

    handle(msg) {
        switch (msg.type) {
            case 'welcome':
                for (const p of msg.players) {
                    if (p.name) this.names.set(p.id, p.name);
                    this.setPose(p.id, p);
                }
                break;
            case 'wallImage':
                this.onWallImage(msg.slot, msg.url);
                break;
            case 'name':
                this.names.set(msg.id, msg.name);
                if (this.players.has(msg.id)) this.setLabel(this.players.get(msg.id), msg.name);
                break;
            case 'pose':
                this.setPose(msg.id, msg);
                break;
            case 'leave':
                this.removePlayer(msg.id);
                break;
            case 'thread':
                this.onThread(msg.thread);
                break;
            case 'reply':
                this.onReply(msg.reply);
                break;
            case 'shot': {
                const o = this.toWorld(msg.room, msg.x, msg.z, msg.dx, msg.dz);
                if (o) this.onShot(new THREE.Vector3(o.x, msg.y, o.z), new THREE.Vector3(o.dx, msg.dy, o.dz));
                break;
            }
            case 'hit': {
                const o = this.toWorld(msg.room, 0, 0, msg.dx, msg.dz);
                if (o) this.onHit(new THREE.Vector3(o.dx, 0, o.dz).normalize());
                break;
            }
        }
    }

    setPose(id, pose) {
        let p = this.players.get(id);
        if (!p) {
            const mesh = new THREE.Mesh(this.pillGeometry, this.pillMaterial);
            mesh.visible = false;
            this.scene.add(mesh);
            p = { id, mesh, pose: null, ready: false, label: null };
            this.players.set(id, p);
            if (this.names.has(id)) this.setLabel(p, this.names.get(id));
        }
        p.pose = { room: pose.room ?? null, x: pose.x, y: pose.y ?? 0, z: pose.z, ry: pose.ry };
    }

    setLabel(p, name) {
        // wait for the pirate font, or the label gets drawn in a plain font
        document.fonts.load(NAME_FONT, name).catch(() => {}).then(() => {
            if (this.players.get(p.id) === p) this.drawLabel(p, name);
        });
    }

    drawLabel(p, name) {
        if (p.label) {
            p.mesh.remove(p.label);
            p.label.material.map.dispose();
            p.label.material.dispose();
        }
        p.label = nameSprite(name);
        p.mesh.add(p.label);
    }

    removePlayer(id) {
        const p = this.players.get(id);
        if (!p) return;
        if (p.label) { p.label.material.map.dispose(); p.label.material.dispose(); }
        this.scene.remove(p.mesh);
        this.players.delete(id);
        this.names.delete(id);
    }

    // A point + flat direction relative to a room (or the world if room is null)
    // -> world space using OUR room layout. null if we don't have that room.
    toWorld(roomId, x, z, dx, dz) {
        if (roomId === null) return { x, z, dx, dz };
        const room = this.hotel.rooms.find((r) => r.id === roomId);
        if (!room) return null;
        const w = room.group.localToWorld(this._v.set(x, 0, z));
        const a = room.group.rotation.y, c = Math.cos(a), s = Math.sin(a);
        return { x: w.x, z: w.z, dx: dx * c + dz * s, dz: -dx * s + dz * c };
    }

    // The opposite of toWorld: world point + flat direction -> relative to `room` (or null).
    toRoom(room, x, z, dx, dz) {
        if (!room) return { room: null, x, z, dx, dz };
        const l = room.group.worldToLocal(this._v.set(x, 0, z));
        const a = -room.group.rotation.y, c = Math.cos(a), s = Math.sin(a);
        return { room: room.id, x: l.x, z: l.z, dx: dx * c + dz * s, dz: -dx * s + dz * c };
    }

    roomFor(pos) {
        return this.hotel.roomAt(pos) || (pos.z < 0 ? this.hotel.nearestRoom(pos) : null);
    }

    // ------------------------------------------------------------------ gun
    sendShot(origin, dir) {
        const r = (n) => Math.round(n * 1000) / 1000;
        const o = this.toRoom(this.roomFor(origin), origin.x, origin.z, dir.x, dir.z);
        this.send({ type: 'shot', room: o.room, x: r(o.x), y: r(origin.y), z: r(o.z), dx: r(o.dx), dy: r(dir.y), dz: r(o.dz) });
    }

    // Our ball hit player `id`, flying along flat direction `dir` (world space).
    sendHit(id, dir) {
        const p = this.players.get(id);
        if (!p?.pose) return;
        // in the hit player's room frame, so it points the same way on their screen
        const room = p.pose.room === null ? null : this.hotel.rooms.find((r) => r.id === p.pose.room);
        const o = this.toRoom(room, 0, 0, dir.x, dir.z);
        this.send({ type: 'hit', id, room: room ? room.id : null, dx: Math.round(o.dx * 1000) / 1000, dz: Math.round(o.dz * 1000) / 1000 });
    }

    // Id of the player whose pill a ball at `p` (radius r) touches, or null.
    pillAt(p, r) {
        for (const [id, pl] of this.players) {
            const m = pl.mesh;
            if (!m.visible) continue;
            const dx = p.x - m.position.x, dz = p.z - m.position.z;
            if (dx * dx + dz * dz < (PILL_RADIUS + r) ** 2 && Math.abs(p.y - m.position.y) < PILL_HEIGHT / 2 + r) return id;
        }
        return null;
    }

    // Converts a received pose into world space using OUR room layout.
    worldPose(pose) {
        if (pose.room === null) return { x: pose.x, z: pose.z, ry: pose.ry };
        const room = this.hotel.rooms.find((r) => r.id === pose.room);
        if (!room) return null;                                   // we don't have that room (yet)
        const w = room.group.localToWorld(this._v.set(pose.x, 0, pose.z));
        return { x: w.x, z: w.z, ry: pose.ry + room.group.rotation.y };
    }

    // Our pose, relative to the room we're in (or the nearest door when in the corridor).
    myPose() {
        const pos = this.camera.position;
        const yaw = this._e.setFromQuaternion(this.camera.quaternion).y;
        const room = this.roomFor(pos);
        if (!room) return { room: null, x: pos.x, z: pos.z, ry: yaw };
        const local = room.group.worldToLocal(this._v.copy(pos));
        return { room: room.id, x: local.x, z: local.z, ry: yaw - room.group.rotation.y };
    }

    update(dt) {
        // send our position (only when it changed)
        this.sendTimer += dt;
        if (this.sendTimer >= SEND_EVERY) {
            this.sendTimer = 0;
            const pose = this.myPose();
            const r = (n) => Math.round(n * 100) / 100;
            const msg = { type: 'pose', room: pose.room, x: r(pose.x), y: r(this.getAir()), z: r(pose.z), ry: r(pose.ry) };
            const key = JSON.stringify(msg);
            if (key !== this.lastSent) {
                this.send(msg);
                this.lastSent = key;
            }
        }

        // move pills smoothly towards where they should be
        const k = 1 - Math.exp(-dt * 12);
        for (const p of this.players.values()) {
            const target = p.pose && this.worldPose(p.pose);
            if (!target) { p.mesh.visible = false; continue; }
            const m = p.mesh;
            if (!p.ready || !m.visible) {
                m.position.set(target.x, PILL_HEIGHT / 2 + p.pose.y, target.z);
                m.rotation.y = target.ry;
                p.ready = true;
            } else {
                m.position.x += (target.x - m.position.x) * k;
                m.position.z += (target.z - m.position.z) * k;
                m.position.y += (PILL_HEIGHT / 2 + p.pose.y - m.position.y) * k;
                m.rotation.y = target.ry;
            }
            m.visible = true;
        }
    }
}
