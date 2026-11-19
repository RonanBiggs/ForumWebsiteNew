// server/index.js - serves the 3D hotel (public/), the JSON API (/api/...)
// backed by Postgres, and the multiplayer WebSocket (/ws).
//
//   npm start          (reads DATABASE_URL from .env locally, or from Render's settings)

import http from 'node:http';
import crypto from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import * as db from './db.js';
import { attachMultiplayer } from './multiplayer.js';
import { clientIp } from './ip.js';

const PORT = Number(process.env.PORT) || 3000;
const MAX_TEXT = 5000;
const MAX_TITLE = 255;
const MAX_NAME = 24;
const SHAPES = ['cube', 'pyramid', 'sphere', 'icosahedron'];     // what an image reply floats as
const cleanShape = (value) => (SHAPES.includes(value) ? value : 'cube');
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;     // keep small: Neon's free database is 0.5 GB in total
const MAX_MODEL_BYTES = 10 * 1024 * 1024;    // 3D models (.glb .gltf .obj .stl .fbx)
const MAX_SCAN_BYTES = 25 * 1024 * 1024;     // room scans (Polycam, Scaniverse...): .glb .gltf .fbx .obj .ply
const WRITES_PER_MINUTE = 10;                // per IP: posts + uploads + new threads

const app = express();
app.set('trust proxy', 1);                   // behind Render's proxy: req.secure is right (the visitor's IP: see ip.js)
app.disable('x-powered-by');

// ------------------------------------------------------------------ helpers
class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
const bad = (message) => new HttpError(400, message);

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

function intParam(value, name) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw bad(`Missing or invalid ${name}.`);
    return n;
}

function cleanText(value, label, { required = false, max = MAX_TEXT } = {}) {
    const text = String(value ?? '').trim();
    if (required && !text) throw bad(`${label} cannot be empty.`);
    if ([...text].length > max) throw bad(`${label} is too long (max ${max} characters).`);
    return text;
}

