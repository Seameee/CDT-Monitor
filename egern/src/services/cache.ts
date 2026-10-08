/**
 * Cache layer over `ctx.storage`.
 *
 * Egern documents `get/set/getJSON/setJSON/delete` and nothing else: no
 * transactions, no compare-and-swap, no TTL, no locking and **no enumeration**.
 * So this module never pretends otherwise:
 *
 *  - One JSON value per entity; a whole-account transaction is never claimed.
 *  - All keys are *derivable from configuration*, because we cannot list the
 *    store. Budget enforcement therefore walks the known key set rather than
 *    scanning.
 *  - Reads validate schema version, namespace, provider and config fingerprint.
 *    A value written under a different identity is discarded, which is what
 *    stops a changed credential or instance from inheriting stale numbers.
 *  - Corrupt entries are ignored (and optionally kept as diagnostics) so a bad
 *    cache can never produce a blank widget.
 *  - Nothing secret is ever written: the fingerprint deliberately excludes
 *    secrets, so an AccessKeySecret can never reach a storage key or value.
 */

import type {
  AccountSnapshot,
  FreshnessQuality,
  InstanceSnapshot,
  ProviderMode,
  SanitizedError,
  ScopeHistory,
  Snapshot,
  TrafficScopeSnapshot,
} from "../domain/models.ts";
import { SNAPSHOT_SCHEMA_VERSION } from "../domain/models.ts";
import type { KeyValueStore } from "../host/types.ts";

/** Cache key version. Bump only with a migration path. */
export const CACHE_VERSION = "v1";

/** Cache entry kinds. */
export type CacheKind =
  | "scope"
  | "instance"
  | "account"
  | "history"
  | "alert"
  | "action-intent"
  | "intent-consumed"
  /** Summary of the most recent automation run, for user-visible diagnostics. */
  | "run-log";

/**
 * Engineering budget for the whole namespace.
 *
 * This is this project's own budget, not a documented platform limit.
 */
export const CACHE_BUDGET_BYTES = 256 * 1024;

/** Versioned envelope wrapping every cached value. */
interface Envelope<T> {
  /** Envelope version, independent of the payload's own schemaVersion. */
  cacheVersion: 1;
  namespace: string;
  provider: ProviderMode;
  /** Identity fingerprint the value was written under. */
  fingerprint: string;
  /** When the value was written (ISO 8601). */
  writtenAt: string;
  data: T;
}

/**
 * Build a cache key.
 *
 * The documented recommendation is
 * `cdt:egern:<version>:<namespace>:<provider>:<entityId>:<kind>`. No secret,
 * token or full AccessKey ever appears in a key.
 */
export function cacheKey(
  namespace: string,
  provider: ProviderMode,
  entityId: string,
  kind: CacheKind,
): string {
  return `cdt:egern:${CACHE_VERSION}:${namespace}:${provider}:${entityId}:${kind}`;
}

/** Sanitize an entity id for use inside a storage key. */
function safeEntityId(entityId: string): string {
  return entityId.replace(/[^A-Za-z0-9._:-]/g, "_");
}

function isFiniteOrNull(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function sanitizedErrorOrNull(value: unknown): SanitizedError | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record["code"] !== "string" || typeof record["message"] !== "string") return null;
  return {
    code: record["code"],
    message: record["message"],
    at: typeof record["at"] === "string" ? record["at"] : new Date(0).toISOString(),
    retryable: record["retryable"] === true,
  };
}

function isoOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Validate a cached traffic scope; returns null when unusable. */
export function validateScopeSnapshot(value: unknown): TrafficScopeSnapshot | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record["id"] !== "string" || typeof record["accountId"] !== "string") return null;
  if (record["trafficClass"] !== "mainland" && record["trafficClass"] !== "overseas") return null;
  if (!isFiniteOrNull(record["usedBytes"])) return null;
  if (!isFiniteOrNull(record["quotaBytes"])) return null;
  if (!isFiniteOrNull(record["usagePercent"])) return null;
  if (!isFiniteOrNull(record["remainingBytes"])) return null;
  const overThreshold = record["overThreshold"];
  if (overThreshold !== null && typeof overThreshold !== "boolean") return null;
  const sourceUnit = record["sourceUnit"];
  if (sourceUnit !== "bytes" && sourceUnit !== "legacyGiB") return null;
  const quality = record["freshnessQuality"];
  if (quality !== "measured" && quality !== "legacy-unverified") return null;
  const thresholdPercent = record["thresholdPercent"];
  if (typeof thresholdPercent !== "number" || !Number.isFinite(thresholdPercent)) return null;

  return {
    id: record["id"],
    accountId: record["accountId"],
    trafficClass: record["trafficClass"],
    sourceScope: typeof record["sourceScope"] === "string" ? record["sourceScope"] : "",
    periodId: typeof record["periodId"] === "string" ? record["periodId"] : "unverified",
    periodTimezone: isoOrNull(record["periodTimezone"]),
    usedBytes: (record["usedBytes"] as number | null) ?? null,
    quotaBytes: (record["quotaBytes"] as number | null) ?? null,
    quotaSource:
      record["quotaSource"] === "user" || record["quotaSource"] === "legacy"
        ? record["quotaSource"]
        : null,
    sourceUnit,
    trafficObservedAt: isoOrNull(record["trafficObservedAt"]),
    trafficAttemptedAt: isoOrNull(record["trafficAttemptedAt"]),
    legacyUpdatedAt: isoOrNull(record["legacyUpdatedAt"]),
    trafficError: sanitizedErrorOrNull(record["trafficError"]),
    stale: record["stale"] === true,
    freshnessQuality: quality as FreshnessQuality,
    remainingBytes: (record["remainingBytes"] as number | null) ?? null,
    usagePercent: (record["usagePercent"] as number | null) ?? null,
    overThreshold: (overThreshold as boolean | null) ?? null,
    thresholdPercent,
  };
}

