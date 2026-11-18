<?php
// dev-server.php - LOCAL TESTING ONLY. Don't upload this.
//
//   php -S localhost:8001 dev-server.php
//
// Same as plain `php -S`, but tells the browser not to cache anything, so
// after editing a .js file a normal reload always runs the new code.
// (Without it, browsers can mix old and new module files and break things.)

$root = __DIR__;
$path = realpath($root . urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH)));

if ($path === false || strpos($path, $root) !== 0) {
    http_response_code(404);
    exit('Not found');
}
if (pathinfo($path, PATHINFO_EXTENSION) === 'php') {
    return false;                 // let PHP run the api/*.php files normally
}
if (is_dir($path)) {
    $path .= '/index.html';
}
if (!is_file($path)) {
    http_response_code(404);
    exit('Not found');
}

$types = [
    'html' => 'text/html; charset=utf-8',
    'js'   => 'text/javascript; charset=utf-8',
    'css'  => 'text/css; charset=utf-8',
    'json' => 'application/json',
    'glb'  => 'model/gltf-binary',
    'gltf' => 'model/gltf+json',
    'png'  => 'image/png',
    'jpg'  => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'gif'  => 'image/gif',
    'svg'  => 'image/svg+xml',
];
$ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));

header('Cache-Control: no-store');
header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
readfile($path);
