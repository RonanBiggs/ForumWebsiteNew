// hotel.js - lays out the lobby, the corridor and one Room per thread.
//
// LAYOUT: a lobby at z = 0..6, then one straight corridor running toward -z
// with ONE continuous row of rooms on its right-hand side. Rooms are sorted by
// latest activity (newest thread/reply first), so the most recently active
// thread is the first door from the lobby. Each room is as deep as its
// replies need (see roomDepth in room.js).
// All the look (sizes, materials, signs) is placeholder: replace
// buildCorridor()/Room.build*() with your own models whenever you like; the
// rest of the game only needs `colliders()`, `interactables()`, `roomAt()`.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { addBox, addSign, disposeTree } from './materials.js';
import { Room, ROOM } from './room.js';
import { Station, buildComputerDesk } from './computer.js';
import { FONTS, labelTexture } from './textures.js';

const HALF = 2;           // corridor half-width
const LOBBY = { halfW: 5, depth: 6 };
const LIGHT_POOL = 6;     // a few real lights that follow the player (cheap)

export class Hotel {
    constructor(scene, mats, api) {
        this.scene = scene;
        this.mats = mats;
        this.api = api;
        this.root = new THREE.Group();
        scene.add(this.root);
        this.rooms = [];
        this.corridor = null;
        this.dirty = true;
        this.lightSpots = [];
        this._tmp = new THREE.Vector3();

        // the lobby computer, where new threads are started
        this.lobbyStation = new Station({
            kind: 'thread',
            drawIdle: (g, w, h) => {
                g.fillStyle = '#ffffff';
                g.textBaseline = 'top';
                g.font = `bold 44px ${FONTS.MONO}`;
                g.fillText('NEW THREAD', 60, 60);
                g.font = `34px ${FONTS.MONO}`;
                g.fillText('[E] sit down to start', 60, h - 130);
            },
        });

        this.lights = [];
        for (let i = 0; i < LIGHT_POOL; i++) {
            const l = new THREE.PointLight(0xffffff, 7, 9, 1.6);
            scene.add(l);
            this.lights.push(l);
        }
    }

    async load() {
        const threads = await this.api.listThreads();
        threads.forEach((t) => this.addRoom(t, false));
        this.layout();
    }

    addRoom(thread, relayout = true) {
        const room = new Room(thread, this.mats, () => { this.dirty = true; });
        this.root.add(room.group);
        room.build();
        this.rooms.push(room);
        if (relayout) this.layout();
        return room;
    }

    // Sort rooms newest-activity-first and line them up along the corridor.
    // Prototype note: this only runs on load and when a thread is created, so a
    // room doesn't slide away while you're standing in it after replying.
    layout() {
        this.rooms.sort((a, b) =>
            b.latestDate.localeCompare(a.latestDate) || b.id - a.id);
        this.rooms.forEach((room, i) => {
            room.place(HALF + ROOM.T, -(ROOM.SLOT / 2 + i * ROOM.SLOT), -Math.PI / 2);
        });
        this.buildCorridor();
    }