const KNOWN_INSTANCE_STATUSES = new Set([
  "Pending",
  "Starting",
  "Running",
  "Stopping",
  "Stopped",
  "Unknown",
]);

/** Validate a cached instance snapshot; returns null when unusable. */
export function validateInstanceSnapshot(value: unknown): InstanceSnapshot | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record["id"] !== "string") return null;
  if (typeof record["status"] !== "string" || !KNOWN_INSTANCE_STATUSES.has(record["status"])) {
    return null;
  }
  if (!isFiniteOrNull(record["monthlyCost"])) return null;
  const actionState = record["actionState"];
  if (
    actionState !== null &&
    actionState !== "pending" &&
    actionState !== "accepted" &&
    actionState !== "confirmed" &&
    actionState !== "uncertain" &&
    actionState !== "failed"
  ) {
    return null;
  }

  return {
    id: record["id"],
    accountId: typeof record["accountId"] === "string" ? record["accountId"] : "",
    trafficScopeId: typeof record["trafficScopeId"] === "string" ? record["trafficScopeId"] : "",
    regionId: typeof record["regionId"] === "string" ? record["regionId"] : "",
    instanceId: typeof record["instanceId"] === "string" ? record["instanceId"] : "",
    name: typeof record["name"] === "string" ? record["name"] : String(record["id"]),
    status: record["status"] as InstanceSnapshot["status"],
    statusObservedAt: isoOrNull(record["statusObservedAt"]),
    legacyUpdatedAt: isoOrNull(record["legacyUpdatedAt"]),
    statusError: sanitizedErrorOrNull(record["statusError"]),
    monthlyCost: (record["monthlyCost"] as number | null) ?? null,
    currency: isoOrNull(record["currency"]),
    billingCycle: isoOrNull(record["billingCycle"]),
    billingObservedAt: isoOrNull(record["billingObservedAt"]),
    billingError: sanitizedErrorOrNull(record["billingError"]),
    lastAction: isoOrNull(record["lastAction"]),
    actionRequestedAt: isoOrNull(record["actionRequestedAt"]),
    actionState: (actionState as InstanceSnapshot["actionState"]) ?? null,
  };
}

/** Validate a cached account snapshot. */
export function validateAccountSnapshot(value: unknown): AccountSnapshot | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record["id"] !== "string") return null;
  if (!isFiniteOrNull(record["balance"])) return null;
  return {
    id: record["id"],
    name: typeof record["name"] === "string" ? record["name"] : String(record["id"]),
    balance: (record["balance"] as number | null) ?? null,
    currency: isoOrNull(record["currency"]),
    balanceObservedAt: isoOrNull(record["balanceObservedAt"]),
    balanceError: sanitizedErrorOrNull(record["balanceError"]),
  };
}

/** Validate a cached history series. */
export function validateHistory(value: unknown): ScopeHistory | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record["scopeId"] !== "string") return null;
  const readSeries = (raw: unknown): ScopeHistory["hourly"] | null => {
    if (!Array.isArray(raw)) return null;
    const samples: ScopeHistory["hourly"] = [];
    for (const entry of raw) {
      if (entry === null || typeof entry !== "object") return null;
      const sample = entry as Record<string, unknown>;
      if (typeof sample["bucket"] !== "string" || typeof sample["observedAt"] !== "string") return null;
      if (typeof sample["bytes"] !== "number" || !Number.isFinite(sample["bytes"])) return null;
      if (sample["source"] !== "direct" && sample["source"] !== "server") return null;
      if (sample["quality"] !== "measured" && sample["quality"] !== "legacy-unverified") return null;
      samples.push({
        bucket: sample["bucket"],
        observedAt: sample["observedAt"],
        bytes: sample["bytes"],
        source: sample["source"],
        periodId: typeof sample["periodId"] === "string" ? sample["periodId"] : "unverified",
        quality: sample["quality"],
      });
    }
    return samples;
  };
  const hourly = readSeries(record["hourly"]);
  const daily = readSeries(record["daily"]);
  if (hourly === null || daily === null) return null;
  return { scopeId: record["scopeId"], hourly, daily };
}

