// server/board.js - the community paint board in the lobby. The server keeps THE board:
// every stroke / fill (from multiplayer.js) is drawn into it with the same code the
// browsers use (public/js/paintraster.js), numbered (seq), and the board is saved to the
// database a few seconds after it changes. New visitors download it as a PNG
// (GET /api/board) and then get the strokes that come after it live.

import zlib from 'node:zlib';
import { pool } from './db.js';
import { BOARD_W, BOARD_H, cleanOp, applyOp, clearBoard } from '../public/js/paintraster.js';

const SAVE_AFTER_MS = 5000;

const pixels = new Uint8Array(BOARD_W * BOARD_H * 4);
clearBoard(pixels);
let seq = 0;                 // number of the last op drawn
let saveTimer = null;
let png = null;              // { seq, data } PNG of the board, made when someone asks for it

// Loads the saved board (if any). Called once at startup.
export async function loadBoard() {
    const { rows } = await pool.query('SELECT pixels, seq FROM paint_board WHERE id = 1');
    if (!rows.length) return;
    const raw = zlib.inflateSync(rows[0].pixels);
    if (raw.length === pixels.length) pixels.set(raw);
    seq = Number(rows[0].seq);
}

// One op from a player: checked, drawn, numbered. Returns { seq, op } or null if invalid.
export function paint(op) {
    const clean = cleanOp(op);
    if (!clean) return null;
    applyOp(pixels, clean);
    seq++;
    if (!saveTimer) saveTimer = setTimeout(save, SAVE_AFTER_MS);
    return { seq, op: clean };
}

async function save() {
    saveTimer = null;
    const at = seq;
    try {
        await pool.query(
            `INSERT INTO paint_board (id, pixels, seq, updated_at) VALUES (1, $1, $2, now())
             ON CONFLICT (id) DO UPDATE SET pixels = EXCLUDED.pixels, seq = EXCLUDED.seq, updated_at = now()`,
            [zlib.deflateSync(pixels), at]);
    } catch (err) {
        console.error('[board] save failed:', err.message);
        if (!saveTimer) saveTimer = setTimeout(save, SAVE_AFTER_MS * 6);     // try again later
    }
}

// Saves now (server shutting down).
export async function flushBoard() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    await save();
}

// The board as a PNG + the seq it's up to.
export function boardPng() {
    if (png?.seq !== seq) png = { seq, data: encodePng(pixels, BOARD_W, BOARD_H) };
    return png;
}

// ------------------------------------------------------------------ a tiny PNG encoder (RGBA, no filters)
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}
function encodePng(rgba, w, h) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(w, 0);
    header.writeUInt32BE(h, 4);
    header[8] = 8; header[9] = 6;                      // 8 bits, RGBA
    const raw = Buffer.alloc((w * 4 + 1) * h);         // each row: filter byte 0 + pixels
    for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}
