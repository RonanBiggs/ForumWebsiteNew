// server/db.js - Postgres (Neon) connection + every query the forum needs.
// Rows come back in the same shape the 3D client already uses:
//   Thread: { thread_id, thread_title, thread_date, session_id, reply_count, latest_date, scan }
//           (scan = URL of the room's 3D scan, or null)
//   Reply:  { post_id, post_content, post_date, post_thread, image, session_id, shape }
//           image: 0 = text, 1 = image, 2 = 3D model (post_content is then the file's URL)

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Local runs read .env; on Render the variables come from the dashboard.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (put it in .env locally, or in the Render dashboard).');
    process.exit(1);
}

// Keep pg's current (strict, certificate-checking) SSL behaviour explicitly;
// Neon's connection strings say sslmode=require.
const connectionString = process.env.DATABASE_URL.replace(/sslmode=(prefer|require|verify-ca)\b/, 'sslmode=verify-full');

// Optional: keep everything in a separate schema (used for testing).
const SCHEMA = process.env.DB_SCHEMA ? process.env.DB_SCHEMA.replace(/[^a-z0-9_]/gi, '') : null;

export const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30000,
    ...(SCHEMA ? { options: `-c search_path=${SCHEMA}` } : {}),
});
pool.on('error', (err) => console.error('Postgres pool error:', err.message));

export async function setupSchema() {
    const sql = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
    if (SCHEMA) await pool.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    await pool.query(sql);
}

// Dates as 'YYYY-MM-DD HH:MM:SS' (UTC) strings, like MySQL gave us - the client sorts on them.
const fmt = (col) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;

const THREAD_SQL = `
    SELECT t.thread_id, t.thread_title, ${fmt('t.thread_date')} AS thread_date, t.session_id,
           CASE WHEN t.scan_file_id IS NOT NULL THEN 'api/scans/' || t.scan_file_id
                WHEN t.scan_id IS NOT NULL THEN 'api/images/' || t.scan_id END AS scan,
           COUNT(r.post_id)::int AS reply_count,
           ${fmt('GREATEST(COALESCE(MAX(r.post_date), t.thread_date), t.thread_date)')} AS latest_date
    FROM threads t
    LEFT JOIN replies r ON r.post_thread = t.thread_id`;
const THREAD_GROUP = ' GROUP BY t.thread_id';

const REPLY_COLS = `post_id, post_content, ${fmt('post_date')} AS post_date, post_thread, image::int AS image, session_id, shape, attached_to`;

// Image replies store "images/<id>"; the browser loads them from /api/images/<id>.
function formatReply(row) {
    if (row.image >= 1 && row.post_content.startsWith('images/')) {      // images and 3D models
        row.post_content = 'api/' + row.post_content;
    }
    return row;
}

export async function listThreads() {
    const { rows } = await pool.query(THREAD_SQL + THREAD_GROUP + ' ORDER BY latest_date DESC, t.thread_id DESC');
    return rows;
}

export async function getThread(threadId, db = pool) {
    const { rows } = await db.query(THREAD_SQL + ' WHERE t.thread_id = $1' + THREAD_GROUP, [threadId]);
    return rows[0] || null;
}

export async function getReplies(threadId) {
    const { rows } = await pool.query(`SELECT ${REPLY_COLS} FROM replies WHERE post_thread = $1 ORDER BY post_id`, [threadId]);
    return rows.map(formatReply);
}

// One poster number per visitor per thread (like the 2D forum's session logic).
async function posterFor(db, visitorId, threadId) {
    const found = await db.query('SELECT poster FROM posters WHERE visitor_id = $1 AND thread_id = $2', [visitorId, threadId]);
    if (found.rows.length) return found.rows[0].poster;
    const { rows } = await db.query(
        `INSERT INTO posters (visitor_id, thread_id, poster) VALUES ($1, $2, nextval('poster_seq'))
         ON CONFLICT (visitor_id, thread_id) DO UPDATE SET poster = posters.poster
         RETURNING poster`,
        [visitorId, threadId]);
    return rows[0].poster;
}

