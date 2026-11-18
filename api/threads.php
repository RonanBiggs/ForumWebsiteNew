<?php
// GET api/threads.php -> all threads, most recently active first (same order as the 2D forum)
require __DIR__ . '/db.php';
require_method('GET');

$rows = $pdo->query(THREAD_SQL . THREAD_GROUP . ' ORDER BY latest_date DESC, t.thread_id DESC')->fetchAll();
respond(array_map('format_thread', $rows));
