<?php

class ConfigManager
{
    private $db;
    private $configCache = [];
    private $accountsCache = [];

    public function __construct(Database $db)
    {
        $this->db = $db->getPdo();
        $this->load();
    }

    public function load()
    {
        $stmt = $this->db->query("SELECT key, value FROM settings");
        while ($row = $stmt->fetch()) {
            $this->configCache[$row['key']] = $row['value'];
        }

        $stmt = $this->db->query("SELECT * FROM accounts ORDER BY id ASC");
        $this->accountsCache = $stmt->fetchAll();
    }

    public function get($key, $default = null)
    {
        return $this->configCache[$key] ?? $default;
    }

    public function getAllSettings()
    {
        return $this->configCache;
    }

    public function getAccounts()
    {
        return $this->accountsCache;
    }

    public function getAccountById($id)
    {
        foreach ($this->accountsCache as $acc) {
            if ($acc['id'] == $id)
                return $acc;
        }
        return null;
    }

    public function isInitialized()
    {
        return !empty($this->configCache['admin_password']);
    }

    /**
     * 验证管理员密码（支持明文迁移到哈希）
     */
    public function verifyAdminPassword($password)
    {
        $stored = $this->configCache['admin_password'] ?? '';
        if (empty($stored)) return false;

        // 若存储的是明文（旧版本兼容）
        if (!password_get_info($stored)['algo']) {
            // 明文匹配时自动升级为哈希
            if (hash_equals($stored, (string)$password)) {
                $this->saveSetting('admin_password', password_hash($password, PASSWORD_DEFAULT));
                return true;
            }
            return false;
        }

        return password_verify((string)$password, $stored);
    }

    /**
     * 获取 Cron Key（用于 monitor.php 鉴权）
     */
    public function getCronKey()
    {
        return $this->configCache['cron_key'] ?? '';
    }

    private function saveSetting($key, $value)
    {
        $stmt = $this->db->prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
        $stmt->execute([$key, $value]);
        $this->configCache[$key] = $value;
    }

    // --- 新增：心跳时间管理 ---

    public function updateLastRunTime($time)
    {
        $this->saveSetting('last_monitor_run', $time);
    }

    public function getLastRunTime()
    {
        return (int) ($this->configCache['last_monitor_run'] ?? 0);
    }

    // ------------------------

