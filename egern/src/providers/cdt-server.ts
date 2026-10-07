/**
 * `CdtServerProvider` — reads the existing Go CDT-Monitor API (v1).
 *
 * This is the **optional collaboration mode**, for users who already run the Go
 * backend and want its scheduling, history and credential custody. It is not the
 * default, and it is strictly read-only here.
 *
 * v1 freshness is the central hazard, and the contract is explicit about it:
 * the row-level `updated_at`/`last_updated` is written when a monitor job is
 * *enqueued*, and is also advanced by successful status queries and by control
 * actions. It is therefore **not** a measurement time. So this provider:
 *   - reports `observedAt: null` (no cloud observation time is claimed);
 *   - keeps the raw value in `legacyUpdatedAt` for display only, always
 *     labelled;
 *   - marks `freshnessQuality: "legacy-unverified"`.
 *
 * Consequently v1 data can never satisfy the freshness precondition for a local
 * automatic control action (see `domain/policy.ts`).
 *
 * Because the v1 summary is keyed by configuration *row* rather than by Aliyun
 * account scope, two rows may belong to the same real account and it is
 * impossible to tell from a masked AccessKeyId. Rows are therefore always shown
 * individually and never summed into a combined quota/usage/balance total.
 */

import type {
  FreshnessQuality,
  InstanceStatus,
  ProviderMode,
  SanitizedError,
} from "../domain/models.ts";
import { UNVERIFIED_PERIOD } from "../domain/models.ts";
import { legacyGibToBytes, trafficClassOfRegion } from "../domain/usage.ts";
import type { HttpClient } from "../host/types.ts";
import type {
  AccountQuery,
  BalanceReading,
  BillReading,
  InstanceQuery,
  InstanceStatusReading,
  ProviderCapabilities,
  ReadonlyCloudProvider,
  RequestScope,
  TrafficQuery,
  TrafficReading,
} from "./types.ts";
import { ProviderError } from "./types.ts";

/** Prefix identifying an entity backed by a v1 server row. */
export const SERVER_ENTITY_PREFIX = "server-row:";

/** Build the entity id for a v1 server row. */
export function serverEntityId(rowId: number): string {
  return `${SERVER_ENTITY_PREFIX}${rowId}`;
}

/** Extract the v1 row id from an entity id, or null when it is not one. */
export function parseServerRowId(entityId: string): number | null {
  if (!entityId.startsWith(SERVER_ENTITY_PREFIX)) return null;
  const raw = entityId.slice(SERVER_ENTITY_PREFIX.length);
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/** Server endpoint description. */
export interface ServerEndpointConfig {
  baseUrl: string;
  token: string;
}

/**
 * One row of the v1 `/api/v1/status` response.
 *
 * Fields are optional because the v1 DTO is not a frozen contract; every read
 * below tolerates absence rather than assuming a shape.
 */
export interface ServerStatusRow {
  id: number;
  name: string;
  region: string;
  instanceStatus: InstanceStatus;
  flowUsed: number | null;
  flowTotal: number | null;
  lastUpdated: string | null;
  stale: boolean;
  balance: number | null;
  currency: string | null;
  monthlyCost: number | null;
  billingError: string | null;
  keepAlive: boolean | null;
  shutdownMode: string | null;
  scheduleEnabled: boolean;
  startTime: string | null;
  stopTime: string | null;
}

/** Parsed `/api/v1/status` payload. */
export interface ServerStatus {
  rows: ServerStatusRow[];
  systemLastRun: string | null;
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  "Pending",
  "Starting",
  "Running",
  "Stopping",
  "Stopped",
]);

function normalizeStatus(value: unknown): InstanceStatus {
  if (typeof value === "string" && KNOWN_STATUSES.has(value)) {
    return value as InstanceStatus;
  }
  return "Unknown";
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Validate and normalise a server base URL.
 *
 * Rejects credentials in the URL and drops query/fragment, while preserving a
 * reverse-proxy base path (e.g. `https://host/cdt`). Plain HTTP is refused
 * unless the caller explicitly opted into local development, so a
 * `widget:read` token cannot be sent in clear text by accident.
 */
export function normalizeServerBaseUrl(
  raw: string,
  allowInsecureHttp: boolean,
): { ok: true; baseUrl: string } | { ok: false; reason: string } {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "") return { ok: false, reason: "未填写服务器地址" };

  const match = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/.exec(trimmed);
  if (match === null) {
    return { ok: false, reason: "服务器地址格式无效" };
  }
  const scheme = (match[1] as string).toLowerCase();
  const authority = match[2] as string;
  const path = match[3] ?? "";

  if (scheme === "http" && !allowInsecureHttp) {
    return {
      ok: false,
      reason: "服务器地址必须使用 HTTPS；本机调试需显式开启开发选项",
    };
  }
  if (authority.includes("@")) {
    return { ok: false, reason: "服务器地址不能包含用户名或密码" };
  }
  if (authority === "" || authority.startsWith(":")) {
    return { ok: false, reason: "服务器地址缺少主机名" };
  }

  return { ok: true, baseUrl: `${scheme}://${authority}${path}` };
}

