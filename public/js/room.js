// room.js - one hotel room = one forum thread.
//
// Local coordinates: the doorway is at z = 0 and the room extends into -z.
// The front wall (with the door) sits at z = 0..T and faces the corridor.
// Walking in (facing -z), the LEFT wall is at x = -W/2: every TEXT reply hangs
// there as a board, in one row, oldest nearest the door. The room gets longer to fit them.
// IMAGE replies don't get a board: they float as a cube (textured with the image)
// in front of the board of the reply before them (see replyLayout below).
// 3D MODEL replies (image = 2) do the same, floating as the model itself.
// The desk + computer is against the back wall.
//
// Everything visual here is PLACEHOLDER geometry - replace freely.

import * as THREE from 'three';
import { addBox, addSign, disposeTree } from './materials.js';
import { replyPanelTexture, labelTexture, imageTexture, wrapText, PANEL_PX, FONTS } from './textures.js';
import { Station, buildComputerDesk } from './computer.js';
import { loadModel } from './models.js';

export const ROOM = { W: 7.6, H: 3.2, T: 0.2, DOOR_W: 1.4, DOOR_H: 2.3, SLOT: 8 };

const SPACING = 2.0;                      // metres between replies along the wall
const FIRST_Z = 2.0;                      // first reply's distance from the door
const BACK_SPACE = 2.4;                   // room behind the last reply for the desk
const PANEL_W = 1.6;
const PANEL_H = PANEL_W * (PANEL_PX.h / PANEL_PX.w);
const PANEL_Y = 1.55;
const CUBE_SIZE = 0.6;
const CUBE_OUT = 1.4;                     // how far the cube floats out from the wall
const CUBE_STEP = 0.8;                    // more images after the same reply: each one this much further out

// slots = how many spots along the wall are used (see replyLayout)
export function roomDepth(slots) {
    return Math.max(7.6, FIRST_Z + (slots - 1) * SPACING + PANEL_W / 2 + BACK_SPACE);
}

// Where each reply goes. A text reply takes the next spot ("slot") on the wall and
// gets a board. An image reply floats as a cube in front of the most recent spot
// (cube = 0 is closest to the wall, 1 the next one out...). Only if there's no
// spot yet (the thread starts with an image) does it start a spot of its own, without a board.
export function replyLayout(replies) {
    const places = [];
    let slot = -1;
    let cubes = 0;
    for (const r of replies) {
        if (Number(r.image) >= 1) {                  // image or 3D model: floats in front
            if (slot < 0) { slot = 0; cubes = 0; }
            places.push({ slot, board: false, cube: cubes++ });
        } else {
            slot++;
            cubes = 0;
            places.push({ slot, board: true, cube: -1 });
        }
    }
    return { places, slots: slot + 1 };
}

export class Room {
    constructor(thread, mats, onChange) {
        this.thread = thread;
        this.mats = mats;
        this.onChange = onChange;           // tell the hotel colliders/interactables changed
        this.group = new THREE.Group();
        this.group.name = `room-${thread.thread_id}`;
        this.replies = null;                // null until loaded (lazy, when the player gets near)
        this.loading = false;
        this.depth = roomDepth(thread.reply_count || 0);
        this.doorAngle = 0;
        this.buildId = 0;
        this.cubes = [];
        this.time = Math.random() * 10;
        this.doorWorld = new THREE.Vector3();
        this.centerWorld = new THREE.Vector3();

        // The computer at the back (its screen canvas survives rebuilds).
        this.station = new Station({ kind: 'reply', room: this, drawIdle: (g, w, h) => this.drawScreenIdle(g, w, h) });
    }

    get id() { return this.thread.thread_id; }

    // Newest activity first; used to sort rooms (same order as the 2D forum's index.php).
    get latestDate() { return this.thread.latest_date || this.thread.thread_date || ''; }

    // Move the whole room (the hotel calls this when it re-orders rooms).
    place(x, z, rotY) {
        this.group.position.set(x, 0, z);
        this.group.rotation.y = rotY;
        this.updateWorldPoints();
        this.onChange();
    }

    updateWorldPoints() {
        this.group.updateMatrixWorld(true);
        this.group.localToWorld(this.doorWorld.set(0, 0, ROOM.T / 2));
        this.group.localToWorld(this.centerWorld.set(0, 2.8, -this.depth / 2));
    }

    // ------------------------------------------------------------------ build
    build() {
        disposeTree(this.group);
        this.group.clear();
        this.buildId++;
        this.cubes = [];

        this.buildShell();
        this.buildDoor();
        this.buildComputer();
        if (this.replies) {
            const { places } = replyLayout(this.replies);
            this.replies.forEach((r, i) => this.addReplyObjects(r, places[i]));
        }

        this.updateWorldPoints();
        this.onChange();
    }