    public function updateConfig($data)
    {
        try {
            $this->db->beginTransaction();

            // 1. 保存全局设置
            // 密码若为新明文则进行哈希，若已是哈希则保留，若为空则保留原值
            $rawPass = $data['admin_password'] ?? '';
            if (!empty($rawPass) && !password_get_info($rawPass)['algo']) {
                $this->saveSetting('admin_password', password_hash($rawPass, PASSWORD_DEFAULT));
            } elseif (!empty($rawPass)) {
                $this->saveSetting('admin_password', $rawPass);
            }
            // 如果密码为空字符串，保留原值（不执行 saveSetting）

            // 生成独立的 Cron Key（若不存在）
            if (!$this->isInitialized() || empty($this->get('cron_key'))) {
                $this->saveSetting('cron_key', bin2hex(random_bytes(16)));
            }
            $this->saveSetting('traffic_threshold', $data['traffic_threshold']);
            $this->saveSetting('enable_schedule_email', $data['enable_schedule_email'] ? '1' : '0');
            $this->saveSetting('shutdown_mode', $data['shutdown_mode']);
            $this->saveSetting('threshold_action', $data['threshold_action']);
            $this->saveSetting('keep_alive', isset($data['keep_alive']) && $data['keep_alive'] ? '1' : '0');
            $this->saveSetting('api_interval', $data['api_interval'] ?? 600);
            $this->saveSetting('enable_billing', isset($data['enable_billing']) && $data['enable_billing'] ? '1' : '0');

            if (isset($data['Notification'])) {
                // Email
                $this->saveSetting('notify_email_enabled', isset($data['Notification']['email_enabled']) && $data['Notification']['email_enabled'] ? '1' : '0');
                $this->saveSetting('notify_email', $data['Notification']['email'] ?? '');
                $this->saveSetting('notify_host', $data['Notification']['host'] ?? '');
                $this->saveSetting('notify_port', $data['Notification']['port'] ?? 465);
                $this->saveSetting('notify_username', $data['Notification']['username'] ?? '');
                // 通知密码：仅当传入非空值时才更新
                $notifyPassword = $data['Notification']['password'] ?? '';
                if (!empty($notifyPassword)) {
                    $this->saveSetting('notify_password', $notifyPassword);
                }
                $this->saveSetting('notify_secure', $data['Notification']['secure'] ?? 'ssl');

                // Telegram
                if (isset($data['Notification']['telegram'])) {
                    $tg = $data['Notification']['telegram'];
                    $this->saveSetting('notify_tg_enabled', isset($tg['enabled']) && $tg['enabled'] ? '1' : '0');
                    // Token：仅当传入非空值时才更新
                    $tgToken = $tg['token'] ?? '';
                    if (!empty($tgToken)) {
                        $this->saveSetting('notify_tg_token', $tgToken);
                    }
                    $this->saveSetting('notify_tg_chat_id', $tg['chat_id'] ?? '');
                    $this->saveSetting('notify_tg_proxy_type', $tg['proxy_type'] ?? 'none');
                    $this->saveSetting('notify_tg_proxy_url', $tg['proxy_url'] ?? '');
                    $this->saveSetting('notify_tg_proxy_ip', $tg['proxy_ip'] ?? '');
                    $this->saveSetting('notify_tg_proxy_port', $tg['proxy_port'] ?? '');
                    $this->saveSetting('notify_tg_proxy_user', $tg['proxy_user'] ?? '');
                    // 代理密码：仅当传入非空值时才更新
                    $tgProxyPass = $tg['proxy_pass'] ?? '';
                    if (!empty($tgProxyPass)) {
                        $this->saveSetting('notify_tg_proxy_pass', $tgProxyPass);
                    }
                }

                // Webhook
                if (isset($data['Notification']['webhook'])) {
                    $wh = $data['Notification']['webhook'];
                    $this->saveSetting('notify_wh_enabled', isset($wh['enabled']) && $wh['enabled'] ? '1' : '0');
                    $this->saveSetting('notify_wh_url', $wh['url'] ?? '');
                    $this->saveSetting('notify_wh_method', $wh['method'] ?? 'GET');
                    $this->saveSetting('notify_wh_request_type', $wh['request_type'] ?? 'JSON');
                    $this->saveSetting('notify_wh_headers', $wh['headers'] ?? '');
                    $this->saveSetting('notify_wh_body', $wh['body'] ?? '');
                }
            }

            // 2. 账号增量同步
            $newAccounts = $data['Accounts'] ?? [];
            $stmt = $this->db->query("SELECT id, access_key_id, region_id, instance_id FROM accounts");
            $existingMap = [];
            while ($row = $stmt->fetch()) {
                // Use composite key for deduplication: AK + Region + InstanceID
                $compositeKey = $row['access_key_id'] . '|' . $row['region_id'] . '|' . ($row['instance_id'] ?? '');
                $existingMap[$compositeKey] = $row['id'];
            }

            $keptIds = [];
            $insertStmt = $this->db->prepare("INSERT INTO accounts (access_key_id, access_key_secret, region_id, instance_id, max_traffic, schedule_enabled, start_time, stop_time, remark, site_type, traffic_used, instance_status, updated_at, last_keep_alive_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'Unknown', 0, 0)");
            $updateStmt = $this->db->prepare("UPDATE accounts SET access_key_secret = ?, region_id = ?, instance_id = ?, max_traffic = ?, schedule_enabled = ?, start_time = ?, stop_time = ?, remark = ?, site_type = ? WHERE id = ?");

            foreach ($newAccounts as $acc) {
                $key = $acc['AccessKeyId'];
                $region = $acc['regionId'];
                $instance = $acc['instanceId'] ?? '';
                $compositeKey = $key . '|' . $region . '|' . $instance;

                // 准备更新参数
                $accessKeySecret = $acc['AccessKeySecret'] ?? '';
                
                // 如果是更新已有账号且传入的密钥为空，保留原值
                if (isset($existingMap[$compositeKey]) && empty($accessKeySecret)) {
                    $account = $this->getAccountById($existingMap[$compositeKey]);
                    if ($account && !empty($account['access_key_secret'])) {
                        $accessKeySecret = $account['access_key_secret'];
                    }
                }

                $params = [
                    $accessKeySecret,
                    $region,
                    $instance,
                    $acc['maxTraffic'],
                    ($acc['schedule']['enabled'] ?? false) ? 1 : 0,
                    $acc['schedule']['startTime'] ?? '',
                    $acc['schedule']['stopTime'] ?? '',
                    $acc['remark'] ?? '',
                    $acc['siteType'] ?? 'china'
                ];

                if (isset($existingMap[$compositeKey])) {
                    $id = $existingMap[$compositeKey];
                    $params[] = $id;
                    $updateStmt->execute($params);
                    $keptIds[] = $id;
                } else {
                    $insertParams = [$key];
                    array_push($insertParams, ...$params);
                    $insertStmt->execute($insertParams);
                }
            }

            // 3. 删除移除的账号
            $idsToDelete = array_diff(array_values($existingMap), $keptIds);
            if (!empty($idsToDelete)) {
                $placeholders = implode(',', array_fill(0, count($idsToDelete), '?'));
                $deleteStmt = $this->db->prepare("DELETE FROM accounts WHERE id IN ($placeholders)");
                $deleteStmt->execute(array_values($idsToDelete));
            }

            $this->db->commit();

            // 4. 重排 ID
            $this->reorderIds();

            // 5. 刷新缓存
            $this->load();
            return true;
        } catch (Exception $e) {
            if ($this->db->inTransaction())
                $this->db->rollBack();
            return false;
        }
    }

