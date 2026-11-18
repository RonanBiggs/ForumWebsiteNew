// server/db.js - Postgres (Neon) connection + every query the forum needs.
// Rows come back in the same shape the 3D client already uses:
//   Thread: { thread_id, thread_title, thread_date, session_id, reply_count, latest_date }
//   Reply:  { post_id, post_content, post_date, post_thread, image, session_id }

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
           COUNT(r.post_id)::int AS reply_count,
           ${fmt('GREATEST(COALESCE(MAX(r.post_date), t.thread_date), t.thread_date)')} AS latest_date
    FROM threads t
    LEFT JOIN replies r ON r.post_thread = t.thread_id`;
const THREAD_GROUP = ' GROUP BY t.thread_id';

const REPLY_COLS = `post_id, post_content, ${fmt('post_date')} AS post_date, post_thread, image::int AS image, session_id, shape`;

// Image replies store "images/<id>"; the browser loads them from /api/images/<id>.
function formatReply(row) {
    if (row.image === 1 && row.post_content.startsWith('images/')) {
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

async function insertReply(db, threadId, content, isImage, poster, shape = 'cube') {
    const { rows } = await db.query(
        `INSERT INTO replies (post_content, post_thread, image, session_id, shape) VALUES ($1, $2, $3, $4, $5)
         RETURNING ${REPLY_COLS}`,
        [content, threadId, isImage ? 1 : 0, poster, shape]);
    return formatReply(rows[0]);
}

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
    return transaction(async (db) => insertReply(db, threadId, text, false, await posterFor(db, visitorId, threadId)));
}

export function addImageReply(visitorId, threadId, image, shape) {
    return transaction(async (db) => {
        const poster = await posterFor(db, visitorId, threadId);
        return insertReply(db, threadId, await insertImage(db, image), true, poster, shape);
    });
}

// New thread; the optional body and image become its first replies, by the creator.
export function createThread(visitorId, title, body, image, shape) {
    return transaction(async (db) => {
        const { rows } = await db.query(
            `INSERT INTO threads (thread_title, session_id) VALUES ($1, nextval('poster_seq')) RETURNING thread_id, session_id`,
            [title]);
        const { thread_id: threadId, session_id: poster } = rows[0];
        await db.query('INSERT INTO posters (visitor_id, thread_id, poster) VALUES ($1, $2, $3)', [visitorId, threadId, poster]);
        if (body) await insertReply(db, threadId, body, false, poster);
        if (image) await insertReply(db, threadId, await insertImage(db, image), true, poster, shape);
        return getThread(threadId, db);
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
// { 'assets/DomBed.jpg': 'api/images/12', ... }
export async function getWallPictures() {
    const { rows } = await pool.query('SELECT slot, image_id FROM wall_pictures');
    return Object.fromEntries(rows.map((r) => [r.slot, 'api/images/' + r.image_id]));
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
