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

// WALL PICTURES: every image in public/assets/ hangs once on a wall, alternating
// lobby / corridor. Spots are tried in this order; add or move spots here.
const PICTURE = { H: 1.4, Y: 1.6, FRAME: 0.06 };     // picture height (m), centre height, frame border
const LOBBY_SPOTS = [                                // x, z, rotY (which way it faces)
    { x: -LOBBY.halfW, z: 3, rotY: Math.PI / 2 },         // left wall, facing the lobby computer
    { x: 0, z: LOBBY.depth, rotY: Math.PI },              // back wall, middle
    { x: -3.6, z: ROOM.T, rotY: 0 },                      // front wall, left of the corridor
    { x: 3.6, z: ROOM.T, rotY: 0 },                       // front wall, right of the corridor
    { x: -3, z: LOBBY.depth, rotY: Math.PI },             // back wall, left
    { x: 3, z: LOBBY.depth, rotY: Math.PI },              // back wall, right
    { x: -LOBBY.halfW, z: 1.2, rotY: Math.PI / 2 },
    { x: -LOBBY.halfW, z: 4.8, rotY: Math.PI / 2 },
];

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
        this.wallImages = [];                 // URLs from public/assets/
        this.pictureTextures = new Map();     // url -> texture (kept when the corridor is rebuilt)
        this.pictureMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });   // frames

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
        this.wallImages = await this.api.listWallImages().catch((err) => {
            console.warn('No wall pictures:', err.message);
            return [];
        });
        const threads = await this.api.listThreads();
        threads.forEach((t) => this.addRoom(t, false));
        this.layout();
    }

    addRoom(thread, relayout = true) {
        // the same thread can arrive twice (we made it: API answer + live broadcast)
        const existing = this.rooms.find((r) => r.id === thread.thread_id);
        if (existing) return existing;
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

        this.hangPictures(g, L);
        this.dirty = true;
    }

    // Every wall image once: alternating lobby / corridor (the corridor's left
    // wall, across from the doors). If one side is full, the rest go on the other.
    hangPictures(g, L) {
        const { SLOT } = ROOM;
        const corridor = [];
        for (let z = -SLOT / 2; z > -L + 1; z -= SLOT) corridor.push({ x: -HALF, z, rotY: Math.PI / 2 });   // opposite each door
        for (let z = -SLOT; z > -L + 1; z -= SLOT) corridor.push({ x: -HALF, z, rotY: Math.PI / 2 });       // then in between
        const lobby = [...LOBBY_SPOTS];
        this.wallImages.forEach((url, i) => {
            const first = i % 2 === 0 ? lobby : corridor;
            const spot = first.shift() ?? (first === lobby ? corridor : lobby).shift();
            if (spot) this.addPicture(g, url, spot);
            else console.warn('No wall space left for', url);
        });
    }

    addPicture(parent, url, { x, z, rotY }) {
        const pic = new THREE.Group();
        pic.position.set(x, PICTURE.Y, z);
        pic.rotation.y = rotY;
        parent.add(pic);
        const f = PICTURE.FRAME;
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1, PICTURE.H + 2 * f, 0.04), this.pictureMat);
        frame.position.z = 0.02;
        const photo = new THREE.Mesh(new THREE.PlaneGeometry(1, PICTURE.H), new THREE.MeshBasicMaterial({ toneMapped: false }));
        photo.position.z = 0.041;
        photo.userData.ownsMaterial = true;     // the material is freed on rebuild...
        photo.userData.keepMap = true;          // ...but the texture stays cached for the next one
        pic.add(frame, photo);

        // width follows the image's shape once it has loaded
        const fit = (tex) => {
            const w = PICTURE.H * (tex.image.width / tex.image.height);
            photo.scale.x = w;
            frame.scale.x = w + 2 * f;
            photo.material.map = tex;
            photo.material.needsUpdate = true;
        };
        let tex = this.pictureTextures.get(url);
        if (!tex) {
            tex = new THREE.TextureLoader().load(url, () => {
                tex.userData.ready.forEach((fn) => fn(tex));
                tex.userData.ready = [];
            });
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = 8;
            tex.userData.ready = [];
            this.pictureTextures.set(url, tex);
        }
        photo.scale.x = frame.scale.x = 0.0001;   // hidden until loaded
        if (tex.image?.width) fit(tex);
        else tex.userData.ready.push(fit);
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

    nearestRoom(pos) {
        let best = null, bestD = Infinity;
        for (const r of this.rooms) {
            const d = r.doorWorld.distanceToSquared(pos);
            if (d < bestD) { bestD = d; best = r; }
        }
        return best;
    }

    // A reply arrived (ours or someone else's). Returns false if we don't know the thread.
    addReply(reply) {
        const room = this.rooms.find((r) => r.id === reply.post_thread);
        if (!room) return false;
        room.addReply(reply);
        return true;
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
