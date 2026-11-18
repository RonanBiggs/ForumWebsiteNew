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
    post_content TEXT         NOT NULL,                   -- text, or "images/<id>" when image = 1
    post_date    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    post_thread  INTEGER      NOT NULL REFERENCES threads (thread_id) ON DELETE CASCADE,
    image        SMALLINT     NOT NULL DEFAULT 0,
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