export interface CacheOptions {
  store: KeyValueStore;
  namespace: string;
  provider: ProviderMode;
  fingerprint: string;
}

/**
 * Typed, identity-checked cache access.
 *
 * Every read verifies the envelope's namespace, provider and fingerprint; a
 * mismatch is treated as a miss, so stale data from another identity can never
 * be rendered as current.
 */
export class Cache {
  private readonly options: CacheOptions;

  constructor(options: CacheOptions) {
    this.options = options;
  }

  private keyFor(entityId: string, kind: CacheKind): string {
    return cacheKey(
      this.options.namespace,
      this.options.provider,
      safeEntityId(entityId),
      kind,
    );
  }

  /**
   * Read and validate one cached value.
   *
   * Returns null for: absent, unparseable JSON, wrong envelope version, mismatched
   * identity, or a payload that fails its own validator. Never throws.
   */
  read<T>(entityId: string, kind: CacheKind, validate: (value: unknown) => T | null): T | null {
    let raw: unknown;
    try {
      raw = this.options.store.getJSON(this.keyFor(entityId, kind));
    } catch {
      return null;
    }
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== "object") return null;
    const envelope = raw as Record<string, unknown>;
    if (envelope["cacheVersion"] !== 1) return null;
    if (envelope["namespace"] !== this.options.namespace) return null;
    if (envelope["provider"] !== this.options.provider) return null;
    // Identity changed (credential/region/instance/scope) → do not reuse.
    if (envelope["fingerprint"] !== this.options.fingerprint) return null;
    try {
      return validate(envelope["data"]);
    } catch {
      return null;
    }
  }

  /** Write one cached value. Returns the encoded size in bytes, or null. */
  write(entityId: string, kind: CacheKind, data: unknown, now: Date): number | null {
    const envelope: Envelope<unknown> = {
      cacheVersion: 1,
      namespace: this.options.namespace,
      provider: this.options.provider,
      fingerprint: this.options.fingerprint,
      writtenAt: now.toISOString(),
      data,
    };
    let encoded: string;
    try {
      encoded = JSON.stringify(envelope);
    } catch {
      return null;
    }
    try {
      this.options.store.set(this.keyFor(entityId, kind), encoded);
    } catch {
      return null;
    }
    // Approximate size: JSON is UTF-8 here in practice, and an over-estimate is
    // the safe direction for a budget.
    return encoded.length;
  }

  /** Remove one cached value. */
  remove(entityId: string, kind: CacheKind): void {
    try {
      this.options.store.delete(this.keyFor(entityId, kind));
    } catch {
      // A failed delete must not break rendering.
    }
  }

  /** Raw text length of a cached value, for budget accounting. */
  sizeOf(entityId: string, kind: CacheKind): number {
    try {
      const raw = this.options.store.get(this.keyFor(entityId, kind));
      return raw === null ? 0 : raw.length;
    } catch {
      return 0;
    }
  }

  /** Key used for an entity/kind, exposed for diagnostics and tests. */
  keyOf(entityId: string, kind: CacheKind): string {
    return this.keyFor(entityId, kind);
  }
}

/**
 * Every key this configuration can own.
 *
 * Built from the config because the store cannot be enumerated. `history` and
 * `alert` entries are listed last so budget trimming discards them first and
 * keeps the most recent snapshot.
 */
export function knownCacheKeys(options: {
  namespace: string;
  provider: ProviderMode;
  scopeIds: readonly string[];
  instanceIds: readonly string[];
  accountIds: readonly string[];
}): Array<{ entityId: string; kind: CacheKind }> {
  const keys: Array<{ entityId: string; kind: CacheKind }> = [];
  for (const scopeId of options.scopeIds) {
    keys.push({ entityId: scopeId, kind: "scope" });
  }
  for (const instanceId of options.instanceIds) {
    keys.push({ entityId: instanceId, kind: "instance" });
  }
  for (const accountId of options.accountIds) {
    keys.push({ entityId: accountId, kind: "account" });
  }
  // History and alert state are the cheapest things to lose.
  for (const scopeId of options.scopeIds) {
    keys.push({ entityId: scopeId, kind: "history" });
    keys.push({ entityId: scopeId, kind: "alert" });
  }
  return keys;
}

