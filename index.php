<?php
// Session 安全配置
ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_secure', 1);
ini_set('session.use_strict_mode', 1);
ini_set('session.cookie_samesite', 'Strict');
session_start();

error_reporting(E_ALL & ~E_NOTICE & ~E_WARNING & ~E_DEPRECATED);
ini_set('display_errors', 0);

// 设置默认时区为中国时区
date_default_timezone_set('Asia/Shanghai');

require_once 'AliyunTrafficCheck.php';

header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("X-Content-Type-Options: nosniff");
header("X-Frame-Options: DENY");
header("Referrer-Policy: strict-origin-when-cross-origin");

$app = new AliyunTrafficCheck();
$action = $_GET['action'] ?? 'view';

// 初始化 CSRF Token（若不存在）
if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

// ---------------- 公开接口 ----------------

if ($action === 'check_init') {
    header('Content-Type: application/json');
    $initError = $app->getInitError();
    if ($initError) {
        echo json_encode(['initialized' => false, 'error' => $initError]);
    } else {
        echo json_encode(['initialized' => $app->isInitialized()]);
    }
    exit;
}

if ($action === 'setup') {
    header('Content-Type: application/json');
    if ($app->isInitialized()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'System already initialized']);
        exit;
    }

    $data = json_decode(file_get_contents('php://input'), true);
    try {
        if ($app->setup($data)) {
            session_regenerate_id(true);
            $_SESSION['is_admin'] = true;
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
            echo json_encode(['success' => true]);
        } else {
            echo json_encode(['success' => false, 'message' => 'Setup failed']);
        }
    } catch (Exception $e) {
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }
    exit;
}

if ($action === 'login') {
    $data = json_decode(file_get_contents('php://input'), true);
    try {
        if ($app->login($data['password'] ?? '')) {
            session_regenerate_id(true);
            $_SESSION['is_admin'] = true;
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
            echo json_encode(['success' => true]);
        } else {
            echo json_encode(['success' => false, 'message' => '密码错误']);
        }
    } catch (Exception $e) {
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }
    exit;
}

if ($action === 'check_login') {
    echo json_encode(['logged_in' => isset($_SESSION['is_admin']) && $_SESSION['is_admin'] === true]);
    exit;
}

if ($action === 'get_csrf_token') {
    header('Content-Type: application/json');
    if (!isset($_SESSION['is_admin'])) {
        http_response_code(403);
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
    echo json_encode(['csrf_token' => $_SESSION['csrf_token']]);
    exit;
}

if ($action === 'get_status') {
    header('Content-Type: application/json; charset=utf-8');
    $initError = $app->getInitError();
    if ($initError) {
        echo json_encode(['error' => $initError]);
    } else {
        echo json_encode($app->getStatusForFrontend());
    }
    exit;
}

// ---------------- 需鉴权接口 ----------------

if ($action !== 'view' && !isset($_SESSION['is_admin'])) {
    http_response_code(403);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

// 获取客户端真实 IP
$clientIp = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
if (isset($_SERVER['HTTP_X_FORWARDED_FOR'])) {
    $ips = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
    $clientIp = trim($ips[0]);
}

// 速率限制：管理接口
if ($action !== 'view' && $action !== 'logout' && $action !== 'check_login' && $action !== 'check_init') {
    $rateLimits = [
        'control_instance' => ['window' => 60, 'max' => 10],
        'save_config'      => ['window' => 60, 'max' => 10],
        'login'            => ['window' => 900, 'max' => 5],
        'setup'            => ['window' => 3600, 'max' => 10],
        'default'          => ['window' => 60, 'max' => 60],
    ];
    $limitConfig = $rateLimits[$action] ?? $rateLimits['default'];
    $app->getDatabase()->recordApiRequest($clientIp, $action);
    $recentCount = $app->getDatabase()->getRecentApiRequests($clientIp, $action, $limitConfig['window']);
    if ($recentCount > $limitConfig['max']) {
        http_response_code(429);
        echo json_encode(['error' => '请求过于频繁，请稍后再试']);
        exit;
    }
}

// CSRF 校验：所有需要鉴权的 POST/JSON 操作（logout 除外）
if ($action !== 'view' && $action !== 'logout' && $action !== 'get_csrf_token' && $action !== 'get_status') {
    $inputToken = '';
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true);
        if (isset($data['csrf_token'])) {
            $inputToken = $data['csrf_token'];
        } elseif (isset($_POST['csrf_token'])) {
            $inputToken = $_POST['csrf_token'];
        }
    }
    if (empty($inputToken) || !hash_equals($_SESSION['csrf_token'], $inputToken)) {
        http_response_code(403);
        echo json_encode(['error' => 'Invalid CSRF token']);
        exit;
    }
}

