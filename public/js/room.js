// room.js - one hotel room = one forum thread.
//
// Local coordinates: the doorway is at z = 0 and the room extends into -z.
// The front wall (with the door) sits at z = 0..T and faces the corridor.
// Walking in (facing -z), the LEFT wall is at x = -W/2: every reply hangs there
// in one row, oldest nearest the door. The room gets longer to fit them all.
// Image replies also get a floating cube (textured with the image) in front
// of their panel. The desk + computer is against the back wall.
//
// Everything visual here is PLACEHOLDER geometry - replace freely.

import * as THREE from 'three';
import { addBox, addSign, disposeTree } from './materials.js';
import { replyPanelTexture, labelTexture, imageTexture, wrapText, PANEL_PX, FONTS } from './textures.js';
import { Station, buildComputerDesk } from './computer.js';

export const ROOM = { W: 7.6, H: 3.2, T: 0.2, DOOR_W: 1.4, DOOR_H: 2.3, SLOT: 8 };

const SPACING = 2.0;                      // metres between replies along the wall
const FIRST_Z = 2.0;                      // first reply's distance from the door
const BACK_SPACE = 2.4;                   // room behind the last reply for the desk
const PANEL_W = 1.6;
const PANEL_H = PANEL_W * (PANEL_PX.h / PANEL_PX.w);
const PANEL_Y = 1.55;
const CUBE_SIZE = 0.6;
const CUBE_OUT = 1.4;                     // how far the cube floats out from the wall

export function roomDepth(replyCount) {
    return Math.max(7.6, FIRST_Z + (replyCount - 1) * SPACING + PANEL_W / 2 + BACK_SPACE);
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
        if (this.replies) this.replies.forEach((r, i) => this.addReplyObjects(r, i));

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
    // Reply i hangs on the left wall; oldest (i = 0) nearest the door.
    replyZ(i) { return -(FIRST_Z + i * SPACING); }

    addReplyObjects(reply, i) {
        const x = -ROOM.W / 2;
        const z = this.replyZ(i);

        const frame = addBox(this.group, { w: 0.04, h: PANEL_H + 0.08, d: PANEL_W + 0.08, x: x + 0.02, y: PANEL_Y, z, mat: this.mats.dark });
        const mat = new THREE.MeshBasicMaterial({ map: replyPanelTexture(reply), toneMapped: false });
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), mat);
        panel.position.set(x + 0.045, PANEL_Y, z);
        panel.rotation.y = Math.PI / 2;        // face into the room (+x)
        panel.userData.ownsMaterial = true;
        this.group.add(panel);

        let interact = { type: 'reply', reply, room: this };

        if (Number(reply.image) === 1) {
            // Transparent parts of a PNG / WEBP are see-through: alphaTest cuts them out,
            // and drawing both sides shows the inside of the cube through the holes.
            const cubeMat = new THREE.MeshBasicMaterial({
                map: imageTexture(reply.post_content), toneMapped: false,
                transparent: true, alphaTest: 0.05, side: THREE.DoubleSide,
            });
            const cube = new THREE.Mesh(wrappedCubeGeometry(CUBE_SIZE), cubeMat);
            cube.position.set(x + CUBE_OUT, PANEL_Y + 0.1, z);
            cube.userData.ownsMaterial = true;
            cube.userData.collider = true;
            cube.userData.baseY = cube.position.y;
            cube.userData.phase = i * 0.7;
            interact = { type: 'image', reply, room: this, cube };
            cube.userData.interact = interact;
            this.group.add(cube);
            this.cubes.push(cube);
        }
        panel.userData.interact = frame.userData.interact = interact;
    }

    async load(api) {
        if (this.replies || this.loading) return;
        this.loading = true;
        try {
            this.replies = await api.getReplies(this.id);
            this.thread.reply_count = this.replies.length;
            this.depth = Math.max(this.depth, roomDepth(this.replies.length));
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
        const needed = roomDepth(this.replies.length);
        if (needed > this.depth) {
            this.depth = needed;
            this.build();
        } else {
            this.addReplyObjects(reply, this.replies.length - 1);
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