/**
 * Trim the cache down to the byte budget.
 *
 * `keys` is ordered with the most expendable entries last, so this walks it in
 * reverse and deletes until the total fits. Returns the number of entries
 * removed.
 */
export function enforceBudget(
  cache: Cache,
  keys: ReadonlyArray<{ entityId: string; kind: CacheKind }>,
  budgetBytes = CACHE_BUDGET_BYTES,
): number {
  let total = 0;
  const sizes = keys.map((entry) => {
    const size = cache.sizeOf(entry.entityId, entry.kind);
    total += size;
    return size;
  });
  let removed = 0;
  for (let index = keys.length - 1; index >= 0 && total > budgetBytes; index--) {
    const size = sizes[index] as number;
    if (size === 0) continue;
    const entry = keys[index] as { entityId: string; kind: CacheKind };
    cache.remove(entry.entityId, entry.kind);
    total -= size;
    removed++;
  }
  return removed;
}

/** Assemble a snapshot from per-entity values, dropping nothing silently. */
export function assembleSnapshot(input: {
  namespace: string;
  fingerprint: string;
  provider: ProviderMode;
  generatedAt: string;
  accounts: AccountSnapshot[];
  scopes: TrafficScopeSnapshot[];
  instances: InstanceSnapshot[];
  errors: Snapshot["errors"];
}): Snapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    namespace: input.namespace,
    configFingerprint: input.fingerprint,
    provider: input.provider,
    generatedAt: input.generatedAt,
    accounts: input.accounts,
    trafficScopes: input.scopes,
    instances: input.instances,
    errors: input.errors,
  };
}

/**
 * Rebuild a snapshot purely from cache, with no network access.
 *
 * This is the widget's first step. If it returns a snapshot whose traffic
 * observation is still within the configured TTL, the widget renders without a
 * network call at all — which matters because a widget's execution budget is
 * both small and unpredictable.
 *
 * Returns null when nothing usable is cached. Entity identity always comes from
 * configuration, so a cache hit can never resurrect a removed scope or instance.
 */
export function loadSnapshotFromCache(
  config: {
    namespace: string;
    configFingerprint: string;
    mode: ProviderMode;
    accounts: ReadonlyArray<{ id: string; name: string }>;
    trafficScopes: ReadonlyArray<{ id: string }>;
    instances: ReadonlyArray<{ id: string; name: string }>;
  },
  cache: Cache,
  now: Date,
): Snapshot | null {
  let hits = 0;

  const scopes: TrafficScopeSnapshot[] = [];
  for (const scopeConfig of config.trafficScopes) {
    const cached = cache.read(scopeConfig.id, "scope", validateScopeSnapshot);
    if (cached === null) continue;
    hits++;
    scopes.push(cached);
  }

  const instances: InstanceSnapshot[] = [];
  for (const instanceConfig of config.instances) {
    const cached = cache.read(instanceConfig.id, "instance", validateInstanceSnapshot);
    if (cached === null) continue;
    hits++;
    // Identity fields follow configuration, never the cache.
    instances.push({ ...cached, name: instanceConfig.name });
  }

  const accounts: AccountSnapshot[] = [];
  for (const accountConfig of config.accounts) {
    const cached = cache.read(accountConfig.id, "account", validateAccountSnapshot);
    if (cached === null) continue;
    hits++;
    accounts.push({ ...cached, name: accountConfig.name });
  }

  if (hits === 0) return null;

  return assembleSnapshot({
    namespace: config.namespace,
    fingerprint: config.configFingerprint,
    provider: config.mode,
    generatedAt: now.toISOString(),
    accounts,
    scopes,
    instances,
    // Cached snapshots carry no fresh error list; per-entity errors ride on the
    // entity itself so a failed field is still visible.
    errors: [],
  });
}

/** Read a scope's cached history, or null. */
export function readCachedHistory(cache: Cache, scopeId: string): ScopeHistory | null {
  return cache.read(scopeId, "history", validateHistory);
}

/** Whether a snapshot has a traffic observation newer than `maxAgeSeconds`. */
export function isSnapshotFresh(
  snapshot: Snapshot,
  now: Date,
  maxAgeSeconds: number,
): boolean {
  let newest = Number.NEGATIVE_INFINITY;
  for (const scope of snapshot.trafficScopes) {
    if (scope.trafficObservedAt === null) continue;
    const parsed = Date.parse(scope.trafficObservedAt);
    if (Number.isFinite(parsed) && parsed > newest) newest = parsed;
  }
  if (newest === Number.NEGATIVE_INFINITY) return false;
  return (now.getTime() - newest) / 1000 < maxAgeSeconds;
}