export interface ServerProviderOptions {
  http: HttpClient;
  endpoint: ServerEndpointConfig;
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs: number;
}

/** Read-only access to the Go v1 API. */
export class CdtServerProvider implements ReadonlyCloudProvider {
  readonly mode: ProviderMode = "server";
  readonly capabilities: ProviderCapabilities = {
    instanceStatus: true,
    billing: true,
    // The v1 API cannot report a trustworthy observation time.
    verifiedObservationTimes: false,
  };

  private statusMemo: Promise<ServerStatus> | null = null;

  private readonly options: ServerProviderOptions;

  constructor(options: ServerProviderOptions) {
    this.options = options;
  }

  /** Raise a sanitized v1 error with a scope-appropriate message. */
  private errorFor(status: number, scope: RequestScope, entityId: string): ProviderError {
    const at = scope.now().toISOString();
    let code: string;
    let message: string;
    if (status === 401) {
      code = "TokenRejected";
      message = "只读 Token 无效或已撤销，请重新创建 widget:read Key";
    } else if (status === 403) {
      code = "ScopeMissing";
      // Never suggest escalating to admin: that is a privilege increase the
      // user did not ask for and a widget must not require.
      message = "只读 Token 缺少 widget:read 权限（不会自动改用管理员登录）";
    } else {
      code = "ServerError";
      message = `服务器返回 HTTP ${status}`;
    }
    const sanitizedError: SanitizedError = { code, message, at, retryable: status >= 500 };
    void entityId;
    return new ProviderError(sanitizedError);
  }

  /** Fetch `/api/v1/status` once per run. */
  private fetchStatus(scope: RequestScope): Promise<ServerStatus> {
    if (this.statusMemo !== null) return this.statusMemo;

    const pending = (async (): Promise<ServerStatus> => {
      const url = `${this.options.endpoint.baseUrl}/api/v1/status`;
      let response: { status: number; text(): Promise<string> };
      try {
        response = await this.options.http.get(url, {
          headers: {
            Authorization: `Bearer ${this.options.endpoint.token}`,
            Accept: "application/json",
          },
          timeout: this.options.requestTimeoutMs,
          credentials: "omit",
          redirect: "error",
        });
      } catch {
        throw new ProviderError({
          code: "NetworkError",
          message: "无法连接服务器",
          at: scope.now().toISOString(),
          retryable: true,
        });
      }
      if (response.status !== 200) {
        throw this.errorFor(response.status, scope, "server");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(await response.text());
      } catch {
        throw new ProviderError({
          code: "MalformedResponse",
          message: "服务器返回了无法解析的内容",
          at: scope.now().toISOString(),
          retryable: false,
        });
      }
      return parseServerStatus(parsed);
    })();

    this.statusMemo = pending;
    return pending;
  }

  /** Look up the row backing an entity id. */
  private async rowFor(
    scope: RequestScope,
    entityId: string,
  ): Promise<ServerStatusRow> {
    const rowId = parseServerRowId(entityId);
    if (rowId === null) {
      throw new ProviderError({
        code: "UnknownEntity",
        message: "server 模式下的实体必须以 server-row:<id> 命名",
        at: scope.now().toISOString(),
        retryable: false,
      });
    }
    const status = await this.fetchStatus(scope);
    const row = status.rows.find((candidate) => candidate.id === rowId);
    if (row === undefined) {
      throw new ProviderError({
        code: "RowNotFound",
        message: `服务器快照中不存在配置行 ${rowId}`,
        at: scope.now().toISOString(),
        retryable: false,
      });
    }
    return row;
  }

