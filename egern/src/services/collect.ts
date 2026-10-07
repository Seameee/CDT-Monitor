/**
 * The read-only collector.
 *
 * Composes configuration + provider + cache into one normalized `Snapshot`.
 *
 * Field-level freshness is the governing rule: a bootstrap of one field must
 * never make another look fresh. Concretely, a successful traffic read updates
 * only traffic fields; a failed status read keeps the previous status and its
 * original `statusObservedAt` while recording the error and the attempt time.
 * The original Go engine advanced a single shared `updated_at` for the whole
 * row, which is exactly the confusion this avoids.
 *
 * This module performs reads only. It has no reference to any write executor —
 * see tests/policy.test.ts and the bundle boundary check.
 */

import type {
  AccountSnapshot,
  AppConfig,
  EntityError,
  InstanceSnapshot,
  QuotaSource,
  SanitizedError,
  Snapshot,
  TrafficScopeSnapshot,
} from "../domain/models.ts";
import { computeUsage, quotaToBytes } from "../domain/usage.ts";
import type { HistorySample } from "../domain/models.ts";
import { makeSample, upsertDaily, upsertHourly } from "../domain/history.ts";
import type { Clock } from "../host/types.ts";
import type { InstanceStatusReading, RequestScope, TrafficReading } from "../providers/types.ts";
import type { ReadonlyCloudProvider } from "../providers/types.ts";
import { ProviderError } from "../providers/types.ts";
import type { Cache } from "./cache.ts";
import {
  validateAccountSnapshot,
  validateHistory,
  validateInstanceSnapshot,
  validateScopeSnapshot,
} from "./cache.ts";
import { assembleSnapshot } from "./cache.ts";

/** Default billing cache TTL. */
export const BILLING_TTL_SECONDS = 6 * 3600;

/** Default maximum concurrent network requests. */
export const MAX_CONCURRENCY = 2;

/** Convert any thrown value into a sanitized error. */
export function toSanitizedError(error: unknown, now: Date): SanitizedError {
  if (error instanceof ProviderError) return error.sanitized;
  return {
    // Never surface the original message: it may embed a URL or a body.
    code: "UnexpectedError",
    message: "采集过程中发生了未预期的错误",
    at: now.toISOString(),
    retryable: false,
  };
}

/** Run tasks with a bounded number in flight, preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length)))
    .fill(0)
    .map(async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await task(items[index] as T, index);
      }
    });
  await Promise.all(workers);
  return results;
}

/** Build the budget scope handed to providers. */
export function makeRequestScope(clock: Clock, deadlineMs: number): RequestScope {
  return {
    deadlineMs,
    remainingMs: () => Math.max(0, deadlineMs - clock.now().getTime()),
    now: () => clock.now(),
  };
}

export interface CollectOptions {
  config: AppConfig;
  cache: Cache;
  provider: ReadonlyCloudProvider;
  clock: Clock;
  /** Absolute epoch-ms deadline for this entry point. */
  deadlineMs: number;
  /** Billing TTL in seconds; defaults to six hours. */
  billingTtlSeconds?: number;
  /**
   * When true, billing is skipped even if enabled. Used by the widget path,
   * where the core CDT/ECS read must win the budget.
   */
  skipBilling?: boolean;
}

/** A freshly built scope snapshot plus the raw reading, for history. */
interface ScopeOutcome {
  snapshot: TrafficScopeSnapshot;
  reading: TrafficReading | null;
}

