// server/prune.js - keeps the database under its size limit by deleting the OLDEST data.
//
// When the database reaches PRUNE_AT_MB, the oldest uploads (images, 3D models, room
// scans, replaced wall pictures) are deleted one by one, strictly oldest first, whatever
// their size, until the live data is down to PRUNE_TO_MB. Deleting an upload also removes
// what shows it: its image/model reply, a wall frame's replacement (the frame goes back
// to its original picture) or a room scan (the room goes back to a normal room).
// If there are no uploads left and it's still too big, the oldest threads go.
//
// Why two numbers: Postgres doesn't shrink its files after a DELETE, it reuses the freed
// space for new data. So the database's reported size triggers the clean-up, but how
// much gets deleted is measured on the live data. The gap stops it deleting again on
// every upload.
//
// Runs at startup, every hour, and shortly after uploads (at most once a minute).

import { pool } from './db.js';

const MB = 1024 * 1024;
export const PRUNE_AT_MB = Number(process.env.PRUNE_AT_MB) || 950;     // start deleting at this database size
export const PRUNE_TO_MB = Number(process.env.PRUNE_TO_MB) || 850;     // ...until the live data is this small
const BATCH = 25;

// The database's size as Postgres reports it (what counts against the plan's limit).
async function databaseBytes(db) {
    const { rows } = await db.query('SELECT pg_database_size(current_database())::bigint AS n');
    return Number(rows[0].n);
}

// What's actually stored right now: uploaded files plus all the other (small) tables.
async function liveBytes(db) {
    const { rows } = await db.query(`
        SELECT COALESCE((SELECT SUM(octet_length(data)) FROM images), 0)::bigint
             + pg_total_relation_size('threads') + pg_total_relation_size('replies')
             + pg_total_relation_size('posters') + pg_total_relation_size('usernames')
             + pg_total_relation_size('wall_pictures') AS n`);
    return Number(rows[0].n);
}

// Deletes one upload and everything that shows it, in one transaction.
async function deleteUpload(db, imageId) {
    const path = 'images/' + imageId;
    await db.query('BEGIN');
    try {
        await db.query('DELETE FROM replies WHERE image >= 1 AND post_content = $1', [path]);
        await db.query('DELETE FROM wall_pictures WHERE image_id = $1', [imageId]);
        await db.query('UPDATE threads SET scan_id = NULL WHERE scan_id = $1', [imageId]);
        await db.query('DELETE FROM images WHERE image_id = $1', [imageId]);
        await db.query('COMMIT');
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        throw err;
    }
}

let running = false;
export async function pruneIfNeeded() {
    if (running) return;
    running = true;
    const db = await pool.connect();
    try {
        const size = await databaseBytes(db);
        if (size < PRUNE_AT_MB * MB) return;
        let live = await liveBytes(db);
        const target = PRUNE_TO_MB * MB;
        if (live <= target) return;              // already cleaned up: the reported size just doesn't shrink
        console.log(`[prune] database is ${(size / MB).toFixed(0)} MB (limit ${PRUNE_AT_MB} MB), live data ${(live / MB).toFixed(0)} MB: deleting the oldest data down to ${PRUNE_TO_MB} MB`);
        let files = 0, threads = 0;

        // 1. oldest uploads first, by upload time only
        while (live > target) {
            const { rows } = await db.query(
                'SELECT image_id, octet_length(data)::bigint AS bytes FROM images ORDER BY created_at, image_id LIMIT $1', [BATCH]);
            if (!rows.length) break;
            for (const r of rows) {
                await deleteUpload(db, r.image_id);
                live -= Number(r.bytes);
                files++;
                if (live <= target) break;
            }
        }
        // 2. nothing uploaded left but still too big: oldest threads (their replies go with them)
        while (live > target) {
            const { rows } = await db.query('SELECT thread_id FROM threads ORDER BY thread_date, thread_id LIMIT 1');
            if (!rows.length) break;
            await db.query('DELETE FROM threads WHERE thread_id = $1', [rows[0].thread_id]);
            threads++;
            live = await liveBytes(db);
        }
        // let Postgres reuse the freed space straight away (plain VACUUM: no locks, no extra space)
        await db.query('VACUUM images').catch((err) => console.warn('[prune] vacuum failed:', err.message));
        console.log(`[prune] deleted ${files} oldest upload(s) and ${threads} oldest thread(s); live data now ~${(live / MB).toFixed(1)} MB`);
    } catch (err) {
        console.error('[prune] failed:', err.message);
    } finally {
        db.release();
        running = false;
    }
}

// After an upload: check soon, but at most once a minute.
let timer = null, lastRun = 0;
export function schedulePrune() {
    if (timer) return;
    const wait = Math.max(5000, 60000 - (Date.now() - lastRun));
    timer = setTimeout(() => {
        timer = null;
        lastRun = Date.now();
        pruneIfNeeded();
    }, wait);
    timer.unref();
}

export function startPruning() {
    lastRun = Date.now();
    pruneIfNeeded();
    setInterval(pruneIfNeeded, 60 * 60 * 1000).unref();
}
