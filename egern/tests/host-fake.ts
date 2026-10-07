/**
 * Test doubles for the Egern host and the cloud, used by the offline suite.
 *
 * These deliberately provide **only** the documented host surface. They
 * specifically do *not* expose `Buffer`, `fetch`, `crypto`, `TextEncoder`,
 * `process` or timers, so a test can never accidentally pass because a Node
 * global happened to be present — which would hide a real device failure.
 */

import type {
  Clock,
  EgernScriptContext,
  HttpClient,
  HttpRequestOptions,
  HttpResponseLike,
  KeyValueStore,
  NonceFactory,
  NotifyOptions,
} from "../src/host/types.ts";
import type {
  AccountConfig,
  Credential,
  InstanceConfig,
  InstanceStatus,
  ProviderMode,
  SanitizedError,
  SourceUnit,
  TrafficClass,
} from "../src/domain/models.ts";
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
} from "../src/providers/types.ts";
import { ProviderError } from "../src/providers/types.ts";

/** A deterministic clock, so schedule tests never depend on wall time. */
export function fixedClock(iso: string): Clock {
  const instant = new Date(iso);
  return { now: () => new Date(instant.getTime()) };
}

/** A stepping clock, for tests that need time to advance between calls. */
export function steppingClock(startIso: string, stepMs = 1000): Clock {
  let current = new Date(startIso).getTime();
  return {
    now: () => {
      const value = new Date(current);
      current += stepMs;
      return value;
    },
  };
}

/** A counter-based nonce factory: deterministic, and not pretending to be secure. */
export function counterNonce(): NonceFactory {
  let counter = 0;
  return {
    create: () => `nonce-${++counter}`,
    describe: () => "test counter",
    isCryptographicallyStrong: () => false,
  };
}

/** An in-memory `ctx.storage`. */
export function memoryStorage(seed: Record<string, string> = {}): KeyValueStore {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    getJSON: (key) => {
      const raw = map.get(key);
      if (raw === undefined) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    setJSON: (key, value) => {
      map.set(key, JSON.stringify(value));
    },
    delete: (key) => {
      map.delete(key);
    },
  };
}

/** A recorded HTTP exchange. */
export interface RecordedRequest {
  method: "GET" | "POST";
  url: string;
  options: HttpRequestOptions | undefined;
  /** Parsed form body, when the request was form-encoded. */
  form: Record<string, string> | null;
}

/** A scripted HTTP responder. */
export type Responder = (
  request: RecordedRequest,
) => { status: number; body: string } | Promise<{ status: number; body: string }>;

/**
 * An HTTP client that never touches the network.
 *
 * Tests assert on `requests` to prove, for example, that a widget issued zero
 * writes or exactly one CDT call.
 */
export function fakeHttp(responder: Responder): { http: HttpClient; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];

  const perform = async (
    method: "GET" | "POST",
    url: string,
    options?: HttpRequestOptions,
  ): Promise<HttpResponseLike> => {
    const record: RecordedRequest = {
      method,
      url,
      options,
      form:
        typeof options?.body === "string" &&
        options.headers?.["Content-Type"] === "application/x-www-form-urlencoded"
          ? Object.fromEntries(new URLSearchParams(options.body))
          : null,
    };
    requests.push(record);
    const result = await responder(record);
    return {
      status: result.status,
      text: async () => result.body,
    };
  };

  return {
    http: {
      get: (url, options) => perform("GET", url, options),
      post: (url, options) => perform("POST", url, options),
    },
    requests,
  };
}

/** Build a fixture credential. */
export function fixtureCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: "cred-main",
    accountId: "account-main",
    accessKeyId: "EXAMPLE_AK_ID",
    accessKeySecret: "EXAMPLE_SECRET",
    siteType: "international",
    ...overrides,
  };
}

/** Build a fixture account. */
export function fixtureAccount(overrides: Partial<AccountConfig> = {}): AccountConfig {
  return { id: "account-main", name: "主账号", aliyunUid: null, ...overrides };
}

/** Build a fixture instance configuration. */
export function fixtureInstance(overrides: Partial<InstanceConfig> = {}): InstanceConfig {
  return {
    id: "hk-ecs",
    accountId: "account-main",
    credentialId: "cred-main",
    trafficScopeId: "main-overseas",
    regionId: "cn-hongkong",
    instanceId: "i-example",
    name: "香港实例",
    keepAlive: false,
    shutdownMode: "KeepCharging",
    schedule: { enabled: false, start: "08:00", stop: "23:30" },
    ...overrides,
  };
}

/** Reading values a fake provider should return. */
export interface FakeProviderScript {
  traffic?: {
    usedBytes: number;
    trafficClass?: TrafficClass;
    periodId?: string;
    observedAt?: string | null;
    legacyUpdatedAt?: string | null;
    sourceUnit?: SourceUnit;
    freshnessQuality?: "measured" | "legacy-unverified";
    suggestedQuotaBytes?: number | null;
  };
  status?: InstanceStatus;
  balance?: { amount: number; currency: string };
  bill?: { totalCost: number; currency: string | null; partial?: boolean };
  /** Fail this operation instead of succeeding. */
  failTraffic?: SanitizedError;
  failStatus?: SanitizedError;
  failBalance?: SanitizedError;
  failBill?: SanitizedError;
}

/**
 * A read-only provider that returns scripted values and records every call.
 *
 * It has **no** write methods, so it cannot violate the read-only boundary even
 * if a test is wrong.
 */
export class FakeReadProvider implements ReadonlyCloudProvider {
  readonly calls: string[] = [];

  readonly mode: ProviderMode;
  readonly capabilities: ProviderCapabilities;
  private readonly script: FakeProviderScript;

