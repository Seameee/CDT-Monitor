<?php
// 此文件用于 Cron 任务
// 输出简洁的文本日志

require_once 'AliyunTrafficCheck.php';

header('Content-Type: text/plain; charset=utf-8');

$app = new AliyunTrafficCheck();

// CLI 模式直接运行，Web 模式需要 Cron Key
$isCli = (PHP_SAPI === 'cli');

if (!$isCli) {
    $inputKey = $_GET['key'] ?? '';
    $cronKey = $app->getCronKey();
    if (empty($cronKey) || !hash_equals($cronKey, $inputKey)) {
        http_response_code(403);
        echo "Access Denied.";
        exit;
    }
}

// 输出简洁日志
echo "--- CDT Monitor Start: " . date('Y-m-d H:i:s') . " ---\n";
echo $app->monitor();
echo "\n--- End ---\n";