    buildShell() {
        const { W, H, T, DOOR_W, DOOR_H } = ROOM;
        const D = this.depth;
        const m = this.mats;
        const g = this.group;

        addBox(g, { w: W, h: 0.1, d: D, y: -0.05, z: -D / 2, mat: m.floor });
        addBox(g, { w: W, h: 0.1, d: D, y: H + 0.05, z: -D / 2, mat: m.ceiling });
        // side + back walls
        addBox(g, { w: T, h: H, d: D + T, x: -W / 2 - T / 2, y: H / 2, z: -(D + T) / 2, mat: m.wall, collider: true });
        addBox(g, { w: T, h: H, d: D + T, x: W / 2 + T / 2, y: H / 2, z: -(D + T) / 2, mat: m.wall, collider: true });
        addBox(g, { w: W + 2 * T, h: H, d: T, y: H / 2, z: -D - T / 2, mat: m.wall, collider: true });

        // front wall (shared with the corridor) with a doorway
        const segW = W / 2 + T - DOOR_W / 2;
        addBox(g, { w: segW, h: H, d: T, x: -(DOOR_W / 2 + segW / 2), y: H / 2, z: T / 2, mat: m.wall, collider: true });
        addBox(g, { w: segW, h: H, d: T, x: DOOR_W / 2 + segW / 2, y: H / 2, z: T / 2, mat: m.wall, collider: true });
        addBox(g, { w: DOOR_W, h: H - DOOR_H, d: T, y: DOOR_H + (H - DOOR_H) / 2, z: T / 2, mat: m.wall });
        for (const s of [-1, 1]) {
            addBox(g, { w: 0.08, h: DOOR_H, d: T + 0.06, x: s * (DOOR_W / 2 + 0.04), y: DOOR_H / 2, z: T / 2, mat: m.trim });
        }
        addBox(g, { w: DOOR_W + 0.16, h: 0.08, d: T + 0.06, y: DOOR_H + 0.04, z: T / 2, mat: m.trim });

        // ceiling light
        addBox(g, { w: 1.2, h: 0.04, d: 0.6, y: H - 0.02, z: -D / 2, mat: m.light });

        // the only sign: thread title above the door, corridor side
        addSign(g, labelTexture(this.thread.thread_title), {
            w: 2.6, h: 0.49, y: DOOR_H + (H - DOOR_H) / 2 + 0.02, z: T + 0.01,
        });
    }

