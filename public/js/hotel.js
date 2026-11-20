// hotel.js - lays out the lobby, the corridor and one Room per thread.
//
// LAYOUT: a lobby at z = 0..12 (the community paint board is on its back wall),
// then one straight corridor running toward -z
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
import { loadModel } from './models.js';
import { Showroom, SHOWROOM } from './showroom.js';

const HALF = 2;           // corridor half-width
const LOBBY = { halfW: 5, depth: 12 };    // you spawn at z = 4.5 facing the corridor; the paint board is behind you
// THE ANIMATION ROOM is behind the lobby's back wall, through a doorway left of the paint board: see showroom.js

// THE PAINT BOARD: on the lobby's back wall. Size in metres (2:1, like its 1024 x 512 pixels).
const PAINT = { W: 5, H: 2.5, Y: 1.65, FRAME: 0.08 };
const LIGHT_POOL = 6;     // a few real lights that follow the player (cheap)

// WALL PICTURES: every image in public/assets/ hangs once on a wall, alternating
// lobby / corridor. Spots are tried in this order; add or move spots here.
// Anyone can press E at a picture to hang their own image in that frame instead.
const PICTURE = { H: 1.4, Y: 1.6, FRAME: 0.06 };     // picture height (m), centre height, frame border
const PICTURE_MODEL = { SIZE: 0.8, OUT: 0.45, SPIN: 0.6 };   // an .obj in a frame: size (m), how far it floats out, spin speed
// Frames only load their picture / model when the player is this close (m): as far as you
// can see (the fog's far end, main.js), so everything in view down the corridor is filled in.
// Pictures are scaled down to PICTURE_MAX px: a full-size phone photo is far more than a 1.4 m frame needs.
const PICTURE_LOAD_DISTANCE = 45;
const PICTURE_MAX = 1024;
const ROOM_WAKE_DISTANCE = 4;     // a room's 3D models load when the player is this close to its door (or inside)

