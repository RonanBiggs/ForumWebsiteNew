// net.js - multiplayer over a WebSocket (/ws on the same server).
//
// - Sends where you are ~10 times a second (only when you moved).
// - Shows every other connected player as a plain pill.
// - Receives new threads / replies that other people post, so the hotel updates live.
//
// Positions inside or next to a room are sent RELATIVE to that room (its thread id),
// so a pill stays in the right room even if rooms are in a different order on
// someone else's screen for a moment.

import * as THREE from 'three';

const SEND_EVERY = 0.1;          // seconds
const PILL_RADIUS = 0.3;
const PILL_HEIGHT = 1.7;         // total height, feet on the floor

export class Multiplayer {
    constructor({ scene, camera, hotel, onThread, onReply }) {
        this.scene = scene;
        this.camera = camera;
        this.hotel = hotel;
        this.onThread = onThread;
        this.onReply = onReply;
        this.ws = null;
        this.players = new Map();          // id -> { mesh, pose, ready }
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
                for (const p of msg.players) this.setPose(p.id, p);
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
        }
    }

    setPose(id, pose) {
        let p = this.players.get(id);
        if (!p) {
            const mesh = new THREE.Mesh(this.pillGeometry, this.pillMaterial);
            mesh.visible = false;
            this.scene.add(mesh);
            p = { mesh, pose: null, ready: false };
            this.players.set(id, p);
        }
        p.pose = { room: pose.room ?? null, x: pose.x, z: pose.z, ry: pose.ry };
    }

    removePlayer(id) {
        const p = this.players.get(id);
        if (!p) return;
        this.scene.remove(p.mesh);
        this.players.delete(id);
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
        const room = this.hotel.roomAt(pos) || (pos.z < 0 ? this.hotel.nearestRoom(pos) : null);
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
            const msg = { type: 'pose', room: pose.room, x: r(pose.x), z: r(pose.z), ry: r(pose.ry) };
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
                m.position.set(target.x, PILL_HEIGHT / 2, target.z);
                m.rotation.y = target.ry;
                p.ready = true;
            } else {
                m.position.x += (target.x - m.position.x) * k;
                m.position.z += (target.z - m.position.z) * k;
                m.rotation.y = target.ry;
            }
            m.visible = true;
        }
    }
}
