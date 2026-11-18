// gun.js - the launcher gun. Every click / Fire tap shoots a ball (no ammo, no
// cooldown). A ball that hits another player sends them flying.
//
// Hits are decided by the SHOOTER (whoever sees their ball touch a pill): it
// tells the server, and the server tells the player who got hit, who then
// launches themself (Player.knockback). Everyone else just sees the balls.

import * as THREE from 'three';
import { ROOM } from './room.js';

export const GUN = {
    SPEED: 28,           // m/s, how fast a ball flies
    RADIUS: 0.09,        // ball size (metres)
    LIFETIME: 1.6,       // seconds before a ball disappears
    MAX_BALLS: 300,      // oldest balls vanish beyond this (spam protection)
    PUSH: 13,            // how hard a hit throws someone sideways (m/s)
    LIFT: 7,             // and upwards (m/s)
    COLOR: 0xff7a1a,
};

export class Gun {
    // getNet() returns the Multiplayer object (or null in demo mode).
    constructor({ scene, camera, hotel, getNet }) {
        this.scene = scene;
        this.camera = camera;
        this.hotel = hotel;
        this.getNet = getNet;
        this.balls = [];
        this.recoil = 0;
        this._v = new THREE.Vector3();
        this._dir = new THREE.Vector3();

        this.ballGeometry = new THREE.SphereGeometry(GUN.RADIUS, 12, 8);
        this.ballMaterial = new THREE.MeshBasicMaterial({ color: GUN.COLOR });

        // PLACEHOLDER gun model, held bottom-right of the screen (a child of the camera).
        this.model = new THREE.Group();
        const body = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 });
        const tip = new THREE.MeshStandardMaterial({ color: GUN.COLOR, emissive: GUN.COLOR, emissiveIntensity: 0.6 });
        const box = (w, h, d, x, y, z, mat) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            m.position.set(x, y, z);
            this.model.add(m);
        };
        box(0.07, 0.08, 0.32, 0, 0, 0, body);           // barrel
        box(0.05, 0.12, 0.06, 0, -0.09, 0.09, body);    // grip
        box(0.075, 0.085, 0.04, 0, 0, -0.17, tip);      // glowing muzzle
        this.model.position.set(0.2, -0.17, -0.42);
        // drawn on top of everything so it never pokes into walls
        this.model.traverse((o) => {
            o.renderOrder = 999;
            if (o.material) o.material.depthTest = false;
        });
        camera.add(this.model);
        scene.add(camera);
    }

    setVisible(on) { this.model.visible = on; }

    // Shoot from the camera, where it's looking.
    fire() {
        const dir = this.camera.getWorldDirection(new THREE.Vector3());
        const origin = this.camera.position.clone().addScaledVector(dir, 0.45);
        origin.y -= 0.08;
        this.spawn(origin, dir, true);
        this.recoil = 1;
        this.getNet()?.sendShot(origin, dir);
    }

    // mine = true: our own ball, which can hit other players.
    spawn(origin, dir, mine) {
        const mesh = new THREE.Mesh(this.ballGeometry, this.ballMaterial);
        mesh.position.copy(origin);
        this.scene.add(mesh);
        this.balls.push({ mesh, vel: dir.clone().normalize().multiplyScalar(GUN.SPEED), age: 0, mine });
        while (this.balls.length > GUN.MAX_BALLS) this.remove(0);
    }

    remove(i) {
        this.scene.remove(this.balls[i].mesh);
        this.balls.splice(i, 1);
    }

    update(dt) {
        // gun kick-back animation
        this.recoil = Math.max(0, this.recoil - dt * 10);
        this.model.position.z = -0.42 + this.recoil * 0.06;
        // keep it on screen on narrow (portrait phone) screens
        this.model.position.x = Math.min(0.2, 0.16 * this.camera.aspect);
        this.model.scale.setScalar(Math.min(1, 0.5 + 0.5 * this.camera.aspect));
        this.model.rotation.x = this.recoil * 0.25;

        const walls = this.hotel.colliders();
        const net = this.getNet();
        const r = GUN.RADIUS;

        for (let i = this.balls.length - 1; i >= 0; i--) {
            const b = this.balls[i];
            b.age += dt;
            let gone = b.age > GUN.LIFETIME;

            // move in small steps so fast balls can't skip through thin walls
            const steps = Math.ceil((GUN.SPEED * dt) / 0.15);
            for (let s = 0; s < steps && !gone; s++) {
                const p = b.mesh.position.addScaledVector(b.vel, dt / steps);
                if (p.y < r || p.y > ROOM.H - r) { gone = true; break; }
                for (const w of walls) {
                    if (p.x > w.min.x - r && p.x < w.max.x + r && p.y > w.min.y - r && p.y < w.max.y + r &&
                        p.z > w.min.z - r && p.z < w.max.z + r) { gone = true; break; }
                }
                if (gone || !net) break;
                const hit = net.pillAt(p, r);
                if (hit !== null) {
                    gone = true;
                    if (b.mine) net.sendHit(hit, this._dir.copy(b.vel).setY(0).normalize());
                } else if (!b.mine && this.hitsMe(p, r)) {
                    gone = true;                              // someone else's ball reached us: the shooter sends the hit
                }
            }
            if (gone) this.remove(i);
        }
    }

    hitsMe(p, r) {
        const c = this.camera.position;
        const dx = p.x - c.x, dz = p.z - c.z;
        return dx * dx + dz * dz < (0.3 + r) ** 2 && p.y < c.y + 0.2 && p.y > c.y - 1.6;
    }
}

// The push a hit gives: along `dir` (flat, normalised) plus some lift.
export function knockVelocity(dir) {
    return new THREE.Vector3(dir.x * GUN.PUSH, GUN.LIFT, dir.z * GUN.PUSH);
}
