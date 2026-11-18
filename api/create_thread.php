<?php
// POST api/create_thread.php  (thread_title, optional post_content, optional image file)
// -> the new thread. The body and image become the thread's first replies,
//    posted with the creator's poster number (the threads table only has a title).
require __DIR__ . '/db.php';
require_method('POST');

$title = trim((string)($_POST['thread_title'] ?? ''));
if ($title === '') fail('Please enter a thread title.');
if (mb_strlen($title) > 255) fail('Thread title is too long (max 255 characters).');
$body = clean_text($_POST['post_content'] ?? '', 'Body');
$stored = save_uploaded_image('image');      // validated before anything is written

try {
    $pdo->beginTransaction();
    $poster = next_poster_number($pdo);
    $stmt = $pdo->prepare('INSERT INTO threads (thread_title, thread_date, session_id) VALUES (?, NOW(), ?)');
    $stmt->execute([$title, $poster]);
    $threadId = (int)$pdo->lastInsertId();
    if ($body !== '') insert_reply($pdo, $threadId, $body, false, $poster);
    if ($stored) insert_reply($pdo, $threadId, $stored, true, $poster);
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    delete_upload($stored);
    throw $e;
}

// the creator keeps their poster number in this thread (same as the 2D forum)
$_SESSION['current_thread_id'] = $threadId;
$_SESSION['session_id'] = $poster;

respond(get_thread($pdo, $threadId));