// Only real PNG / JPEG / GIF / WEBP files, checked by their first bytes (not the file name).
function imageFromUpload(file) {
    if (!file) return null;
    const b = file.buffer;
    if (b.length > MAX_IMAGE_BYTES) throw bad(`Images can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
    let mime = null;
    if (b.length > 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') mime = 'image/png';
    else if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) mime = 'image/jpeg';
    else if (b.length > 6 && b.toString('ascii', 0, 4) === 'GIF8') mime = 'image/gif';
    else if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') mime = 'image/webp';
    if (!mime) throw bad('Only PNG, JPG, JPEG, GIF and WEBP files are allowed.');
    return { mime, data: b };
}

// 3D models: GLB / glTF, OBJ, STL, FBX, checked by their contents (and the file name
// for the text formats). Returns null if it isn't one.
function modelFromUpload(file) {
    const b = file.buffer;
    const name = (file.originalname || '').toLowerCase();
    const starts = (s) => b.length >= s.length && b.toString('latin1', 0, s.length) === s;
    const text = () => b.toString('utf8');
    let mime = null;
    if (starts('glTF')) mime = 'model/gltf-binary';
    else if (starts('Kaydara FBX Binary')) mime = 'model/fbx';
    else if (name.endsWith('.gltf')) {
        let json;
        try { json = JSON.parse(text()); } catch { throw bad('That .gltf file is not valid.'); }
        if (!json?.asset) throw bad('That .gltf file is not valid.');
        // only one file is uploaded, so everything must be inside it
        const uris = [...(json.buffers || []), ...(json.images || [])].map((x) => x.uri).filter(Boolean);
        if (uris.some((u) => !u.startsWith('data:'))) throw bad('That .gltf uses separate files. Export it as a single .glb instead.');
        mime = 'model/gltf+json';
    } else if (name.endsWith('.fbx') && /^\s*; FBX/.test(text().slice(0, 200))) mime = 'model/fbx';
    else if (name.endsWith('.stl')) {
        const binary = b.length >= 84 && b.length === 84 + 50 * b.readUInt32LE(80);
        if (binary || /^\s*solid/.test(text().slice(0, 100))) mime = 'model/stl';
    } else if (name.endsWith('.ply') && starts('ply')) {
        mime = 'model/ply';                         // Polycam / Scaniverse mesh or point cloud
    } else if (name.endsWith('.obj')) {
        const t = text();
        if (!t.includes('\0') && /^v\s/m.test(t) && /^f\s/m.test(t)) mime = 'model/obj';
    }
    return mime ? { mime, data: b } : null;
}

// Replies / new threads take an image OR a 3D model: { kind: 'image' | 'model', mime, data }
function fileFromUpload(file) {
    if (!file) return null;
    const model = modelFromUpload(file);
    if (model?.mime === 'model/ply') throw bad('PLY files can only be used as a room scan.');
    if (model && model.data.length > MAX_MODEL_BYTES) throw bad(`3D models can be at most ${MAX_MODEL_BYTES / 1024 / 1024} MB.`);
    if (model) return { kind: 'model', ...model };
    try {
        return { kind: 'image', ...imageFromUpload(file) };
    } catch (err) {
        if (err.message.startsWith('Only')) throw bad('Only images (PNG, JPG, GIF, WEBP) and 3D models (GLB, glTF, OBJ, STL, FBX) are allowed.');
        throw err;
    }
}

// A room scan for a new thread: a 3D model file (incl. PLY), up to MAX_SCAN_BYTES.
function scanFromUpload(file) {
    if (!file) return null;
    const scan = modelFromUpload(file);
    if (!scan) {
        if ((file.originalname || '').toLowerCase().endsWith('.usdz')) throw bad('USDZ scans are not supported: export the scan as GLB instead.');
        throw bad('Room scans must be GLB, glTF, FBX, OBJ or PLY (from Polycam, Scaniverse...).');
    }
    if (!['model/gltf-binary', 'model/gltf+json', 'model/fbx', 'model/obj', 'model/ply'].includes(scan.mime)) {
        throw bad('Room scans must be GLB, glTF, FBX, OBJ or PLY.');
    }
    return scan;
}

async function requireThread(threadId) {
    if (!(await db.threadExists(threadId))) throw new HttpError(404, 'Thread not found.');
}

// Very simple spam brake: at most WRITES_PER_MINUTE writes per IP.
const writes = new Map();
function rateLimit(req, res, next) {
    const now = Date.now();
    const ip = clientIp(req);
    const recent = (writes.get(ip) || []).filter((t) => now - t < 60000);
    if (recent.length >= WRITES_PER_MINUTE) return next(new HttpError(429, 'Slow down a bit and try again in a minute.'));
    recent.push(now);
    writes.set(ip, recent);
    next();
}
setInterval(() => {
    const now = Date.now();
    for (const [ip, times] of writes) if (times.every((t) => now - t >= 60000)) writes.delete(ip);
}, 60000).unref();

// Visitor id cookie -> poster numbers (one per visitor per thread).
app.use('/api', (req, res, next) => {
    const m = /(?:^|;\s*)hotel_vid=([a-f0-9]{32})/.exec(req.headers.cookie || '');
    req.visitorId = m ? m[1] : crypto.randomBytes(16).toString('hex');
    if (!m) {
        res.cookie('hotel_vid', req.visitorId, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 365 * 864e5 });
    }
    res.set('Cache-Control', 'no-store');
    next();
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SCAN_BYTES, files: 2, fields: 5, fieldSize: 64 * 1024 },     // images (3 MB) and models (10 MB) are checked themselves
});

// ------------------------------------------------------------------ API
app.get('/api/health', (req, res) => res.json({ ok: true, online: multiplayer.count() }));

app.get('/api/threads', route(async (req, res) => {
    res.json(await db.listThreads());
}));

app.get('/api/replies', route(async (req, res) => {
    res.json(await db.getReplies(intParam(req.query.thread_id, 'thread_id')));
}));

app.post('/api/reply', rateLimit, upload.none(), route(async (req, res) => {
    const threadId = intParam(req.body.thread_id, 'thread_id');
    const text = cleanText(req.body.post_content, 'Reply', { required: true });
    await requireThread(threadId);
    const reply = await db.addTextReply(req.visitorId, threadId, text);
    multiplayer.broadcast({ type: 'reply', reply });
    res.json(reply);
}));

app.post('/api/upload', rateLimit, upload.single('image'), route(async (req, res) => {
    const threadId = intParam(req.body.thread_id, 'thread_id');
    const image = fileFromUpload(req.file);         // an image or a 3D model
    if (!image) throw bad('Please choose an image or 3D model to upload.');
    await requireThread(threadId);
    const reply = await db.addImageReply(req.visitorId, threadId, image, cleanShape(req.body.shape));
    multiplayer.broadcast({ type: 'reply', reply });
    res.json(reply);
}));

// Text and/or a file (image or 3D model) in one post. Returns [reply, ...].
app.post('/api/post', rateLimit, upload.single('image'), route(async (req, res) => {
    const threadId = intParam(req.body.thread_id, 'thread_id');
    const text = cleanText(req.body.post_content, 'Reply');
    const file = fileFromUpload(req.file);
    if (!text && !file) throw bad('Write something or attach a file.');
    await requireThread(threadId);
    const replies = await db.addPost(req.visitorId, threadId, text, file, cleanShape(req.body.shape));
    for (const reply of replies) multiplayer.broadcast({ type: 'reply', reply });
    res.json(replies);
}));

const threadUpload = upload.fields([{ name: 'image', maxCount: 1 }, { name: 'scan', maxCount: 1 }]);
app.post('/api/create_thread', rateLimit, threadUpload, route(async (req, res) => {
    const title = cleanText(req.body.thread_title, 'Thread title', { required: true, max: MAX_TITLE });
    const body = cleanText(req.body.post_content, 'Body');
    const image = fileFromUpload(req.files?.image?.[0]);    // an image or a 3D model
    const scan = scanFromUpload(req.files?.scan?.[0]);      // optional: the room itself
    const thread = await db.createThread(req.visitorId, title, body, image, cleanShape(req.body.shape), scan);
    multiplayer.broadcast({ type: 'thread', thread });
    res.json(thread);
}));

app.get('/api/images/:id', route(async (req, res) => {
    const image = await db.getImage(intParam(req.params.id, 'image id'));
    if (!image) throw new HttpError(404, 'Image not found.');
    res.set({
        'Content-Type': image.mime,
        'Cache-Control': 'public, max-age=31536000, immutable',   // images never change
        'X-Content-Type-Options': 'nosniff',
    });
    res.send(image.data);
}));

// Usernames: one per IP address, set once on the entrance screen, can never be changed.
app.get('/api/me', route(async (req, res) => {
    res.json({ name: await db.getUsername(clientIp(req)) });
}));

app.post('/api/name', rateLimit, upload.none(), route(async (req, res) => {
    const name = cleanText(req.body.name, 'Name', { required: true, max: MAX_NAME })
        .replace(/[\p{C}]/gu, '')            // no control / invisible characters
        .replace(/\s+/g, ' ');
    if (!name) throw bad('Name cannot be empty.');
    const ip = clientIp(req);
    const saved = await db.claimUsername(ip, name);   // already had one: keeps the old one
    multiplayer.setName(ip, saved);
    res.json({ name: saved });
}));

// Pictures for the lobby / corridor walls: one frame ("slot") per image file in
// public/assets/. Visitors can replace what hangs in a frame (press E at it).
const ASSETS_DIR = fileURLToPath(new URL('../public/assets', import.meta.url));
async function wallSlots() {
    const files = await readdir(ASSETS_DIR).catch(() => []);
    return files
        .filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f))
        .sort((a, b) => a.localeCompare(b))
        .map((f) => 'assets/' + encodeURIComponent(f));
}

// Empty frames along the corridor are slots too: "hall-1", "hall-2"... (by position).
const HALL_SLOT = /^hall-\d{1,5}$/;

// [{ slot, url }]: every file in public/assets/ (url = the replacement if someone
// changed it, else the original file), then every corridor frame someone filled.
app.get('/api/wall-images', route(async (req, res) => {
    const [slots, replaced] = await Promise.all([wallSlots(), db.getWallPictures()]);
    const hall = Object.keys(replaced).filter((s) => HALL_SLOT.test(s)).map((slot) => ({ slot, url: replaced[slot] }));
    res.json([...slots.map((slot) => ({ slot, url: replaced[slot] || slot })), ...hall]);
}));

app.post('/api/wall-image', rateLimit, upload.single('image'), route(async (req, res) => {
    const slot = String(req.body.slot || '');
    if (!HALL_SLOT.test(slot) && !(await wallSlots()).includes(slot)) throw bad('That picture frame does not exist.');
    const image = imageFromUpload(req.file);
    if (!image) throw bad('Please choose an image.');
    const url = await db.setWallPicture(slot, image);
    multiplayer.broadcast({ type: 'wallImage', slot, url });
    res.json({ slot, url });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));

// ------------------------------------------------------------------ static site
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

// ------------------------------------------------------------------ errors -> JSON
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        err = bad(err.code === 'LIMIT_FILE_SIZE' ? `File is too large (max ${MAX_SCAN_BYTES / 1024 / 1024} MB for room scans, ${MAX_MODEL_BYTES / 1024 / 1024} MB for 3D models, ${MAX_IMAGE_BYTES / 1024 / 1024} MB for images).` : 'Upload failed.');
    }
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Server error, please try again.' : err.message });
});

// ------------------------------------------------------------------ start
const server = http.createServer(app);
const multiplayer = attachMultiplayer(server);

await db.setupSchema();          // creates tables on first run, no-op afterwards
server.listen(PORT, () => console.log(`Hotel running on http://localhost:${PORT}`));
