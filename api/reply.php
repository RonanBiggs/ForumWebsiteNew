<?php
// POST api/reply.php  (thread_id, post_content) -> the new reply
require __DIR__ . '/db.php';
require_method('POST');

$threadId = int_param($_POST, 'thread_id');
require_thread($pdo, $threadId);
$text = clean_text($_POST['post_content'] ?? '', 'Reply');
if ($text === '') fail('Reply cannot be empty.');

respond(insert_reply($pdo, $threadId, $text, false, poster_for_thread($pdo, $threadId)));
