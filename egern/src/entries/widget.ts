/**
 * `cdt-widget` — generic (widget) entry point. Strictly read-only.
 *
 * Flow: read this context's cache → if the traffic observation is still within
 * the configured TTL, render straight from cache → otherwise perform a read-only
 * collection and render. A widget therefore never depends on a `schedule` run
 * having populated a shared key, which is the contract's required degradation
 * when cross-context cache sharing is unproven.
 *
 * This function **always returns a valid Widget DSL document**. Configuration
 * errors, network failures, corrupt caches and unknown widget families all
 * produce a renderable result; nothing is allowed to throw out of the entry.
 */

import type { EgernScriptContext, WidgetFamily } from "../host/types.ts";
import { asWidgetFamily } from "../host/types.ts";
import type { ScopeHistory, Snapshot } from "../domain/models.ts";
import { loadSnapshotFromCache, isSnapshotFresh, readCachedHistory } from "../services/cache.ts";
import { collectSnapshot } from "../services/collect.ts";
import { buildViewModel } from "../widget/render.ts";
import { renderLayout } from "../widget/layouts.ts";
import { resolveTheme } from "../widget/theme.ts";
import {
  WIDGET_BUDGET_MS,
  createProvider,
  describeIssues,
  prepareRuntime,
} from "./runtime.ts";
import type { ReadRuntime } from "./runtime.ts";

/** Smallest sensible refreshAfter delay, in seconds. */
const MIN_REFRESH_AFTER_SECONDS = 60;
/** Largest refreshAfter delay we will request, in seconds. */
const MAX_REFRESH_AFTER_SECONDS = 3600;

export default async function main(ctx: EgernScriptContext): Promise<unknown> {
  const family: WidgetFamily | undefined = asWidgetFamily(ctx.widgetFamily);
  try {
    return await renderWidget(ctx, family);
  } catch {
    // Last-resort guard: a widget must never surface an exception, which would
    // show as a blank or crashed widget rather than a useful message.
    return fallbackWidget("CDT Monitor", "小组件渲染失败", "请检查模块配置后重试", family);
  }
}

async function renderWidget(
  ctx: EgernScriptContext,
  family: WidgetFamily | undefined,
): Promise<unknown> {
  const prepared = prepareRuntime(ctx, WIDGET_BUDGET_MS);
  if (!prepared.ok) {
    return fallbackWidget(
      "CDT Monitor",
      "配置有误，无法采集",
      describeIssues(prepared.issues),
      family,
    );
  }

  const runtime = prepared.runtime;
  const { config, cache, clock } = runtime;
  const now = clock.now();
  const theme = resolveTheme(config.view.theme);

  // Step 1: cache-only, no network.
  let snapshot: Snapshot | null = loadSnapshotFromCache(config, cache, now);
  const cacheIsFresh =
    snapshot !== null && isSnapshotFresh(snapshot, now, Math.max(MIN_REFRESH_AFTER_SECONDS, config.refreshSeconds));

  // Step 2: only collect when the cache cannot serve the render.
  if (!cacheIsFresh) {
    let provider;
    try {
      provider = createProvider(runtime);
    } catch {
      provider = null;
    }
    if (provider !== null) {
      const collected = await collectSnapshot({
        config,
        cache,
        provider,
        clock,
        deadlineMs: runtime.deadlineMs,
        // The widget must always fetch status; billing is a schedule concern.
        skipBilling: true,
      });
      // Prefer the fresh result, but fall back to the cache if collection
      // produced nothing usable at all.
      if (collected.snapshot.trafficScopes.length > 0) {
        snapshot = collected.snapshot;
      }
    }
  }

  // Whatever happened, render something: a snapshot built from configuration
  // identity with no observations still communicates "waiting for first read".
  const resolved: Snapshot = snapshot ?? emptySnapshot(runtime);
  const histories = collectHistories(resolved, cache, config.trafficScopes.map((scope) => scope.id));
  const model = buildViewModel({ snapshot: resolved, config, now, histories, theme });

  return renderLayout(family, {
    model,
    theme,
    refreshAfter: nextRefreshIso(now, config.refreshSeconds),
    url: consoleUrl(config),
  });
}

