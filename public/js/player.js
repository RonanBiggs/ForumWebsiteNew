// player.js - first-person walking: pointer-lock mouse look, WASD, simple wall collision,
// touch joystick input (touch.js), and getting launched by the gun (knockback).

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CONFIG } from './config.js';

const UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = 22;              // m/s² while flying after a hit
const CEILING = 3.2 - 0.15;      // highest the eyes can go (rooms/lobby are 3.2 m tall)

export class Player {
    constructor(camera, domElement) {
        this.camera = camera;
        this.controls = new PointerLockControls(camera, domElement);
        this.enabled = false;       // false while sitting / in menus
        this.radius = 0.3;
        this.velocity = new THREE.Vector3();
        this.keys = new Set();
        this.bob = 0;
        this._fwd = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._wish = new THREE.Vector3();
        this.touchMove = { x: 0, y: 0 };     // joystick, -1..1 (y = -1 is forward)
        this.touchRun = false;
        this.knock = new THREE.Vector3();    // launch velocity from being shot
        this.air = 0;                        // height above the ground while flying

        addEventListener('keydown', (e) => this.keys.add(e.code));
        addEventListener('keyup', (e) => this.keys.delete(e.code));
        addEventListener('blur', () => this.keys.clear());
    }

    get position() { return this.camera.position; }

    key(...codes) { return codes.some((c) => this.keys.has(c)) ? 1 : 0; }

    // Got hit: add a launch velocity (see knockVelocity in gun.js).
    knockback(v) { this.knock.add(v); }

    // Stop flying (e.g. when sitting down).
    land() { this.knock.set(0, 0, 0); this.air = 0; }

    update(dt, boxes) {
        this.updateKnock(dt, boxes);
        if (!this.enabled) {
            this.velocity.set(0, 0, 0);
            if (this.knock.lengthSq() > 0 || this.air > 0) this.camera.position.y = CONFIG.EYE_HEIGHT + this.air;
            return;
        }
        const f = this._fwd;
        this.camera.getWorldDirection(f);
        f.y = 0;
        f.normalize();
        this._right.crossVectors(f, UP);

        const forward = this.key('KeyW', 'ArrowUp') - this.key('KeyS', 'ArrowDown') - this.touchMove.y;
        const strafe = this.key('KeyD', 'ArrowRight') - this.key('KeyA', 'ArrowLeft') + this.touchMove.x;
        const wish = this._wish.set(0, 0, 0).addScaledVector(f, forward).addScaledVector(this._right, strafe);
        if (wish.lengthSq() > 1) wish.normalize();          // joystick can be pushed part way
        const run = this.key('ShiftLeft', 'ShiftRight') || this.touchRun;
        const speed = run ? CONFIG.RUN_SPEED : CONFIG.WALK_SPEED;
        wish.multiplyScalar(speed);

        // smooth acceleration
        this.velocity.lerp(wish, 1 - Math.exp(-dt * 12));

        const p = this.camera.position;
        this.moveAxis(p, 'x', this.velocity.x * dt, boxes);
        this.moveAxis(p, 'z', this.velocity.z * dt, boxes);

        // subtle head bob
        const moving = Math.min(1, this.velocity.length() / CONFIG.WALK_SPEED);
        this.bob += dt * (6 + 4 * moving) * moving;
        p.y = CONFIG.EYE_HEIGHT + this.air + (this.air > 0 ? 0 : Math.sin(this.bob) * 0.035 * moving);
    }

    // Flying after a hit: gravity, bouncing off the ceiling, sliding to a stop on the floor.
    updateKnock(dt, boxes) {
        const k = this.knock;
        if (k.lengthSq() < 1e-4 && this.air === 0) { k.set(0, 0, 0); return; }
        const p = this.camera.position;
        // small steps so a hard hit can't push us through a wall
        const steps = Math.max(1, Math.ceil((Math.hypot(k.x, k.z) * dt) / 0.15));
        for (let i = 0; i < steps; i++) {
            this.moveAxis(p, 'x', (k.x * dt) / steps, boxes, () => { k.x *= -0.4; });
            this.moveAxis(p, 'z', (k.z * dt) / steps, boxes, () => { k.z *= -0.4; });
        }
        k.y -= GRAVITY * dt;
        this.air += k.y * dt;
        if (CONFIG.EYE_HEIGHT + this.air > CEILING) { this.air = CEILING - CONFIG.EYE_HEIGHT; k.y = -Math.abs(k.y) * 0.3; }
        if (this.air <= 0) {
            this.air = 0;
            k.y = 0;
            const friction = Math.exp(-dt * 6);      // skid along the floor
            k.x *= friction;
            k.z *= friction;
        }
    }

    // Move along one axis, then push out of any box we ended up inside.
    moveAxis(p, axis, delta, boxes, onBump) {
        if (!delta) return;
        p[axis] += delta;
        const r = this.radius;
        let bumped = false;
        for (const b of boxes) {
            if (b.max.y < 0.2 || b.min.y > 1.8) continue;   // floor/ceiling/above head
            if (p.x > b.min.x - r && p.x < b.max.x + r && p.z > b.min.z - r && p.z < b.max.z + r) {
                p[axis] = delta > 0 ? b.min[axis] - r - 1e-4 : b.max[axis] + r + 1e-4;
                bumped = true;
            }
        }
        if (bumped) onBump?.();
    }
}
