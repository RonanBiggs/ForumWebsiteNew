<?php
// POST api/upload.php  (thread_id, image file) -> the new image reply
require __DIR__ . '/db.php';
require_method('POST');

$threadId = int_param($_POST, 'thread_id');
require_thread($pdo, $threadId);
$stored = save_uploaded_image('image');
if (!$stored) fail('Please choose an image to upload.');

try {
    respond(insert_reply($pdo, $threadId, $stored, true, poster_for_thread($pdo, $threadId)));
} catch (Throwable $e) {
    delete_upload($stored);
    throw $e;
}
