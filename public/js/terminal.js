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
const AREAS = {
    title: { y0: 100, y1: 205 },
    body: { y0: 205, y1: 550 },
    image: { y0: 550, y1: 640 },
};
const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export class Terminal {
    constructor({ input, fileInput, hint, api, onExit, onThreadCreated }) {
        this.input = input;
        this.fileInput = fileInput;
        this.hint = hint;                       // HTML element showing the key help
        this.api = api;
        this.onExit = onExit;
        this.onThreadCreated = onThreadCreated;
        this.station = null;
        this.status = '';
        this.busy = false;
        this.blink = true;
        this.form = null;                       // thread mode: { title, body, image, field }

        input.addEventListener('input', () => this.syncField());
        input.addEventListener('keyup', () => this.draw());          // caret moves
        input.addEventListener('keydown', (e) => this.onKey(e));
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
        this.hint.textContent = station.kind === 'thread'
            ? 'Click TITLE or BODY to type there · Enter: new line · click CREATE THREAD to post · Esc: stand up'
            : 'Enter: new line · click POST on the screen to send · Esc: stand up';
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

    // Same as pressing Enter on the last field (the Post / Create button).
    submit() {
        if (!this.station) return;
        if (this.mode === 'thread') this.createThread();
        else this.postReply();
    }

    // Same as Tab (the Next field button).
    nextField() {
        if (this.form) this.switchField(this.form.field === 'title' ? 'body' : 'title');
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
        if (inRect(x, y, BUTTON)) { this.submit(); return true; }
        if (this.mode !== 'thread') return false;
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
            this.send(() => this.api.uploadImage(this.station.room.id, file), 'Image posted.')
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
        const thread = await this.send(() => this.api.createThread(title, body, image), '');
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

        // status (left) and the POST / CREATE THREAD button (bottom right)
        g.font = `26px ${MONO}`;
        g.fillStyle = this.status.startsWith('ERROR') ? '#ff5555' : '#dddddd';
        wrapText(g, this.status, BUTTON.x - 80).slice(0, 2).forEach((l, i) => g.fillText(l, 50, h - 95 + i * 32));
        this.drawButton(g, this.mode === 'thread' ? 'CREATE THREAD' : 'POST');
        st.texture.needsUpdate = true;
    }

    drawButton(g, label) {
        const b = BUTTON;
        g.fillStyle = this.busy ? '#666666' : '#ffffff';
        g.fillRect(b.x, b.y, b.w, b.h);
        g.fillStyle = '#1a1a1a';
        g.font = `bold 34px ${MONO}`;
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
        g.fillText(`REPLY :: ${title.length > 34 ? title.slice(0, 33) + '…' : title}`, 50, 40);
        g.fillRect(50, 90, w - 100, 3);
        g.font = `34px ${MONO}`;
        const lines = wrapText(g, '> ' + this.withCursor(this.input.value, true), w - 100);
        lines.slice(-12).forEach((l, i) => g.fillText(l, 50, 120 + i * 42));
        // (12 lines end at y ~620, above the status line and POST button)
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
        bodyLines.slice(-8).forEach((l, i) => g.fillText(l, 90, 255 + i * 36));

        label('IMAGE (optional)', 560, false);
        g.fillStyle = '#ffffff';
        g.font = `28px ${MONO}`;
        g.fillText(f.image ? f.image.name : 'none, click here to attach one', 90, 600);
    }
}