/** Collect a normalized snapshot. Never throws. */
export async function collectSnapshot(
  options: CollectOptions,
): Promise<{ snapshot: Snapshot; errors: EntityError[] }> {
  const { config, cache, provider, clock } = options;
  const errors: EntityError[] = [];
  const scope = makeRequestScope(clock, options.deadlineMs);
  const now = clock.now();

  // ---- traffic scopes ----------------------------------------------------
  const scopeIds = config.trafficScopes.map((item) => item.id);
  const scopeOutcomes = await mapWithConcurrency(
    config.trafficScopes,
    MAX_CONCURRENCY,
    async (scopeConfig): Promise<ScopeOutcome> => {
      const previous = cache.read(scopeConfig.id, "scope", validateScopeSnapshot);
      const configuredQuotaBytes =
        scopeConfig.quota === null
          ? null
          : quotaToBytes(scopeConfig.quota.value, scopeConfig.quota.unit);
      try {
        const reading = await provider.getTraffic(scope, {
          scope: scopeConfig,
          credential: resolveCredential(config, scopeConfig.credentialId),
        });
        // An explicit user quota always wins; only when none is configured does
        // a provider-supplied figure stand in (server mode's flow_total).
        const quotaBytes = configuredQuotaBytes ?? reading.suggestedQuotaBytes;
        const quotaSource: QuotaSource | null =
          configuredQuotaBytes !== null
            ? (scopeConfig.quota?.source ?? "user")
            : reading.suggestedQuotaSource;
        const usage = computeUsage(reading.usedBytes, quotaBytes, scopeConfig.thresholdPercent);
        return {
          snapshot: {
            id: scopeConfig.id,
            accountId: scopeConfig.accountId,
            trafficClass: scopeConfig.trafficClass,
            sourceScope: reading.regions.join(","),
            periodId: reading.periodId,
            periodTimezone: reading.periodTimezone,
            usedBytes: reading.usedBytes,
            quotaBytes,
            quotaSource,
            sourceUnit: reading.sourceUnit,
            trafficObservedAt: reading.observedAt,
            trafficAttemptedAt: now.toISOString(),
            legacyUpdatedAt: reading.legacyUpdatedAt,
            trafficError: null,
            stale: reading.partial,
            freshnessQuality: reading.freshnessQuality,
            remainingBytes: usage.remainingBytes,
            usagePercent: usage.usagePercent,
            overThreshold: usage.overThreshold,
            thresholdPercent: scopeConfig.thresholdPercent,
          },
          reading,
        };
      } catch (caught) {
        const error = toSanitizedError(caught, now);
        // Keep the previous measured value and its ORIGINAL observation time.
        // Only the attempt time and the error move forward.
        return {
          snapshot: {
            id: scopeConfig.id,
            accountId: scopeConfig.accountId,
            trafficClass: scopeConfig.trafficClass,
            sourceScope: previous?.sourceScope ?? "",
            periodId: previous?.periodId ?? "unverified",
            periodTimezone: previous?.periodTimezone ?? null,
            usedBytes: previous?.usedBytes ?? null,
            quotaBytes: configuredQuotaBytes ?? previous?.quotaBytes ?? null,
            quotaSource: scopeConfig.quota?.source ?? previous?.quotaSource ?? null,
            sourceUnit: previous?.sourceUnit ?? "bytes",
            trafficObservedAt: previous?.trafficObservedAt ?? null,
            trafficAttemptedAt: now.toISOString(),
            legacyUpdatedAt: previous?.legacyUpdatedAt ?? null,
            trafficError: error,
            stale: true,
            freshnessQuality: previous?.freshnessQuality ?? "measured",
            remainingBytes: previous?.remainingBytes ?? null,
            usagePercent: previous?.usagePercent ?? null,
            overThreshold: previous?.overThreshold ?? null,
            thresholdPercent: scopeConfig.thresholdPercent,
          },
          reading: null,
        };
      }
    },
  );

  for (const outcome of scopeOutcomes) {
    const error = outcome.snapshot.trafficError;
    if (error !== null) {
      errors.push({ ...error, entityId: outcome.snapshot.id });
    }
    // Persist one value per entity — never a whole-account transaction, because
    // `ctx.storage` documents none. A failed read still writes its merged
    // snapshot (previous values plus the error) so the next run keeps both.
    cache.write(outcome.snapshot.id, "scope", outcome.snapshot, now);
    // Record history only for a real observation.
    if (outcome.reading !== null && outcome.snapshot.usedBytes !== null) {
      recordHistory(cache, outcome.snapshot, outcome.reading, now);
    }
  }

  // ---- instances ---------------------------------------------------------
  const instanceOutcomes = await mapWithConcurrency(
    config.instances,
    MAX_CONCURRENCY,
    async (instanceConfig): Promise<InstanceSnapshot> => {
      const previous = cache.read(instanceConfig.id, "instance", validateInstanceSnapshot);
      const base: InstanceSnapshot = previous ?? {
        id: instanceConfig.id,
        accountId: instanceConfig.accountId,
        trafficScopeId: instanceConfig.trafficScopeId,
        regionId: instanceConfig.regionId,
        instanceId: instanceConfig.instanceId,
        name: instanceConfig.name,
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
      };

      let reading: InstanceStatusReading;
      try {
        reading = await provider.getInstanceStatus(scope, {
          instance: instanceConfig,
          credential: resolveCredential(config, instanceConfig.credentialId),
        });
      } catch (caught) {
        return {
          ...base,
          // Identity fields follow configuration even when the read fails.
          accountId: instanceConfig.accountId,
          trafficScopeId: instanceConfig.trafficScopeId,
          regionId: instanceConfig.regionId,
          instanceId: instanceConfig.instanceId,
          name: instanceConfig.name,
          statusError: toSanitizedError(caught, now),
          statusObservedAt: base.statusObservedAt,
          legacyUpdatedAt: base.legacyUpdatedAt,
        };
      }

      return {
        ...base,
        accountId: instanceConfig.accountId,
        trafficScopeId: instanceConfig.trafficScopeId,
        regionId: instanceConfig.regionId,
        instanceId: instanceConfig.instanceId,
        name: instanceConfig.name,
        status: reading.status,
        // Only a successful read advances the observation time; the v1 server
        // provider returns null here on purpose.
        statusObservedAt: reading.observedAt ?? base.statusObservedAt,
        legacyUpdatedAt: reading.legacyUpdatedAt ?? base.legacyUpdatedAt,
        statusError: null,
      };
    },
  );

  for (const instance of instanceOutcomes) {
    if (instance.statusError !== null) {
      errors.push({ ...instance.statusError, entityId: instance.id });
    }
  }

  // ---- accounts (billing, optional) --------------------------------------
  const accountSnapshots: AccountSnapshot[] = [];
  for (const account of config.accounts) {
    const previous = cache.read(account.id, "account", validateAccountSnapshot);
    const base: AccountSnapshot = previous ?? {
      id: account.id,
      name: account.name,
      balance: null,
      currency: null,
      balanceObservedAt: null,
      balanceError: null,
    };

    const shouldFetch = config.billingEnabled && options.skipBilling !== true && billingDue(base, now, options.billingTtlSeconds ?? BILLING_TTL_SECONDS);
    if (!shouldFetch || scope.remainingMs() <= 0) {
      accountSnapshots.push({ ...base, name: account.name });
      continue;
    }

    const credential = config.credentials.find((item) => item.accountId === account.id);
    if (credential === undefined) {
      accountSnapshots.push({ ...base, name: account.name });
      continue;
    }

    try {
      const reading = await provider.getBalance(scope, { account, credential });
      accountSnapshots.push({
        ...base,
        name: account.name,
        balance: reading.amount,
        currency: reading.currency,
        balanceObservedAt: reading.observedAt,
        balanceError: null,
      });
    } catch (caught) {
      const error = toSanitizedError(caught, now);
      errors.push({ ...error, entityId: account.id });
      accountSnapshots.push({ ...base, name: account.name, balanceError: error });
    }
  }

  // ---- instance billing (optional) ---------------------------------------
  const finalInstances: InstanceSnapshot[] = [];
  for (const instance of instanceOutcomes) {
    const configInstance = config.instances.find((item) => item.id === instance.id);
    if (
      configInstance === undefined ||
      !config.billingEnabled ||
      options.skipBilling === true ||
      configInstance.instanceId === "" ||
      scope.remainingMs() <= 0
    ) {
      finalInstances.push(instance);
      continue;
    }
    const cycle = billingCycleFor(clock.now());
    if (!billingDue(instance, now, options.billingTtlSeconds ?? BILLING_TTL_SECONDS, cycle)) {
      finalInstances.push(instance);
      continue;
    }
    try {
      const reading = await provider.getInstanceBill(
        scope,
        {
          instance: configInstance,
          credential: resolveCredential(config, configInstance.credentialId),
        },
        cycle,
      );
      finalInstances.push({
        ...instance,
        monthlyCost: reading.totalCost,
        currency: reading.currency ?? instance.currency,
        billingCycle: reading.cycle,
        billingObservedAt: reading.observedAt,
        billingError: null,
      });
    } catch (caught) {
      const error = toSanitizedError(caught, now);
      errors.push({ ...error, entityId: instance.id });
      finalInstances.push({ ...instance, billingError: error });
    }
  }

  // Persist each instance snapshot (identity follows configuration; values and
  // errors come from this run).
  for (const instance of finalInstances) {
    cache.write(instance.id, "instance", instance, now);
  }
  for (const account of accountSnapshots) {
    cache.write(account.id, "account", account, now);
  }

  const snapshot = assembleSnapshot({
    namespace: config.namespace,
    fingerprint: config.configFingerprint,
    provider: provider.mode,
    generatedAt: now.toISOString(),
    accounts: accountSnapshots,
    scopes: scopeOutcomes.map((outcome) => outcome.snapshot),
    instances: finalInstances,
    errors,
  });

  void scopeIds;
  return { snapshot, errors };
}