// kind: 0 text, 1 image, 2 3D model
// attachedTo: post_id of the text reply an image/model was posted together with (or null)
async function insertReply(db, threadId, content, kind, poster, shape = 'cube', attachedTo = null) {
    const { rows } = await db.query(
        `INSERT INTO replies (post_content, post_thread, image, session_id, shape, attached_to) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${REPLY_COLS}`,
        [content, threadId, kind, poster, shape, attachedTo]);
    return formatReply(rows[0]);
}

// Uploaded files (images and 3D models) both live in the images table.
const fileKind = (file) => (file.kind === 'model' ? 2 : 1);

async function insertImage(db, image) {
    const { rows } = await db.query('INSERT INTO images (mime, data) VALUES ($1, $2) RETURNING image_id', [image.mime, image.data]);
    return 'images/' + rows[0].image_id;
}

// Runs fn(client) inside a transaction.
async function transaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

export function addTextReply(visitorId, threadId, text) {
    return transaction(async (db) => insertReply(db, threadId, text, 0, await posterFor(db, visitorId, threadId)));
}

export function addImageReply(visitorId, threadId, image, shape) {
    return transaction(async (db) => {
        const poster = await posterFor(db, visitorId, threadId);
        return insertReply(db, threadId, await insertImage(db, image), fileKind(image), poster, shape);
    });
}

// A post from a room's computer: text and/or one image / 3D model, posted together
// (the file then floats in front of the text's board). Returns the new replies.
export function addPost(visitorId, threadId, text, file, shape) {
    return transaction(async (db) => {
        const poster = await posterFor(db, visitorId, threadId);
        const out = [];
        if (text) out.push(await insertReply(db, threadId, text, 0, poster));
        if (file) out.push(await insertReply(db, threadId, await insertImage(db, file), fileKind(file), poster, shape, out[0]?.post_id ?? null));
        return out;
    });
}

// New thread; the optional body and image become its first replies, by the creator.
// scan: optional room scan ({ path, mime, bytes }: a file on disk), streamed into scan_chunks.
export function createThread(visitorId, title, body, image, shape, scan = null) {
    return transaction(async (db) => {
        const scanId = scan ? await insertScan(db, scan) : null;
        const { rows } = await db.query(
            `INSERT INTO threads (thread_title, session_id, scan_file_id) VALUES ($1, nextval('poster_seq'), $2) RETURNING thread_id, session_id`,
            [title, scanId]);
        const { thread_id: threadId, session_id: poster } = rows[0];
        await db.query('INSERT INTO posters (visitor_id, thread_id, poster) VALUES ($1, $2, $3)', [visitorId, threadId, poster]);
        const text = body ? await insertReply(db, threadId, body, 0, poster) : null;
        if (image) await insertReply(db, threadId, await insertImage(db, image), fileKind(image), poster, shape, text?.post_id ?? null);
        return getThread(threadId, db);
    });
}

// ------------------------------------------------------------------ room scans (streamed, in pieces)
const SCAN_CHUNK = 1024 * 1024;

// Copies a scan file from disk into the database 1 MB at a time. Returns its scan_id.
async function insertScan(db, { path, mime, bytes }) {
    const { rows } = await db.query('INSERT INTO scans (mime, bytes) VALUES ($1, $2) RETURNING scan_id', [mime, bytes]);
    const scanId = rows[0].scan_id;
    const file = await fs.promises.open(path);
    try {
        const buf = Buffer.alloc(SCAN_CHUNK);
        for (let n = 0; ; n++) {
            const { bytesRead } = await file.read(buf, 0, SCAN_CHUNK, n * SCAN_CHUNK);
            if (!bytesRead) break;
            await db.query('INSERT INTO scan_chunks (scan_id, n, data) VALUES ($1, $2, $3)', [scanId, n, buf.subarray(0, bytesRead)]);
        }
    } finally {
        await file.close();
    }
    return scanId;
}

export async function getScanInfo(scanId) {
    const { rows } = await pool.query('SELECT mime, bytes FROM scans WHERE scan_id = $1', [scanId]);
    return rows[0] || null;
}