    buildCorridor() {
        if (this.corridor) {
            disposeTree(this.corridor);
            this.corridor.removeFromParent();
        }
        const g = (this.corridor = new THREE.Group());
        this.root.add(g);
        const m = this.mats;
        const { H, T, SLOT } = ROOM;
        const L = Math.max(2, this.rooms.length) * SLOT;
        this.lightSpots = [];

        // corridor: rooms are all on the right (+x); the left side is one long wall
        addBox(g, { w: HALF * 2, h: 0.1, d: L, y: -0.05, z: -L / 2, mat: m.floor });
        addBox(g, { w: HALF * 2, h: 0.1, d: L, y: H + 0.05, z: -L / 2, mat: m.ceiling });
        addBox(g, { w: HALF * 2 + 2 * T, h: H, d: T, y: H / 2, z: -L - T / 2, mat: m.wall, collider: true });
        addBox(g, { w: T, h: H, d: L, x: -(HALF + T / 2), y: H / 2, z: -L / 2, mat: m.wall, collider: true });
        // plain wall on the right after the last room (only when there are < 2 rooms)
        const used = this.rooms.length * SLOT;
        if (used < L) {
            addBox(g, { w: T, h: H, d: L - used, x: HALF + T / 2, y: H / 2, z: -used - (L - used) / 2, mat: m.wall, collider: true });
        }
        for (let z = -2; z > -L; z -= 4) {
            addBox(g, { w: 0.6, h: 0.04, d: 0.6, y: H - 0.02, z, mat: m.light });
            this.lightSpots.push(new THREE.Vector3(0, H - 0.4, z));
        }

        // lobby
        const { halfW, depth } = LOBBY;
        addBox(g, { w: halfW * 2, h: 0.1, d: depth, y: -0.05, z: depth / 2, mat: m.floor });
        addBox(g, { w: halfW * 2, h: 0.1, d: depth, y: H + 0.05, z: depth / 2, mat: m.ceiling });
        addBox(g, { w: halfW * 2 + 2 * T, h: H, d: T, y: H / 2, z: depth + T / 2, mat: m.wall, collider: true });
        for (const side of [1, -1]) {
            addBox(g, { w: T, h: H, d: depth, x: side * (halfW + T / 2), y: H / 2, z: depth / 2, mat: m.wall, collider: true });
            const fw = halfW + T - HALF;
            addBox(g, { w: fw, h: H, d: T, x: side * (HALF + fw / 2), y: H / 2, z: T / 2, mat: m.wall, collider: true });
        }
        addBox(g, { w: 1.2, h: 0.04, d: 1.2, y: H - 0.02, z: 3, mat: m.light });
        this.lightSpots.push(new THREE.Vector3(0, H - 0.4, 3), new THREE.Vector3(3, H - 0.4, 3));

        // lobby computer against the right wall, facing into the lobby: start a new thread
        buildComputerDesk(g, m, this.lobbyStation, { x: halfW - 0.5, z: 3, rotY: -Math.PI / 2, onChange: () => { this.dirty = true; } });

        // LOBBY SIGN: on the wall above the lobby computer. Text: CONFIG.LOBBY_SIGN_TEXT.
        // w/h = size in metres, y = height of its centre, z = position along the wall.
        addSign(g, labelTexture(CONFIG.LOBBY_SIGN_TEXT), { w: 2.6, h: 0.49, x: halfW - 0.01, y: 2.2, z: 3, rotY: -Math.PI / 2 });

        this.dirty = true;
    }

    // ------------------------------------------------------------------ queries
    refresh() {
        if (!this.dirty) return;
        this.dirty = false;
        this.root.updateMatrixWorld(true);
        this._colliders = [];
        this._interactables = [];
        this.root.traverse((o) => {
            if (!o.isMesh) return;
            if (o.userData.collider) this._colliders.push(new THREE.Box3().setFromObject(o));
            if (o.userData.interact) this._interactables.push(o);
        });
        this._lightCandidates = [...this.lightSpots, ...this.rooms.map((r) => r.centerWorld)];
    }

    colliders() { this.refresh(); return this._colliders; }
    interactables() { this.refresh(); return this._interactables; }

    roomAt(pos) {
        return this.rooms.find((r) => r.containsPoint(pos, this._tmp)) || null;
    }

    // ------------------------------------------------------------------ per frame
    update(dt, playerPos) {
        this.refresh();
        for (const room of this.rooms) {
            room.update(dt, playerPos);
            // lazy-load replies when the player gets close to the door
            if (!room.replies && !room.loading && playerPos.distanceTo(room.doorWorld) < 16) room.load(this.api);
        }
        // move the light pool to the nearest light spots
        const nearest = this._lightCandidates
            .map((p) => [p, p.distanceToSquared(playerPos)])
            .sort((a, b) => a[1] - b[1]);
        this.lights.forEach((l, i) => { if (nearest[i]) l.position.copy(nearest[i][0]); });
    }
}