    buildDoor() {
        const { T, DOOR_W, DOOR_H } = ROOM;
        this.doorPivot = new THREE.Group();
        this.doorPivot.position.set(-DOOR_W / 2, 0, T / 2);
        this.doorPivot.rotation.y = this.doorAngle;
        this.group.add(this.doorPivot);
        addBox(this.doorPivot, { w: DOOR_W - 0.02, h: DOOR_H - 0.02, d: 0.06, x: DOOR_W / 2, y: DOOR_H / 2, mat: this.mats.door });
        for (const s of [-1, 1]) {
            const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), this.mats.dark);
            knob.position.set(DOOR_W - 0.15, 1.0, s * 0.06);
            this.doorPivot.add(knob);
        }
    }

    buildComputer() {
        buildComputerDesk(this.group, this.mats, this.station, { z: -this.depth + 0.75, onChange: this.onChange });
    }

    // ------------------------------------------------------------------ replies
    // Spot (slot) i on the left wall; oldest (i = 0) nearest the door.
    replyZ(i) { return -(FIRST_Z + i * SPACING); }

    // place = { slot, board, cube } from replyLayout()
    addReplyObjects(reply, place) {
        const x = -ROOM.W / 2;
        const z = this.replyZ(place.slot);

        if (place.board) {
            const frame = addBox(this.group, { w: 0.04, h: PANEL_H + 0.08, d: PANEL_W + 0.08, x: x + 0.02, y: PANEL_Y, z, mat: this.mats.dark });
            const mat = new THREE.MeshBasicMaterial({ map: replyPanelTexture(reply), toneMapped: false });
            const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), mat);
            panel.position.set(x + 0.045, PANEL_Y, z);
            panel.rotation.y = Math.PI / 2;        // face into the room (+x)
            panel.userData.ownsMaterial = true;
            this.group.add(panel);
            panel.userData.interact = frame.userData.interact = { type: 'reply', reply, room: this };
        }

        if (Number(reply.image) === 2) {
            this.addModel(reply, place, x, z);
        } else if (Number(reply.image) === 1) {
            // Transparent parts of a PNG / WEBP are see-through: alphaTest cuts them out,
            // and drawing both sides shows the inside of the cube through the holes.
            const cubeMat = new THREE.MeshBasicMaterial({
                map: imageTexture(reply.post_content), toneMapped: false,
                transparent: true, alphaTest: 0.05, side: THREE.DoubleSide,
            });
            const cube = new THREE.Mesh(shapeGeometry(reply.shape), cubeMat);
            // several images after one reply: 4 in a line out from the wall, then a row above, then further along
            this.floatAt(cube, place, x, z);
            cube.userData.ownsMaterial = true;
            cube.userData.collider = true;
            cube.userData.interact = { type: 'image', reply, room: this, cube };
            this.group.add(cube);
            this.cubes.push(cube);
        }
    }

    // Where a floating image / model goes. Several after one reply: 4 in a line out
    // from the wall, then a row above, then further along.
    floatAt(obj, place, x, z) {
        const out = place.cube % 4, layer = Math.floor(place.cube / 4);
        obj.position.set(x + CUBE_OUT + out * CUBE_STEP, PANEL_Y + 0.1 + (layer % 2) * CUBE_STEP, z - Math.floor(layer / 2) * CUBE_STEP);
        obj.userData.baseY = obj.position.y;
        obj.userData.phase = place.slot * 0.7 + place.cube * 1.3;
    }

    // A 3D model reply: spins, bobs and can be picked up (E) exactly like an image shape.
    // An invisible box is what you aim at / bump into; a wireframe spins while it loads.
    addModel(reply, place, x, z) {
        const holder = new THREE.Group();
        this.floatAt(holder, place, x, z);
        const hitbox = new THREE.Mesh(new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE), new THREE.MeshBasicMaterial());
        hitbox.visible = false;
        hitbox.userData.ownsMaterial = true;
        hitbox.userData.collider = true;
        hitbox.userData.interact = { type: 'image', reply, room: this, cube: holder };
        const loading = new THREE.Mesh(new THREE.BoxGeometry(CUBE_SIZE * 0.6, CUBE_SIZE * 0.6, CUBE_SIZE * 0.6),
            new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }));
        loading.userData.ownsMaterial = true;
        holder.add(hitbox, loading);
        this.group.add(holder);
        this.cubes.push(holder);

        const build = this.buildId;
        loadModel(reply.post_content, CUBE_SIZE * 1.15).then(({ object, animations }) => {
            if (build !== this.buildId) return;      // room was rebuilt meanwhile (the new build loads its own)
            holder.remove(loading);
            loading.geometry.dispose();
            loading.material.dispose();
            holder.add(object);
            if (animations.length) {                 // play the model's own animation, if it has one
                const mixer = new THREE.AnimationMixer(object);
                mixer.clipAction(animations[0]).play();
                holder.userData.mixer = mixer;
            }
            this.onChange();
        }).catch((err) => {
            console.warn('3D model failed to load', reply.post_content, err);
            if (build === this.buildId) loading.material.color.set(0xaa0000);   // red wireframe = broken
        });
    }

    async load(api) {
        if (this.replies || this.loading) return;
        this.loading = true;
        try {
            this.replies = await api.getReplies(this.id);
            this.thread.reply_count = this.replies.length;
            this.depth = roomDepth(replyLayout(this.replies).slots);   // exact now (before: a guess from the count)
            this.build();
            this.station.drawIdle();
        } catch (err) {
            console.error(`Could not load replies for room ${this.id}`, err);
        } finally {
            this.loading = false;
        }
    }

    // A new reply was posted: hang it on the wall (lengthen the room if needed).
    addReply(reply) {
        if (reply.post_date) this.thread.latest_date = reply.post_date;

        // Replies not loaded yet (nobody walked near): just count it; it loads with the rest later.
        if (!this.replies) {
            this.thread.reply_count = (this.thread.reply_count || 0) + 1;
            const needed = roomDepth(this.thread.reply_count);
            if (needed > this.depth) { this.depth = needed; this.build(); }
            return;
        }
        // The same reply can arrive twice (our own post: API answer + live broadcast).
        if (this.replies.some((r) => r.post_id === reply.post_id)) return;

        this.replies.push(reply);
        this.thread.reply_count = this.replies.length;
        const { places, slots } = replyLayout(this.replies);
        const needed = roomDepth(slots);
        if (needed > this.depth) {
            this.depth = needed;
            this.build();
        } else {
            this.addReplyObjects(reply, places[places.length - 1]);
            this.onChange();
        }
        if (!this.station.inUse) this.station.drawIdle();      // update the reply count on the screen
    }

    // ------------------------------------------------------------------ per frame
    update(dt, playerPos) {
        const near = playerPos.distanceTo(this.doorWorld) < 2.6;
        const target = near ? 1.45 : 0;
        this.doorAngle += (target - this.doorAngle) * Math.min(1, dt * 5);
        if (this.doorPivot) this.doorPivot.rotation.y = this.doorAngle;

        // image cubes slowly spin and bob, unless someone is holding one
        this.time += dt;
        for (const cube of this.cubes) {
            cube.userData.mixer?.update(dt);
            if (cube.userData.held) continue;
            cube.rotation.y += dt * 0.5;
            cube.position.y = cube.userData.baseY + Math.sin(this.time * 1.5 + cube.userData.phase) * 0.05;
        }
    }

    containsPoint(worldPos, tmp = new THREE.Vector3()) {
        const p = this.group.worldToLocal(tmp.copy(worldPos));
        return Math.abs(p.x) < ROOM.W / 2 && p.z < 0 && p.z > -this.depth;
    }

    // Camera pose for looking at an image cube up close.
    inspectPose(cube) {
        const c = cube.position;
        return {
            pos: this.group.localToWorld(new THREE.Vector3(c.x + 1.1, c.y, c.z)),
            look: this.group.localToWorld(c.clone()),
        };
    }

    // ------------------------------------------------------------------ screen
    drawScreenIdle(g, w, h) {
        g.fillStyle = '#ffffff';
        g.textBaseline = 'top';
        g.font = `bold 40px ${FONTS.MONO}`;
        const lines = wrapText(g, this.thread.thread_title, w - 120).slice(0, 4);
        lines.forEach((l, i) => g.fillText(l, 60, 60 + i * 50));
        g.font = `34px ${FONTS.MONO}`;
        const n = this.replies ? this.replies.length : this.thread.reply_count ?? 0;
        g.fillText(`${n} ${n === 1 ? 'reply' : 'replies'}`, 60, h - 200);
        g.fillText('[E] sit down to reply', 60, h - 130);
    }

    dispose() {
        disposeTree(this.group);
        this.group.removeFromParent();
        this.station.texture.dispose();
    }
}

