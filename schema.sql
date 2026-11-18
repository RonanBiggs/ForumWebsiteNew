-- schema.sql
-- Import this in phpMyAdmin (InfinityFree control panel -> MySQL Databases -> phpMyAdmin)
-- after selecting your database on the left.

CREATE TABLE IF NOT EXISTS threads (
    thread_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
    thread_title VARCHAR(255) NOT NULL,
    thread_date  DATETIME     NOT NULL,
    session_id   INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (thread_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS replies (
    post_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    post_content TEXT         NOT NULL,          -- reply text, or image path when image = 1
    post_date    DATETIME     NOT NULL,
    post_thread  INT UNSIGNED NOT NULL,
    image        TINYINT(1)   NOT NULL DEFAULT 0,
    session_id   INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (post_id),
    KEY idx_post_thread (post_thread),
    CONSTRAINT fk_replies_thread FOREIGN KEY (post_thread)
        REFERENCES threads (thread_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
