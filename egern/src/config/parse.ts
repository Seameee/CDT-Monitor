/**
 * Build a validated `AppConfig` from Egern environment variables.
 *
 * Two account models:
 *  - **simple** — a handful of `CDT_*` variables, for one account/instance. This
 *    is the default path and the one the install guide leads with.
 *  - **advanced** — `CDT_ACCOUNTS_JSON`, which carries the full layered model and
 *    is mutually exclusive with the simple credential fields. When it is
 *    present the simple credential fields are *ignored*, not merged, so the same
 *    account cannot be counted twice under two ids.
 *
 * Failure policy from the contract: a broken **control** configuration disables
 * control for the affected entity but must not stop read-only monitoring of
 * other accounts. Only genuinely global problems (missing credentials, unknown
 * mode, unusable advanced JSON) abort the whole configuration.
 */

import type {
  AccountConfig,
  AppConfig,
  ControlConfig,
  Credential,
  InstanceConfig,
  NotificationConfig,
  ProviderMode,
  QuotaConfig,
  QuotaUnit,
  ShutdownMode,
  SiteType,
  TrafficClass,
  TrafficScopeConfig,
  ViewSelection,
} from "../domain/models.ts";
import { trafficClassOfRegion } from "../domain/usage.ts";
import { unverifiedDevice } from "../domain/models.ts";
import { normalizeClockTime } from "../domain/schedule.ts";
import { utf8Bytes } from "../host/crypto.ts";
import { normalizeServerBaseUrl } from "../providers/cdt-server.ts";
import type { ConfigIssue, IssueCollector } from "./env.ts";
import {
  IssueCollector as Collector,
  readBoolean,
  readEnum,
  readJson,
  readList,
  readNonNegativeInteger,
  readNumber,
  readString,
} from "./env.ts";
import { parseAdvancedModel, parseThresholdAction, validateTimeZone } from "./validate.ts";

/** Outcome of parsing configuration. */
export type ParseOutcome =
  | { ok: true; config: AppConfig; issues: ConfigIssue[] }
  | { ok: false; issues: ConfigIssue[] };

/** Environment variable names recognised by this plugin. */
export const ENV_KEYS = {
  mode: "CDT_MODE",
  namespace: "CDT_NAMESPACE",
  accountId: "CDT_ACCOUNT_ID",
  accessKeyId: "CDT_ACCESS_KEY_ID",
  accessKeySecret: "CDT_ACCESS_KEY_SECRET",
  securityToken: "CDT_SECURITY_TOKEN",
  siteType: "CDT_SITE_TYPE",
  regionId: "CDT_REGION_ID",
  instanceId: "CDT_INSTANCE_ID",
  name: "CDT_NAME",
  quota: "CDT_QUOTA",
  quotaUnit: "CDT_QUOTA_UNIT",
  trafficClass: "CDT_TRAFFIC_CLASS",
  thresholdPercent: "CDT_THRESHOLD_PERCENT",
  refreshSeconds: "CDT_REFRESH_SECONDS",
  automationIntervalSeconds: "CDT_AUTOMATION_INTERVAL_SECONDS",
  billingEnabled: "CDT_BILLING_ENABLED",
  localNotify: "CDT_LOCAL_NOTIFY",
  timezone: "CDT_TIMEZONE",
  debug: "CDT_DEBUG",
  baseUrl: "CDT_BASE_URL",
  readToken: "CDT_READ_TOKEN",
  allowInsecureHttp: "CDT_ALLOW_INSECURE_HTTP",
  accountsJson: "CDT_ACCOUNTS_JSON",
  notificationJson: "CDT_NOTIFICATION_JSON",
  controlJson: "CDT_CONTROL_JSON",
  telegramToken: "CDT_TELEGRAM_BOT_TOKEN",
  scopeId: "CDT_SCOPE_ID",
  instanceIds: "CDT_INSTANCE_IDS",
  theme: "CDT_THEME",
} as const;

/** Default refresh interval in seconds (a cache TTL, not a cron schedule). */
export const DEFAULT_REFRESH_SECONDS = 900;

/**
 * Default minimum spacing between two automation *checks*, in seconds.
 *
 * The module's cron only says how often iOS may wake the script; it cannot stop
 * the script from doing full cloud reads on every wake-up, and iOS may wake it
 * more often than the cron suggests. This throttle is enforced inside the script
 * *before* any network call, so raising it genuinely reduces battery and API use
 * without needing a forked module. 300 keeps the original behaviour.
 */
export const DEFAULT_AUTOMATION_INTERVAL_SECONDS = 300;

