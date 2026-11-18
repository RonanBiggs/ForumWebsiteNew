// touch.js - phone / tablet controls (used instead of mouse + keyboard on touch screens).
//
//   Left side of the screen:  drag = walk (a joystick appears under your thumb; push it all the way to run)
//   Right side of the screen: drag = look around
//   Buttons (bottom right):   FIRE, and a USE button that pops up when you're looking at
//                             something you can use (a reply, an image cube, a computer)
//
// The buttons/joystick look is in style.css (the "Touch controls" section).

import * as THREE from 'three';

// Touch screens without a mouse. Add ?touch=1 to the URL to force it on (or ?touch=0 off).
export function isTouchDevice() {
    const forced = new URLSearchParams(location.search).get('touch');
    if (forced !== null) return forced !== '0';
    return matchMedia('(pointer: coarse)').matches;
}

const LOOK_SPEED = 0.005;       // radians per pixel dragged
const STICK_RADIUS = 55;        // pixels: how far the joystick knob can move

export class TouchControls {
    constructor({ camera, player, onFire, onUse }) {
        this.camera = camera;
        this.player = player;
        this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
        this.stick = null;          // { id, x, y } the joystick's touch
        this.look = null;           // { id, x, y } the look touch

        const el = (tag, cls, parent, text) => {
            const e = document.createElement(tag);
            e.className = cls;
            if (text) e.textContent = text;
            parent.append(e);
            return e;
        };
        this.root = el('div', 'touch hidden', document.body);
        this.base = el('div', 'stick-base hidden', this.root);
        this.knob = el('div', 'stick-knob', this.base);
        this.fireBtn = el('button', 'tbtn fire', this.root, 'FIRE');
        this.useBtn = el('button', 'tbtn use hidden', this.root, 'USE');
        this.fireBtn.type = this.useBtn.type = 'button';

        // pointerdown (not click) so rapid taps all count and there's no delay
        const press = (btn, fn) => btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            fn();
        });
        press(this.fireBtn, onFire);
        press(this.useBtn, onUse);

        this.root.addEventListener('pointerdown', (e) => this.down(e));
        this.root.addEventListener('pointermove', (e) => this.move(e));
        this.root.addEventListener('pointerup', (e) => this.up(e));
        this.root.addEventListener('pointercancel', (e) => this.up(e));
    }

    setVisible(on) {
        this.root.classList.toggle('hidden', !on);
        if (!on) this.reset();
    }

    // Show the USE button with this text, or hide it (null).
    setUse(label) {
        this.useBtn.classList.toggle('hidden', !label);
        if (label && this.useBtn.textContent !== label) this.useBtn.textContent = label;
    }

    reset() {
        this.stick = this.look = null;
        this.base.classList.add('hidden');
        this.player.touchMove.x = this.player.touchMove.y = 0;
        this.player.touchRun = false;
    }

    down(e) {
        e.preventDefault();
        this.root.setPointerCapture(e.pointerId);
        if (e.clientX < innerWidth * 0.45 && !this.stick) {
            this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
            this.base.style.left = `${e.clientX}px`;
            this.base.style.top = `${e.clientY}px`;
            this.knob.style.transform = 'translate(-50%, -50%)';
            this.base.classList.remove('hidden');
        } else if (!this.look) {
            this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }
    }

    move(e) {
        if (this.stick?.id === e.pointerId) {
            let dx = e.clientX - this.stick.x, dy = e.clientY - this.stick.y;
            const len = Math.hypot(dx, dy);
            if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
            this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            this.player.touchMove.x = dx / STICK_RADIUS;
            this.player.touchMove.y = dy / STICK_RADIUS;
            this.player.touchRun = len > STICK_RADIUS * 1.3;     // pushed past the edge: run
        } else if (this.look?.id === e.pointerId) {
            const dx = e.clientX - this.look.x, dy = e.clientY - this.look.y;
            this.look.x = e.clientX;
            this.look.y = e.clientY;
            const eu = this.euler.setFromQuaternion(this.camera.quaternion);
            eu.y -= dx * LOOK_SPEED;
            eu.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, eu.x - dy * LOOK_SPEED));
            this.camera.quaternion.setFromEuler(eu);
        }
    }

    up(e) {
        if (this.stick?.id === e.pointerId) {
            this.stick = null;
            this.base.classList.add('hidden');
            this.player.touchMove.x = this.player.touchMove.y = 0;
            this.player.touchRun = false;
        } else if (this.look?.id === e.pointerId) {
            this.look = null;
        }
    }
}
