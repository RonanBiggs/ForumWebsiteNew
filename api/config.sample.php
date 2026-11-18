<?php
// api/config.sample.php
// Copy this file to api/config.php and fill it in.
// config.php is git-ignored so your password never ends up on GitHub.

// ---- Database: values from InfinityFree control panel -> "MySQL Databases" ----
define('DB_HOST', 'sqlXXX.infinityfree.com');   // "MySQL Hostname" (NOT localhost)
define('DB_USER', 'if0_XXXXXXXX');              // "MySQL Username"
define('DB_PASS', 'your_account_password');     // your hosting account password
define('DB_NAME', 'if0_XXXXXXXX_forum');        // full database name, with the if0_ prefix

// Local development only: connect through a socket file instead of DB_HOST.
// define('DB_SOCKET', '/path/to/mysqld.sock');

// ---- Uploaded images ----
// UPLOADS_DIR = folder on the server where images are saved.
// UPLOADS_URL = how the browser reaches that folder, relative to the hotel's index.html.
// The database always stores "uploads/<file>", the same as the 2D forum.

// Hotel on its own (its own uploads/ folder next to index.html):
define('UPLOADS_DIR', __DIR__ . '/../uploads');
define('UPLOADS_URL', 'uploads/');

// Sharing images with the 2D forum, when the forum is in htdocs/ and the hotel in htdocs/hotel/:
// define('UPLOADS_DIR', __DIR__ . '/../../uploads');
// define('UPLOADS_URL', '../uploads/');
