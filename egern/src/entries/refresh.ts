/**
 * `cdt-refresh` — schedule entry point. Read-only collection plus explicitly
 * enabled notifications.
 *
 * It never starts or stops an instance and never touches the control executor;
 * instance actions belong solely to the `automation` and `control` entries.
 *
 * It also never *assumes* that the widget can see what it writes. The contract's
 * default assumption is that storage sharing is unproven, so if a widget cannot
 * read these values it simply performs its own read. Nothing here is a
 * correctness dependency for rendering.
 */

import type { EgernScriptContext } from "../host/types.ts";
import { collectSnapshot } from "../services/collect.ts";
import type { Snapshot } from "../domain/models.ts";
import {
  buildDailyReportEvent,
  buildRecoveredEvent,
  buildThresholdEvent,
  dispatchNotification,
} from "../services/notifications.ts";
import { knownCacheKeys, enforceBudget } from "../services/cache.ts";
import { dueWithinMinutes, parseClockTime, scheduleCycleDate } from "../domain/schedule.ts";
import { createTimeZoneProvider } from "../domain/timezone.ts";
import {
  REFRESH_BUDGET_MS,
  createProvider,
  prepareRuntime,
} from "./runtime.ts";
import type { ReadRuntime } from "./runtime.ts";

export default async function main(ctx: EgernScriptContext): Promise<void> {
  const prepared = prepareRuntime(ctx, REFRESH_BUDGET_MS);
  if (!prepared.ok) {
    // A schedule run has no UI. It must fail silently and safely.
    return;
  }
  const runtime = prepared.runtime;
  const { config, cache, clock, http, notifier } = runtime;
  const now = clock.now();

  const provider = createProvider(runtime);
  const { snapshot } = await collectSnapshot({
    config,
    cache,
    provider,
    clock,
    deadlineMs: runtime.deadlineMs,
    skipBilling: false,
  });

  // Threshold and recovery notifications are opt-in; the widget never sends.
  if (config.localNotify || config.notifications.telegram.enabled || config.notifications.webhook.enabled) {
    const deps = { http, notifier, cache, requestTimeoutMs: 6000 };
    for (const scope of snapshot.trafficScopes) {
      if (scope.overThreshold === true && scope.trafficError === null) {
        await dispatchNotification(deps, buildThresholdEvent(scope, now), config.notifications, now);
      } else if (scope.overThreshold === false && scope.trafficError === null) {
        await dispatchNotification(deps, buildRecoveredEvent(scope, now), config.notifications, now);
      }
    }
  }

  if (config.notifications.dailyReport.enabled) {
    await maybeSendDailyReport(snapshot, runtime, now);
  }

  // Keep the cache inside its byte budget. History and alert entries are the
  // most expendable, so they are trimmed first.
  const keys = knownCacheKeys({
    namespace: config.namespace,
    provider: config.mode,
    scopeIds: config.trafficScopes.map((scope) => scope.id),
    instanceIds: config.instances.map((instance) => instance.id),
    accountIds: config.accounts.map((account) => account.id),
  });
  enforceBudget(cache, keys);
}

/** Send the daily report when the configured window is currently due. */
async function maybeSendDailyReport(
  snapshot: Snapshot,
  runtime: ReadRuntime,
  now: Date,
): Promise<void> {
  const config = runtime.config;
  const timeZone = createTimeZoneProvider(config.timezone);
  if (!timeZone.isReliable()) {
    // Without a trustworthy timezone the report could cover the wrong window,
    // so it is skipped rather than sent with a guessed boundary.
    return;
  }
  const target = parseClockTime(config.notifications.dailyReport.time);
  if (target === null) return;

  const parts = timeZone.partsAt(now);
  const window = config.notifications.dailyReport.compensationWindowMinutes;
  if (!dueWithinMinutes(parts.minuteOfDay, target.minutes, window)) return;

  // The window is anchored to the cycle date so a delayed retry reports the same
  // period rather than silently shifting to the next day.
  const cycleDate = scheduleCycleDate(parts, target.minutes, target.minutes);
  const windowNote = `${config.notifications.dailyReport.time} 窗口`;
  const event = buildDailyReportEvent(snapshot, config, cycleDate, windowNote, now);

  await dispatchNotification(
    { http: runtime.http, notifier: runtime.notifier, cache: runtime.cache, requestTimeoutMs: 6000 },
    event,
    config.notifications,
    now,
  );
}