  async getTraffic(scope: RequestScope, query: TrafficQuery): Promise<TrafficReading> {
    const row = await this.rowFor(scope, query.scope.id);
    const warnings: string[] = [
      "服务器记录时间不是云端采样时间，可能包含陈旧字段",
    ];
    if (row.stale) warnings.push("服务器将该行标记为 stale");
    if (row.flowUsed === null) {
      throw new ProviderError({
        code: "MissingTraffic",
        message: "服务器快照中缺少该行的流量数据",
        at: scope.now().toISOString(),
        retryable: false,
      });
    }

    const quality: FreshnessQuality = "legacy-unverified";
    return {
      // v1 reports GiB while both its UI and the Android widget label it "GB".
      usedBytes: legacyGibToBytes(row.flowUsed),
      regions: row.region === "" ? [] : [row.region],
      partial: row.stale,
      observedAt: null,
      legacyUpdatedAt: row.lastUpdated,
      // The Go provider passes no period parameter, so the accumulation window
      // is unconfirmed.
      periodId: UNVERIFIED_PERIOD,
      periodTimezone: null,
      sourceUnit: "legacyGiB",
      freshnessQuality: quality,
      // The v1 row carries the configured maximum, so it can stand in for a
      // quota the user did not set. Converted from GiB and tagged "legacy" so
      // the UI never presents it as the user's own figure.
      suggestedQuotaBytes: row.flowTotal === null ? null : legacyGibToBytes(row.flowTotal),
      suggestedQuotaSource: row.flowTotal === null ? null : "legacy",
      warnings,
    };
  }

  async getInstanceStatus(
    scope: RequestScope,
    query: InstanceQuery,
  ): Promise<InstanceStatusReading> {
    const row = await this.rowFor(scope, query.instance.id);
    return {
      instanceId: query.instance.instanceId,
      status: row.instanceStatus,
      observedAt: null,
      legacyUpdatedAt: row.lastUpdated,
    };
  }

  async getBalance(scope: RequestScope, query: AccountQuery): Promise<BalanceReading> {
    const row = await this.rowFor(scope, query.account.id);
    if (row.billingError !== null && row.billingError !== "") {
      throw new ProviderError({
        code: "BillingError",
        message: "服务器记录了账单查询错误",
        at: scope.now().toISOString(),
        retryable: false,
      });
    }
    if (row.balance === null) {
      throw new ProviderError({
        code: "BillingDisabled",
        message: "服务器未启用或尚未缓存账单数据",
        at: scope.now().toISOString(),
        retryable: false,
      });
    }
    return {
      amount: row.balance,
      currency: row.currency ?? "CNY",
      observedAt: scope.now().toISOString(),
    };
  }

  async getInstanceBill(
    scope: RequestScope,
    query: InstanceQuery,
    cycle: string,
  ): Promise<BillReading> {
    const row = await this.rowFor(scope, query.instance.id);
    if (row.monthlyCost === null) {
      throw new ProviderError({
        code: "BillingDisabled",
        message: "服务器未启用或尚未缓存实例账单",
        at: scope.now().toISOString(),
        retryable: false,
      });
    }
    return {
      totalCost: row.monthlyCost,
      currency: row.currency,
      cycle,
      // v1 caches a single value; pagination state is not exposed.
      partial: false,
      observedAt: scope.now().toISOString(),
    };
  }
}

/** Parse a `/api/v1/status` payload into rows. */
export function parseServerStatus(body: unknown): ServerStatus {
  const root = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rawAccounts = Array.isArray(root["accounts"]) ? (root["accounts"] as unknown[]) : [];
  const rows: ServerStatusRow[] = [];

  for (const entry of rawAccounts) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = numberOrNull(record["id"]);
    if (id === null) continue;

    const region = stringOrNull(record["region"]) ?? "";
    rows.push({
      id,
      name: stringOrNull(record["remark"]) ?? stringOrNull(record["account"]) ?? `#${id}`,
      region,
      instanceStatus: normalizeStatus(record["instance_status"]),
      flowUsed: numberOrNull(record["flow_used"]),
      flowTotal: numberOrNull(record["flow_total"]),
      lastUpdated: stringOrNull(record["last_updated"]),
      stale: record["stale"] === true,
      balance: numberOrNull(record["balance"]),
      currency: stringOrNull(record["currency"]),
      monthlyCost: numberOrNull(record["monthly_cost"]),
      billingError: stringOrNull(record["billing_error"]),
      keepAlive: typeof record["keep_alive"] === "boolean" ? (record["keep_alive"] as boolean) : null,
      shutdownMode: stringOrNull(record["shutdown_mode"]),
      scheduleEnabled: record["schedule_enabled"] === true,
      startTime: stringOrNull(record["start_time"]),
      stopTime: stringOrNull(record["stop_time"]),
    });
  }

  return {
    rows,
    systemLastRun: stringOrNull(root["system_last_run"]),
  };
}

/** Traffic class implied by a v1 row's region. */
export function serverRowTrafficClass(region: string): "mainland" | "overseas" {
  return region === "" ? "overseas" : trafficClassOfRegion(region);
}