/** Resolve a credential by id, failing loudly rather than guessing. */
function resolveCredential(config: AppConfig, credentialId: string) {
  const credential = config.credentials.find((item) => item.id === credentialId);
  if (credential === undefined) {
    throw new ProviderError({
      code: "MissingCredential",
      message: `配置引用了不存在的凭据 ${credentialId}`,
      at: new Date(0).toISOString(),
      retryable: false,
    });
  }
  return credential;
}

/** Whether a balance/bill cache entry is due for a refresh. */
export function billingDue(
  snapshot: {
    balanceObservedAt?: string | null;
    billingObservedAt?: string | null;
    billingCycle?: string | null;
  },
  now: Date,
  ttlSeconds: number,
  cycle?: string,
): boolean {
  const stamp = snapshot.balanceObservedAt ?? snapshot.billingObservedAt ?? null;
  if (stamp === null) return true;
  const parsed = Date.parse(stamp);
  if (!Number.isFinite(parsed)) return true;
  if (billingCycleMismatch(snapshot.billingCycle, cycle)) return true;
  return (now.getTime() - parsed) / 1000 >= ttlSeconds;
}

/** A new billing cycle invalidates a cached amount regardless of its age. */
function billingCycleMismatch(
  stored: string | null | undefined,
  cycle: string | undefined,
): boolean {
  if (cycle === undefined) return false;
  if (stored === undefined || stored === null) return false;
  return stored !== cycle;
}

