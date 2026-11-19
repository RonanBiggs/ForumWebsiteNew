// paintraster.js - the community paint board's drawing code, shared by the browser AND the
// server (server/board.js imports this file), so a stroke or a fill comes out exactly the
// same pixels everywhere. It draws straight into an RGBA pixel array (BOARD_W x BOARD_H x 4).
//
// Operations ("ops"), as sent over the network:
//   { t: 'l', c: <colour index>, w: <width px>, p: [x0, y0, x1, y1, ...] }   a pen line
//   { t: 'f', c: <colour index>, p: [x, y] }                                  bucket fill

export const BOARD_W = 1024;
export const BOARD_H = 512;
export const MAX_WIDTH = 40;          // pen width slider: 1..MAX_WIDTH pixels
export const MAX_POINTS = 256;        // numbers per line op (128 points)

// The colours (index = what ops send). White doubles as the eraser.
export const PALETTE = [
    '#000000', '#ffffff', '#8a8a8a', '#e53935', '#fb8c00', '#fdd835',
    '#43a047', '#1e88e5', '#4fc3f7', '#8e24aa', '#f06292', '#6d4c41',
];
const RGB = PALETTE.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));

const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));

// Checks an op (from anyone) and returns a clean copy, or null if it's not valid.
export function cleanOp(op) {
    if (!op || typeof op !== 'object') return null;
    const c = Number(op.c);
    if (!Number.isInteger(c) || c < 0 || c >= PALETTE.length) return null;
    const p = Array.isArray(op.p) ? op.p : null;
    if (!p || !p.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    if (op.t === 'f') {
        if (p.length !== 2) return null;
        return { t: 'f', c, p: [clampInt(p[0], 0, BOARD_W - 1), clampInt(p[1], 0, BOARD_H - 1)] };
    }
    if (op.t === 'l') {
        if (p.length < 2 || p.length > MAX_POINTS || p.length % 2) return null;
        const w = clampInt(op.w, 1, MAX_WIDTH);
        return { t: 'l', c, w, p: p.map((n, i) => clampInt(n, -MAX_WIDTH, (i % 2 ? BOARD_H : BOARD_W) + MAX_WIDTH)) };
    }
    return null;
}

// Draws a clean op into `px` (RGBA array). Returns the changed area { x0, y0, x1, y1 } or null.
export function applyOp(px, op) {
    return op.t === 'f' ? fill(px, op.p[0], op.p[1], RGB[op.c]) : line(px, op.p, op.w, RGB[op.c]);
}

export function clearBoard(px) {
    px.fill(255);
}

// A round pen: a filled circle stamped along every segment.
function line(px, p, width, rgb) {
    const r = Math.max(width / 2, 0.71);          // a 1-pixel pen still leaves a mark
    const box = { x0: BOARD_W, y0: BOARD_H, x1: -1, y1: -1 };
    const stamp = (cx, cy) => {
        const ymin = Math.max(0, Math.floor(cy - r)), ymax = Math.min(BOARD_H - 1, Math.ceil(cy + r));
        for (let y = ymin; y <= ymax; y++) {
            const dy = y + 0.5 - cy;
            const half = r * r - dy * dy;
            if (half < 0) continue;
            const dx = Math.sqrt(half);
            const xmin = Math.max(0, Math.ceil(cx - dx - 0.5)), xmax = Math.min(BOARD_W - 1, Math.floor(cx + dx - 0.5));
            for (let x = xmin; x <= xmax; x++) {
                const i = (y * BOARD_W + x) * 4;
                px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255;
            }
            if (xmin <= xmax) {
                if (xmin < box.x0) box.x0 = xmin;
                if (xmax > box.x1) box.x1 = xmax;
                if (y < box.y0) box.y0 = y;
                if (y > box.y1) box.y1 = y;
            }
        }
    };
    const step = Math.max(0.5, r / 2);
    let x = p[0], y = p[1];
    stamp(x + 0.5, y + 0.5);
    for (let k = 2; k < p.length; k += 2) {
        const nx = p[k], ny = p[k + 1];
        const n = Math.ceil(Math.hypot(nx - x, ny - y) / step);
        for (let s = 1; s <= n; s++) stamp(x + ((nx - x) * s) / n + 0.5, y + ((ny - y) * s) / n + 0.5);
        x = nx; y = ny;
    }
    return box.x1 < 0 ? null : box;
}

// Bucket fill: every pixel connected to (x, y) with exactly its colour becomes `rgb`.
function fill(px, x, y, rgb) {
    const at = (y * BOARD_W + x) * 4;
    const target = [px[at], px[at + 1], px[at + 2], px[at + 3]];
    if (target[0] === rgb[0] && target[1] === rgb[1] && target[2] === rgb[2] && target[3] === 255) return null;
    const same = (i) => px[i] === target[0] && px[i + 1] === target[1] && px[i + 2] === target[2] && px[i + 3] === target[3];
    const paint = (i) => { px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255; };
    const box = { x0: x, y0: y, x1: x, y1: y };
    const stack = [x, y];
    while (stack.length) {
        const sy = stack.pop(), sx0 = stack.pop();
        let lx = sx0;
        while (lx > 0 && same((sy * BOARD_W + lx - 1) * 4)) lx--;
        let rx = sx0;
        if (!same((sy * BOARD_W + sx0) * 4)) continue;
        while (rx < BOARD_W - 1 && same((sy * BOARD_W + rx + 1) * 4)) rx++;
        for (let fx = lx; fx <= rx; fx++) paint((sy * BOARD_W + fx) * 4);
        box.x0 = Math.min(box.x0, lx); box.x1 = Math.max(box.x1, rx);
        box.y0 = Math.min(box.y0, sy); box.y1 = Math.max(box.y1, sy);
        for (const ny of [sy - 1, sy + 1]) {
            if (ny < 0 || ny >= BOARD_H) continue;
            let inRun = false;
            for (let fx = lx; fx <= rx; fx++) {
                const ok = same((ny * BOARD_W + fx) * 4);
                if (ok && !inRun) { stack.push(fx, ny); inRun = true; }
                else if (!ok) inRun = false;
            }
        }
    }
    return box;
}