/** Gather cached history for the scopes being rendered. */
function collectHistories(
  snapshot: Snapshot,
  cache: ReadRuntime["cache"],
  scopeIds: readonly string[],
): Map<string, ScopeHistory> {
  const histories = new Map<string, ScopeHistory>();
  for (const scope of snapshot.trafficScopes) {
    const history = readCachedHistory(cache, scope.id);
    if (history !== null) histories.set(scope.id, history);
  }
  void scopeIds;
  return histories;
}

/** A snapshot with identity but no observations, used when nothing is cached. */
function emptySnapshot(runtime: ReadRuntime): Snapshot {
  const { config } = runtime;
  return {
    schemaVersion: 1,
    namespace: config.namespace,
    configFingerprint: config.configFingerprint,
    provider: config.mode,
    generatedAt: runtime.clock.now().toISOString(),
    accounts: config.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      balance: null,
      currency: null,
      balanceObservedAt: null,
      balanceError: null,
    })),
    trafficScopes: config.trafficScopes.map((scope) => ({
      id: scope.id,
      accountId: scope.accountId,
      trafficClass: scope.trafficClass,
      sourceScope: "",
      periodId: "unverified",
      periodTimezone: null,
      usedBytes: null,
      quotaBytes: null,
      quotaSource: scope.quota?.source ?? null,
      sourceUnit: "bytes",
      trafficObservedAt: null,
      trafficAttemptedAt: null,
      legacyUpdatedAt: null,
      trafficError: null,
      stale: true,
      freshnessQuality: "measured",
      remainingBytes: null,
      usagePercent: null,
      overThreshold: null,
      thresholdPercent: scope.thresholdPercent,
    })),
    instances: config.instances.map((instance) => ({
      id: instance.id,
      accountId: instance.accountId,
      trafficScopeId: instance.trafficScopeId,
      regionId: instance.regionId,
      instanceId: instance.instanceId,
      name: instance.name,
      status: "Unknown",
      statusObservedAt: null,
      legacyUpdatedAt: null,
      statusError: null,
      monthlyCost: null,
      currency: null,
      billingCycle: null,
      billingObservedAt: null,
      billingError: null,
      lastAction: null,
      actionRequestedAt: null,
      actionState: null,
    })),
    errors: [],
  };
}

/**
 * Compute the next `refreshAfter` instant.
 *
 * This is a *request* in the future, not a schedule: iOS decides when (and
 * whether) to honour it. It is always strictly in the future.
 */
export function nextRefreshIso(now: Date, refreshSeconds: number): string {
  const seconds = Math.min(
    MAX_REFRESH_AFTER_SECONDS,
    Math.max(MIN_REFRESH_AFTER_SECONDS, refreshSeconds),
  );
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

/** Safe deep link for tapping the widget. GET-only, carries no key or action. */
function consoleUrl(config: ReadRuntime["config"]): string | null {
  if (config.mode === "server" && config.server !== null) {
    return config.server.baseUrl;
  }
  return "https://cdt.console.aliyun.com/";
}

/**
 * A minimal, always-valid widget used for configuration and crash states.
 *
 * The family is honoured for the lock-screen variants so the text stays readable
 * there, but no layout-specific node is required to render.
 */
export function fallbackWidget(
  title: string,
  message: string,
  detail: string,
  family: WidgetFamily | undefined,
): unknown {
  if (family === "accessoryInline") {
    return { type: "widget", children: [{ type: "text", text: `${title} ${message}`, font: { size: "caption1" } }] };
  }
  const children: unknown[] = [
    { type: "text", text: title, font: { size: "headline", weight: "semibold" }, maxLines: 1 },
    { type: "text", text: message, font: { size: "subheadline", weight: "medium" }, maxLines: 2 },
  ];
  if (detail !== "") {
    children.push({ type: "text", text: detail, font: { size: "caption2" }, maxLines: 3 });
  }
  if (family === "accessoryCircular") {
    return { type: "widget", children: [{ type: "text", text: "CDT", font: { size: "caption1" } }] };
  }
  return { type: "widget", children, padding: 16, gap: 6 };
}