function emptyControlConfig(): ControlConfig {
  return {
    schemaVersion: 1,
    // Everything below defaults to "off". Deleting the config is equivalent to
    // disabling it; there is no conflicting implicit switch.
    enabled: false,
    // Attests nothing. There is deliberately no env variable, module default or
    // code path that pre-fills this.
    deviceVerification: unverifiedDevice(),
    credentialId: null,
    allowedInstanceIds: [],
    scopes: [],
    instances: [],
    actionCooldownSeconds: 600,
    pauseUntil: null,
  };
}

function emptyNotificationConfig(localNotify: boolean): NotificationConfig {
  return {
    schemaVersion: 1,
    local: localNotify,
    telegram: { enabled: false, botToken: "", chatId: "" },
    webhook: { enabled: false, url: "", method: "POST", bodyTemplate: "" },
    dailyReport: { enabled: false, time: "22:00", compensationWindowMinutes: 20 },
  };
}

/** Read the widget-level view selection from env. */
function readViewSelection(env: Record<string, string | undefined>): ViewSelection {
  return {
    scopeId: readString(env, ENV_KEYS.scopeId),
    instanceIds: readList(env, ENV_KEYS.instanceIds),
    theme: readString(env, ENV_KEYS.theme),
  };
}

/** Stable 32-bit FNV-1a hash of a string's UTF-8 bytes, as 8 hex digits. */
export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (const byte of utf8Bytes(input)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Fingerprint the identity-affecting parts of a configuration.
 *
 * Cache entries are keyed on this so that changing a credential, region,
 * instance id or traffic scope cannot silently reuse values observed under the
 * previous identity. Purely cosmetic changes (display name, theme) are excluded
 * so that renaming something does not discard accumulated history.
 */
export function computeConfigFingerprint(config: AppConfig): string {
  const identity = {
    mode: config.mode,
    namespace: config.namespace,
    credentials: config.credentials
      .map((credential) => ({
        id: credential.id,
        accountId: credential.accountId,
        // The AK id participates (a rotated key must invalidate caches) but the
        // secret never does: it must not reach cache keys.
        accessKeyId: credential.accessKeyId,
        siteType: credential.siteType,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    accounts: config.accounts.map((account) => account.id).sort(),
    scopes: config.trafficScopes
      .map((scope) => ({
        id: scope.id,
        accountId: scope.accountId,
        credentialId: scope.credentialId,
        trafficClass: scope.trafficClass,
        quota: scope.quota,
        threshold: scope.thresholdPercent,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    instances: config.instances
      .map((instance) => ({
        id: instance.id,
        accountId: instance.accountId,
        trafficScopeId: instance.trafficScopeId,
        regionId: instance.regionId,
        instanceId: instance.instanceId,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    server: config.server === null ? null : config.server.baseUrl,
  };
  return fnv1aHex(JSON.stringify(identity));
}

/** Parse the control document, leaving control disabled on any doubt. */
function parseControlConfig(
  value: unknown,
  knownCredentialIds: readonly string[],
  knownInstanceIds: readonly string[],
  knownScopeIds: readonly string[],
  issues: IssueCollector,
): ControlConfig {
  const config = emptyControlConfig();
  if (value === undefined) return config;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    issues.error("CDT_CONTROL_JSON", "CDT_CONTROL_JSON 必须是 JSON 对象，控制保持关闭");
    return config;
  }
  const record = value as Record<string, unknown>;

  if (record["schemaVersion"] !== 1) {
    issues.error("CDT_CONTROL_JSON.schemaVersion", "不支持的 control schemaVersion，控制保持关闭");
    return config;
  }

  // Unknown keys are refused rather than ignored: a misspelled safety switch
  // must not silently leave control in a state the user did not intend.
  const knownKeys = [
    "schemaVersion", "enabled", "deviceVerification", "credentialId",
    "allowedInstanceIds", "scopes", "instances", "actionCooldownSeconds", "pauseUntil",
    // Shorthands for the common single-instance / single-scope case.
    "verifiedOnDevice", "keepAlive", "stopWhenOverThreshold",
  ];
  for (const key of Object.keys(record)) {
    if (!knownKeys.includes(key)) {
      issues.error("CDT_CONTROL_JSON", `CDT_CONTROL_JSON 含有未知字段 ${key}，控制保持关闭`);
      return config;
    }
  }

  if (record["enabled"] !== undefined && typeof record["enabled"] !== "boolean") {
    issues.error("CDT_CONTROL_JSON.enabled", "enabled 必须是布尔值，控制保持关闭");
    return config;
  }
  config.enabled = record["enabled"] === true;

  // Shorthand attestation: a single date meaning "I verified BOTH preconditions
  // on this device". The detailed deviceVerification object below remains for
  // anyone who wants to record them separately. Requiring two booleans plus a
  // date for a one-instance setup was needless friction that pushed people
  // towards copying a snippet they had not actually verified.
  const verifiedOnDevice = record["verifiedOnDevice"];
  if (verifiedOnDevice !== undefined) {
    if (
      typeof verifiedOnDevice !== "string" ||
      !Number.isFinite(Date.parse(verifiedOnDevice))
    ) {
      issues.error(
        "CDT_CONTROL_JSON.verifiedOnDevice",
        "verifiedOnDevice 必须是合法的 ISO 8601 日期，控制保持关闭",
      );
      config.enabled = false;
      return config;
    }
    if (record["deviceVerification"] !== undefined) {
      issues.error(
        "CDT_CONTROL_JSON",
        "verifiedOnDevice 与 deviceVerification 不能同时使用，控制保持关闭",
      );
      config.enabled = false;
      return config;
    }
    config.deviceVerification = {
      crossExecutionIntentClaim: true,
      hostSerializesSameTarget: true,
      verifiedAt: verifiedOnDevice,
      note: "verifiedOnDevice",
    };
  }

  // Device attestation. Parsed strictly and before anything else, because it is
  // what decides whether a cloud write is permitted at all.
  const attestation = record["deviceVerification"];
  if (attestation !== undefined) {
    if (attestation === null || typeof attestation !== "object" || Array.isArray(attestation)) {
      issues.error(
        "CDT_CONTROL_JSON.deviceVerification",
        "deviceVerification 必须是对象，控制保持关闭",
      );
      config.enabled = false;
      return config;
    }
    const item = attestation as Record<string, unknown>;
    const allowed = ["crossExecutionIntentClaim", "hostSerializesSameTarget", "verifiedAt", "note"];
    for (const key of Object.keys(item)) {
      if (!allowed.includes(key)) {
        issues.error(
          "CDT_CONTROL_JSON.deviceVerification",
          `deviceVerification 含未知字段 ${key}，控制保持关闭`,
        );
        config.enabled = false;
        return config;
      }
    }
    for (const key of ["crossExecutionIntentClaim", "hostSerializesSameTarget"]) {
      if (item[key] !== undefined && typeof item[key] !== "boolean") {
        issues.error(
          "CDT_CONTROL_JSON.deviceVerification",
          `${key} 必须是布尔值，控制保持关闭`,
        );
        config.enabled = false;
        return config;
      }
    }
    const crossExecution = item["crossExecutionIntentClaim"] === true;
    const serialises = item["hostSerializesSameTarget"] === true;

    let verifiedAt: string | null = null;
    if (item["verifiedAt"] !== undefined && item["verifiedAt"] !== null) {
      if (
        typeof item["verifiedAt"] !== "string" ||
        !Number.isFinite(Date.parse(item["verifiedAt"]))
      ) {
        issues.error(
          "CDT_CONTROL_JSON.deviceVerification.verifiedAt",
          "verifiedAt 必须是合法的 ISO 8601 日期或时间，控制保持关闭",
        );
        config.enabled = false;
        return config;
      }
      verifiedAt = item["verifiedAt"];
    }

    // An attestation without a date is not an audit trail, so it is refused
    // rather than silently accepted.
    if ((crossExecution || serialises) && verifiedAt === null) {
      issues.error(
        "CDT_CONTROL_JSON.deviceVerification.verifiedAt",
        "声明已通过真机验证时必须同时填写 verifiedAt，控制保持关闭",
      );
      config.enabled = false;
      return config;
    }

    config.deviceVerification = {
      crossExecutionIntentClaim: crossExecution,
      hostSerializesSameTarget: serialises,
      verifiedAt,
      note: typeof item["note"] === "string" ? item["note"] : null,
    };
  }

  const credentialId = record["credentialId"];
  if (credentialId !== undefined && credentialId !== null) {
    if (typeof credentialId !== "string" || !knownCredentialIds.includes(credentialId)) {
      issues.error("CDT_CONTROL_JSON.credentialId", "控制凭据不存在，控制保持关闭");
      config.enabled = false;
      return config;
    }
    config.credentialId = credentialId;
  } else if (knownCredentialIds.length === 1) {
    // Nothing to choose between, and the identifier is not visible in the UI, so
    // requiring the user to type it would just be a guessing game.
    config.credentialId = knownCredentialIds[0] as string;
  }

  const cooldown = record["actionCooldownSeconds"];
  if (cooldown !== undefined) {
    if (typeof cooldown !== "number" || !Number.isFinite(cooldown) || cooldown < 0) {
      issues.error("CDT_CONTROL_JSON.actionCooldownSeconds", "actionCooldownSeconds 必须是非负数");
      config.enabled = false;
      return config;
    }
    config.actionCooldownSeconds = cooldown;
  }

  const pauseUntil = record["pauseUntil"];
  if (pauseUntil !== undefined && pauseUntil !== null) {
    if (typeof pauseUntil !== "string" || !Number.isFinite(Date.parse(pauseUntil))) {
      issues.error("CDT_CONTROL_JSON.pauseUntil", "pauseUntil 必须是合法的 ISO 8601 时间");
      config.enabled = false;
      return config;
    }
    config.pauseUntil = pauseUntil;
  }

  const rawScopes = record["scopes"];
  if (rawScopes !== undefined) {
    if (!Array.isArray(rawScopes)) {
      issues.error("CDT_CONTROL_JSON.scopes", "scopes 必须是数组");
      config.enabled = false;
      return config;
    }
    for (const entry of rawScopes as unknown[]) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        issues.error("CDT_CONTROL_JSON.scopes", "scopes 中存在非对象条目");
        config.enabled = false;
        return config;
      }
      const item = entry as Record<string, unknown>;
      const scopeId = item["scopeId"];
      if (typeof scopeId !== "string" || scopeId === "") {
        issues.error("CDT_CONTROL_JSON.scopes", "scope 缺少 scopeId");
        config.enabled = false;
        return config;
      }
      if (item["thresholdStopEnabled"] !== undefined && typeof item["thresholdStopEnabled"] !== "boolean") {
        issues.error(
          "CDT_CONTROL_JSON.scopes",
          `scope ${scopeId} 的 thresholdStopEnabled 必须是布尔值`,
          scopeId,
        );
        config.enabled = false;
        return config;
      }
      config.scopes.push({
        scopeId,
        // notify_only is the safe default: turning control on must never
        // implicitly turn stopping on.
        thresholdAction: parseThresholdAction(
          item["thresholdAction"],
          "notify_only",
          `scope ${scopeId}`,
          issues,
        ),
        thresholdStopEnabled: item["thresholdStopEnabled"] === true,
      });
    }
  }

  const rawInstances = record["instances"];
  if (rawInstances !== undefined) {
    if (!Array.isArray(rawInstances)) {
      issues.error("CDT_CONTROL_JSON.instances", "instances 必须是数组");
      config.enabled = false;
      return config;
    }
    for (const entry of rawInstances as unknown[]) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        issues.error("CDT_CONTROL_JSON.instances", "instances 中存在非对象条目");
        config.enabled = false;
        return config;
      }
      const item = entry as Record<string, unknown>;
      const instanceId = item["instanceId"];
      if (typeof instanceId !== "string" || !knownInstanceIds.includes(instanceId)) {
        issues.error("CDT_CONTROL_JSON.instances", "控制 instances 引用了未知实例");
        config.enabled = false;
        return config;
      }
      const shutdownMode = item["shutdownMode"];
      if (
        shutdownMode !== undefined &&
        shutdownMode !== "KeepCharging" &&
        shutdownMode !== "StopCharging"
      ) {
        issues.error(
          "CDT_CONTROL_JSON.instances",
          `实例 ${instanceId} 的 shutdownMode 非法`,
          instanceId,
        );
        config.enabled = false;
        return config;
      }
      config.instances.push({
        instanceId,
        scheduleControlEnabled: item["scheduleControlEnabled"] === true,
        keepAlive: item["keepAlive"] === true,
        shutdownMode: (shutdownMode === "StopCharging"
          ? "StopCharging"
          : "KeepCharging") as ShutdownMode,
      });
    }
  }

  // ---- allow-list resolution -------------------------------------------
  // Resolved *after* `instances`, because declaring a per-instance policy is
  // itself an act of allow-listing and repeating the ids served no purpose.
  const allowed = record["allowedInstanceIds"];
  if (allowed !== undefined) {
    if (!Array.isArray(allowed)) {
      issues.error("CDT_CONTROL_JSON.allowedInstanceIds", "allowedInstanceIds 必须是数组");
      config.enabled = false;
      return config;
    }
    for (const entry of allowed as unknown[]) {
      if (typeof entry !== "string" || !knownInstanceIds.includes(entry)) {
        issues.error(
          "CDT_CONTROL_JSON.allowedInstanceIds",
          `控制白名单包含未知实例 ${String(entry)}，控制保持关闭`,
        );
        config.enabled = false;
        return config;
      }
      config.allowedInstanceIds.push(entry);
    }
  } else {
    for (const policy of config.instances) {
      config.allowedInstanceIds.push(policy.instanceId);
    }
  }

  // ---- keepAlive shorthand for the single-instance case ----------------
  const keepAlive = record["keepAlive"];
  if (keepAlive !== undefined) {
    if (typeof keepAlive !== "boolean") {
      issues.error("CDT_CONTROL_JSON.keepAlive", "keepAlive 必须是布尔值，控制保持关闭");
      config.enabled = false;
      return config;
    }
    if (record["instances"] !== undefined || record["allowedInstanceIds"] !== undefined) {
      issues.error(
        "CDT_CONTROL_JSON.keepAlive",
        "keepAlive 简写不能与 instances / allowedInstanceIds 同时使用，控制保持关闭",
      );
      config.enabled = false;
      return config;
    }
    if (knownInstanceIds.length === 0) {
      issues.error(
        "CDT_CONTROL_JSON.keepAlive",
        "没有可保活的实例：请先填写 CDT_INSTANCE_ID，控制保持关闭",
      );
      config.enabled = false;
      return config;
    }
    if (knownInstanceIds.length > 1) {
      issues.error(
        "CDT_CONTROL_JSON.keepAlive",
        `配置了 ${knownInstanceIds.length} 个实例，keepAlive 简写无法确定目标；请显式列出 allowedInstanceIds 与 instances`,
      );
      config.enabled = false;
      return config;
    }
    const only = knownInstanceIds[0] as string;
    config.allowedInstanceIds = [only];
    config.instances = [
      {
        instanceId: only,
        scheduleControlEnabled: false,
        keepAlive: keepAlive === true,
        shutdownMode: "KeepCharging",
      },
    ];
  }

  // ---- stopWhenOverThreshold shorthand for the single-scope case --------
  const stopShorthand = record["stopWhenOverThreshold"];
  if (stopShorthand !== undefined) {
    if (typeof stopShorthand !== "boolean") {
      issues.error("CDT_CONTROL_JSON.stopWhenOverThreshold", "stopWhenOverThreshold 必须是布尔值，控制保持关闭");
      config.enabled = false;
      return config;
    }
    if (record["scopes"] !== undefined) {
      issues.error(
        "CDT_CONTROL_JSON.stopWhenOverThreshold",
        "stopWhenOverThreshold 简写不能与 scopes 同时使用，控制保持关闭",
      );
      config.enabled = false;
      return config;
    }
    if (knownScopeIds.length === 0) {
      issues.error(
        "CDT_CONTROL_JSON.stopWhenOverThreshold",
        "没有可保护的流量范围，控制保持关闭",
      );
      config.enabled = false;
      return config;
    }
    if (knownScopeIds.length > 1) {
      issues.error(
        "CDT_CONTROL_JSON.stopWhenOverThreshold",
        `配置了 ${knownScopeIds.length} 个流量范围，简写无法确定目标；请显式列出 scopes`,
      );
      config.enabled = false;
      return config;
    }
    config.scopes = [
      {
        scopeId: knownScopeIds[0] as string,
        // The shorthand exists precisely to turn stopping on, so it sets both
        // fields the gate requires. `thresholdAction` alone would not be enough.
        thresholdStopEnabled: stopShorthand === true,
        thresholdAction: stopShorthand === true ? "stop_and_notify" : "notify_only",
      },
    ];
  }

  // A policy for an instance that is not allow-listed is a contradictory
  // configuration; refuse it rather than silently ignoring the policy.
  for (const policy of config.instances) {
    if (!config.allowedInstanceIds.includes(policy.instanceId)) {
      // Global, not entity-scoped: every other control-config refusal is global,
      // and a policy that silently does nothing is worse than a loud failure.
      issues.error(
        "CDT_CONTROL_JSON",
        `实例 ${policy.instanceId} 有控制策略但不在 allowedInstanceIds 中，控制保持关闭`,
      );
      config.enabled = false;
      return config;
    }
  }

  return config;
}

/** Parse the notification document. */
function parseNotificationConfig(
  value: unknown,
  localNotify: boolean,
  env: Record<string, string | undefined>,
  issues: IssueCollector,
): NotificationConfig {
  const config = emptyNotificationConfig(localNotify);
  if (value === undefined) return config;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    issues.error("CDT_NOTIFICATION_JSON", "CDT_NOTIFICATION_JSON 必须是 JSON 对象");
    return config;
  }
  const record = value as Record<string, unknown>;
  if (record["schemaVersion"] !== 1) {
    issues.error("CDT_NOTIFICATION_JSON.schemaVersion", "不支持的 notification schemaVersion");
    return config;
  }

  const telegram = record["telegram"];
  if (telegram !== undefined) {
    if (telegram === null || typeof telegram !== "object" || Array.isArray(telegram)) {
      issues.error("CDT_NOTIFICATION_JSON.telegram", "telegram 必须是对象");
    } else {
      const item = telegram as Record<string, unknown>;
      // The bot token is deliberately read from env only, never from a JSON
      // document that a user might paste into a screenshot or an install URL.
      const token = readString(env, ENV_KEYS.telegramToken);
      const chatId = typeof item["chatId"] === "string" ? item["chatId"].trim() : "";
      const enabled = item["enabled"] === true;
      if (enabled && (token === null || chatId === "")) {
        issues.error(
          "CDT_NOTIFICATION_JSON.telegram",
          "启用 Telegram 通知需要 CDT_TELEGRAM_BOT_TOKEN 与 telegram.chatId",
        );
      } else {
        config.telegram = { enabled, botToken: token ?? "", chatId };
      }
    }
  }

  const webhook = record["webhook"];
  if (webhook !== undefined) {
    if (webhook === null || typeof webhook !== "object" || Array.isArray(webhook)) {
      issues.error("CDT_NOTIFICATION_JSON.webhook", "webhook 必须是对象");
    } else {
      const item = webhook as Record<string, unknown>;
      const url = typeof item["url"] === "string" ? item["url"].trim() : "";
      const enabled = item["enabled"] === true;
      const method = item["method"] === "PUT" ? "PUT" : "POST";
      if (enabled) {
        if (!/^https:\/\/[^\s]+$/.test(url)) {
          issues.error("CDT_NOTIFICATION_JSON.webhook.url", "Webhook 必须是 HTTPS 地址");
        } else {
          config.webhook = {
            enabled: true,
            url,
            method,
            bodyTemplate: typeof item["bodyTemplate"] === "string" ? item["bodyTemplate"] : "",
          };
        }
      }
    }
  }

  const daily = record["dailyReport"];
  if (daily !== undefined) {
    if (daily === null || typeof daily !== "object" || Array.isArray(daily)) {
      issues.error("CDT_NOTIFICATION_JSON.dailyReport", "dailyReport 必须是对象");
    } else {
      const item = daily as Record<string, unknown>;
      const time = normalizeClockTime(typeof item["time"] === "string" ? (item["time"] as string) : "");
      if (time === null) {
        issues.error("CDT_NOTIFICATION_JSON.dailyReport.time", "日报时间必须是合法 HH:mm");
      } else {
        const window = item["compensationWindowMinutes"];
        config.dailyReport = {
          enabled: item["enabled"] === true,
          time,
          compensationWindowMinutes:
            typeof window === "number" && Number.isFinite(window) && window >= 0
              ? window
              : 20,
        };
      }
    }
  }

  return config;
}

/**
 * Parse the full configuration.
 *
 * `env` is `ctx.env`; `view` is optional and normally derived from the same map.
 */
export function parseConfig(
  env: Record<string, string | undefined>,
  view: ViewSelection = readViewSelection(env),
): ParseOutcome {
  const issues = new Collector();

  const mode = readEnum<ProviderMode>(env, ENV_KEYS.mode, ["direct", "server"], "direct", issues);
  const namespace = readString(env, ENV_KEYS.namespace) ?? "default";
  const displayName = readString(env, ENV_KEYS.name) ?? "CDT";
  const timezone = readString(env, ENV_KEYS.timezone) ?? "Asia/Shanghai";
  validateTimeZone(timezone, issues);
  const debug = readBoolean(env, ENV_KEYS.debug, false, issues);
  const billingEnabled = readBoolean(env, ENV_KEYS.billingEnabled, false, issues);
  const localNotify = readBoolean(env, ENV_KEYS.localNotify, false, issues);
  const refreshSeconds = readNonNegativeInteger(
    env,
    ENV_KEYS.refreshSeconds,
    DEFAULT_REFRESH_SECONDS,
    issues,
  );
  const automationIntervalSeconds = readNonNegativeInteger(
    env,
    ENV_KEYS.automationIntervalSeconds,
    DEFAULT_AUTOMATION_INTERVAL_SECONDS,
    issues,
  );

  let credentials: Credential[] = [];
  let accounts: AccountConfig[] = [];
  let trafficScopes: TrafficScopeConfig[] = [];
  let instances: InstanceConfig[] = [];

  const advancedRaw = readJson(env, ENV_KEYS.accountsJson, issues);

  if (advancedRaw === null) {
    // Explicitly unusable JSON: refuse rather than quietly building a second,
    // different account set from the simple fields.
    issues.error(
      ENV_KEYS.accountsJson,
      "CDT_ACCOUNTS_JSON 无法解析；不会回退到简单模式以免产生重复账号",
    );
  }

  if (advancedRaw !== undefined && advancedRaw !== null) {
    const model = parseAdvancedModel(advancedRaw, issues);
    if (model === null) {
      return { ok: false, issues: issues.issues };
    }
    credentials = model.credentials;
    accounts = model.accounts;
    trafficScopes = model.trafficScopes;
    instances = model.instances;
    if (readString(env, ENV_KEYS.accessKeyId) !== null) {
      issues.warn(
        ENV_KEYS.accessKeyId,
        "已设置 CDT_ACCOUNTS_JSON，简单模式凭据字段被忽略，以避免同一账号被重复计数",
      );
    }
  } else {
    const built = buildSimpleModel(env, mode, namespace, displayName, timezone, issues);
    credentials = built.credentials;
    accounts = built.accounts;
    trafficScopes = built.trafficScopes;
    instances = built.instances;
  }

  // ---- server endpoint ---------------------------------------------------
  let server: AppConfig["server"] = null;
  if (mode === "server") {
    const rawBaseUrl = readString(env, ENV_KEYS.baseUrl);
    const token = readString(env, ENV_KEYS.readToken);
    const allowInsecure = readBoolean(env, ENV_KEYS.allowInsecureHttp, false, issues);
    if (rawBaseUrl === null) {
      issues.error(ENV_KEYS.baseUrl, "server 模式必须设置 CDT_BASE_URL");
    } else if (token === null) {
      issues.error(ENV_KEYS.readToken, "server 模式必须设置 CDT_READ_TOKEN（widget:read Key）");
    } else {
      const normalized = normalizeServerBaseUrl(rawBaseUrl, allowInsecure);
      if (!normalized.ok) {
        issues.error(ENV_KEYS.baseUrl, normalized.reason);
      } else {
        server = {
          baseUrl: normalized.baseUrl,
          token,
          allowInsecureHttp: allowInsecure,
        };
      }
    }
  } else if (readString(env, ENV_KEYS.baseUrl) !== null) {
    issues.warn(ENV_KEYS.baseUrl, "direct 模式下 CDT_BASE_URL 不会被使用");
  }

  const knownCredentialIds = credentials.map((credential) => credential.id);
  const knownInstanceIds = instances.map((instance) => instance.id);
  const knownScopeIds = trafficScopes.map((scope) => scope.id);

  const control = parseControlConfig(
    readJson(env, ENV_KEYS.controlJson, issues),
    knownCredentialIds,
    knownInstanceIds,
    knownScopeIds,
    issues,
  );
  // Local instance control writes to Aliyun directly, so it needs cloud
  // credentials. Server mode deliberately carries none, so control there would
  // fail at request time; refuse it up front with a clear reason instead.
  // Over-threshold protection compares usage against a quota. In direct mode the
  // only quota source is CDT_QUOTA, so enabling the protection without it would
  // create a safety feature that silently never fires.
  if (mode === "direct" && control.enabled) {
    for (const scopePolicy of control.scopes) {
      if (!scopePolicy.thresholdStopEnabled) continue;
      const scope = trafficScopes.find((item) => item.id === scopePolicy.scopeId);
      if (scope !== undefined && scope.quota === null) {
        issues.error(
          ENV_KEYS.controlJson,
          `范围 ${scopePolicy.scopeId} 开启了阈值停机，但 direct 模式没有可用上限；请填写 CDT_QUOTA`,
        );
      }
    }
  }

  if (mode === "server" && control.enabled) {
    issues.error(
      ENV_KEYS.controlJson,
      "server 模式不提供本地云写控制（该模式没有云端凭据）；保活已关闭，请改用 direct 模式，或由 Go 后端执行实例操作",
    );
    control.enabled = false;
  }

  const notifications = parseNotificationConfig(
    readJson(env, ENV_KEYS.notificationJson, issues),
    localNotify,
    env,
    issues,
  );

  if (billingEnabled && mode === "server" && server === null) {
    issues.warn(ENV_KEYS.billingEnabled, "server 模式未配置成功，账单查询将被跳过");
  }

  const config: AppConfig = {
    mode,
    namespace,
    accountLabel: readString(env, ENV_KEYS.accountId) ?? "main",
    displayName,
    timezone,
    debug,
    refreshSeconds,
    automationIntervalSeconds,
    billingEnabled,
    localNotify,
    credentials,
    accounts,
    trafficScopes,
    instances,
    control,
    notifications,
    server,
    view,
    configFingerprint: "",
  };
  config.configFingerprint = computeConfigFingerprint(config);

  if (issues.globalErrors().length > 0) {
    return { ok: false, issues: issues.issues };
  }
  return { ok: true, config, issues: issues.issues };
}

/** Build the single-account model from the simple `CDT_*` variables. */
function buildSimpleModel(
  env: Record<string, string | undefined>,
  mode: ProviderMode,
  namespace: string,
  displayName: string,
  timezone: string,
  issues: Collector,
): {
  credentials: Credential[];
  accounts: AccountConfig[];
  trafficScopes: TrafficScopeConfig[];
  instances: InstanceConfig[];
} {
  const accountLabel = readString(env, ENV_KEYS.accountId) ?? "main";
  const credentials: Credential[] = [];
  const accounts: AccountConfig[] = [];
  const trafficScopes: TrafficScopeConfig[] = [];
  const instances: InstanceConfig[] = [];

  const accountId = `account-${accountLabel}`;
  accounts.push({ id: accountId, name: displayName, aliyunUid: null });

  const regionId = readString(env, ENV_KEYS.regionId) ?? "cn-hongkong";
  const siteType = readEnum<SiteType>(
    env,
    ENV_KEYS.siteType,
    ["china", "international"],
    "china",
    issues,
  );

  const credentialId = `cred-${accountLabel}`;
  if (mode === "direct") {
    const accessKeyId = readString(env, ENV_KEYS.accessKeyId);
    const accessKeySecret = readString(env, ENV_KEYS.accessKeySecret);
    if (accessKeyId === null) {
      issues.error(ENV_KEYS.accessKeyId, "direct 模式必须设置只读 RAM 的 AccessKey ID");
    }
    if (accessKeySecret === null) {
      issues.error(ENV_KEYS.accessKeySecret, "direct 模式必须设置只读 RAM 的 AccessKey Secret");
    }
    const securityToken = readString(env, ENV_KEYS.securityToken);
    if (accessKeyId !== null && accessKeySecret !== null) {
      credentials.push({
        id: credentialId,
        accountId,
        accessKeyId,
        accessKeySecret,
        siteType,
        ...(securityToken !== null ? { securityToken } : {}),
      });
    }
  } else {
    // Server mode does not need cloud credentials at all: the backend holds
    // them. A placeholder credential keeps the entity graph uniform.
    credentials.push({
      id: credentialId,
      accountId,
      accessKeyId: "server-mode",
      accessKeySecret: "",
      siteType,
    });
  }

  // Traffic class: explicit when given, otherwise derived from the region.
  const explicitClass = readEnum<TrafficClass | "auto">(
    env,
    ENV_KEYS.trafficClass,
    ["auto", "mainland", "overseas"],
    "auto",
    issues,
  );
  const trafficClass: TrafficClass =
    explicitClass === "auto" ? trafficClassOfRegion(regionId) : explicitClass;

  // Quota is never invented. Without it the widget shows usage and marks the
  // remaining/percentage columns as "未配置".
  let quota: QuotaConfig | null = null;
  const quotaRaw = readString(env, ENV_KEYS.quota);
  if (quotaRaw !== null) {
    if (!/^\d+(\.\d+)?$/.test(quotaRaw)) {
      issues.error(ENV_KEYS.quota, "CDT_QUOTA 必须是正数");
    } else {
      const value = Number(quotaRaw);
      if (!Number.isFinite(value) || value <= 0) {
        issues.error(ENV_KEYS.quota, "CDT_QUOTA 必须大于 0");
      } else {
        const unit = readEnum<QuotaUnit>(
          env,
          ENV_KEYS.quotaUnit,
          ["GB", "GiB"],
          "GB",
          issues,
        );
        quota = { value, unit, source: "user" };
      }
    }
  }

  const thresholdPercent = validateThresholdSafe(
    readNumber(env, ENV_KEYS.thresholdPercent, 95, issues),
    issues,
  );

  const scopeId = `scope-${accountLabel}-${trafficClass}`;
  trafficScopes.push({
    id: scopeId,
    accountId,
    credentialId,
    trafficClass,
    quota,
    thresholdPercent,
    controlTargets: [],
  });

  const instanceIdRaw = readString(env, ENV_KEYS.instanceId);
  if (instanceIdRaw !== null) {
    instances.push({
      id: `instance-${accountLabel}`,
      accountId,
      credentialId,
      trafficScopeId: scopeId,
      regionId,
      instanceId: instanceIdRaw,
      name: displayName,
      keepAlive: false,
      shutdownMode: "KeepCharging",
      // Simple mode never enables a schedule; scheduling is an explicit
      // advanced/control concern, and a disabled schedule here means the direct
      // monitoring path cannot start or stop anything.
      schedule: { enabled: false, start: "08:00", stop: "23:30" },
    });
  }

  return { credentials, accounts, trafficScopes, instances };
}

function validateThresholdSafe(value: number, issues: Collector): number {
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    issues.error(ENV_KEYS.thresholdPercent, "CDT_THRESHOLD_PERCENT 必须落在 (0, 100]");
    return 95;
  }
  return value;
}