// 新增：处理手工控制实例开关机请求
if ($action === 'control_instance') {
    $data = json_decode(file_get_contents('php://input'), true);
    $id = $data['id'] ?? 0;
    $actionType = $data['action'] ?? ''; // 期望值: Start 或 Stop

    if (!$id || !$actionType) {
        echo json_encode(['success' => false, 'message' => '参数缺失']);
        exit;
    }

    try {
        $result = $app->controlInstance($id, $actionType);

        if ($result === true) {
            echo json_encode(['success' => true, 'message' => '指令发送成功']);
        } else {
            echo json_encode(['success' => false, 'message' => $result]);
        }
    } catch (Exception $e) {
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }
    exit;
}

if ($action === 'get_config') {
    echo json_encode($app->getConfigForFrontend());
    exit;
}

if ($action === 'save_config') {
    $data = json_decode(file_get_contents('php://input'), true);
    if ($app->updateConfig($data)) {
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'message' => '保存失败']);
    }
    exit;
}

if ($action === 'send_test_email') {
    $data = json_decode(file_get_contents('php://input'), true);
    $result = $app->sendTestEmail($data['email'] ?? '');
    echo json_encode(['success' => $result === true, 'message' => $result]);
    exit;
}

if ($action === 'send_test_telegram') {
    $data = json_decode(file_get_contents('php://input'), true);
    $result = $app->sendTestTelegram($data['telegram'] ?? []);
    echo json_encode(['success' => $result === true, 'message' => $result]);
    exit;
}

if ($action === 'send_test_webhook') {
    $data = json_decode(file_get_contents('php://input'), true);
    $result = $app->sendTestWebhook($data['webhook'] ?? []);
    echo json_encode(['success' => $result === true, 'message' => $result]);
    exit;
}

if ($action === 'refresh_account') {
    $data = json_decode(file_get_contents('php://input'), true);
    $id = $data['id'] ?? 0;
    $result = $app->refreshAccount($id);
    if ($result === false) {
        echo json_encode(['success' => false, 'message' => 'Refresh failed']);
    } elseif (is_array($result)) {
        // 流量/状态刷新成功，但账单获取失败
        echo json_encode($result);
    } else {
        echo json_encode(['success' => true]);
    }
    exit;
}

// 修改：获取系统日志，支持 Tab
if ($action === 'get_logs') {
    header('Content-Type: application/json; charset=utf-8');
    $tab = $_GET['tab'] ?? 'action'; // 默认是动作日志
    echo json_encode(['data' => $app->getSystemLogs($tab)]);
    exit;
}

// 新增：清空日志
if ($action === 'clear_logs') {
    $data = json_decode(file_get_contents('php://input'), true);
    $tab = $data['tab'] ?? 'action';
    if ($app->clearSystemLogs($tab)) {
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'message' => 'Clear failed']);
    }
    exit;
}

if ($action === 'get_history') {
    header('Content-Type: application/json; charset=utf-8');
    $id = $_GET['id'] ?? 0;
    echo json_encode(['data' => $app->getAccountHistory($id)]);
    exit;
}

if ($action === 'logout') {
    session_destroy();
    echo json_encode(['success' => true]);
    exit;
}

echo $app->renderTemplate();

