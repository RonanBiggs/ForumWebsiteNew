// server/prune.js - keeps the database under its size limit by deleting old data.
//
// When the database reaches PRUNE_AT_MB, data is deleted until the live data is down
// to PRUNE_TO_MB, in this order:
//   1. BIG room scans (over BIG_SCAN_MB), oldest first;
//   2. then every upload (images, 3D models, room scans, replaced wall pictures),
//      strictly oldest first, whatever its size;
//   3. only if no uploads are left: the oldest threads.
// Deleting an upload also removes what shows it: its image/model reply, a wall frame's
// replacement (the frame goes back to its original picture) or a room scan (the room
// goes back to a normal room). Text replies stay.
//
// Before a big upload (a room scan can be 300 MB) is stored, makeRoomFor() deletes
// enough the same way for it to fit under PRUNE_AT_MB, or says no.
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
export const BIG_SCAN_MB = Number(process.env.BIG_SCAN_MB) || 25;     // scans bigger than this are deleted first
const BATCH = 25;

// The database's size as Postgres reports it (what counts against the plan's limit).
async function databaseBytes(db) {
    const { rows } = await db.query('SELECT pg_database_size(current_database())::bigint AS n');
    return Number(rows[0].n);
}

// What's actually stored right now: uploaded files and scans plus the other (small) tables.
async function liveBytes(db) {
    const { rows } = await db.query(`
        SELECT COALESCE((SELECT SUM(octet_length(data)) FROM images), 0)::bigint
             + COALESCE((SELECT SUM(bytes) FROM scans), 0)::bigint
             + pg_total_relation_size('threads') + pg_total_relation_size('replies')
             + pg_total_relation_size('posters') + pg_total_relation_size('usernames')
             + pg_total_relation_size('wall_pictures') + pg_total_relation_size('scans') AS n`);
    return Number(rows[0].n);
}

// Deletes one upload (kind 'image': images table, 'scan': scans table) and everything that shows it.
async function deleteUpload(db, kind, id) {
    await db.query('BEGIN');
    try {
        if (kind === 'scan') {
            await db.query('DELETE FROM scans WHERE scan_id = $1', [id]);     // pieces go with it; the room's scan_file_id becomes NULL
        } else {
            await db.query('DELETE FROM replies WHERE image >= 1 AND post_content = $1', ['images/' + id]);
            await db.query('DELETE FROM wall_pictures WHERE image_id = $1', [id]);
            await db.query('UPDATE threads SET scan_id = NULL WHERE scan_id = $1', [id]);
            await db.query('DELETE FROM images WHERE image_id = $1', [id]);
        }
        await db.query('COMMIT');
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        throw err;
    }
}

// Deletes until the live data is at most `target` bytes. Returns the new live size.
async function deleteDownTo(db, target, why) {
    let live = await liveBytes(db);
    if (live <= target) return live;
    console.log(`[prune] ${why}: live data ${(live / MB).toFixed(1)} MB, deleting down to ${(target / MB).toFixed(1)} MB`);
    let big = 0, files = 0, threads = 0;

    // 1. big room scans, oldest first
    while (live > target) {
        const { rows } = await db.query(
            'SELECT scan_id, bytes FROM scans WHERE bytes > $1 ORDER BY created_at, scan_id LIMIT 1', [BIG_SCAN_MB * MB]);
        if (!rows.length) break;
        await deleteUpload(db, 'scan', rows[0].scan_id);
        live -= Number(rows[0].bytes);
        big++;
    }
    // 2. every upload, oldest first, whatever its size
    while (live > target) {
        const { rows } = await db.query(`
            SELECT 'image' AS kind, image_id AS id, octet_length(data)::bigint AS bytes, created_at FROM images
            UNION ALL
            SELECT 'scan', scan_id, bytes, created_at FROM scans
            ORDER BY created_at, id LIMIT $1`, [BATCH]);
        if (!rows.length) break;
        for (const r of rows) {
            await deleteUpload(db, r.kind, r.id);
            live -= Number(r.bytes);
            files++;
            if (live <= target) break;
        }
    }
    // 3. nothing uploaded left but still too big: oldest threads (their replies go with them)
    while (live > target) {
        const { rows } = await db.query('SELECT thread_id FROM threads ORDER BY thread_date, thread_id LIMIT 1');
        if (!rows.length) break;
        await db.query('DELETE FROM threads WHERE thread_id = $1', [rows[0].thread_id]);
        threads++;
        live = await liveBytes(db);
    }
    // let Postgres reuse the freed space straight away (plain VACUUM: no locks, no extra space)
    for (const table of ['images', 'scan_chunks']) {
        await db.query(`VACUUM ${table}`).catch((err) => console.warn(`[prune] vacuum ${table} failed:`, err.message));
    }
    console.log(`[prune] deleted ${big} big scan(s), ${files} oldest upload(s), ${threads} oldest thread(s); live data now ~${(live / MB).toFixed(1)} MB`);
    return live;
}

// One clean-up at a time (the regular check and makeRoomFor can't overlap).
let queue = Promise.resolve();
function exclusive(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
}

export function pruneIfNeeded() {
    return exclusive(async () => {
        const db = await pool.connect();
        try {
            if (await databaseBytes(db) < PRUNE_AT_MB * MB) return;
            await deleteDownTo(db, PRUNE_TO_MB * MB, `database reached ${PRUNE_AT_MB} MB`);
        } catch (err) {
            console.error('[prune] failed:', err.message);
        } finally {
            db.release();
        }
    });
}

// Before storing `bytes` more: make sure live data + bytes stays under PRUNE_AT_MB,
// deleting old data if needed. Returns false if it can't fit.
export function makeRoomFor(bytes) {
    return exclusive(async () => {
        const limit = PRUNE_AT_MB * MB;
        if (bytes > limit) return false;
        const db = await pool.connect();
        try {
            let live = await liveBytes(db);
            if (live + bytes <= limit) return true;
            live = await deleteDownTo(db, Math.min(PRUNE_TO_MB * MB, limit - bytes), `making room for a ${(bytes / MB).toFixed(0)} MB upload`);
            return live + bytes <= limit;
        } finally {
            db.release();
        }
    });
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
