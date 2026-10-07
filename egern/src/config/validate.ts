/**
 * Validation for the advanced account model and cross-entity references.
 *
 * The advanced JSON is this project's own schema (not an Egern one), so it is
 * validated strictly and explicitly:
 *   - a wrong `schemaVersion` is rejected rather than guessed at;
 *   - unknown keys are reported, not ignored — an ignored typo in a control
 *     allow-list is a safety problem, not a cosmetic one;
 *   - duplicate ids and dangling references are errors;
 *   - an invalid *control* configuration disables control for the affected
 *     entity but must not break read-only display of other accounts.
 */

import type {
  AccountConfig,
  Credential,
  InstanceConfig,
  InstanceScheduleConfig,
  QuotaConfig,
  QuotaUnit,
  ShutdownMode,
  SiteType,
  ThresholdAction,
  TrafficClass,
  TrafficScopeConfig,
} from "../domain/models.ts";
import { normalizeClockTime } from "../domain/schedule.ts";
import { createTimeZoneProvider } from "../domain/timezone.ts";
import type { IssueCollector } from "./env.ts";

/** The parsed advanced model. */
export interface AdvancedModel {
  credentials: Credential[];
  accounts: AccountConfig[];
  trafficScopes: TrafficScopeConfig[];
  instances: InstanceConfig[];
}

/** Supported advanced schema version. */
export const ADVANCED_SCHEMA_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  where: string,
  issues: IssueCollector,
): string | null {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    issues.error(key, `${where} 缺少必填字符串字段 ${key}`);
    return null;
  }
  return value.trim();
}

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim();
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  key: string,
  fallback: boolean,
  where: string,
  issues: IssueCollector,
): boolean {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    issues.error(key, `${where} 的 ${key} 必须是布尔值`);
    return fallback;
  }
  return value;
}

/** Report keys that this schema does not define. */
function reportUnknownKeys(
  record: Record<string, unknown>,
  known: readonly string[],
  where: string,
  issues: IssueCollector,
): void {
  for (const key of Object.keys(record)) {
    if (!known.includes(key)) {
      issues.warn(key, `${where} 含有未知字段 ${key}，已忽略`);
    }
  }
}

function readQuota(
  value: unknown,
  where: string,
  issues: IssueCollector,
): QuotaConfig | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    issues.error("quota", `${where} 的 quota 必须是对象`);
    return null;
  }
  reportUnknownKeys(value, ["value", "unit", "source"], `${where}.quota`, issues);
  const amount = value["value"];
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    issues.error("quota.value", `${where} 的 quota.value 必须是正数`);
    return null;
  }
  const unit = value["unit"];
  if (unit !== "GB" && unit !== "GiB") {
    issues.error("quota.unit", `${where} 的 quota.unit 必须是 GB 或 GiB`);
    return null;
  }
  const source = value["source"];
  if (source !== undefined && source !== "user" && source !== "legacy") {
    issues.error("quota.source", `${where} 的 quota.source 必须是 user 或 legacy`);
    return null;
  }
  return {
    value: amount,
    unit: unit as QuotaUnit,
    source: source === "legacy" ? "legacy" : "user",
  };
}

function readThreshold(
  value: unknown,
  where: string,
  issues: IssueCollector,
): number {
  if (value === undefined) return 95;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100) {
    issues.error("thresholdPercent", `${where} 的 thresholdPercent 必须落在 (0, 100]`);
    return 95;
  }
  return value;
}