  constructor(
    mode: ProviderMode,
    script: FakeProviderScript = {},
    capabilities?: ProviderCapabilities,
  ) {
    this.mode = mode;
    this.script = script;
    this.capabilities = capabilities ?? {
      instanceStatus: true,
      billing: true,
      verifiedObservationTimes: mode === "direct",
    };
  }

  async getTraffic(scope: RequestScope, query: TrafficQuery): Promise<TrafficReading> {
    this.calls.push(`traffic:${query.scope.id}`);
    if (this.script.failTraffic !== undefined) throw new ProviderError(this.script.failTraffic);
    const script = this.script.traffic;
    if (script === undefined) {
      throw new ProviderError({
        code: "NoScript",
        message: "test did not script a traffic reading",
        at: scope.now().toISOString(),
        retryable: false,
      });
    }
    return {
      usedBytes: script.usedBytes,
      regions: ["cn-hongkong"],
      partial: false,
      observedAt: script.observedAt === undefined ? scope.now().toISOString() : script.observedAt,
      legacyUpdatedAt: script.legacyUpdatedAt ?? null,
      periodId: script.periodId ?? "unverified",
      periodTimezone: null,
      sourceUnit: script.sourceUnit ?? "bytes",
      freshnessQuality: script.freshnessQuality ?? "measured",
      suggestedQuotaBytes: script.suggestedQuotaBytes ?? null,
      suggestedQuotaSource: script.suggestedQuotaBytes == null ? null : "legacy",
      warnings: [],
    };
  }

  async getInstanceStatus(
    scope: RequestScope,
    query: InstanceQuery,
  ): Promise<InstanceStatusReading> {
    this.calls.push(`status:${query.instance.id}`);
    if (this.script.failStatus !== undefined) throw new ProviderError(this.script.failStatus);
    return {
      instanceId: query.instance.instanceId,
      status: this.script.status ?? "Running",
      observedAt: this.mode === "server" ? null : scope.now().toISOString(),
      legacyUpdatedAt: this.mode === "server" ? "2026-10-05T08:00:00.000Z" : null,
    };
  }

  async getBalance(scope: RequestScope, query: AccountQuery): Promise<BalanceReading> {
    this.calls.push(`balance:${query.account.id}`);
    if (this.script.failBalance !== undefined) throw new ProviderError(this.script.failBalance);
    const balance = this.script.balance;
    if (balance === undefined) {
      throw new ProviderError({
        code: "BillingDisabled",
        message: "not scripted",
        at: scope.now().toISOString(),
        retryable: false,
      });
    }
    return { amount: balance.amount, currency: balance.currency, observedAt: scope.now().toISOString() };
  }

  async getInstanceBill(
    scope: RequestScope,
    query: InstanceQuery,
    cycle: string,
  ): Promise<BillReading> {
    this.calls.push(`bill:${query.instance.id}`);
    if (this.script.failBill !== undefined) throw new ProviderError(this.script.failBill);
    const bill = this.script.bill;
    if (bill === undefined) {
      throw new ProviderError({
        code: "BillingDisabled",
        message: "not scripted",
        at: scope.now().toISOString(),
        retryable: false,
      });
    }
    return {
      totalCost: bill.totalCost,
      currency: bill.currency,
      cycle,
      partial: bill.partial ?? false,
      observedAt: scope.now().toISOString(),
    };
  }
}

/**
 * A control provider that records write attempts.
 *
 * Used to prove that unauthorized intents produce **zero** calls, and that a
 * timeout is classified `uncertain` rather than silently retried.
 */
export class FakeControlProvider {
  readonly started: InstanceConfig[] = [];
  readonly stopped: Array<{ instance: InstanceConfig; mode: string }> = [];

  private readonly failWith: SanitizedError | null;

  constructor(failWith: SanitizedError | null = null) {
    this.failWith = failWith;
  }

  async startInstance(
    _scope: RequestScope,
    instance: InstanceConfig,
  ): Promise<void> {
    if (this.failWith !== null) throw new ProviderError(this.failWith);
    this.started.push(instance);
  }

  async stopInstance(
    _scope: RequestScope,
    instance: InstanceConfig,
    _credential: Credential,
    shutdownMode: string,
  ): Promise<void> {
    if (this.failWith !== null) throw new ProviderError(this.failWith);
    this.stopped.push({ instance, mode: shutdownMode });
  }
}

/** Notifications captured from a fake `ctx.notify`. */
export interface FakeContext {
  ctx: EgernScriptContext;
  storage: KeyValueStore;
  notifications: NotifyOptions[];
  requests: RecordedRequest[];
}

/** Build a fake `ctx` for a generic (widget) or schedule run. */
export function createFakeContext(options: {
  env: Record<string, string | undefined>;
  responder?: Responder;
  widgetFamily?: string;
  cron?: string;
  seedStorage?: Record<string, string>;
}): FakeContext {
  const storage = memoryStorage(options.seedStorage ?? {});
  const notifications: NotifyOptions[] = [];
  const { http, requests } = fakeHttp(
    options.responder ??
      (() => ({ status: 500, body: JSON.stringify({ Code: "NoResponder" }) })),
  );

  const ctx: EgernScriptContext = {
    env: options.env,
    http,
    storage,
    notify: (payload) => {
      notifications.push(payload);
    },
    app: { version: "test-1.0", language: "zh-Hans" },
    script: { name: "cdt-test" },
    ...(options.widgetFamily !== undefined ? { widgetFamily: options.widgetFamily } : {}),
    ...(options.cron !== undefined ? { cron: options.cron } : {}),
  };

  return { ctx, storage, notifications, requests };
}
