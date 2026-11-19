// textures.js - PLACEHOLDER textures, all drawn on <canvas> (no image files).
// Swap these out for real textures/materials later.

import * as THREE from 'three';

const FONT = 'Arial, Helvetica, sans-serif';
const MONO = '"Courier New", monospace';

function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

function toTexture(canvas, repeat = true) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

// Generic 1 m prototype grid in a given colour.
export function gridTexture(base) {
    const c = makeCanvas(256, 256);
    const g = c.getContext('2d');
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 2;
    for (let i = 64; i < 256; i += 64) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 4;
    g.strokeRect(0, 0, 256, 256);
    return toTexture(c);
}

// Word-wraps text to maxWidth, honouring \n and breaking very long words.
export function wrapText(g, text, maxWidth) {
    const lines = [];
    for (const para of String(text).split('\n')) {
        let line = '';
        for (let word of para.split(' ')) {
            while (g.measureText(word).width > maxWidth) {
                let i = word.length;
                while (i > 1 && g.measureText((line ? line + ' ' : '') + word.slice(0, i)).width > maxWidth) i--;
                if (line && i <= 1) { lines.push(line); line = ''; continue; }
                lines.push((line ? line + ' ' : '') + word.slice(0, i));
                line = '';
                word = word.slice(i);
            }
            const test = line ? line + ' ' + word : word;
            if (g.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = test;
            }
        }
        lines.push(line);
    }
    return lines;
}

// Plain white label with black text, shrunk/ellipsised to fit.
export function labelTexture(text, { width = 1024, height = 192, size = 72 } = {}) {
    const c = makeCanvas(width, height);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);
    g.strokeStyle = '#000000';
    g.lineWidth = 6;
    g.strokeRect(3, 3, width - 6, height - 6);
    g.fillStyle = '#000000';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let s = size;
    g.font = `bold ${s}px ${FONT}`;
    while (g.measureText(text).width > width - 60 && s > 32) g.font = `bold ${(s -= 4)}px ${FONT}`;
    while (g.measureText(text).width > width - 60 && text.length > 1) text = text.slice(0, -2) + '…';
    g.fillText(text, width / 2, height / 2);
    return toTexture(c, false);
}

// ---------- reply panels (posts hung on the room's left wall) ----------

export const PANEL_PX = { w: 512, h: 360 };

export function replyPanelTexture(reply) {
    const { w, h } = PANEL_PX;
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');

    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#000000';
    g.lineWidth = 4;
    g.strokeRect(2, 2, w - 4, h - 4);

    g.fillStyle = '#000000';
    g.textBaseline = 'top';
    g.font = `bold 22px ${MONO}`;
    g.fillText(`No. ${reply.session_id}`, 20, 18);
    g.font = `16px ${MONO}`;
    g.textAlign = 'right';
    g.fillStyle = '#555555';
    g.fillText(String(reply.post_date || '').slice(0, 16), w - 20, 22);
    g.textAlign = 'left';
    g.fillRect(20, 50, w - 40, 2);

    const top = 64;
    if (Number(reply.image) >= 1) {           // image / 3D model posted on its own: it floats in front of this board
        g.fillStyle = '#555555';
        g.font = `italic 26px ${FONT}`;
        g.fillText(Number(reply.image) === 2 ? '[3D model]' : '[image]', 24, top + 20);
    } else {
        g.fillStyle = '#000000';
        g.font = `24px ${FONT}`;
        const lineH = 30;
        const maxLines = Math.floor((h - top - 46) / lineH);
        const lines = wrapText(g, reply.post_content, w - 48);
        const shown = lines.slice(0, maxLines);
        if (lines.length > maxLines) shown[maxLines - 1] = shown[maxLines - 1].replace(/.{0,3}$/, '…');
        shown.forEach((line, i) => g.fillText(line, 24, top + 6 + i * lineH));
        if (lines.length > maxLines) {
            g.fillStyle = '#0000cc';
            g.font = `italic 18px ${FONT}`;
            g.fillText('[E] read the rest', 24, h - 38);
        }
    }
    return toTexture(c, false);
}