/** Billing cycle label (`YYYY-MM`) in the business timezone. */
export function billingCycleFor(now: Date, timeZone?: { partsAt(d: Date): { year: number; month: number } }): string {
  if (timeZone === undefined) {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const parts = timeZone.partsAt(now);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

/** Append a successful reading to the scope's history series. */
function recordHistory(
  cache: Cache,
  scopeSnapshot: TrafficScopeSnapshot,
  reading: TrafficReading,
  now: Date,
): void {
  if (scopeSnapshot.usedBytes === null) return;
  const existing = cache.read(scopeSnapshot.id, "history", validateHistory) ?? {
    scopeId: scopeSnapshot.id,
    hourly: [],
    daily: [],
  };

  const base = {
    instant: now,
    bytes: scopeSnapshot.usedBytes,
    source: reading.sourceUnit === "bytes" ? ("direct" as const) : ("server" as const),
    periodId: reading.periodId,
    quality: reading.freshnessQuality,
  };
  const hourlySample: HistorySample = makeSample({ ...base, granularity: "hour" });
  const dailySample: HistorySample = makeSample({ ...base, granularity: "day" });

  cache.write(
    scopeSnapshot.id,
    "history",
    {
      scopeId: scopeSnapshot.id,
      hourly: upsertHourly(existing.hourly, hourlySample),
      daily: upsertDaily(existing.daily, dailySample),
    },
    now,
  );
}
