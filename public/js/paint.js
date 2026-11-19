// paint.js - the lobby's community paint board, browser side.
//
// The board's pixels live here (an ImageData) and are shown on the board in the lobby
// (hotel.js puts `texture` on it). Drawing uses the same code as the server
// (paintraster.js), so everyone ends up with the same pixels:
//   - your pen strokes are drawn straight away and sent (in small batches as you move);
//   - fills are sent and drawn when the server sends them back (fills depend on what's
//     already there, so they're done in the server's order);
//   - everyone else's strokes / fills arrive live (net.js -> onRemote).
// On load the current board comes from the server as a PNG (GET api/board) plus the number
// of the last op in it; live ops up to that number are skipped, later ones applied.

import * as THREE from 'three';
import { BOARD_W, BOARD_H, cleanOp, applyOp, clearBoard } from './paintraster.js';

const SEND_EVERY_MS = 40;

export class PaintBoard {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = BOARD_W;
        this.canvas.height = BOARD_H;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.image = this.ctx.createImageData(BOARD_W, BOARD_H);
        clearBoard(this.image.data);
        this.ctx.putImageData(this.image, 0, 0);
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.anisotropy = 8;

        this.seq = 0;              // last server op that's in our pixels
        this.loaded = false;
        this.waiting = [];         // live ops that arrived before the board finished loading
        this.send = null;          // (op) => void, set when multiplayer is on; null = demo mode (local only)
        this.myId = () => null;    // our player id (to skip our own strokes coming back)

        this.color = 0;
        this.width = 6;
        this.bucket = false;
        this.stroke = null;        // the stroke being drawn: { last: [x, y], pending: [...numbers], timer }
    }

    // Gets the board from the server. Without a server (demo mode) it stays blank and local.
    // Also used after a reconnect (strokes made while we were away come with the new picture).
    async load() {
        this.loaded = false;
        try {
            const res = await fetch('api/board', { cache: 'no-store' });
            if (!res.ok || !res.headers.get('content-type')?.includes('image/png')) throw new Error('no board');
            const seq = Number(res.headers.get('x-board-seq')) || 0;
            const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
            this.ctx.drawImage(bitmap, 0, 0);
            this.image = this.ctx.getImageData(0, 0, BOARD_W, BOARD_H);
            this.seq = seq;
        } catch {
            // demo mode / server unreachable: start blank
        }
        this.loaded = true;
        this.texture.needsUpdate = true;
        for (const msg of this.waiting.splice(0)) this.onRemote(msg);
    }

    // An op from the server (anyone's, ours included).
    onRemote(msg) {
        if (!this.loaded) { this.waiting.push(msg); return; }
        if (msg.seq <= this.seq) return;                  // already in the board we downloaded
        this.seq = msg.seq;
        if (msg.by === this.myId() && msg.op.t === 'l') return;   // our own line: already drawn
        this.draw(msg.op);
    }

    draw(op) {
        const box = applyOp(this.image.data, op);
        if (!box) return;
        this.ctx.putImageData(this.image, 0, 0, box.x0, box.y0, box.x1 - box.x0 + 1, box.y1 - box.y0 + 1);
        this.texture.needsUpdate = true;
    }

    // Local use. With a server, sends it; in demo mode, just draws.
    submit(op) {
        const clean = cleanOp(op);
        if (!clean) return;
        if (!this.send) { this.draw(clean); return; }
        if (clean.t === 'l') this.draw(clean);            // lines show at once; fills when they come back
        this.send(clean);
    }

    // ---------------------------------------------------------------- the pen / bucket (x, y in board pixels)
    down(x, y) {
        if (this.bucket) { this.submit({ t: 'f', c: this.color, p: [x, y] }); return; }
        this.stroke = { last: [x, y], pending: [x, y], fresh: true, timer: null };   // fresh: unsent points
        this.flushSoon();
    }

    move(x, y) {
        const s = this.stroke;
        if (!s || (x === s.last[0] && y === s.last[1])) return;
        s.pending.push(x, y);
        s.last = [x, y];
        s.fresh = true;
        if (s.pending.length >= 120) this.flush();
        else this.flushSoon();
    }

    up() {
        if (!this.stroke) return;
        this.flush();
        this.stroke = null;
    }

    flushSoon() {
        if (!this.stroke.timer) this.stroke.timer = setTimeout(() => this.flush(), SEND_EVERY_MS);
    }

    // Sends the stroke's points so far as one line op; the next batch starts at the last point.
    flush() {
        const s = this.stroke;
        if (!s) return;
        clearTimeout(s.timer);
        s.timer = null;
        if (s.fresh) this.submit({ t: 'l', c: this.color, w: this.width, p: s.pending });
        s.pending = [...s.last];
        s.fresh = false;
    }
}
