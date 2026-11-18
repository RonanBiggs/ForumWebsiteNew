// terminal.js - typing on a computer screen (a Station from computer.js).
//
//   'reply'  station (in a room):  type a reply, Enter posts it, or attach an image.
//   'thread' station (lobby):      TITLE -> BODY fields + optional image, creates a thread.
//
// Keystrokes go into a hidden <textarea> (so paste, arrow keys, IME etc. just
// work); we mirror its contents onto the station's screen canvas.

import { wrapText, FONTS } from './textures.js';
import { drawScreenBackground } from './computer.js';

const MONO = FONTS.MONO;

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
            ? 'Enter: next field / create · Tab: switch field · Shift+Enter: new line · Esc: stand up'
            : 'Enter: post · Shift+Enter: new line · Esc: stand up';
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

        if (this.mode === 'thread') {
            if (e.key === 'Tab') {
                e.preventDefault();
                this.switchField(this.form.field === 'title' ? 'body' : 'title');
            } else if (e.key === 'Enter' && (this.form.field === 'title' || !e.shiftKey)) {
                e.preventDefault();          // title is one line; Enter on it moves to the body
                if (this.form.field === 'title') this.switchField('body');
                else this.createThread();
            }
        } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.postReply();
        }
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

        g.font = `26px ${MONO}`;
        g.fillStyle = this.status.startsWith('ERROR') ? '#ff5555' : '#dddddd';
        wrapText(g, this.status, w - 100).slice(0, 2).forEach((l, i) => g.fillText(l, 50, h - 90 + i * 32));
        st.texture.needsUpdate = true;
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
        g.fillText(f.image ? f.image.name : 'none, use "Attach image" below', 90, 600);
    }
}