// What an image reply floats as (picked on the computer screen when posting).
// All about CUBE_SIZE big; the image is wrapped around each one.
const shapeCache = new Map();
function shapeGeometry(shape) {
    if (!shapeCache.has(shape)) {
        let geo;
        if (shape === 'sphere') geo = new THREE.SphereGeometry(CUBE_SIZE * 0.62, 32, 16);
        else if (shape === 'pyramid') geo = new THREE.ConeGeometry(CUBE_SIZE * 0.75, CUBE_SIZE * 1.15, 4, 1).rotateY(Math.PI / 4);
        else if (shape === 'icosahedron') geo = new THREE.IcosahedronGeometry(CUBE_SIZE * 0.7, 0);
        else geo = wrappedCubeGeometry(CUBE_SIZE);
        geo.userData.shared = true;                  // shared by every reply with that shape: never freed
        shapeCache.set(shape, geo);
    }
    return shapeCache.get(shape);
}

// A cube whose image is WRAPPED around it (like wrapping paper) instead of
// repeated on every face: the 4 sides share one horizontal strip of the image
// and the top/bottom fold the image's top/bottom edge in towards the middle.
// It's stretched and pinched on purpose.
function wrappedCubeGeometry(size, seg = 8) {
    const geo = new THREE.BoxGeometry(size, size, size, seg, seg, seg);
    const uv = geo.attributes.uv;
    const pos = geo.attributes.position;
    const perFace = (seg + 1) * (seg + 1);
    const half = size / 2;
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z. Going round the cube:
    // +z (front) -> +x -> -z (back) -> -x, each gets a quarter of the image width.
    const sideSlot = { 4: 0, 0: 1, 5: 2, 1: 3 };
    for (let f = 0; f < 6; f++) {
        for (let i = f * perFace; i < (f + 1) * perFace; i++) {
            if (f in sideSlot) {
                uv.setX(i, (sideSlot[f] + uv.getX(i)) / 4);
            } else {
                const x = pos.getX(i), z = pos.getZ(i);
                // same horizontal position as the side face below this point
                const u = (Math.atan2(x, z) / (2 * Math.PI) + 0.125 + 1) % 1;
                // 1 at the cap's edge (matches the sides) -> folds a quarter inward
                const r = Math.max(Math.abs(x), Math.abs(z)) / half;
                const fold = (1 - r) * 0.25;
                uv.setXY(i, u, f === 2 ? 1 - fold : fold);
            }
        }
    }
    return geo;
}
