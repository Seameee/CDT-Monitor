/**
 * Shared entry-point runtime.
 *
 * Every entry (`widget`, `refresh`, `diagnostics`, `control`, `automation`) boots
 * through here so that configuration parsing, adapter wiring and budget
 * arithmetic are identical everywhere — and so that a failure has one place to
 * be turned into a safe, renderable result.
 *
 * Budgets follow the project defaults: a widget gets a 20 s script timeout and
 * keeps ~15 s of that for work, leaving time to render; a schedule run gets 30 s
 * and spends ~25 s. Provider timeouts are derived from what is left, never fixed.
 */

import type { AppConfig } from "../domain/models.ts";
import type { ConfigIssue } from "../config/env.ts";
import { parseConfig } from "../config/parse.ts";
import type { Clock, EgernScriptContext, HttpClient, KeyValueStore, NonceFactory, Notifier } from "../host/types.ts";
import { createClock, createNonceFactory, readEnvMap, wrapHttp, wrapNotifier, wrapStorage } from "../host/egern.ts";
import type { ReadonlyCloudProvider } from "../providers/types.ts";
import { DirectAliyunProvider } from "../providers/aliyun/direct.ts";
import { CdtServerProvider } from "../providers/cdt-server.ts";
import { Cache } from "../services/cache.ts";

/** Widget script timeout, in seconds (declared in the module YAML). */
export const WIDGET_TIMEOUT_SECONDS = 20;
/** Time the widget keeps for itself before rendering. */
export const WIDGET_BUDGET_MS = 15_000;

/** Schedule script timeout, in seconds. */
export const REFRESH_TIMEOUT_SECONDS = 30;
/** Time the schedule run keeps for itself. */
export const REFRESH_BUDGET_MS = 25_000;

/** Per-request timeout bounds, clamped by the remaining budget. */
export const MIN_REQUEST_TIMEOUT_MS = 2_000;
export const MAX_REQUEST_TIMEOUT_MS = 8_000;

/** Read attempts per request. Two, per the contract. */
export const READ_ATTEMPTS = 2;

/** A fully wired read runtime. */
export interface ReadRuntime {
  env: Record<string, string | undefined>;
  config: AppConfig;
  issues: ConfigIssue[];
  cache: Cache;
  clock: Clock;
  nonce: NonceFactory;
  http: HttpClient;
  storage: KeyValueStore;
  notifier: Notifier;
  /** Absolute epoch-ms deadline for this entry point. */
  deadlineMs: number;
}

/** Result of preparing a runtime. */
export type RuntimeOutcome =
  | { ok: true; runtime: ReadRuntime }
  | { ok: false; issues: ConfigIssue[] };

/** Prepare configuration, adapters and cache for a read entry point. */
export function prepareRuntime(ctx: EgernScriptContext, budgetMs: number): RuntimeOutcome {
  const env = readEnvMap(ctx);
  const outcome = parseConfig(env);
  if (!outcome.ok) {
    return { ok: false, issues: outcome.issues };
  }
  const config = outcome.config;
  const clock = createClock();
  const storage = wrapStorage(ctx);

  return {
    ok: true,
    runtime: {
      env,
      config,
      issues: outcome.issues,
      cache: new Cache({
        store: storage,
        namespace: config.namespace,
        provider: config.mode,
        fingerprint: config.configFingerprint,
      }),
      clock,
      nonce: createNonceFactory(),
      http: wrapHttp(ctx),
      storage,
      notifier: wrapNotifier(ctx),
      deadlineMs: clock.now().getTime() + budgetMs,
    },
  };
}

/** Clamp a per-request timeout so it cannot exceed the remaining budget. */
export function requestTimeoutFor(runtime: ReadRuntime): number {
  const remaining = runtime.deadlineMs - runtime.clock.now().getTime();
  // Reserve a slice for the response processing that follows the request.
  const allowance = Math.floor(remaining / READ_ATTEMPTS) - 500;
  return Math.max(
    MIN_REQUEST_TIMEOUT_MS,
    Math.min(MAX_REQUEST_TIMEOUT_MS, allowance > 0 ? allowance : MIN_REQUEST_TIMEOUT_MS),
  );
}

/** Build the read-only provider for the configured mode. */
export function createProvider(runtime: ReadRuntime): ReadonlyCloudProvider {
  const requestTimeoutMs = requestTimeoutFor(runtime);
  if (runtime.config.mode === "server") {
    if (runtime.config.server === null) {
      throw new Error("server mode requires a configured endpoint");
    }
    return new CdtServerProvider({
      http: runtime.http,
      endpoint: {
        baseUrl: runtime.config.server.baseUrl,
        token: runtime.config.server.token,
      },
      requestTimeoutMs,
    });
  }
  return new DirectAliyunProvider({
    http: runtime.http,
    clock: runtime.clock,
    nonce: runtime.nonce,
    requestTimeoutMs,
    maxAttempts: READ_ATTEMPTS,
    deadlineMs: runtime.deadlineMs,
  });
}

/** RPC dependencies for a write provider (control entries only). */
export function createRpcDependencies(runtime: ReadRuntime) {
  return {
    http: runtime.http,
    clock: runtime.clock,
    nonce: runtime.nonce,
    requestTimeoutMs: requestTimeoutFor(runtime),
    maxAttempts: 1,
    deadlineMs: runtime.deadlineMs,
  };
}

/** Format issues for a human, bounded in length. */
export function describeIssues(issues: readonly ConfigIssue[], limit = 3): string {
  const errors = issues.filter((issue) => issue.severity === "error");
  const chosen = (errors.length > 0 ? errors : issues).slice(0, limit);
  return chosen.map((issue) => `${issue.field}: ${issue.message}`).join("；");
}
