<?php
declare(strict_types=1);

$baseDirectory = realpath(__DIR__);
$requestedPath = isset($_GET['path']) ? (string) $_GET['path'] : '';
$requestedPath = str_replace("\0", '', $requestedPath);
$candidate = $baseDirectory && $requestedPath !== ''
    ? realpath($baseDirectory . DIRECTORY_SEPARATOR . $requestedPath)
    : false;

$allowedMimeTypes = [
    'pdf' => 'application/pdf',
    'm4a' => 'audio/mp4',
    'mp4' => 'video/mp4',
    'png' => 'image/png',
    'txt' => 'text/plain; charset=utf-8',
    'md' => 'text/markdown; charset=utf-8',
    'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

$isInsideLibrary = $candidate !== false
    && $baseDirectory !== false
    && str_starts_with($candidate, $baseDirectory . DIRECTORY_SEPARATOR);
$extension = $candidate ? strtolower(pathinfo($candidate, PATHINFO_EXTENSION)) : '';

if (!$isInsideLibrary || !is_file($candidate) || !isset($allowedMimeTypes[$extension])) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Recurso no encontrado.';
    exit;
}

$filename = basename($candidate);
header('Content-Type: ' . $allowedMimeTypes[$extension]);
header("Content-Disposition: attachment; filename*=UTF-8''" . rawurlencode($filename));
header('Content-Length: ' . (string) filesize($candidate));
header('Cache-Control: public, max-age=86400');
header('X-Content-Type-Options: nosniff');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') {
    exit;
}
readfile($candidate);
