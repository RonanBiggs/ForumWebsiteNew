// terminal.js - typing on a computer screen (a Station from computer.js).
//
//   'reply'  station (in a room):  type a reply (Enter = new line), click POST on the screen, or attach an image.
//   'thread' station (lobby):      TITLE / BODY fields (click one to type in it) + optional image,
//                                  click CREATE THREAD on the screen.
//
// Keystrokes go into a hidden <textarea> (so paste, arrow keys, IME etc. just
// work); we mirror its contents onto the station's screen canvas.

import { wrapText, FONTS } from './textures.js';
import { drawScreenBackground } from './computer.js';

const MONO = FONTS.MONO;

// Clickable areas on the 1024 x 768 screen canvas (also used to draw them).
const BUTTON = { x: 1024 - 380, y: 768 - 105, w: 330, h: 70 };      // POST / CREATE THREAD
const ATTACH = { x: 50, y: 768 - 105, w: 330, h: 70 };              // ATTACH IMAGE (reply screens)
const EXIT = { x: 1024 - 200, y: 28, w: 150, h: 52 };               // EXIT (stand up)
const AREAS = {
    title: { y0: 100, y1: 205 },
    body: { y0: 205, y1: 500 },
    image: { y0: 550, y1: 640 },
};

// Shape picker: what an image floats as in the room. Small 2D drawings, click one to pick it.
export const SHAPES = ['cube', 'pyramid', 'sphere', 'icosahedron'];
function shapeRects(mode) {
    // new-thread screen: under the IMAGE line, left of CREATE THREAD
    // reply screen: between ATTACH IMAGE and POST
    const size = mode === 'thread' ? 60 : 56, gap = mode === 'thread' ? 12 : 8;
    const x0 = mode === 'thread' ? 90 : ATTACH.x + ATTACH.w + (BUTTON.x - ATTACH.x - ATTACH.w - (4 * size + 3 * gap)) / 2;
    const y = BUTTON.y + (BUTTON.h - size) / 2;
    return SHAPES.map((shape, i) => ({ shape, x: x0 + i * (size + gap), y, w: size, h: size }));
}
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export class Terminal {
    constructor({ input, fileInput, api, onExit, onThreadCreated }) {
        this.input = input;
        this.fileInput = fileInput;
        this.api = api;
        this.onExit = onExit;
        this.onThreadCreated = onThreadCreated;
        this.station = null;
        this.status = '';
        this.busy = false;
        this.blink = true;
        this.form = null;                       // thread mode: { title, body, image, field }
        this.shape = 'cube';                    // picked shape for the next image (kept between posts)

        input.addEventListener('input', () => this.syncField());
        input.addEventListener('keyup', () => this.draw());          // caret moves
        input.addEventListener('keydown', (e) => this.onKey(e));
        // Ctrl+V / paste with an image on the clipboard: attach it (text pastes as normal)
        input.addEventListener('paste', (e) => {
            const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
            const file = item?.getAsFile();
            if (!file || !this.station) return;
            e.preventDefault();
            if (!IMAGE_TYPES.includes(file.type)) {
                this.status = 'ERROR: only PNG, JPG, GIF and WEBP images';
                this.draw();
                return;
            }
            const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
            this.attachFile(file.name && file.name !== 'image.png' ? file : new File([file], `pasted.${ext}`, { type: file.type }));
        });
        fileInput.addEventListener('change', () => {
            const file = fileInput.files[0];
            fileInput.value = '';
            if (file) this.attachFile(file);
            this.focus();
        });
        setInterval(() => { this.blink = !this.blink; if (this.station) this.draw(); }, 530);
    }

    get mode() { return this.station?.kind; }

    open(station) {
        this.station = station;
        station.inUse = true;
        this.status = '';
        this.input.value = '';
        this.form = station.kind === 'thread' ? { title: '', body: '', image: null, field: 'title' } : null;
        this.focus();
        this.draw();
    }

    close() {
        if (!this.station) return;
        this.input.blur();
        this.station.inUse = false;
        this.station.drawIdle();
        this.station = null;
        this.form = null;
    }

    focus() { if (this.station) this.input.focus({ preventScroll: true }); }

    attach() { if (this.station && !this.busy) this.fileInput.click(); }

    // The POST / CREATE THREAD button on the screen.
    submit() {
        if (!this.station) return;
        if (this.mode === 'thread') this.createThread();
        else this.postReply();
    }

    // ------------------------------------------------------------------ input
    syncField() {
        if (this.form) this.form[this.form.field] = this.input.value;
        this.draw();
    }

    switchField(field) {
        this.form.field = field;
        this.input.value = this.form[field];
        this.input.setSelectionRange(this.input.value.length, this.input.value.length);
        this.draw();
    }

    onKey(e) {
        if (!this.station) return;
        if (e.key === 'Escape') { e.preventDefault(); this.onExit(); return; }

        // Enter types a new line (the textarea does that by itself). Posting is the button on the screen.
        if (this.mode === 'thread') {
            if (e.key === 'Tab') {
                e.preventDefault();
                this.switchField(this.form.field === 'title' ? 'body' : 'title');
            } else if (e.key === 'Enter' && this.form.field === 'title') {
                e.preventDefault();          // the title is one line: Enter on it moves down to the body
                this.switchField('body');
            }
        }
    }

    // A click on the screen at canvas pixel (x, y). Returns true if it hit something.
    clickAt(x, y) {
        if (!this.station) return false;
        if (inRect(x, y, EXIT)) { this.onExit(); return true; }
        if (inRect(x, y, BUTTON)) { this.submit(); return true; }
        const picked = shapeRects(this.mode).find((r) => inRect(x, y, r));
        if (picked) { this.shape = picked.shape; this.draw(); return true; }
        if (this.mode !== 'thread') {
            if (inRect(x, y, ATTACH)) { this.attach(); return true; }
            return false;
        }
        for (const field of ['title', 'body']) {
            if (y >= AREAS[field].y0 && y < AREAS[field].y1) {
                if (this.form.field !== field) this.switchField(field);
                return true;
            }
        }
        if (y >= AREAS.image.y0 && y < AREAS.image.y1) { this.attach(); return true; }
        return false;
    }

    attachFile(file) {
        if (this.mode === 'thread') {
            this.form.image = file;          // sent together with the thread
            this.status = '';
            this.draw();
        } else {
            this.send(() => this.api.uploadImage(this.station.room.id, file, this.shape), 'Image posted.')
                .then((reply) => reply && this.station?.room.addReply(reply));
        }
    }

    // ------------------------------------------------------------------ sending
    async postReply() {
        const text = this.input.value.trim();
        if (!text || this.busy) return;
        const room = this.station.room;
        const reply = await this.send(() => this.api.postReply(room.id, text), 'Posted. It is on the wall now.');
        if (reply) {
            room.addReply(reply);
            this.input.value = '';
        }
        this.draw();
    }

    async createThread() {
        const { title, body, image } = this.form;
        if (!title.trim()) {
            this.status = 'ERROR: the thread needs a title';
            this.switchField('title');
            return;
        }
        if (this.busy) return;
        const thread = await this.send(() => this.api.createThread(title, body, image, this.shape), '');
        if (thread) {
            this.onThreadCreated(thread);
            this.status = `Created! Room ${thread.thread_id} is the first door down the hall.`;
            this.form = { title: '', body: '', image: null, field: 'title' };
            this.input.value = '';
        }
        this.draw();
    }

    // Runs an API call, showing progress/errors on screen. Returns its result or null.
    async send(fn, okMessage) {
        this.busy = true;
        this.status = 'sending…';
        this.draw();
        try {
            const result = await fn();
            this.status = okMessage;
            return result;
        } catch (err) {
            this.status = 'ERROR: ' + err.message;
            return null;
        } finally {
            this.busy = false;
            this.draw();
        }
    }

    // ------------------------------------------------------------------ drawing
    // Text with a block cursor at the caret (same width as a space in monospace, so no reflow).
    withCursor(text, active) {
        if (!active) return text;
        const caret = this.input.selectionStart ?? text.length;
        return text.slice(0, caret) + (this.blink ? '█' : ' ') + text.slice(caret);
    }

    draw() {
        const st = this.station;
        if (!st) return;
        const g = st.canvas.getContext('2d');
        const { width: w, height: h } = st.canvas;
        drawScreenBackground(g, w, h);
        g.textBaseline = 'top';
        g.fillStyle = '#ffffff';

        if (this.mode === 'thread') this.drawThreadForm(g, w, h);
        else this.drawReply(g, w, h);

        // status line, then the buttons: EXIT (top right), POST / CREATE THREAD (bottom right),
        // ATTACH IMAGE (bottom left, reply screens; the new-thread form has its IMAGE line)
        g.font = `26px ${MONO}`;
        g.fillStyle = this.status.startsWith('ERROR') ? '#ff5555' : '#dddddd';
        if (this.mode === 'thread') {
            g.font = `24px ${MONO}`;
            wrapText(g, this.status, w - 140).slice(0, 2).forEach((l, i) => g.fillText(l, 90, 505 + i * 26));
        } else {
            wrapText(g, this.status, w - 100).slice(0, 2).forEach((l, i) => g.fillText(l, 50, 590 + i * 32));
            this.drawButton(g, ATTACH, 'ATTACH IMAGE');
        }
        for (const r of shapeRects(this.mode)) drawShapeIcon(g, r, r.shape === this.shape);
        this.drawButton(g, BUTTON, this.mode === 'thread' ? 'CREATE THREAD' : 'POST');
        this.drawButton(g, EXIT, 'EXIT', 28);
        st.texture.needsUpdate = true;
    }

    drawButton(g, b, label, size = 34) {
        g.fillStyle = this.busy ? '#666666' : '#ffffff';
        g.fillRect(b.x, b.y, b.w, b.h);
        g.fillStyle = '#1a1a1a';
        g.font = `bold ${size}px ${MONO}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 2);
        g.textAlign = 'left';
        g.textBaseline = 'top';
    }

    drawReply(g, w) {
        const room = this.station.room;
        g.font = `bold 34px ${MONO}`;
        const title = room.thread.thread_title;
        g.fillText(`REPLY :: ${title.length > 26 ? title.slice(0, 25) + '…' : title}`, 50, 40);
        g.fillRect(50, 90, w - 100, 3);
        g.font = `34px ${MONO}`;
        const lines = wrapText(g, '> ' + this.withCursor(this.input.value, true), w - 100);
        lines.slice(-11).forEach((l, i) => g.fillText(l, 50, 120 + i * 42));
        // (11 lines end at y ~580, above the status line and the buttons)
    }

    drawThreadForm(g, w) {
        const f = this.form;
        g.font = `bold 34px ${MONO}`;
        g.fillText('NEW THREAD', 50, 40);
        g.fillRect(50, 90, w - 100, 3);

        const label = (text, y, active) => {
            g.fillStyle = active ? '#ffffff' : '#888888';
            g.font = `bold 28px ${MONO}`;
            g.fillText((active ? '▶ ' : '  ') + text, 50, y);
        };
        g.font = `32px ${MONO}`;

        label('TITLE', 115, f.field === 'title');
        g.fillStyle = '#ffffff';
        g.font = `32px ${MONO}`;
        const titleLine = wrapText(g, this.withCursor(f.title, f.field === 'title'), w - 140).slice(-1)[0];
        g.fillText(titleLine, 90, 155);

        label('BODY (optional)', 215, f.field === 'body');
        g.fillStyle = '#ffffff';
        g.font = `30px ${MONO}`;
        const bodyLines = wrapText(g, this.withCursor(f.body, f.field === 'body'), w - 140);
        bodyLines.slice(-6).forEach((l, i) => g.fillText(l, 90, 255 + i * 36));      // 6 lines, status below

        label('IMAGE (optional)', 560, false);
        g.fillStyle = '#ffffff';
        g.font = `28px ${MONO}`;
        g.fillText(f.image ? f.image.name : 'none: click here, or paste one (Ctrl+V)', 90, 600);
    }
}

// One shape-picker box: a 2D line drawing of the shape. Selected = white box, dark lines.
function drawShapeIcon(g, r, selected) {
    const { x, y, w: s } = r;
    g.fillStyle = selected ? '#ffffff' : '#1a1a1a';
    g.fillRect(x, y, s, s);
    g.strokeStyle = selected ? '#ffffff' : '#666666';
    g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, s - 2, s - 2);
    g.strokeStyle = selected ? '#1a1a1a' : '#bbbbbb';
    g.lineWidth = 2.5;
    g.lineJoin = 'round';
    const P = (px, py) => [x + px * s, y + py * s];          // 0..1 inside the box
    const path = (pts, close = true) => {
        g.beginPath();
        pts.forEach(([px, py], i) => (i ? g.lineTo(...P(px, py)) : g.moveTo(...P(px, py))));
        if (close) g.closePath();
        g.stroke();
    };
    const lines = (pairs) => pairs.forEach(([a, b]) => path([a, b], false));

    if (r.shape === 'cube') {
        const f = [[0.2, 0.38], [0.62, 0.38], [0.62, 0.8], [0.2, 0.8]];     // front face
        const b = f.map(([px, py]) => [px + 0.18, py - 0.18]);              // back face
        path(f);
        path(b);
        lines(f.map((p, i) => [p, b[i]]));
    } else if (r.shape === 'pyramid') {
        const top = [0.5, 0.15], l = [0.16, 0.72], fr = [0.46, 0.85], rt = [0.84, 0.68];
        path([l, fr, rt], false);
        lines([[top, l], [top, fr], [top, rt]]);
    } else if (r.shape === 'sphere') {
        const cx = x + s / 2, cy = y + s / 2, rad = s * 0.34;
        g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.ellipse(cx, cy, rad, rad * 0.35, 0, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.ellipse(cx, cy, rad * 0.35, rad, 0, 0, Math.PI * 2); g.stroke();
    } else {
        // icosahedron: hexagon outline, a triangle inside, joined to the corners
        const hex = [...Array(6)].map((_, i) => {
            const a = -Math.PI / 2 + (i * Math.PI) / 3;
            return [0.5 + 0.36 * Math.cos(a), 0.5 + 0.36 * Math.sin(a)];
        });
        const tri = [[0.5, 0.68], [0.31, 0.37], [0.69, 0.37]];
        path(hex);
        path(tri);
        lines([[tri[0], hex[2]], [tri[0], hex[3]], [tri[0], hex[4]],
               [tri[1], hex[4]], [tri[1], hex[5]], [tri[1], hex[0]],
               [tri[2], hex[0]], [tri[2], hex[1]], [tri[2], hex[2]]]);
    }
}