function readSchedule(
  value: unknown,
  where: string,
  issues: IssueCollector,
): InstanceScheduleConfig {
  const fallback: InstanceScheduleConfig = { enabled: false, start: "08:00", stop: "23:30" };
  if (value === undefined) return fallback;
  if (!isRecord(value)) {
    issues.error("schedule", `${where} 的 schedule 必须是对象`);
    return fallback;
  }
  reportUnknownKeys(value, ["enabled", "start", "stop"], `${where}.schedule`, issues);
  const enabled = readOptionalBoolean(value, "enabled", false, `${where}.schedule`, issues);
  const start = normalizeClockTime(typeof value["start"] === "string" ? (value["start"] as string) : "");
  const stop = normalizeClockTime(typeof value["stop"] === "string" ? (value["stop"] as string) : "");
  if (start === null) {
    issues.error("schedule.start", `${where} 的 schedule.start 不是合法 HH:mm`);
    return fallback;
  }
  if (stop === null) {
    issues.error("schedule.stop", `${where} 的 schedule.stop 不是合法 HH:mm`);
    return fallback;
  }
  if (enabled && start === stop) {
    // Equal start/stop would silently mean "24 hours". Require an explicit
    // all-day field rather than inferring it.
    issues.error(
      "schedule",
      `${where} 的 schedule.start 与 schedule.stop 相同；如需全天窗口请等待显式的全天配置项`,
    );
    return { enabled: false, start, stop };
  }
  return { enabled, start, stop };
}

/**
 * Parse and validate the advanced account model.
 *
 * Returns null when the document is unusable as a whole; otherwise returns the
 * model plus the issues recorded for individual entities.
 */
