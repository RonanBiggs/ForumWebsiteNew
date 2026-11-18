<?php
// GET api/replies.php?thread_id=N -> that thread's replies, oldest first
require __DIR__ . '/db.php';
require_method('GET');

$threadId = int_param($_GET, 'thread_id');
$stmt = $pdo->prepare('SELECT post_id, post_content, post_date, post_thread, image, session_id
                       FROM replies WHERE post_thread = ? ORDER BY post_id ASC');
$stmt->execute([$threadId]);
respond(array_map('format_reply', $stmt->fetchAll()));
