-- server/schema.sql - PostgreSQL schema (Neon). Safe to run more than once.
-- Run with:  npm run db:setup     (the server also runs it on startup)

-- Same columns as the original MySQL forum tables.
CREATE TABLE IF NOT EXISTS threads (
    thread_id    SERIAL PRIMARY KEY,
    thread_title VARCHAR(255) NOT NULL,
    thread_date  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    session_id   INTEGER      NOT NULL DEFAULT 0          -- poster number of the creator
);

CREATE TABLE IF NOT EXISTS replies (
    post_id      SERIAL PRIMARY KEY,
    post_content TEXT         NOT NULL,                   -- text, or "images/<id>" when image = 1 (image) or 2 (3D model)
    post_date    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    post_thread  INTEGER      NOT NULL REFERENCES threads (thread_id) ON DELETE CASCADE,
    image        SMALLINT     NOT NULL DEFAULT 0,      -- 0 text, 1 image, 2 3D model
    session_id   INTEGER      NOT NULL DEFAULT 0          -- poster number
);
CREATE INDEX IF NOT EXISTS idx_replies_thread ON replies (post_thread);

-- Uploaded images live IN the database: Render's free disk is wiped on every
-- restart/deploy, so files saved to disk would disappear.
CREATE TABLE IF NOT EXISTS images (
    image_id   SERIAL PRIMARY KEY,
    mime       VARCHAR(32) NOT NULL,
    data       BYTEA       NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Poster numbers: one per visitor per thread (visitor = random id in a cookie).
CREATE SEQUENCE IF NOT EXISTS poster_seq;
CREATE TABLE IF NOT EXISTS posters (
    visitor_id TEXT    NOT NULL,
    thread_id  INTEGER NOT NULL REFERENCES threads (thread_id) ON DELETE CASCADE,
    poster     INTEGER NOT NULL,
    PRIMARY KEY (visitor_id, thread_id)
);

-- Usernames: one per IP address, set once on the entrance screen and never changed.
-- Shown above that player's pill.
CREATE TABLE IF NOT EXISTS usernames (
    ip         TEXT        PRIMARY KEY,
    name       VARCHAR(24) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Wall pictures that visitors replaced (press E at a picture frame). slot = the
-- original file in public/assets/ ("assets/DomBed.jpg"); image_id = what hangs there now.
CREATE TABLE IF NOT EXISTS wall_pictures (
    slot       TEXT        PRIMARY KEY,
    image_id   INTEGER     NOT NULL REFERENCES images (image_id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What an image reply floats in the room as: 'cube', 'pyramid', 'sphere' or 'icosahedron'
-- (picked on the computer screen when posting). Older replies are cubes.
ALTER TABLE replies ADD COLUMN IF NOT EXISTS shape VARCHAR(16) NOT NULL DEFAULT 'cube';

-- An image / 3D model posted TOGETHER with a text reply floats in front of that reply's
-- board: attached_to = that reply's post_id. NULL = posted on its own: it gets its own board.
ALTER TABLE replies ADD COLUMN IF NOT EXISTS attached_to INTEGER;

-- A 3D scan (Polycam, Scaniverse...) that IS the thread's room: the file in images.
ALTER TABLE threads ADD COLUMN IF NOT EXISTS scan_id INTEGER REFERENCES images (image_id);

-- Room scans can be big (up to 300 MB), so they're stored in 1 MB pieces in their own
-- tables and streamed in and out (never held in memory whole). threads.scan_file_id
-- points here; older scans used threads.scan_id (in images) and still work.
CREATE TABLE IF NOT EXISTS scans (
    scan_id    SERIAL      PRIMARY KEY,
    mime       VARCHAR(32) NOT NULL,
    bytes      BIGINT      NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scan_chunks (
    scan_id INTEGER NOT NULL REFERENCES scans (scan_id) ON DELETE CASCADE,
    n       INTEGER NOT NULL,                 -- piece number, from 0
    data    BYTEA   NOT NULL,
    PRIMARY KEY (scan_id, n)
);
ALTER TABLE threads ADD COLUMN IF NOT EXISTS scan_file_id INTEGER REFERENCES scans (scan_id) ON DELETE SET NULL;
