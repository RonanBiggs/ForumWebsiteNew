// player.js - first-person walking: pointer-lock mouse look, WASD, simple wall collision.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CONFIG } from './config.js';

const UP = new THREE.Vector3(0, 1, 0);

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

        addEventListener('keydown', (e) => this.keys.add(e.code));
        addEventListener('keyup', (e) => this.keys.delete(e.code));
        addEventListener('blur', () => this.keys.clear());
    }

    get position() { return this.camera.position; }

    key(...codes) { return codes.some((c) => this.keys.has(c)) ? 1 : 0; }

    update(dt, boxes) {
        if (!this.enabled) {
            this.velocity.set(0, 0, 0);
            return;
        }
        const f = this._fwd;
        this.camera.getWorldDirection(f);
        f.y = 0;
        f.normalize();
        this._right.crossVectors(f, UP);

        const forward = this.key('KeyW', 'ArrowUp') - this.key('KeyS', 'ArrowDown');
        const strafe = this.key('KeyD', 'ArrowRight') - this.key('KeyA', 'ArrowLeft');
        const wish = this._wish.set(0, 0, 0).addScaledVector(f, forward).addScaledVector(this._right, strafe);
        if (wish.lengthSq() > 0) wish.normalize();
        const speed = this.key('ShiftLeft', 'ShiftRight') ? CONFIG.RUN_SPEED : CONFIG.WALK_SPEED;
        wish.multiplyScalar(speed);

        // smooth acceleration
        this.velocity.lerp(wish, 1 - Math.exp(-dt * 12));

        const p = this.camera.position;
        this.moveAxis(p, 'x', this.velocity.x * dt, boxes);
        this.moveAxis(p, 'z', this.velocity.z * dt, boxes);

        // subtle head bob
        const moving = Math.min(1, this.velocity.length() / CONFIG.WALK_SPEED);
        this.bob += dt * (6 + 4 * moving) * moving;
        p.y = CONFIG.EYE_HEIGHT + Math.sin(this.bob) * 0.035 * moving;
    }

    // Move along one axis, then push out of any box we ended up inside.
    moveAxis(p, axis, delta, boxes) {
        if (!delta) return;
        p[axis] += delta;
        const r = this.radius;
        for (const b of boxes) {
            if (b.max.y < 0.2 || b.min.y > 1.8) continue;   // floor/ceiling/above head
            if (p.x > b.min.x - r && p.x < b.max.x + r && p.z > b.min.z - r && p.z < b.max.z + r) {
                p[axis] = delta > 0 ? b.min[axis] - r - 1e-4 : b.max[axis] + r + 1e-4;
            }
        }
    }
}