// Writes a scan to `out` (an HTTP response) a few pieces at a time, fetching the next
// pieces while the current ones are being sent. Stops if the visitor goes away.
const PIECES_PER_QUERY = 4;
export async function streamScan(scanId, out) {
    let gone = false;
    out.on('close', () => { gone = true; });
    const fetchFrom = (n) => pool.query(
        'SELECT data FROM scan_chunks WHERE scan_id = $1 AND n >= $2 AND n < $3 ORDER BY n',
        [scanId, n, n + PIECES_PER_QUERY]);
    try {
        let next = fetchFrom(0);
        for (let n = 0; !gone; n += PIECES_PER_QUERY) {
            const { rows } = await next;
            if (!rows.length) break;
            next = fetchFrom(n + PIECES_PER_QUERY);            // start the next fetch now
            for (const row of rows) {
                if (gone) break;
                if (!out.write(row.data)) await waitForDrain(out);
            }
            if (rows.length < PIECES_PER_QUERY) break;         // that was the last piece
        }
        next?.catch(() => {});
        out.end();
    } catch (err) {
        console.error('Scan download failed:', err.message);
        out.destroy();                    // already sending: just cut it off
    }
}

function waitForDrain(out) {
    return new Promise((resolve) => {
        const done = () => { out.off('drain', done); out.off('close', done); resolve(); };
        out.on('drain', done);
        out.on('close', done);
    });
}

export async function getImage(imageId) {
    const { rows } = await pool.query('SELECT mime, data FROM images WHERE image_id = $1', [imageId]);
    return rows[0] || null;
}

export async function threadExists(threadId) {
    const { rows } = await pool.query('SELECT 1 FROM threads WHERE thread_id = $1', [threadId]);
    return rows.length > 0;
}

// ------------------------------------------------------------------ usernames (one per IP, permanent)
export async function getUsername(ip) {
    const { rows } = await pool.query('SELECT name FROM usernames WHERE ip = $1', [ip]);
    return rows[0]?.name ?? null;
}

// Saves the name unless this IP already has one. Returns the IP's name either way.
export async function claimUsername(ip, name) {
    const { rows } = await pool.query(
        `INSERT INTO usernames (ip, name) VALUES ($1, $2)
         ON CONFLICT (ip) DO UPDATE SET ip = usernames.ip
         RETURNING name`, [ip, name]);
    return rows[0].name;
}

// ------------------------------------------------------------------ replaced wall pictures
// { 'assets/DomBed.jpg': { url: 'api/images/12', model: false }, ... }  (model: an .obj hangs there)
export async function getWallPictures() {
    const { rows } = await pool.query(
        'SELECT w.slot, w.image_id, i.mime FROM wall_pictures w JOIN images i ON i.image_id = w.image_id');
    return Object.fromEntries(rows.map((r) => [r.slot, { url: 'api/images/' + r.image_id, model: r.mime === 'model/obj' }]));
}

// The lever: every slot gets a random image or .obj from everything uploaded
// (no repeats until the pool runs out). Returns [{ slot, url, model }], or null if nothing's uploaded.
export function shuffleWallPictures(slots) {
    return transaction(async (db) => {
        const { rows: pool_ } = await db.query(
            "SELECT image_id, mime FROM images WHERE mime LIKE 'image/%' OR mime = 'model/obj'");
        if (!pool_.length) return null;
        let bag = [];
        const picks = slots.map(() => {
            if (!bag.length) bag = [...pool_].sort(() => Math.random() - 0.5);
            return bag.pop();
        });
        await db.query(                          // all frames in one go
            `INSERT INTO wall_pictures (slot, image_id) SELECT * FROM unnest($1::text[], $2::int[])
             ON CONFLICT (slot) DO UPDATE SET image_id = EXCLUDED.image_id, changed_at = now()`,
            [slots, picks.map((p) => p.image_id)]);
        return slots.map((slot, i) => ({ slot, url: 'api/images/' + picks[i].image_id, model: picks[i].mime === 'model/obj' }));
    });
}

// Hangs a new image in a picture frame. Returns its URL.
export function setWallPicture(slot, image) {
    return transaction(async (db) => {
        const path = await insertImage(db, image);           // "images/<id>"
        const imageId = Number(path.split('/')[1]);
        await db.query(
            `INSERT INTO wall_pictures (slot, image_id) VALUES ($1, $2)
             ON CONFLICT (slot) DO UPDATE SET image_id = EXCLUDED.image_id, changed_at = now()`,
            [slot, imageId]);
        return 'api/' + path;
    });
}
