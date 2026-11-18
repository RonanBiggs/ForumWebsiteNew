<?php
// api/db.php - shared setup + helpers for the hotel's JSON endpoints.
// Uses the same `threads` / `replies` tables (and the same poster-number
// session logic) as the 2D ForumWebsite, so both can share one database.

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
ini_set('display_errors', '0');

function respond($data, $status = 200)
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function fail($message, $status = 400)
{
    respond(['error' => $message], $status);
}

set_exception_handler(function ($e) {
    error_log('Hotel API: ' . $e);
    fail('Server error, please try again later.', 500);
});

if (!file_exists(__DIR__ . '/config.php')) {
    fail('Server not set up yet: copy api/config.sample.php to api/config.php.', 500);
}
require __DIR__ . '/config.php';

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

try {
    $dsn = (defined('DB_SOCKET') && DB_SOCKET)
        ? 'mysql:unix_socket=' . DB_SOCKET . ';dbname=' . DB_NAME . ';charset=utf8mb4'
        : 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
} catch (PDOException $e) {
    error_log('Hotel API DB connect: ' . $e->getMessage());
    fail('Could not connect to the database. Check api/config.php.', 500);
}

const MAX_REPLY_CHARS = 5000;
const MAX_UPLOAD_BYTES = 5000000;

// ---------------------------------------------------------------- requests
function require_method($method)
{
    if ($_SERVER['REQUEST_METHOD'] !== $method) fail("Use $method for this endpoint.", 405);
}

function int_param($source, $name)
{
    $v = isset($source[$name]) ? filter_var($source[$name], FILTER_VALIDATE_INT) : false;
    if ($v === false || $v <= 0) fail("Missing or invalid $name.");
    return $v;
}

// ---------------------------------------------------------------- threads
const THREAD_SQL = "
    SELECT t.thread_id, t.thread_title, t.thread_date, t.session_id,
           COUNT(r.post_id) AS reply_count,
           GREATEST(COALESCE(MAX(r.post_date), t.thread_date), t.thread_date) AS latest_date
    FROM threads t
    LEFT JOIN replies r ON r.post_thread = t.thread_id
";
const THREAD_GROUP = " GROUP BY t.thread_id, t.thread_title, t.thread_date, t.session_id ";

function format_thread($row)
{
    return [
        'thread_id' => (int)$row['thread_id'],
        'thread_title' => $row['thread_title'],
        'thread_date' => $row['thread_date'],
        'session_id' => (int)$row['session_id'],
        'reply_count' => (int)$row['reply_count'],
        'latest_date' => $row['latest_date'],
    ];
}

function get_thread($pdo, $threadId)
{
    $stmt = $pdo->prepare(THREAD_SQL . ' WHERE t.thread_id = ? ' . THREAD_GROUP);
    $stmt->execute([$threadId]);
    $row = $stmt->fetch();
    return $row ? format_thread($row) : null;
}

function require_thread($pdo, $threadId)
{
    $thread = get_thread($pdo, $threadId);
    if (!$thread) fail('Thread not found.', 404);
    return $thread;
}

// ---------------------------------------------------------------- replies
function format_reply($row)
{
    $isImage = (int)$row['image'] === 1;
    return [
        'post_id' => (int)$row['post_id'],
        // image replies store "uploads/<file>"; turn that into a URL the hotel page can load
        'post_content' => $isImage ? image_url($row['post_content']) : $row['post_content'],
        'post_date' => $row['post_date'],
        'post_thread' => (int)$row['post_thread'],
        'image' => $isImage ? 1 : 0,
        'session_id' => (int)$row['session_id'],
    ];
}

function image_url($stored)
{
    return strpos($stored, 'uploads/') === 0 ? UPLOADS_URL . substr($stored, strlen('uploads/')) : $stored;
}

function insert_reply($pdo, $threadId, $content, $isImage, $poster)
{
    $stmt = $pdo->prepare('INSERT INTO replies (post_content, post_date, post_thread, image, session_id)
                           VALUES (?, NOW(), ?, ?, ?)');
    $stmt->execute([$content, $threadId, $isImage ? 1 : 0, $poster]);
    $stmt = $pdo->prepare('SELECT post_id, post_content, post_date, post_thread, image, session_id FROM replies WHERE post_id = ?');
    $stmt->execute([$pdo->lastInsertId()]);
    return format_reply($stmt->fetch());
}

function clean_text($text, $label)
{
    $text = trim((string)$text);
    if (mb_strlen($text) > MAX_REPLY_CHARS) fail("$label is too long (max " . MAX_REPLY_CHARS . ' characters).');
    return $text;
}

// ---------------------------------------------------------------- poster numbers
// Same idea as the 2D forum: one number per visitor per thread, kept in the session.
function next_poster_number($pdo)
{
    $row = $pdo->query('SELECT GREATEST(
            COALESCE((SELECT MAX(session_id) FROM threads), 0),
            COALESCE((SELECT MAX(session_id) FROM replies), 0)) + 1 AS next_id')->fetch();
    return (int)$row['next_id'];
}

function poster_for_thread($pdo, $threadId)
{
    if (!isset($_SESSION['current_thread_id'], $_SESSION['session_id'])
        || (int)$_SESSION['current_thread_id'] !== (int)$threadId) {
        $_SESSION['session_id'] = next_poster_number($pdo);
        $_SESSION['current_thread_id'] = (int)$threadId;
    }
    return (int)$_SESSION['session_id'];
}

// ---------------------------------------------------------------- image uploads
// Validates $_FILES[$field] and saves it with a random name.
// Returns the stored path ("uploads/<file>"), or null if no file was sent.
function save_uploaded_image($field)
{
    $file = $_FILES[$field] ?? null;
    if (!$file || $file['error'] === UPLOAD_ERR_NO_FILE) return null;
    if (in_array($file['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $file['size'] > MAX_UPLOAD_BYTES) {
        fail('File is too large (max 5 MB).');
    }
    if ($file['error'] !== UPLOAD_ERR_OK) fail('Upload failed, please try again.');

    $allowed = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_GIF => 'gif'];
    $info = @getimagesize($file['tmp_name']);           // checks the real contents, not the name
    if ($info === false || !isset($allowed[$info[2]])) fail('Only PNG, JPG, JPEG and GIF files are allowed.');

    if (!is_dir(UPLOADS_DIR) && !mkdir(UPLOADS_DIR, 0755, true)) {
        throw new RuntimeException('Cannot create uploads folder ' . UPLOADS_DIR);
    }
    $name = bin2hex(random_bytes(12)) . '.' . $allowed[$info[2]];
    if (!move_uploaded_file($file['tmp_name'], UPLOADS_DIR . '/' . $name)) {
        throw new RuntimeException('Cannot save upload into ' . UPLOADS_DIR);
    }
    return 'uploads/' . $name;
}

function delete_upload($stored)
{
    if ($stored) @unlink(UPLOADS_DIR . '/' . basename($stored));
}
