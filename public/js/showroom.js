// showroom.js - the animation room behind the lobby's back wall.
//
// A Blender animation (public/models/animation.glb) floats in the middle of the room,
// frozen on its first frame. Press E at the red button on the pedestal: it plays once,
// then jumps back to the first frame. Every clip in the file plays at the same time
// (Blender exports one clip per moving object), so all the models move together.
//
// To swap in a new animation: export it from Blender as .glb and replace
// public/models/animation.glb (or change URL below).
//
// Built once and never rebuilt (the lobby around it is rebuilt often), so the loaded
// model and its playback survive picture changes / new threads.

import * as THREE from 'three';
import { addBox } from './materials.js';
import { ROOM } from './room.js';
import { parseModel, limitTextures, PHONE } from './models.js';

export const SHOWROOM = {
    URL: 'models/animation.glb',
    DOOR_X: -3.9,          // doorway centre along the lobby's back wall (left of the paint board)
    DEPTH: 9,              // how far the room goes back (m); it's as wide as the lobby
    MODEL_SIZE: 3.2,       // the whole animation (every frame of it) fits in a box this big (m)
    MODEL_Y: 1.6,          // height of the animation's centre
    PEDESTAL: { x: -2.4, z: 2.6, H: 1.0 },   // x across the room, z = distance from the doorway wall
    LOAD_DISTANCE: 5.5,    // start downloading the model when the player is this close to the doorway (m)
    TEXTURE_MAX: PHONE ? 1024 : 2048,   // its textures are scaled down to this (px): 4096 ones are too much for phones
};
const BUTTON_Y = 0.045;    // the button's resting height above the pedestal top
const BUTTON_PRESS = 0.03; // how far it sinks while the animation plays

export class Showroom {
    // halfW = half the room's width, z0 = where the room starts (back face of the lobby wall)
    constructor(mats, { halfW, z0 }) {
        this.mats = mats;
        this.group = new THREE.Group();
        this.lightSpots = [];
        this.mixer = null;
        this.actions = [];
        this.duration = 0;
        this.t = 0;
        this.playing = false;
        this.loading = false;
        this.center = new THREE.Vector3(0, SHOWROOM.MODEL_Y, z0 + SHOWROOM.DEPTH / 2);
        this.door = new THREE.Vector3(SHOWROOM.DOOR_X, SHOWROOM.MODEL_Y, z0);
        this.zStart = z0;
        this.build(halfW, z0);
    }

    build(halfW, z0) {
        const g = this.group;
        const m = this.mats;
        const { H, T } = ROOM;
        const D = SHOWROOM.DEPTH;
        const zMid = z0 - T + (D + T) / 2;                    // floor/ceiling also cover the doorway's threshold
        addBox(g, { w: halfW * 2, h: 0.1, d: D + T, y: -0.05, z: zMid, mat: m.floor });
        addBox(g, { w: halfW * 2, h: 0.1, d: D + T, y: H + 0.05, z: zMid, mat: m.ceiling });
        for (const side of [1, -1]) {
            addBox(g, { w: T, h: H, d: D + T, x: side * (halfW + T / 2), y: H / 2, z: zMid, mat: m.wall, collider: true });
        }
        addBox(g, { w: halfW * 2 + 2 * T, h: H, d: T, y: H / 2, z: z0 + D + T / 2, mat: m.wall, collider: true });
        for (const lz of [z0 + D * 0.3, z0 + D * 0.75]) {
            addBox(g, { w: 1.2, h: 0.04, d: 1.2, y: H - 0.02, z: lz, mat: m.light });
            this.lightSpots.push(new THREE.Vector3(0, H - 0.4, lz));
        }

        // the pedestal with the red button
        const P = SHOWROOM.PEDESTAL;
        const ped = new THREE.Group();
        ped.position.set(P.x, 0, z0 + P.z);
        g.add(ped);
        addBox(ped, { w: 0.5, h: P.H, d: 0.5, y: P.H / 2, mat: m.furniture, collider: true });
        addBox(ped, { w: 0.62, h: 0.06, d: 0.62, y: P.H + 0.03, mat: m.dark });
        const top = P.H + 0.06;
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.03, 32), m.dark);
        ring.position.y = top + 0.015;
        this.button = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.1, 0.06, 32),
            new THREE.MeshStandardMaterial({ color: 0xdd1111, roughness: 0.35, emissive: 0x330000 }));
        this.button.position.y = top + BUTTON_Y;
        this.button.userData.ownsMaterial = true;
        this.buttonTop = top;
        // an invisible box around the top: what you aim at to press E
        const hit = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), new THREE.MeshBasicMaterial());
        hit.position.y = top + 0.1;
        hit.visible = false;
        hit.userData.ownsMaterial = true;
        hit.userData.interact = { type: 'animButton' };
        ped.add(ring, this.button, hit);

        // the animation goes in here once loaded
        this.holder = new THREE.Group();
        this.holder.position.copy(this.center);
        g.add(this.holder);
    }

    async load() {
        this.loading = true;
        try {
            const res = await fetch(SHOWROOM.URL);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const { object, animations } = await parseModel(await res.arrayBuffer(), 'model/gltf-binary');
            limitTextures(object, SHOWROOM.TEXTURE_MAX);
            this.mixer = new THREE.AnimationMixer(object);
            this.actions = animations.map((clip) => {
                const action = this.mixer.clipAction(clip);
                action.play();                               // we set its time ourselves (pose())
                return action;
            });
            this.duration = Math.max(0, ...animations.map((c) => c.duration));

            // fit the WHOLE animation in the room: the box around every pose, not just the first
            const box = new THREE.Box3(), step = new THREE.Box3();
            for (let i = 0; i <= 24; i++) {
                this.pose((this.duration * i) / 24);
                object.updateMatrixWorld(true);
                box.union(step.setFromObject(object));
            }
            this.pose(0);                                     // show the first frame
            const dims = box.getSize(new THREE.Vector3());
            object.position.sub(box.getCenter(new THREE.Vector3()));
            this.holder.scale.setScalar(SHOWROOM.MODEL_SIZE / (Math.max(dims.x, dims.y, dims.z) || 1));
            object.traverse((o) => {
                if (!o.isMesh) return;
                o.frustumCulled = false;                      // animated meshes can have stale bounds
            });
            this.holder.add(object);
        } catch (err) {
            console.warn('Animation room: model failed to load', SHOWROOM.URL, err);
        }
    }

    // Shows every clip at time t (seconds).
    pose(t) {
        if (!this.mixer) return;
        for (const a of this.actions) a.time = Math.min(t, a.getClip().duration);
        this.mixer.update(0);
    }

    // The red button: play once (ignored while it's already playing).
    press() {
        if (!this.mixer || this.playing || !this.duration) return;
        this.playing = true;
        this.t = 0;
    }

    update(dt, playerPos) {
        // loaded once, the first time someone comes near the doorway (or is inside), then kept
        if (!this.loading && (playerPos.z > this.zStart || playerPos.distanceTo(this.door) < SHOWROOM.LOAD_DISTANCE)) this.load();
        // the button stays pushed in while the animation plays
        const want = this.buttonTop + BUTTON_Y - (this.playing ? BUTTON_PRESS : 0);
        this.button.position.y += (want - this.button.position.y) * Math.min(1, dt * 20);
        if (!this.playing) return;
        this.t = Math.min(this.t + dt, this.duration);
        this.pose(this.t);
        if (this.t >= this.duration) {                        // done: back to the first frame
            this.playing = false;
            this.pose(0);
        }
    }
}
