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

const PORT = Number(process.env.PORT) || 3000;
const MAX_TEXT = 5000;
const MAX_TITLE = 255;
const MAX_NAME = 24;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;     // keep small: Neon's free database is 0.5 GB in total
const WRITES_PER_MINUTE = 10;                // per IP: posts + uploads + new threads

const app = express();
app.set('trust proxy', 1);                   // behind Render's proxy: req.ip / req.secure are the visitor's
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

// Only real PNG / JPEG / GIF files, checked by their first bytes (not the file name).
function imageFromUpload(file) {
    if (!file) return null;
    const b = file.buffer;
    let mime = null;
    if (b.length > 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') mime = 'image/png';
    else if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) mime = 'image/jpeg';
    else if (b.length > 6 && b.toString('ascii', 0, 4) === 'GIF8') mime = 'image/gif';
    if (!mime) throw bad('Only PNG, JPG, JPEG and GIF files are allowed.');
    return { mime, data: b };
}

async function requireThread(threadId) {
    if (!(await db.threadExists(threadId))) throw new HttpError(404, 'Thread not found.');
}

// Very simple spam brake: at most WRITES_PER_MINUTE writes per IP.
const writes = new Map();
function rateLimit(req, res, next) {
    const now = Date.now();
    const recent = (writes.get(req.ip) || []).filter((t) => now - t < 60000);
    if (recent.length >= WRITES_PER_MINUTE) return next(new HttpError(429, 'Slow down a bit and try again in a minute.'));
    recent.push(now);
    writes.set(req.ip, recent);
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
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5, fieldSize: 64 * 1024 },
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
    const image = imageFromUpload(req.file);
    if (!image) throw bad('Please choose an image to upload.');
    await requireThread(threadId);
    const reply = await db.addImageReply(req.visitorId, threadId, image);
    multiplayer.broadcast({ type: 'reply', reply });
    res.json(reply);
}));

app.post('/api/create_thread', rateLimit, upload.single('image'), route(async (req, res) => {
    const title = cleanText(req.body.thread_title, 'Thread title', { required: true, max: MAX_TITLE });
    const body = cleanText(req.body.post_content, 'Body');
    const image = imageFromUpload(req.file);
    const thread = await db.createThread(req.visitorId, title, body, image);
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
    res.json({ name: await db.getUsername(req.ip) });
}));

app.post('/api/name', rateLimit, upload.none(), route(async (req, res) => {
    const name = cleanText(req.body.name, 'Name', { required: true, max: MAX_NAME })
        .replace(/[\p{C}]/gu, '')            // no control / invisible characters
        .replace(/\s+/g, ' ');
    if (!name) throw bad('Name cannot be empty.');
    const saved = await db.claimUsername(req.ip, name);   // already had one: keeps the old one
    multiplayer.setName(req.ip, saved);
    res.json({ name: saved });
}));

// Pictures for the lobby / corridor walls: every image file in public/assets/.
const ASSETS_DIR = fileURLToPath(new URL('../public/assets', import.meta.url));
app.get('/api/wall-images', route(async (req, res) => {
    const files = await readdir(ASSETS_DIR).catch(() => []);
    res.json(files
        .filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f))
        .sort((a, b) => a.localeCompare(b))
        .map((f) => 'assets/' + encodeURIComponent(f)));
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));

// ------------------------------------------------------------------ static site
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

// ------------------------------------------------------------------ errors -> JSON
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        err = bad(err.code === 'LIMIT_FILE_SIZE' ? `File is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).` : 'Upload failed.');
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