// ---------- image cubes ----------

// Loads an uploaded image onto a canvas texture for the image shapes. The image
// is stretched to fill a 2:1 canvas, which then gets wrapped around the shape.
// (Drawn INTO the canvas rather than replacing it: the GPU texture keeps its
// first size, so swapping in a different-sized image would fail silently.)
// Animated GIFs play: their frames are decoded with gifuct-js and drawn in turn.
export function imageTexture(url) {
    const W = 1024, H = 512;
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    const message = (bg, text) => {
        g.fillStyle = bg;
        g.fillRect(0, 0, W, H);
        g.fillStyle = '#ffffff';
        g.font = `32px ${FONT}`;
        g.textAlign = 'center';
        for (let x = W / 8; x < W; x += W / 4) g.fillText(text, x, H / 2);
    };
    message('#888888', 'loading…');
    const tex = toTexture(c, false);

    const show = (source) => {
        g.clearRect(0, 0, W, H);          // keep PNG / WEBP / GIF transparency (the shape is see-through there)
        g.drawImage(source, 0, 0, W, H);
        tex.needsUpdate = true;
    };
    (async () => {
        const bytes = await (await fetch(url)).arrayBuffer();
        const head = new Uint8Array(bytes, 0, 4);
        const isGif = String.fromCharCode(...head) === 'GIF8';
        if (isGif && await playGif(bytes, show, tex)) return;
        // still image (or a 1-frame GIF): a plain <img> also handles SVG (demo data)
        const img = new Image();
        img.src = url;
        await img.decode();
        show(img);
    })().catch((err) => {
        console.warn('Image failed to load', url, err);
        message('#aa0000', 'image failed to load');
        tex.needsUpdate = true;
    });
    return tex;
}

// ---------- animated GIFs ----------
const GIF_LIB = 'https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm';
let gifLib = null;
const playing = new Set();          // { draw(now) } for every GIF on screen
let ticking = false;

// Decodes the GIF and keeps calling show(canvas) with the current frame.
// Returns false if it only has one frame (then it's shown like a still image).
async function playGif(bytes, show, tex) {
    gifLib ??= import(GIF_LIB);
    const { parseGIF, decompressFrames } = await gifLib;
    const gif = parseGIF(bytes);
    const frames = decompressFrames(gif, true);
    if (frames.length < 2) return false;

    // Keep at most ~12 million decoded pixels (~48 MB) per GIF; very long GIFs just loop sooner.
    let budget = 12e6, count = 0;
    while (count < frames.length && (budget -= frames[count].dims.width * frames[count].dims.height) > 0) count++;
    frames.length = Math.max(2, count);

    // Each frame is a patch drawn over the previous picture: build it up on `full` as it plays.
    const full = makeCanvas(gif.lsd.width, gif.lsd.height), fg = full.getContext('2d');
    const patch = makeCanvas(1, 1), pg = patch.getContext('2d');
    let i = 0, next = 0, prev = null;
    const anim = {
        draw(now) {
            if (now < next) return;
            if (i === 0) fg.clearRect(0, 0, full.width, full.height);
            else if (prev?.disposalType === 2) fg.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height);
            const f = frames[i];
            const { width, height, left, top } = f.dims;
            if (patch.width !== width || patch.height !== height) { patch.width = width; patch.height = height; }
            pg.putImageData(new ImageData(f.patch, width, height), 0, 0);
            fg.drawImage(patch, left, top);
            show(full);
            next = now + Math.max(20, f.delay || 100);
            prev = f;
            i = (i + 1) % frames.length;
        },
    };
    playing.add(anim);
    tex.addEventListener('dispose', () => playing.delete(anim));     // room rebuilt: stop
    if (!ticking) {
        ticking = true;
        const tick = (now) => {
            playing.forEach((a) => a.draw(now));
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }
    return true;
}

export const FONTS = { FONT, MONO };