export function parseAdvancedModel(
  value: unknown,
  issues: IssueCollector,
): AdvancedModel | null {
  if (!isRecord(value)) {
    issues.error("CDT_ACCOUNTS_JSON", "CDT_ACCOUNTS_JSON 必须是 JSON 对象");
    return null;
  }

  if (value["schemaVersion"] !== ADVANCED_SCHEMA_VERSION) {
    issues.error(
      "schemaVersion",
      `不支持的 schemaVersion（需要 ${ADVANCED_SCHEMA_VERSION}）；不会回退到其他账号配置`,
    );
    return null;
  }

  reportUnknownKeys(
    value,
    ["schemaVersion", "namespace", "credentials", "accounts", "trafficScopes", "instances"],
    "CDT_ACCOUNTS_JSON",
    issues,
  );

  // ---- credentials -------------------------------------------------------
  const credentials: Credential[] = [];
  const credentialIds = new Set<string>();
  const rawCredentials = value["credentials"];
  if (!Array.isArray(rawCredentials) || rawCredentials.length === 0) {
    issues.error("credentials", "credentials 必须是非空数组");
    return null;
  }
  for (const entry of rawCredentials) {
    if (!isRecord(entry)) {
      issues.error("credentials", "credentials 中存在非对象条目");
      continue;
    }
    const where = "credentials[]";
    reportUnknownKeys(
      entry,
      ["id", "accountId", "accessKeyId", "accessKeySecret", "securityToken", "siteType"],
      where,
      issues,
    );
    const id = readRequiredString(entry, "id", where, issues);
    const accountId = readRequiredString(entry, "accountId", where, issues);
    const accessKeyId = readRequiredString(entry, "accessKeyId", where, issues);
    const accessKeySecret = readRequiredString(entry, "accessKeySecret", where, issues);
    if (id === null || accountId === null || accessKeyId === null || accessKeySecret === null) {
      continue;
    }
    if (credentialIds.has(id)) {
      issues.error("credentials.id", `凭据 id 重复：${id}`);
      continue;
    }
    credentialIds.add(id);
    const siteType = entry["siteType"];
    if (siteType !== "china" && siteType !== "international") {
      issues.error("siteType", `凭据 ${id} 的 siteType 必须是 china 或 international`);
      continue;
    }
    credentials.push({
      id,
      accountId,
      accessKeyId,
      accessKeySecret,
      siteType: siteType as SiteType,
      ...(readOptionalString(entry, "securityToken") !== null
        ? { securityToken: readOptionalString(entry, "securityToken") as string }
        : {}),
    });
  }

  // ---- accounts ----------------------------------------------------------
  const accounts: AccountConfig[] = [];
  const accountIds = new Set<string>();
  const rawAccounts = value["accounts"];
  if (!Array.isArray(rawAccounts) || rawAccounts.length === 0) {
    issues.error("accounts", "accounts 必须是非空数组");
    return null;
  }
  for (const entry of rawAccounts) {
    if (!isRecord(entry)) {
      issues.error("accounts", "accounts 中存在非对象条目");
      continue;
    }
    const where = "accounts[]";
    reportUnknownKeys(entry, ["id", "name", "aliyunUid"], where, issues);
    const id = readRequiredString(entry, "id", where, issues);
    if (id === null) continue;
    if (accountIds.has(id)) {
      issues.error("accounts.id", `账户 id 重复：${id}`);
      continue;
    }
    accountIds.add(id);
    accounts.push({
      id,
      name: readOptionalString(entry, "name") ?? id,
      aliyunUid: readOptionalString(entry, "aliyunUid"),
    });
  }

  // A credential must point at a declared account.
  for (const credential of credentials) {
    if (!accountIds.has(credential.accountId)) {
      issues.error(
        "credentials.accountId",
        `凭据 ${credential.id} 引用了不存在的账户 ${credential.accountId}`,
        credential.id,
      );
    }
  }

  // ---- traffic scopes ----------------------------------------------------
  const trafficScopes: TrafficScopeConfig[] = [];
  const scopeIds = new Set<string>();
  const rawScopes = value["trafficScopes"];
  if (!Array.isArray(rawScopes)) {
    issues.error("trafficScopes", "trafficScopes 必须是数组");
    return null;
  }
  for (const entry of rawScopes) {
    if (!isRecord(entry)) {
      issues.error("trafficScopes", "trafficScopes 中存在非对象条目");
      continue;
    }
    const where = "trafficScopes[]";
    reportUnknownKeys(
      entry,
      ["id", "accountId", "credentialId", "trafficClass", "quota", "thresholdPercent", "controlTargets"],
      where,
      issues,
    );
    const id = readRequiredString(entry, "id", where, issues);
    const accountId = readRequiredString(entry, "accountId", where, issues);
    const credentialId = readRequiredString(entry, "credentialId", where, issues);
    if (id === null || accountId === null || credentialId === null) continue;
    if (scopeIds.has(id)) {
      issues.error("trafficScopes.id", `流量范围 id 重复：${id}`);
      continue;
    }
    scopeIds.add(id);

    const trafficClass = entry["trafficClass"];
    if (trafficClass !== "mainland" && trafficClass !== "overseas") {
      issues.error("trafficClass", `流量范围 ${id} 的 trafficClass 必须是 mainland 或 overseas`);
      continue;
    }
    if (!accountIds.has(accountId)) {
      issues.error("trafficScopes.accountId", `流量范围 ${id} 引用了不存在的账户 ${accountId}`, id);
    }
    if (!credentialIds.has(credentialId)) {
      issues.error("trafficScopes.credentialId", `流量范围 ${id} 引用了不存在的凭据 ${credentialId}`, id);
    }
    const controlTargets: string[] = [];
    if (entry["controlTargets"] !== undefined) {
      if (!Array.isArray(entry["controlTargets"])) {
        issues.error("controlTargets", `流量范围 ${id} 的 controlTargets 必须是数组`, id);
      } else {
        for (const target of entry["controlTargets"] as unknown[]) {
          if (typeof target !== "string" || target.trim() === "") {
            issues.error("controlTargets", `流量范围 ${id} 的 controlTargets 含非法条目`, id);
            continue;
          }
          controlTargets.push(target.trim());
        }
      }
    }

    trafficScopes.push({
      id,
      accountId,
      credentialId,
      trafficClass: trafficClass as TrafficClass,
      quota: readQuota(entry["quota"], `流量范围 ${id}`, issues),
      thresholdPercent: readThreshold(entry["thresholdPercent"], `流量范围 ${id}`, issues),
      controlTargets,
    });
  }

  if (trafficScopes.length === 0) {
    issues.error("trafficScopes", "trafficScopes 不能为空");
    return null;
  }

  // ---- instances ---------------------------------------------------------
  const instances: InstanceConfig[] = [];
  const instanceIds = new Set<string>();
  const rawInstances = value["instances"];
  if (rawInstances !== undefined && !Array.isArray(rawInstances)) {
    issues.error("instances", "instances 必须是数组");
    return null;
  }
  for (const entry of (rawInstances ?? []) as unknown[]) {
    if (!isRecord(entry)) {
      issues.error("instances", "instances 中存在非对象条目");
      continue;
    }
    const where = "instances[]";
    reportUnknownKeys(
      entry,
      [
        "id", "accountId", "credentialId", "trafficScopeId", "regionId",
        "instanceId", "name", "keepAlive", "shutdownMode", "schedule",
      ],
      where,
      issues,
    );
    const id = readRequiredString(entry, "id", where, issues);
    const accountId = readRequiredString(entry, "accountId", where, issues);
    const credentialId = readRequiredString(entry, "credentialId", where, issues);
    const trafficScopeId = readRequiredString(entry, "trafficScopeId", where, issues);
    const regionId = readRequiredString(entry, "regionId", where, issues);
    const instanceId = readRequiredString(entry, "instanceId", where, issues);
    if (
      id === null || accountId === null || credentialId === null ||
      trafficScopeId === null || regionId === null || instanceId === null
    ) {
      continue;
    }
    if (instanceIds.has(id)) {
      issues.error("instances.id", `实例 id 重复：${id}`);
      continue;
    }
    instanceIds.add(id);

    if (!accountIds.has(accountId)) {
      issues.error("instances.accountId", `实例 ${id} 引用了不存在的账户 ${accountId}`, id);
    }
    if (!credentialIds.has(credentialId)) {
      issues.error("instances.credentialId", `实例 ${id} 引用了不存在的凭据 ${credentialId}`, id);
    }
    if (!scopeIds.has(trafficScopeId)) {
      issues.error("instances.trafficScopeId", `实例 ${id} 引用了不存在的流量范围 ${trafficScopeId}`, id);
    }

    const shutdownMode = entry["shutdownMode"];
    if (
      shutdownMode !== undefined &&
      shutdownMode !== "KeepCharging" &&
      shutdownMode !== "StopCharging"
    ) {
      issues.error("shutdownMode", `实例 ${id} 的 shutdownMode 非法`, id);
    }

    instances.push({
      id,
      accountId,
      credentialId,
      trafficScopeId,
      regionId,
      instanceId,
      name: readOptionalString(entry, "name") ?? instanceId,
      keepAlive: readOptionalBoolean(entry, "keepAlive", false, `实例 ${id}`, issues),
      shutdownMode: (shutdownMode === "StopCharging"
        ? "StopCharging"
        : "KeepCharging") as ShutdownMode,
      schedule: readSchedule(entry["schedule"], `实例 ${id}`, issues),
    });
  }

  return { credentials, accounts, trafficScopes, instances };
}

/** Validate a business timezone, reporting an error when unusable. */
export function validateTimeZone(
  timeZone: string,
  issues: IssueCollector,
  field = "CDT_TIMEZONE",
): boolean {
  const provider = createTimeZoneProvider(timeZone);
  if (!provider.isReliable()) {
    issues.error(field, `无法在当前环境使用该时区：${timeZone}`);
    return false;
  }
  return true;
}

/** Validate a threshold percentage value. */
export function validateThreshold(
  value: number,
  field: string,
  issues: IssueCollector,
): number {
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    issues.error(field, `${field} 必须落在 (0, 100]`);
    return 95;
  }
  return value;
}

/** Narrow a raw string to a threshold action. */
export function parseThresholdAction(
  value: unknown,
  fallback: ThresholdAction,
  where: string,
  issues: IssueCollector,
): ThresholdAction {
  if (value === undefined) return fallback;
  if (value === "notify_only" || value === "stop_and_notify") return value;
  issues.error("thresholdAction", `${where} 的 thresholdAction 非法`);
  return fallback;
}