    private function reorderIds()
    {
        try {
            $this->db->beginTransaction();
            $stmt = $this->db->query("SELECT * FROM accounts ORDER BY id ASC");
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            if (!empty($rows)) {
                $this->db->exec("DELETE FROM accounts");
                $this->db->exec("DELETE FROM sqlite_sequence WHERE name='accounts'");

                $insertStmt = $this->db->prepare("INSERT INTO accounts (id, access_key_id, access_key_secret, region_id, instance_id, max_traffic, schedule_enabled, start_time, stop_time, remark, site_type, traffic_used, instance_status, updated_at, last_keep_alive_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

                $newId = 1;
                foreach ($rows as $row) {
                    $insertStmt->execute([
                        $newId++,
                        $row['access_key_id'],
                        $row['access_key_secret'],
                        $row['region_id'],
                        $row['instance_id'],
                        $row['max_traffic'],
                        $row['schedule_enabled'],
                        $row['start_time'],
                        $row['stop_time'],
                        $row['remark'] ?? '',
                        $row['site_type'] ?? 'china',
                        $row['traffic_used'],
                        $row['instance_status'],
                        $row['updated_at'],
                        $row['last_keep_alive_at']
                    ]);
                }
            }
            $this->db->commit();
        } catch (Exception $e) {
            if ($this->db->inTransaction())
                $this->db->rollBack();
        }
    }

    public function updateAccountStatus($id, $traffic, $status, $updatedAt)
    {
        $stmt = $this->db->prepare("UPDATE accounts SET traffic_used = ?, instance_status = ?, updated_at = ? WHERE id = ?");
        return $stmt->execute([$traffic, $status, $updatedAt, $id]);
    }

    public function updateLastKeepAlive($id, $time)
    {
        $stmt = $this->db->prepare("UPDATE accounts SET last_keep_alive_at = ? WHERE id = ?");
        return $stmt->execute([$time, $id]);
    }
}