// THE LEVER: on the lobby's right wall, just right of where you spawn. Flipping it
// gives every frame a random uploaded image, with a slot-machine spin in every frame first.
const LEVER = { z: 5.4, y: 1.2, ANGLE: 0.6 };     // position along the right wall; handle swings +-ANGLE (up / down)
const SLOTS = { SPIN: 1.4, STAGGER: 0.25, MAX_TOTAL: 4, LOOPS: 6, HOLD: 0.4, TILE: 256, PRELOAD_WAIT: 2.5 };   // reel timings (s), tile size (px), max wait for the reel's pictures (s)
const LOBBY_SPOTS = [                                // x, z, rotY (which way it faces)
    { x: -LOBBY.halfW, z: 3, rotY: Math.PI / 2 },         // left wall, facing the lobby computer
    { x: -LOBBY.halfW, z: 8, rotY: Math.PI / 2 },         // left wall, further back
    { x: LOBBY.halfW, z: 8.5, rotY: -Math.PI / 2 },       // right wall, further back
    { x: -3.6, z: ROOM.T, rotY: 0 },                      // front wall, left of the corridor
    { x: 3.6, z: ROOM.T, rotY: 0 },                       // front wall, right of the corridor
    { x: 4, z: LOBBY.depth, rotY: Math.PI },              // back wall, right of the paint board
    { x: -LOBBY.halfW, z: 10.8, rotY: Math.PI / 2 },
    { x: LOBBY.halfW, z: 10.8, rotY: -Math.PI / 2 },
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
        this.wallImages = [];                 // [{ slot, url, model }]: one frame per file in public/assets/
        this.hallImages = {};                 // { 'hall-3': { url, model } }: empty corridor frames someone filled
        this.frames = [];                     // every frame on the walls now: { slot, photo, frame } (in hanging order)
        this.pictureModels = [];              // .obj models floating in frames (they spin)
        this.leverAngle = LEVER.ANGLE;        // the lever's handle: tilts to +ANGLE or -ANGLE
        this.leverTarget = LEVER.ANGLE;
        this.spin = null;                     // slot-machine animation while it runs
        this.pictureTextures = new Map();     // url -> texture (kept when the corridor is rebuilt)
        this.wallModels = new Map();          // url -> Promise<model> (an .obj in a frame, kept when the corridor is rebuilt)
        this.pendingPictures = [];            // frames waiting for the player to come near: { pos, load }
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

        // the animation room behind the lobby's back wall (built once, never rebuilt)
        this.showroom = new Showroom(mats, { halfW: LOBBY.halfW, z0: LOBBY.depth + ROOM.T });
        this.root.add(this.showroom.group);

        this.lights = [];
        for (let i = 0; i < LIGHT_POOL; i++) {
            const l = new THREE.PointLight(0xffffff, 7, 9, 1.6);
            scene.add(l);
            this.lights.push(l);
        }
    }

    async load() {
        const pictures = await this.api.listWallImages().catch((err) => {
            console.warn('No wall pictures:', err.message);
            return [];
        });
        this.wallImages = pictures.filter((p) => !p.slot.startsWith('hall-')).map((p) => ({ ...p, model: !!p.model }));
        for (const p of pictures) if (p.slot.startsWith('hall-')) this.hallImages[p.slot] = { url: p.url, model: !!p.model };
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
        // the .obj models in frames are kept between rebuilds: take them out before freeing the rest
        for (const m of this.pictureModels) m.removeFromParent();
        const g = (this.corridor = new THREE.Group());
        this.frames = [];
        this.pictureModels = [];
        this.pendingPictures = [];
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
        // back wall, with the doorway into the animation room (showroom.js) left of the paint board
        {
            const { DOOR_W, DOOR_H } = ROOM;
            const zb = depth + T / 2, dx = SHOWROOM.DOOR_X;
            const left = -(halfW + T), right = halfW + T, a = dx - DOOR_W / 2, b = dx + DOOR_W / 2;
            addBox(g, { w: a - left, h: H, d: T, x: (left + a) / 2, y: H / 2, z: zb, mat: m.wall, collider: true });
            addBox(g, { w: right - b, h: H, d: T, x: (b + right) / 2, y: H / 2, z: zb, mat: m.wall, collider: true });
            addBox(g, { w: DOOR_W, h: H - DOOR_H, d: T, x: dx, y: DOOR_H + (H - DOOR_H) / 2, z: zb, mat: m.wall });
            for (const s of [-1, 1]) {                    // door frame, like the thread rooms'
                addBox(g, { w: 0.08, h: DOOR_H, d: T + 0.06, x: dx + s * (DOOR_W / 2 + 0.04), y: DOOR_H / 2, z: zb, mat: m.trim });
            }
            addBox(g, { w: DOOR_W + 0.16, h: 0.08, d: T + 0.06, x: dx, y: DOOR_H + 0.04, z: zb, mat: m.trim });
        }
        for (const side of [1, -1]) {
            addBox(g, { w: T, h: H, d: depth, x: side * (halfW + T / 2), y: H / 2, z: depth / 2, mat: m.wall, collider: true });
            const fw = halfW + T - HALF;
            addBox(g, { w: fw, h: H, d: T, x: side * (HALF + fw / 2), y: H / 2, z: T / 2, mat: m.wall, collider: true });
        }
        for (const lz of [3, 8.5]) {
            addBox(g, { w: 1.2, h: 0.04, d: 1.2, y: H - 0.02, z: lz, mat: m.light });
            this.lightSpots.push(new THREE.Vector3(0, H - 0.4, lz), new THREE.Vector3(3, H - 0.4, lz));
        }
        this.lightSpots.push(new THREE.Vector3(0, H - 0.6, depth - 2));     // lights the paint board
        this.lightSpots.push(...this.showroom.lightSpots);

        // lobby computer against the right wall, facing into the lobby: start a new thread
        buildComputerDesk(g, m, this.lobbyStation, { x: halfW - 0.5, z: 3, rotY: -Math.PI / 2, onChange: () => { this.dirty = true; } });

        // LOBBY SIGN: on the wall above the lobby computer. Text: CONFIG.LOBBY_SIGN_TEXT.
        // w/h = size in metres, y = height of its centre, z = position along the wall.
        addSign(g, labelTexture(CONFIG.LOBBY_SIGN_TEXT), { w: 2.6, h: 0.49, x: halfW - 0.01, y: 2.2, z: 3, rotY: -Math.PI / 2 });

        this.buildLever(g);
        this.buildPaintBoard(g);
        this.hangPictures(g, L);
        this.forgetUnusedPictures();
        this.dirty = true;
    }

    // The community paint board on the lobby's back wall. Its picture is the paint module's
    // texture (paint.js), which survives this being rebuilt.
    buildPaintBoard(g) {
        if (!this.paint) return;
        const board = new THREE.Group();
        board.position.set(0, PAINT.Y, LOBBY.depth);
        board.rotation.y = Math.PI;                       // face into the lobby
        g.add(board);
        const f = PAINT.FRAME;
        const frame = new THREE.Mesh(new THREE.BoxGeometry(PAINT.W + 2 * f, PAINT.H + 2 * f, 0.05), this.pictureMat);
        frame.position.z = 0.025;
        const surface = new THREE.Mesh(new THREE.PlaneGeometry(PAINT.W, PAINT.H),
            new THREE.MeshBasicMaterial({ map: this.paint.texture, toneMapped: false }));
        surface.position.z = 0.051;
        surface.userData.ownsMaterial = true;
        surface.userData.keepMap = true;                  // the texture belongs to paint.js
        board.add(frame, surface);
        frame.userData.interact = surface.userData.interact = { type: 'board' };
        this.paintSurface = surface;
    }

    // Where to stand to paint: in front of the board, far enough back to see all of it.
    paintPose(camera) {
        const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
        const fit = Math.max((PAINT.H / 2) / Math.tan(halfV), (PAINT.W / 2) / (Math.tan(halfV) * camera.aspect));
        const d = Math.min(fit * 1.12, LOBBY.depth - 1);
        return {
            pos: new THREE.Vector3(0, PAINT.Y, LOBBY.depth - d),
            look: new THREE.Vector3(0, PAINT.Y, LOBBY.depth),
        };
    }

    // A lever on the lobby's right wall, near the spawn point. Local +z points out of the
    // wall into the lobby. Its handle (this.leverPivot) swings up/down, animated in update().
    buildLever(g) {
        const lever = new THREE.Group();
        lever.position.set(LOBBY.halfW, LEVER.y, LEVER.z);
        lever.rotation.y = -Math.PI / 2;                  // face into the lobby
        g.add(lever);
        const dark = this.mats.dark;
        addBox(lever, { w: 0.26, h: 0.4, d: 0.04, z: 0.02, mat: dark });                        // wall plate
        addBox(lever, { w: 0.04, h: 0.12, d: 0.1, x: -0.07, z: 0.08, mat: dark });              // the two cheeks
        addBox(lever, { w: 0.04, h: 0.12, d: 0.1, x: 0.07, z: 0.08, mat: dark });
        this.leverPivot = new THREE.Group();
        this.leverPivot.position.z = 0.09;
        this.leverPivot.rotation.x = this.leverAngle;
        lever.add(this.leverPivot);
        addBox(this.leverPivot, { w: 0.035, h: 0.035, d: 0.42, z: 0.21, mat: this.mats.trim });   // handle, sticking out
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 10), new THREE.MeshStandardMaterial({ color: 0xcc1111, roughness: 0.4 }));
        knob.position.z = 0.44;
        knob.userData.ownsMaterial = true;
        this.leverPivot.add(knob);
        // an invisible box around it all: what you aim at to press E
        const hit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.6), new THREE.MeshBasicMaterial());
        hit.position.z = 0.3;
        hit.visible = false;
        hit.userData.ownsMaterial = true;
        hit.userData.interact = { type: 'lever' };
        lever.add(hit);
    }

    // Flips the handle to the other side (animated in update()).
    flipLever() { this.leverTarget = -this.leverTarget; }

    // Every frame's slot, for the server to fill when the lever is pulled.
    frameSlots() { return this.frames.map((f) => f.slot); }

    // Every wall image once: alternating lobby / corridor (the corridor's left
    // wall, across from the doors). If one side is full, the rest go on the other.
    // Every corridor spot left over gets an EMPTY frame (more appear as the corridor
    // grows); press E at one to hang your own image there.
    hangPictures(g, L) {
        const { SLOT } = ROOM;
        const corridor = [];
        for (let z = -SLOT / 2; z > -L + 1; z -= SLOT) corridor.push({ x: -HALF, z, rotY: Math.PI / 2 });   // opposite each door
        for (let z = -SLOT; z > -L + 1; z -= SLOT) corridor.push({ x: -HALF, z, rotY: Math.PI / 2 });       // then in between
        const lobby = [...LOBBY_SPOTS];
        this.wallImages.forEach((pic, i) => {
            const first = i % 2 === 0 ? lobby : corridor;
            const spot = first.shift() ?? (first === lobby ? corridor : lobby).shift();
            if (spot) this.addPicture(g, pic, spot);
            else console.warn('No wall space left for', pic.slot);
        });
        for (const spot of corridor) {
            const slot = `hall-${Math.round(-spot.z / (SLOT / 2))}`;     // by position: hall-1 is 4 m in, hall-2 8 m...
            this.addPicture(g, { slot, url: null, model: false, ...this.hallImages[slot] }, spot);
        }
    }

    // Someone hung a new image in a frame (us, or another player live).
    setWallImage(slot, url, model = false) {
        if (this.storePicture(slot, url, model)) this.buildCorridor();
    }

    // Several at once (the lever): one rebuild.
    setWallImages(pictures) {
        let changed = false;
        for (const p of pictures) changed = this.storePicture(p.slot, p.url, !!p.model) || changed;
        if (changed) this.buildCorridor();
    }

    storePicture(slot, url, model) {
        if (slot.startsWith('hall-')) {
            if (this.hallImages[slot]?.url === url) return false;
            this.hallImages[slot] = { url, model };
            return true;
        }
        const pic = this.wallImages.find((p) => p.slot === slot);
        if (!pic || pic.url === url) return false;
        pic.url = url;
        pic.model = model;
        return true;
    }

    addPicture(parent, { slot, url, model }, { x, z, rotY }) {
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
        frame.userData.interact = photo.userData.interact = { type: 'picture', slot };   // press E to change it
        this.frames.push({ slot, photo, frame });

        // empty frame (nobody hung anything here yet), or one with an .obj: blank card, portrait 3:4
        if (!url || model) {
            photo.material.color.set(0xf2efe6);
            photo.scale.x = PICTURE.H * 0.75;
            frame.scale.x = PICTURE.H * 0.75 + 2 * f;
        }
        if (!url) return;
        const later = (load) => this.pendingPictures.push({ pos: new THREE.Vector3(x, PICTURE.Y, z), load });
        if (model) {
            // the .obj floats in front of the card, scaled down to fit the frame, slowly spinning
            const corridor = this.corridor;
            later(() => this.wallModel(url).then((model) => {
                if (this.corridor !== corridor) return;                    // rebuilt meanwhile
                const object = model.parent ? model.clone() : model;       // the same .obj in two frames: a copy
                object.position.z = PICTURE_MODEL.OUT;
                pic.add(object);
                this.pictureModels.push(object);
            }).catch((err) => console.warn('Wall model failed to load', url, err)));
            return;
        }

        // width follows the image's shape once it has loaded
        const fit = (tex) => {
            const w = PICTURE.H * (tex.image.width / tex.image.height);
            photo.scale.x = w;
            frame.scale.x = w + 2 * f;
            photo.material.map = tex;
            photo.material.needsUpdate = true;
        };
        photo.scale.x = frame.scale.x = 0.0001;   // hidden until loaded
        const tex = this.pictureTextures.get(url);
        if (tex?.image?.width) fit(tex);          // already loaded (before a rebuild): show it now
        else later(() => this.pictureTexture(url).userData.ready.push(fit));
    }

    // A wall picture as a texture, scaled down to PICTURE_MAX px. Loaded once per url.
    pictureTexture(url) {
        let tex = this.pictureTextures.get(url);
        if (tex) return tex;
        tex = new THREE.Texture();
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.userData.ready = [];
        this.pictureTextures.set(url, tex);
        const img = new Image();
        img.onload = () => {
            const s = Math.min(1, PICTURE_MAX / Math.max(img.width, img.height));
            let source = img;
            if (s < 1) {
                source = document.createElement('canvas');
                source.width = Math.round(img.width * s);
                source.height = Math.round(img.height * s);
                source.getContext('2d').drawImage(img, 0, 0, source.width, source.height);
            }
            tex.image = source;
            tex.needsUpdate = true;
            tex.userData.ready.forEach((fn) => fn(tex));
            tex.userData.ready = [];
        };
        img.onerror = () => console.warn('Wall picture failed to load', url);
        img.src = url;
        return tex;
    }

    // An .obj for a frame: downloaded and parsed once, then kept between rebuilds
    // (the lever and picture changes rebuild every frame; re-parsing big .obj files froze the game).
    wallModel(url) {
        let p = this.wallModels.get(url);
        if (!p) {
            p = loadModel(url, PICTURE_MODEL.SIZE).then(({ object }) => {
                object.traverse((o) => {
                    if (!o.isMesh) return;
                    o.userData.ownsMaterial = false;      // a corridor rebuild must not free it...
                    o.geometry.userData.shared = true;    // ...forgetUnusedPictures() does, once it's off the walls
                });
                return object;
            });
            p.catch(() => this.wallModels.delete(url));
            this.wallModels.set(url, p);
        }
        return p;
    }

    // After a rebuild: free the pictures / models that no frame shows any more.
    forgetUnusedPictures() {
        const used = new Set([...this.wallImages, ...Object.values(this.hallImages)].map((p) => p.url));
        for (const [url, tex] of this.pictureTextures) {
            if (used.has(url)) continue;
            tex.dispose();
            this.pictureTextures.delete(url);
        }
        for (const [url, p] of this.wallModels) {
            if (used.has(url)) continue;
            this.wallModels.delete(url);
            p.then((object) => object.traverse((o) => {
                if (!o.isMesh) return;
                o.geometry.dispose();
                for (const m of [].concat(o.material)) { m.map?.dispose(); m.dispose(); }
            })).catch(() => {});
        }
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

    // ------------------------------------------------------------------ slot machine (the lever)
    // Every frame spins like a slot-machine reel of the real new pictures, the reels stop
    // one after another, each on its new picture, then the pictures hang for real.
    // pictures: [{ slot, url, model }] from the server.
    async startSlots(pictures) {
        const token = (this.slotsToken = {});
        // the reel: one tile per different new picture (at most 16, at least 4: repeated if needed)
        let tiles = [...new Set(pictures.filter((p) => p.url && !p.model).map((p) => p.url))].slice(0, 16);
        // load the reel's pictures first (they're also what the frames show afterwards), so it
        // spins real pictures. Never waits longer than PRELOAD_WAIT: a slow one is a plain tile.
        const textures = tiles.map((url) => this.pictureTexture(url));
        await Promise.race([
            Promise.all(textures.map((tex) => (tex.image?.width ? null : new Promise((done) => tex.userData.ready.push(done))))),
            new Promise((done) => setTimeout(done, SLOTS.PRELOAD_WAIT * 1000)),
        ]);
        if (this.slotsToken !== token) return;          // another pull came in meanwhile: that one wins
        if (this.spin) this.finishSlots();              // a new pull while spinning: land the old one first
        const bySlot = new Map(pictures.map((p) => [p.slot, p]));
        if (!tiles.length) tiles = [null];
        while (tiles.length < 4) tiles = tiles.concat(tiles);
        const N = tiles.length, T = SLOTS.TILE;
        const canvas = document.createElement('canvas');
        canvas.width = T;
        canvas.height = T * N;
        const g = canvas.getContext('2d');
        const reel = new THREE.CanvasTexture(canvas);
        reel.colorSpace = THREE.SRGBColorSpace;
        tiles.forEach((url, i) => {
            g.fillStyle = `hsl(${(i * 67) % 360} 45% 40%)`;    // shows only if its picture didn't load in time
            g.fillRect(0, i * T, T, T);
            const img = url && this.pictureTextures.get(url)?.image;
            if (!img?.width) return;
            const s = Math.max(T / img.width, T / img.height);  // cover the tile, keep the picture's shape
            g.save();
            g.beginPath(); g.rect(0, i * T, T, T); g.clip();
            g.drawImage(img, (T - img.width * s) / 2, i * T + (T - img.height * s) / 2, img.width * s, img.height * s);
            g.restore();
        });

        const step = Math.min(SLOTS.STAGGER, (SLOTS.MAX_TOTAL - SLOTS.SPIN) / Math.max(1, this.frames.length));
        const reels = this.frames.map((fr, i) => {
            const target = bySlot.get(fr.slot);
            const k = target ? Math.max(0, tiles.indexOf(target.url)) : i % N;
            const map = reel.clone();
            map.wrapT = THREE.RepeatWrapping;
            map.repeat.set(1, 1 / N);
            const old = fr.photo.material;
            fr.photo.material = new THREE.MeshBasicMaterial({ map, toneMapped: false });
            old.dispose();
            fr.photo.scale.x = PICTURE.H * 0.75;
            fr.frame.scale.x = PICTURE.H * 0.75 + 2 * PICTURE.FRAME;
            return { map, final: 1 - (k + 1) / N, stopAt: SLOTS.SPIN + i * step, loops: SLOTS.LOOPS + (i % 3) };
        });
        this.spin = { t: 0, reels, reel, pictures, end: SLOTS.SPIN + reels.length * step + SLOTS.HOLD };
    }

    finishSlots() {
        const { pictures, reel } = this.spin;
        this.spin = null;
        this.setWallImages(pictures);                    // rebuilds the frames with the real pictures
        reel.dispose();
    }

    updateSlots(dt) {
        const s = this.spin;
        s.t += dt;
        const ease = (x) => 1 - (1 - x) ** 3;
        for (const r of s.reels) {
            const p = Math.min(1, s.t / r.stopAt);
            r.map.offset.y = r.final + r.loops * (1 - ease(p));
        }
        if (s.t >= s.end) this.finishSlots();
    }

    // ------------------------------------------------------------------ per frame
    update(dt, playerPos) {
        this.refresh();
        // lever handle, frame models, slot machine
        this.leverAngle += (this.leverTarget - this.leverAngle) * Math.min(1, dt * 12);
        if (this.leverPivot) this.leverPivot.rotation.x = this.leverAngle;
        for (const m of this.pictureModels) m.rotation.y += dt * PICTURE_MODEL.SPIN;
        if (this.spin) this.updateSlots(dt);
        this.showroom.update(dt, playerPos);
        // wall pictures / models: load when the player comes near
        if (this.pendingPictures.length) {
            this.pendingPictures = this.pendingPictures.filter((p) => {
                if (p.pos.distanceTo(playerPos) > PICTURE_LOAD_DISTANCE) return true;
                p.load();
                return false;
            });
        }
        for (const room of this.rooms) {
            room.update(dt, playerPos);
            // lazy-load replies when the player gets close to the door...
            const doorDist = playerPos.distanceTo(room.doorWorld);
            if (!room.replies && !room.loading && doorDist < 16) room.load(this.api);
            // ...and the 3D models (the big downloads) only when they come in
            if (!room.awake && (doorDist < ROOM_WAKE_DISTANCE || room.containsPoint(playerPos, this._tmp))) room.wake();
        }
        // move the light pool to the nearest light spots
        const nearest = this._lightCandidates
            .map((p) => [p, p.distanceToSquared(playerPos)])
            .sort((a, b) => a[1] - b[1]);
        this.lights.forEach((l, i) => { if (nearest[i]) l.position.copy(nearest[i][0]); });
    }
}
