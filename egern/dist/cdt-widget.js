var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/host/types.ts
var WIDGET_FAMILIES = [
  "systemSmall",
  "systemMedium",
  "systemLarge",
  "systemExtraLarge",
  "accessoryCircular",
  "accessoryRectangular",
  "accessoryInline"
];
function asWidgetFamily(value) {
  if (value === void 0) return void 0;
  return WIDGET_FAMILIES.includes(value) ? value : void 0;
}

// src/domain/models.ts
var UNVERIFIED_PERIOD = "unverified";
function unverifiedDevice() {
  return {
    crossExecutionIntentClaim: false,
    hostSerializesSameTarget: false,
    verifiedAt: null,
    note: null
  };
}
var SNAPSHOT_SCHEMA_VERSION = 1;
var MAX_HOURLY_SAMPLES = 48;
var MAX_DAILY_SAMPLES = 35;

// src/services/cache.ts
var CACHE_VERSION = "v1";
var CACHE_BUDGET_BYTES = 256 * 1024;
function cacheKey(namespace, provider, entityId, kind) {
  return `cdt:egern:${CACHE_VERSION}:${namespace}:${provider}:${entityId}:${kind}`;
}
function safeEntityId(entityId) {
  return entityId.replace(/[^A-Za-z0-9._:-]/g, "_");
}
function isFiniteOrNull(value) {
  return value === null || typeof value === "number" && Number.isFinite(value);
}
function sanitizedErrorOrNull(value) {
  if (value === null || value === void 0) return null;
  if (typeof value !== "object") return null;
  const record = value;
  if (typeof record["code"] !== "string" || typeof record["message"] !== "string") return null;
  return {
    code: record["code"],
    message: record["message"],
    at: typeof record["at"] === "string" ? record["at"] : (/* @__PURE__ */ new Date(0)).toISOString(),
    retryable: record["retryable"] === true
  };
}
function isoOrNull(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function validateScopeSnapshot(value) {
  if (value === null || typeof value !== "object") return null;
  const record = value;
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
    usedBytes: record["usedBytes"] ?? null,
    quotaBytes: record["quotaBytes"] ?? null,
    quotaSource: record["quotaSource"] === "user" || record["quotaSource"] === "legacy" ? record["quotaSource"] : null,
    sourceUnit,
    trafficObservedAt: isoOrNull(record["trafficObservedAt"]),
    trafficAttemptedAt: isoOrNull(record["trafficAttemptedAt"]),
    legacyUpdatedAt: isoOrNull(record["legacyUpdatedAt"]),
    trafficError: sanitizedErrorOrNull(record["trafficError"]),
    stale: record["stale"] === true,
    freshnessQuality: quality,
    remainingBytes: record["remainingBytes"] ?? null,
    usagePercent: record["usagePercent"] ?? null,
    overThreshold: overThreshold ?? null,
    thresholdPercent
  };
}
var KNOWN_INSTANCE_STATUSES = /* @__PURE__ */ new Set([
  "Pending",
  "Starting",
  "Running",
  "Stopping",
  "Stopped",
  "Unknown"
]);
function validateInstanceSnapshot(value) {
  if (value === null || typeof value !== "object") return null;
  const record = value;
  if (typeof record["id"] !== "string") return null;
  if (typeof record["status"] !== "string" || !KNOWN_INSTANCE_STATUSES.has(record["status"])) {
    return null;
  }
  if (!isFiniteOrNull(record["monthlyCost"])) return null;
  const actionState = record["actionState"];
  if (actionState !== null && actionState !== "pending" && actionState !== "accepted" && actionState !== "confirmed" && actionState !== "uncertain" && actionState !== "failed") {
    return null;
  }
  return {
    id: record["id"],
    accountId: typeof record["accountId"] === "string" ? record["accountId"] : "",
    trafficScopeId: typeof record["trafficScopeId"] === "string" ? record["trafficScopeId"] : "",
    regionId: typeof record["regionId"] === "string" ? record["regionId"] : "",
    instanceId: typeof record["instanceId"] === "string" ? record["instanceId"] : "",
    name: typeof record["name"] === "string" ? record["name"] : String(record["id"]),
    status: record["status"],
    statusObservedAt: isoOrNull(record["statusObservedAt"]),
    legacyUpdatedAt: isoOrNull(record["legacyUpdatedAt"]),
    statusError: sanitizedErrorOrNull(record["statusError"]),
    monthlyCost: record["monthlyCost"] ?? null,
    currency: isoOrNull(record["currency"]),
    billingCycle: isoOrNull(record["billingCycle"]),
    billingObservedAt: isoOrNull(record["billingObservedAt"]),
    billingError: sanitizedErrorOrNull(record["billingError"]),
    lastAction: isoOrNull(record["lastAction"]),
    actionRequestedAt: isoOrNull(record["actionRequestedAt"]),
    actionState: actionState ?? null
  };
}
function validateAccountSnapshot(value) {
  if (value === null || typeof value !== "object") return null;
  const record = value;
  if (typeof record["id"] !== "string") return null;
  if (!isFiniteOrNull(record["balance"])) return null;
  return {
    id: record["id"],
    name: typeof record["name"] === "string" ? record["name"] : String(record["id"]),
    balance: record["balance"] ?? null,
    currency: isoOrNull(record["currency"]),
    balanceObservedAt: isoOrNull(record["balanceObservedAt"]),
    balanceError: sanitizedErrorOrNull(record["balanceError"])
  };
}
function validateHistory(value) {
  if (value === null || typeof value !== "object") return null;
  const record = value;
  if (typeof record["scopeId"] !== "string") return null;
  const readSeries = (raw) => {
    if (!Array.isArray(raw)) return null;
    const samples = [];
    for (const entry of raw) {
      if (entry === null || typeof entry !== "object") return null;
      const sample = entry;
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
        quality: sample["quality"]
      });
    }
    return samples;
  };
  const hourly = readSeries(record["hourly"]);
  const daily = readSeries(record["daily"]);
  if (hourly === null || daily === null) return null;
  return { scopeId: record["scopeId"], hourly, daily };
}
var Cache = class {
  constructor(options) {
    __publicField(this, "options");
    this.options = options;
  }
  keyFor(entityId, kind) {
    return cacheKey(
      this.options.namespace,
      this.options.provider,
      safeEntityId(entityId),
      kind
    );
  }
  /**
   * Read and validate one cached value.
   *
   * Returns null for: absent, unparseable JSON, wrong envelope version, mismatched
   * identity, or a payload that fails its own validator. Never throws.
   */
  read(entityId, kind, validate) {
    let raw;
    try {
      raw = this.options.store.getJSON(this.keyFor(entityId, kind));
    } catch {
      return null;
    }
    if (raw === null || raw === void 0) return null;
    if (typeof raw !== "object") return null;
    const envelope = raw;
    if (envelope["cacheVersion"] !== 1) return null;
    if (envelope["namespace"] !== this.options.namespace) return null;
    if (envelope["provider"] !== this.options.provider) return null;
    if (envelope["fingerprint"] !== this.options.fingerprint) return null;
    try {
      return validate(envelope["data"]);
    } catch {
      return null;
    }
  }
  /** Write one cached value. Returns the encoded size in bytes, or null. */
  write(entityId, kind, data, now) {
    const envelope = {
      cacheVersion: 1,
      namespace: this.options.namespace,
      provider: this.options.provider,
      fingerprint: this.options.fingerprint,
      writtenAt: now.toISOString(),
      data
    };
    let encoded;
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
    return encoded.length;
  }
  /** Remove one cached value. */
  remove(entityId, kind) {
    try {
      this.options.store.delete(this.keyFor(entityId, kind));
    } catch {
    }
  }
  /** Raw text length of a cached value, for budget accounting. */
  sizeOf(entityId, kind) {
    try {
      const raw = this.options.store.get(this.keyFor(entityId, kind));
      return raw === null ? 0 : raw.length;
    } catch {
      return 0;
    }
  }
  /** Key used for an entity/kind, exposed for diagnostics and tests. */
  keyOf(entityId, kind) {
    return this.keyFor(entityId, kind);
  }
};
function assembleSnapshot(input) {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    namespace: input.namespace,
    configFingerprint: input.fingerprint,
    provider: input.provider,
    generatedAt: input.generatedAt,
    accounts: input.accounts,
    trafficScopes: input.scopes,
    instances: input.instances,
    errors: input.errors
  };
}
function loadSnapshotFromCache(config, cache, now) {
  let hits = 0;
  const scopes = [];
  for (const scopeConfig of config.trafficScopes) {
    const cached = cache.read(scopeConfig.id, "scope", validateScopeSnapshot);
    if (cached === null) continue;
    hits++;
    scopes.push(cached);
  }
  const instances = [];
  for (const instanceConfig of config.instances) {
    const cached = cache.read(instanceConfig.id, "instance", validateInstanceSnapshot);
    if (cached === null) continue;
    hits++;
    instances.push({ ...cached, name: instanceConfig.name });
  }
  const accounts = [];
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
    errors: []
  });
}
function readCachedHistory(cache, scopeId) {
  return cache.read(scopeId, "history", validateHistory);
}
function isSnapshotFresh(snapshot, now, maxAgeSeconds) {
  let newest = Number.NEGATIVE_INFINITY;
  for (const scope of snapshot.trafficScopes) {
    if (scope.trafficObservedAt === null) continue;
    const parsed = Date.parse(scope.trafficObservedAt);
    if (Number.isFinite(parsed) && parsed > newest) newest = parsed;
  }
  if (newest === Number.NEGATIVE_INFINITY) return false;
  return (now.getTime() - newest) / 1e3 < maxAgeSeconds;
}

// src/domain/usage.ts
var BYTES_PER_GB = 1e9;
var BYTES_PER_GIB = 1073741824;
function quotaToBytes(value, unit) {
  return unit === "GB" ? value * BYTES_PER_GB : value * BYTES_PER_GIB;
}
function legacyGibToBytes(gib) {
  return gib * BYTES_PER_GIB;
}
function trafficClassOfRegion(regionId) {
  if (regionId.startsWith("cn-") && regionId !== "cn-hongkong") {
    return "mainland";
  }
  return "overseas";
}
function isFiniteNonNegative(value) {
  return value !== null && Number.isFinite(value) && value >= 0;
}
function computeUsage(usedBytes, quotaBytes, thresholdPercent) {
  if (!isFiniteNonNegative(usedBytes)) {
    return {
      remainingBytes: null,
      usagePercent: null,
      overThreshold: null,
      unknownReason: "未获取到用量数据"
    };
  }
  if (!isFiniteNonNegative(quotaBytes) || quotaBytes <= 0) {
    return {
      remainingBytes: null,
      usagePercent: null,
      overThreshold: null,
      unknownReason: "未配置有效的流量上限"
    };
  }
  if (!Number.isFinite(thresholdPercent) || thresholdPercent <= 0 || thresholdPercent > 100) {
    return {
      remainingBytes: null,
      usagePercent: null,
      overThreshold: null,
      unknownReason: "告警阈值配置无效"
    };
  }
  const usagePercent = usedBytes / quotaBytes * 100;
  return {
    remainingBytes: Math.max(0, quotaBytes - usedBytes),
    usagePercent,
    overThreshold: usagePercent >= thresholdPercent,
    unknownReason: null
  };
}
function clampFraction(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// src/domain/history.ts
function upsertSample(samples, sample, maxSamples) {
  const next = samples.filter((existing) => existing.bucket !== sample.bucket);
  next.push(sample);
  next.sort((a, b) => a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0);
  if (next.length > maxSamples) {
    return next.slice(next.length - maxSamples);
  }
  return next;
}
function upsertHourly(samples, sample) {
  return upsertSample(samples, sample, MAX_HOURLY_SAMPLES);
}
function upsertDaily(samples, sample) {
  return upsertSample(samples, sample, MAX_DAILY_SAMPLES);
}
function hourlyBucket(instant) {
  const truncated = new Date(
    Date.UTC(
      instant.getUTCFullYear(),
      instant.getUTCMonth(),
      instant.getUTCDate(),
      instant.getUTCHours()
    )
  );
  return truncated.toISOString();
}
function dailyBucket(instant) {
  const truncated = new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate())
  );
  return truncated.toISOString();
}
function makeSample(input) {
  return {
    bucket: input.granularity === "hour" ? hourlyBucket(input.instant) : dailyBucket(input.instant),
    observedAt: input.instant.toISOString(),
    bytes: input.bytes,
    source: input.source,
    periodId: input.periodId,
    quality: input.quality
  };
}
function minutesBetween(fromIso, toIso) {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return (to - from) / 6e4;
}
function formatHours(minutes) {
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  const hours = minutes / 60;
  return hours < 10 ? `${hours.toFixed(1)} 小时` : `${Math.round(hours)} 小时`;
}
function computeConsumption(samples, options) {
  if (samples.length === 0) {
    return {
      consumedBytes: null,
      coverageMinutes: null,
      basis: "unknown",
      quality: "no-baseline",
      description: "暂无历史数据"
    };
  }
  const ordered = [...samples].sort(
    (a, b) => a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0
  );
  const latest = ordered[ordered.length - 1];
  if (!options.periodVerified) {
    return {
      consumedBytes: null,
      coverageMinutes: null,
      basis: "cumulative",
      quality: "unknown-period",
      description: "接口累计值（统计周期待确认）"
    };
  }
  const cutoff = options.now.getTime() - options.requestedHours * 36e5;
  let baseline = null;
  for (const sample of ordered) {
    if (Date.parse(sample.observedAt) <= cutoff) baseline = sample;
  }
  if (baseline === null) baseline = ordered[0];
  if (baseline === latest || baseline.bucket === latest.bucket) {
    return {
      consumedBytes: null,
      coverageMinutes: null,
      basis: "unknown",
      quality: "no-baseline",
      description: "暂无足够的历史样本"
    };
  }
  const coverageMinutes = minutesBetween(baseline.observedAt, latest.observedAt);
  if (baseline.periodId !== latest.periodId) {
    return {
      consumedBytes: null,
      coverageMinutes,
      basis: "cumulative",
      quality: "partial",
      description: coverageMinutes === null ? "跨越统计周期，累计值分段" : `跨越统计周期，仅覆盖最近 ${formatHours(coverageMinutes)}`
    };
  }
  if (latest.bytes < baseline.bytes) {
    return {
      consumedBytes: null,
      coverageMinutes,
      basis: "cumulative",
      quality: "revision",
      description: "累计值出现回退，已按数据修订处理（不视为额度重置）"
    };
  }
  const consumedBytes = latest.bytes - baseline.bytes;
  const coverageText = coverageMinutes === null ? "区间未知" : `最近 ${formatHours(coverageMinutes)}`;
  const fullWindow = coverageMinutes !== null && coverageMinutes >= options.requestedHours * 60;
  return {
    consumedBytes,
    coverageMinutes,
    basis: "window",
    quality: fullWindow ? "ok" : "partial",
    description: fullWindow ? `${coverageText}消耗` : `${coverageText}，估算`
  };
}
function hasVerifiedPeriod(sample) {
  return sample.periodId !== UNVERIFIED_PERIOD && sample.periodId !== "";
}

// src/providers/types.ts
var ProviderError = class extends Error {
  constructor(sanitized2) {
    super(sanitized2.message);
    __publicField(this, "sanitized");
    this.sanitized = sanitized2;
    this.name = "ProviderError";
  }
  get code() {
    return this.sanitized.code;
  }
  get retryable() {
    return this.sanitized.retryable;
  }
};
function bssEndpointFor(siteType) {
  if (siteType === "international") {
    return { host: "business.ap-southeast-1.aliyuncs.com", regionId: "ap-southeast-1" };
  }
  return { host: "business.aliyuncs.com", regionId: "cn-hangzhou" };
}

// src/services/collect.ts
var BILLING_TTL_SECONDS = 6 * 3600;
var MAX_CONCURRENCY = 2;
function toSanitizedError(error, now) {
  if (error instanceof ProviderError) return error.sanitized;
  return {
    // Never surface the original message: it may embed a URL or a body.
    code: "UnexpectedError",
    message: "采集过程中发生了未预期的错误",
    at: now.toISOString(),
    retryable: false
  };
}
async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    for (; ; ) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
function makeRequestScope(clock, deadlineMs) {
  return {
    deadlineMs,
    remainingMs: () => Math.max(0, deadlineMs - clock.now().getTime()),
    now: () => clock.now()
  };
}
async function collectSnapshot(options) {
  const { config, cache, provider, clock } = options;
  const errors = [];
  const scope = makeRequestScope(clock, options.deadlineMs);
  const now = clock.now();
  const scopeIds = config.trafficScopes.map((item) => item.id);
  const scopeOutcomes = await mapWithConcurrency(
    config.trafficScopes,
    MAX_CONCURRENCY,
    async (scopeConfig) => {
      const previous = cache.read(scopeConfig.id, "scope", validateScopeSnapshot);
      const configuredQuotaBytes = scopeConfig.quota === null ? null : quotaToBytes(scopeConfig.quota.value, scopeConfig.quota.unit);
      try {
        const reading = await provider.getTraffic(scope, {
          scope: scopeConfig,
          credential: resolveCredential(config, scopeConfig.credentialId)
        });
        const quotaBytes = configuredQuotaBytes ?? reading.suggestedQuotaBytes;
        const quotaSource = configuredQuotaBytes !== null ? scopeConfig.quota?.source ?? "user" : reading.suggestedQuotaSource;
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
            thresholdPercent: scopeConfig.thresholdPercent
          },
          reading
        };
      } catch (caught) {
        const error = toSanitizedError(caught, now);
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
            thresholdPercent: scopeConfig.thresholdPercent
          },
          reading: null
        };
      }
    }
  );
  for (const outcome of scopeOutcomes) {
    const error = outcome.snapshot.trafficError;
    if (error !== null) {
      errors.push({ ...error, entityId: outcome.snapshot.id });
    }
    cache.write(outcome.snapshot.id, "scope", outcome.snapshot, now);
    if (outcome.reading !== null && outcome.snapshot.usedBytes !== null) {
      recordHistory(cache, outcome.snapshot, outcome.reading, now);
    }
  }
  const instanceOutcomes = await mapWithConcurrency(
    config.instances,
    MAX_CONCURRENCY,
    async (instanceConfig) => {
      const previous = cache.read(instanceConfig.id, "instance", validateInstanceSnapshot);
      const base = previous ?? {
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
        actionState: null
      };
      let reading;
      try {
        reading = await provider.getInstanceStatus(scope, {
          instance: instanceConfig,
          credential: resolveCredential(config, instanceConfig.credentialId)
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
          legacyUpdatedAt: base.legacyUpdatedAt
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
        statusError: null
      };
    }
  );
  for (const instance of instanceOutcomes) {
    if (instance.statusError !== null) {
      errors.push({ ...instance.statusError, entityId: instance.id });
    }
  }
  const accountSnapshots = [];
  for (const account of config.accounts) {
    const previous = cache.read(account.id, "account", validateAccountSnapshot);
    const base = previous ?? {
      id: account.id,
      name: account.name,
      balance: null,
      currency: null,
      balanceObservedAt: null,
      balanceError: null
    };
    const shouldFetch = config.billingEnabled && options.skipBilling !== true && billingDue(base, now, options.billingTtlSeconds ?? BILLING_TTL_SECONDS);
    if (!shouldFetch || scope.remainingMs() <= 0) {
      accountSnapshots.push({ ...base, name: account.name });
      continue;
    }
    const credential = config.credentials.find((item) => item.accountId === account.id);
    if (credential === void 0) {
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
        balanceError: null
      });
    } catch (caught) {
      const error = toSanitizedError(caught, now);
      errors.push({ ...error, entityId: account.id });
      accountSnapshots.push({ ...base, name: account.name, balanceError: error });
    }
  }
  const finalInstances = [];
  for (const instance of instanceOutcomes) {
    const configInstance = config.instances.find((item) => item.id === instance.id);
    if (configInstance === void 0 || !config.billingEnabled || options.skipBilling === true || configInstance.instanceId === "" || scope.remainingMs() <= 0) {
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
          credential: resolveCredential(config, configInstance.credentialId)
        },
        cycle
      );
      finalInstances.push({
        ...instance,
        monthlyCost: reading.totalCost,
        currency: reading.currency ?? instance.currency,
        billingCycle: reading.cycle,
        billingObservedAt: reading.observedAt,
        billingError: null
      });
    } catch (caught) {
      const error = toSanitizedError(caught, now);
      errors.push({ ...error, entityId: instance.id });
      finalInstances.push({ ...instance, billingError: error });
    }
  }
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
    errors
  });
  return { snapshot, errors };
}
function resolveCredential(config, credentialId) {
  const credential = config.credentials.find((item) => item.id === credentialId);
  if (credential === void 0) {
    throw new ProviderError({
      code: "MissingCredential",
      message: `配置引用了不存在的凭据 ${credentialId}`,
      at: (/* @__PURE__ */ new Date(0)).toISOString(),
      retryable: false
    });
  }
  return credential;
}
function billingDue(snapshot, now, ttlSeconds, cycle) {
  const stamp = snapshot.balanceObservedAt ?? snapshot.billingObservedAt ?? null;
  if (stamp === null) return true;
  const parsed = Date.parse(stamp);
  if (!Number.isFinite(parsed)) return true;
  if (billingCycleMismatch(snapshot.billingCycle, cycle)) return true;
  return (now.getTime() - parsed) / 1e3 >= ttlSeconds;
}
function billingCycleMismatch(stored, cycle) {
  if (cycle === void 0) return false;
  if (stored === void 0 || stored === null) return false;
  return stored !== cycle;
}
function billingCycleFor(now, timeZone) {
  if (timeZone === void 0) {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const parts = timeZone.partsAt(now);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}
function recordHistory(cache, scopeSnapshot, reading, now) {
  if (scopeSnapshot.usedBytes === null) return;
  const existing = cache.read(scopeSnapshot.id, "history", validateHistory) ?? {
    scopeId: scopeSnapshot.id,
    hourly: [],
    daily: []
  };
  const base = {
    instant: now,
    bytes: scopeSnapshot.usedBytes,
    source: reading.sourceUnit === "bytes" ? "direct" : "server",
    periodId: reading.periodId,
    quality: reading.freshnessQuality
  };
  const hourlySample = makeSample({ ...base, granularity: "hour" });
  const dailySample = makeSample({ ...base, granularity: "day" });
  cache.write(
    scopeSnapshot.id,
    "history",
    {
      scopeId: scopeSnapshot.id,
      hourly: upsertHourly(existing.hourly, hourlySample),
      daily: upsertDaily(existing.daily, dailySample)
    },
    now
  );
}

// src/domain/format.ts
var EM_DASH = "—";
function usable(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function formatNumber(value, digits = 2) {
  if (!usable(value)) return EM_DASH;
  const normalized = Object.is(value, -0) ? 0 : value;
  if (Math.abs(normalized) >= 1e15) {
    return normalized.toExponential(2);
  }
  return normalized.toFixed(digits);
}
function formatBytes(bytes, unit, digits = 2) {
  if (!usable(bytes) || bytes < 0) return EM_DASH;
  const divisor = unit === "GB" ? BYTES_PER_GB : BYTES_PER_GIB;
  return `${formatNumber(bytes / divisor, digits)} ${unit}`;
}
function formatPercent(percent, digits = 2) {
  if (!usable(percent) || percent < 0) return EM_DASH;
  return `${formatNumber(percent, digits)}%`;
}
var CURRENCY_SYMBOLS = {
  CNY: "¥",
  USD: "$",
  JPY: "JP¥",
  EUR: "€",
  GBP: "£",
  HKD: "HK$"
};
function formatMoney(amount, currency) {
  if (!usable(amount)) return EM_DASH;
  const code = typeof currency === "string" && currency !== "" ? currency : null;
  if (code === null) return formatNumber(amount, 2);
  const symbol = CURRENCY_SYMBOLS[code];
  return symbol ? `${symbol}${formatNumber(amount, 2)}` : `${code} ${formatNumber(amount, 2)}`;
}
function formatSampleAge(observedAt, now) {
  if (typeof observedAt !== "string" || observedAt === "") return EM_DASH;
  const time = Date.parse(observedAt);
  if (!Number.isFinite(time)) return EM_DASH;
  const minutes = Math.floor((now.getTime() - time) / 6e4);
  if (minutes < 0) return "刚刚";
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}
function truncateName(name, maxLength) {
  if (typeof name !== "string") return "";
  const characters = Array.from(name);
  if (characters.length <= maxLength) return name;
  return `${characters.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}
function instanceStatusLabel(status) {
  switch (status) {
    case "Running":
      return "运行中";
    case "Stopped":
      return "已停止";
    case "Starting":
      return "启动中";
    case "Stopping":
      return "停止中";
    case "Pending":
      return "创建中";
    default:
      return "未知";
  }
}
function trafficClassLabel(trafficClass) {
  return trafficClass === "mainland" ? "国内" : "海外";
}

// src/widget/render.ts
function selectPrimaryScope(snapshot, config) {
  const selected = config.view.scopeId;
  if (selected !== null) {
    const match = snapshot.trafficScopes.find((scope) => scope.id === selected);
    if (match !== void 0) return match;
  }
  return snapshot.trafficScopes[0] ?? null;
}
function classify(scope) {
  if (scope.overThreshold === true) return "danger";
  if (scope.usagePercent === null) return "muted";
  if (scope.usagePercent >= scope.thresholdPercent - 5) return "warning";
  return "ok";
}
function statusTextFor(scope, stale) {
  if (scope.trafficError !== null) return "查询失败";
  if (scope.overThreshold === true) return "已超阈值";
  if (scope.usagePercent === null) return "用量未知";
  if (stale) return "数据陈旧";
  if (scope.usagePercent >= scope.thresholdPercent - 5) return "接近阈值";
  return "正常";
}
function scopeLabel(scope, displayName) {
  return `${displayName} ${trafficClassLabel(scope.trafficClass)} CDT`;
}
function buildViewModel(options) {
  const { snapshot, config, now, histories } = options;
  const errors = dedupeErrors(snapshot.errors.map((error) => error.message));
  if (snapshot.trafficScopes.length === 0) {
    return {
      title: config.displayName,
      status: "unconfigured",
      stateColor: "muted",
      message: "尚未配置监控对象",
      detail: "请在模块 Env 中填写 AccessKey 或服务器地址",
      scopes: [],
      errors,
      updatedAtIso: null,
      hasHistory: false
    };
  }
  const instanceRows = /* @__PURE__ */ new Map();
  for (const instance of snapshot.instances) {
    const rows = instanceRows.get(instance.trafficScopeId) ?? [];
    rows.push({
      id: instance.id,
      // Truncation happens on code points, so an emoji or CJK name is never
      // split into a replacement glyph.
      name: truncateName(instance.name, 18),
      statusText: instance.statusError === null ? instanceStatusLabel(instance.status) : `${instanceStatusLabel(instance.status)}（待确认）`,
      status: instance.status,
      state: (
        // An unconfirmed state is always a warning: the colour must not imply
        // certainty the data does not have.
        instance.statusError !== null ? "warning" : instance.status === "Running" ? "ok" : instance.status === "Stopped" ? "muted" : "warning"
      ),
      costText: instance.monthlyCost === null ? null : formatMoney(instance.monthlyCost, instance.currency)
    });
    instanceRows.set(instance.trafficScopeId, rows);
  }
  const statusUnconfirmed = new Set(
    snapshot.instances.filter((instance) => instance.statusError !== null).map((instance) => instance.trafficScopeId)
  );
  const scopes = snapshot.trafficScopes.map((scope) => {
    const history = histories.get(scope.id);
    const stale = scope.stale || scope.trafficError !== null;
    const usageText = buildUsageText(scope);
    const consumption = history === void 0 ? null : computeConsumption(history.hourly, {
      periodVerified: history.hourly.some(hasVerifiedPeriod),
      requestedHours: 24,
      now
    });
    const qualityNotes = [];
    if (scope.periodId === "unverified") {
      qualityNotes.push("接口累计（周期待确认）");
    }
    if (scope.sourceUnit === "legacyGiB") {
      qualityNotes.push("来自服务器，单位按 GiB 换算");
    }
    if (scope.overThreshold === false && scope.trafficError === null && scope.freshnessQuality !== "measured") {
      qualityNotes.push("服务器时间戳不作为云端采样时间");
    }
    if (statusUnconfirmed.has(scope.id)) {
      qualityNotes.push("实例状态查询失败，显示的是上次已知状态");
    }
    return {
      scopeId: scope.id,
      label: scopeLabel(scope, config.displayName),
      usageText,
      percentText: scope.trafficError !== null && scope.usedBytes === null ? EM_DASH : formatPercent(scope.usagePercent),
      remainingText: scope.remainingBytes === null ? "未配置" : `${formatBytes(scope.remainingBytes, "GB")}`,
      // Graphics clamp; the text above keeps the true value.
      fraction: scope.usagePercent === null ? 0 : clampFraction(scope.usagePercent / 100),
      state: classify(scope),
      statusText: statusTextFor(scope, stale),
      ageText: formatSampleAge(scope.trafficObservedAt ?? scope.legacyUpdatedAt, now),
      observedAtIso: scope.trafficObservedAt,
      consumptionText: consumption === null || consumption.consumedBytes === null ? null : `${formatBytes(consumption.consumedBytes, "GB")} · ${consumption.description}`,
      instances: instanceRows.get(scope.id) ?? [],
      errorText: scope.trafficError?.message ?? null,
      qualityNote: qualityNotes.length > 0 ? qualityNotes.join(" · ") : null
    };
  });
  const primary = selectPrimaryScope(snapshot, config);
  const primaryView = primary === null ? null : scopes.find((view) => view.scopeId === primary.id) ?? null;
  const updatedAtIso = newestObservation(scopes);
  const hasHistory = histories.size > 0;
  if (config.view.scopeId !== null && snapshot.trafficScopes.every((scope) => scope.id !== config.view.scopeId)) {
    return {
      title: config.displayName,
      status: "target-missing",
      stateColor: "warning",
      message: "选中的监控对象已不存在",
      detail: `CDT_SCOPE_ID=${config.view.scopeId} 不在当前配置中`,
      scopes,
      errors,
      updatedAtIso,
      hasHistory
    };
  }
  if (primaryView === null || primary === null) {
    return {
      title: config.displayName,
      status: "unconfigured",
      stateColor: "muted",
      message: "尚无可用数据",
      detail: null,
      scopes,
      errors,
      updatedAtIso,
      hasHistory
    };
  }
  const status = deriveStatus(primaryView, primary, config, hasHistory);
  const authError = snapshot.errors.find(
    (error) => error.code === "TokenRejected" || error.code === "AccessDenied"
  );
  const finalStatus = authError !== void 0 ? "auth-error" : status;
  return {
    title: config.displayName,
    status: finalStatus,
    stateColor: primaryView.state,
    message: messageFor(finalStatus),
    detail: detailFor(finalStatus, primaryView, config),
    scopes,
    errors,
    updatedAtIso,
    hasHistory
  };
}
function buildUsageText(scope) {
  const used = scope.usedBytes === null ? EM_DASH : `${formatNumber(scope.usedBytes / 1e9, 2)} GB`;
  if (scope.quotaBytes === null) {
    return `${used} / 未配置上限`;
  }
  return `${used} / ${formatBytes(scope.quotaBytes, "GB")}`;
}
function newestObservation(scopes) {
  let newest = null;
  let newestTime = Number.NEGATIVE_INFINITY;
  for (const scope of scopes) {
    if (scope.observedAtIso === null) continue;
    const parsed = Date.parse(scope.observedAtIso);
    if (!Number.isFinite(parsed)) continue;
    if (parsed > newestTime) {
      newestTime = parsed;
      newest = scope.observedAtIso;
    }
  }
  return newest;
}
function deriveStatus(view, scope, config, hasHistory) {
  if (scope.usedBytes === null && scope.trafficObservedAt === null && scope.legacyUpdatedAt === null && scope.trafficError === null) {
    return "waiting";
  }
  if (scope.trafficError !== null && scope.usedBytes === null) return "waiting";
  if (scope.trafficError !== null) return "stale";
  if (scope.overThreshold === true) return "over-threshold";
  if (scope.usagePercent !== null && scope.usagePercent >= scope.thresholdPercent - 5) {
    return "near-threshold";
  }
  if (scope.stale) return "stale";
  if (!hasHistory) return "no-history";
  if (config.billingEnabled && config.mode === "server") return "partial";
  return "normal";
}
function messageFor(status) {
  switch (status) {
    case "waiting":
      return "等待首次采集";
    case "stale":
      return "数据可能已过期";
    case "over-threshold":
      return "流量已超阈值";
    case "near-threshold":
      return "流量接近阈值";
    case "auth-error":
      return "凭据无效或权限不足";
    case "permission-error":
      return "权限不足";
    case "no-history":
      return "暂无历史数据";
    case "partial":
      return "部分数据缺失";
    case "target-missing":
      return "监控对象不存在";
    case "unconfigured":
      return "尚未配置";
    default:
      return null;
  }
}
function detailFor(status, view, config) {
  switch (status) {
    case "auth-error":
      return "请检查只读 RAM 凭据或服务器 Token";
    case "stale":
      return view.errorText ?? "上次采集未成功，显示的是缓存值";
    case "waiting":
      return "尚未取得有效数据";
    case "no-history":
      return "安装后开始采样，历史不会凭空继承";
    case "partial":
      return "账单数据可能缺失，用量仍然有效";
    default:
      return null;
  }
}
function dedupeErrors(messages) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const message of messages) {
    if (seen.has(message)) continue;
    seen.add(message);
    result.push(message);
    if (result.length >= 3) break;
  }
  return result;
}

// src/widget/theme.ts
var DEFAULT_PALETTE = {
  background: { light: "#FFFFFF", dark: "#1C1C1E" },
  card: { light: "#F2F2F7", dark: "#2C2C2E" },
  textPrimary: { light: "#111114", dark: "#FFFFFF" },
  textSecondary: { light: "#55555B", dark: "#B4B4BB" },
  accent: { light: "#0A54C4", dark: "#4C9AFF" },
  warning: { light: "#8A5200", dark: "#FFD60A" },
  danger: { light: "#C0271D", dark: "#FF6B60" },
  ok: { light: "#1B7A3A", dark: "#4CD964" },
  muted: { light: "#6C6C72", dark: "#9A9AA0" },
  separator: { light: "#D8D8DE", dark: "#3A3A3C" }
};
var DARK_PALETTE = {
  background: "#000000",
  card: "#1C1C1E",
  textPrimary: "#FFFFFF",
  textSecondary: "#B4B4BB",
  accent: "#4C9AFF",
  warning: "#FFD60A",
  danger: "#FF6B60",
  ok: "#4CD964",
  muted: "#9A9AA0",
  separator: "#3A3A3C"
};
var LIGHT_PALETTE = {
  background: "#FFFFFF",
  card: "#F2F2F7",
  textPrimary: "#111114",
  textSecondary: "#55555B",
  accent: "#0A54C4",
  warning: "#8A5200",
  danger: "#C0271D",
  ok: "#1B7A3A",
  muted: "#6C6C72",
  separator: "#D8D8DE"
};
function resolveTheme(name) {
  switch (name) {
    case "dark":
      return { name: "dark", ...DARK_PALETTE };
    case "light":
      return { name: "light", ...LIGHT_PALETTE };
    default:
      return { name: "auto", ...DEFAULT_PALETTE };
  }
}
function svgColor(color, dark) {
  const hex = typeof color === "string" ? color : dark ? color.dark : color.light;
  return hexToRgbFunction(hex);
}
function hexToRgbFunction(value) {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(value.trim());
  if (match === null) {
    return value.replace(/#/g, "");
  }
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex.split("").map((character) => character + character).join("");
  }
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  if (hex.length === 8) {
    const alpha = parseInt(hex.slice(6, 8), 16) / 255;
    return `rgba(${red},${green},${blue},${alpha.toFixed(3)})`;
  }
  return `rgb(${red},${green},${blue})`;
}

// src/widget/svg.ts
var MAX_SVG_BYTES = 64 * 1024;
function num(value) {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 100) / 100);
}
function fraction(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
function toSvgDataUri(viewBox, body) {
  const markup = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}'>${body}</svg>`;
  if (markup.length > MAX_SVG_BYTES) return null;
  return `data:image/svg+xml,${markup}`;
}
function progressRing(options) {
  const { size, strokeWidth } = options;
  const radius = (size - strokeWidth) / 2;
  if (!(radius > 0)) return null;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = fraction(options.fraction);
  const dash = circumference * filled;
  const track = hexToRgbFunction(options.trackColor);
  const progress = hexToRgbFunction(options.progressColor);
  const body = `<circle cx='${num(center)}' cy='${num(center)}' r='${num(radius)}' fill='none' stroke='${track}' stroke-opacity='0.25' stroke-width='${num(strokeWidth)}'/><circle cx='${num(center)}' cy='${num(center)}' r='${num(radius)}' fill='none' stroke='${progress}' stroke-width='${num(strokeWidth)}' stroke-linecap='round' stroke-dasharray='${num(circumference)}' stroke-dashoffset='${num(circumference - dash)}' transform='rotate(-90 ${num(center)} ${num(center)})'/>`;
  return toSvgDataUri(`0 0 ${num(size)} ${num(size)}`, body);
}
function progressBar(options) {
  const { width, height } = options;
  if (!(width > 0) || !(height > 0)) return null;
  const radius = options.radius ?? height / 2;
  const filled = fraction(options.fraction);
  const track = hexToRgbFunction(options.trackColor);
  const progress = hexToRgbFunction(options.progressColor);
  const body = `<rect x='0' y='0' width='${num(width)}' height='${num(height)}' rx='${num(radius)}' fill='${track}' fill-opacity='0.25'/><rect x='0' y='0' width='${num(width * filled)}' height='${num(height)}' rx='${num(radius)}' fill='${progress}'/>`;
  return toSvgDataUri(`0 0 ${num(width)} ${num(height)}`, body);
}

// src/widget/layouts.ts
function text(value, options = {}) {
  const node = { type: "text", text: value };
  const font = {};
  if (options.size !== void 0) font["size"] = options.size;
  if (options.weight !== void 0) font["weight"] = options.weight;
  if (Object.keys(font).length > 0) node["font"] = font;
  if (options.color !== void 0) node["textColor"] = options.color;
  if (options.lines !== void 0) node["maxLines"] = options.lines;
  if (options.minScale !== void 0) node["minScale"] = options.minScale;
  if (options.align !== void 0) node["textAlign"] = options.align;
  if (options.flex !== void 0) node["flex"] = options.flex;
  return node;
}
function stack(children, options = {}) {
  const node = { type: "stack", children };
  node["direction"] = options.direction ?? "row";
  if (options.alignItems !== void 0) node["alignItems"] = options.alignItems;
  if (options.gap !== void 0) node["gap"] = options.gap;
  if (options.flex !== void 0) node["flex"] = options.flex;
  if (options.url !== void 0) node["url"] = options.url;
  return node;
}
function relativeDate(iso, color) {
  if (iso === null) return null;
  return {
    type: "date",
    date: iso,
    format: "relative",
    font: { size: "caption2" },
    textColor: color
  };
}
function image(src, width, height) {
  if (src === null) return [];
  return [{ type: "image", src, width, height }];
}
function root(children, options, extra = {}) {
  const node = {
    type: "widget",
    children,
    padding: 16,
    gap: 6,
    ...extra
  };
  if (options.url !== null) node.url = options.url;
  if (options.refreshAfter !== null) node.refreshAfter = options.refreshAfter;
  return node;
}
function messageLayout(options, title, message, detail) {
  const children = [
    text(title, { size: "headline", weight: "semibold", color: options.theme.textPrimary, lines: 1 }),
    text(message, { size: "subheadline", weight: "medium", color: options.theme.warning, lines: 2 })
  ];
  if (detail !== null) {
    children.push(text(detail, { size: "caption2", color: options.theme.textSecondary, lines: 2 }));
  }
  return root(children, options, { backgroundColor: options.theme.background });
}
function statusBanner(model, theme) {
  if (model.message === null) return [];
  const nodes = [
    text(model.message, { size: "caption1", weight: "medium", color: theme.warning, lines: 1 })
  ];
  if (model.detail !== null) {
    nodes.push(text(model.detail, { size: "caption2", color: theme.textSecondary, lines: 2 }));
  }
  return nodes;
}
function instanceLines(view, theme, limit) {
  const rows = view.instances.slice(0, limit);
  if (rows.length === 0) return [];
  return rows.map(
    (row) => stack(
      [
        text(row.name, { size: "caption1", color: theme.textPrimary, lines: 1, flex: 1 }),
        text(row.statusText, {
          size: "caption1",
          weight: "medium",
          color: row.state === "ok" ? theme.ok : row.state === "danger" ? theme.danger : theme.muted,
          lines: 1
        })
      ],
      { direction: "row", alignItems: "center", gap: 6 }
    )
  );
}
function smallLayout(options) {
  const { model, theme } = options;
  const scope = model.scopes[0];
  if (scope === void 0) {
    return messageLayout(options, model.title, model.message ?? "尚未配置", model.detail);
  }
  const color = scope.state === "danger" ? theme.danger : scope.state === "warning" ? theme.warning : theme.ok;
  const bar = progressBar({
    fraction: scope.fraction,
    width: 120,
    height: 6,
    trackColor: svgColor(theme.muted, true),
    progressColor: svgColor(color, true)
  });
  const children = [
    text(scope.label, { size: "caption2", color: theme.textSecondary, lines: 1 }),
    text(scope.percentText, { size: "title", weight: "bold", color, lines: 1, minScale: 0.6 }),
    text(scope.usageText, { size: "caption1", color: theme.textPrimary, lines: 2, minScale: 0.7 }),
    ...image(bar, 120, 6),
    stack(
      [
        text(scope.statusText, { size: "caption1", weight: "medium", color, lines: 1, flex: 1 }),
        relativeDate(scope.observedAtIso, theme.textSecondary) ?? text(scope.ageText, { size: "caption2", color: theme.textSecondary, lines: 1 })
      ],
      { direction: "row", alignItems: "center", gap: 6 }
    )
  ];
  if (scope.errorText !== null) {
    children.push(text(scope.errorText, { size: "caption2", color: theme.danger, lines: 2 }));
  }
  return root(children, options, { backgroundColor: theme.background });
}
function mediumLayout(options) {
  const { model, theme } = options;
  const scope = model.scopes[0];
  if (scope === void 0) {
    return messageLayout(options, model.title, model.message ?? "尚未配置", model.detail);
  }
  const color = scope.state === "danger" ? theme.danger : scope.state === "warning" ? theme.warning : theme.ok;
  const bar = progressBar({
    fraction: scope.fraction,
    width: 200,
    height: 8,
    trackColor: svgColor(theme.muted, true),
    progressColor: svgColor(color, true)
  });
  const children = [
    stack(
      [
        text(scope.label, {
          size: "subheadline",
          weight: "semibold",
          color: theme.textPrimary,
          lines: 1,
          flex: 1
        }),
        text(scope.statusText, {
          size: "caption1",
          weight: "medium",
          color,
          lines: 1
        })
      ],
      { direction: "row", alignItems: "center", gap: 6 }
    ),
    text(scope.usageText, { size: "title3", weight: "semibold", color: theme.textPrimary, lines: 1, minScale: 0.7 }),
    ...image(bar, 200, 8),
    stack(
      [
        text(`剩余 ${scope.remainingText}`, {
          size: "caption1",
          color: theme.textSecondary,
          lines: 1,
          flex: 1
        }),
        relativeDate(scope.observedAtIso, theme.textSecondary) ?? text(scope.ageText, { size: "caption2", color: theme.textSecondary, lines: 1 })
      ],
      { direction: "row", alignItems: "center", gap: 6 }
    )
  ];
  children.push(...statusBanner(model, theme));
  const instances = instanceLines(scope, theme, 2);
  if (instances.length > 0) children.push(...instances);
  if (scope.consumptionText !== null) {
    children.push(text(scope.consumptionText, { size: "caption2", color: theme.textSecondary, lines: 1 }));
  }
  return root(children, options, { backgroundColor: theme.background });
}
function largeLayout(options) {
  const { model, theme } = options;
  if (model.scopes.length === 0) {
    return messageLayout(options, model.title, model.message ?? "尚未配置", model.detail);
  }
  const children = [
    text(model.title, { size: "headline", weight: "semibold", color: theme.textPrimary, lines: 1 }),
    ...statusBanner(model, theme)
  ];
  for (const scope of model.scopes.slice(0, 4)) {
    const color = scope.state === "danger" ? theme.danger : scope.state === "warning" ? theme.warning : theme.ok;
    const bar = progressBar({
      fraction: scope.fraction,
      width: 200,
      height: 6,
      trackColor: svgColor(theme.muted, true),
      progressColor: svgColor(color, true)
    });
    children.push(
      stack(
        [
          text(scope.label, { size: "subheadline", color: theme.textPrimary, lines: 1, flex: 1 }),
          text(`${scope.percentText} · ${scope.statusText}`, {
            size: "caption1",
            weight: "medium",
            color,
            lines: 1
          })
        ],
        { direction: "row", alignItems: "center", gap: 6 }
      )
    );
    children.push(text(scope.usageText, { size: "caption1", color: theme.textSecondary, lines: 1 }));
    children.push(...image(bar, 200, 6));
    children.push(...instanceLines(scope, theme, 3));
    if (scope.qualityNote !== null) {
      children.push(text(scope.qualityNote, { size: "caption2", color: theme.muted, lines: 1 }));
    }
    if (scope.errorText !== null) {
      children.push(text(scope.errorText, { size: "caption2", color: theme.danger, lines: 1 }));
    }
  }
  if (model.errors.length > 0) {
    children.push(text(model.errors.join("；"), { size: "caption2", color: theme.danger, lines: 2 }));
  }
  return root(children, options, { backgroundColor: theme.background, gap: 8 });
}
function extraLargeLayout(options) {
  const base = largeLayout(options);
  const { model, theme } = options;
  const columns = [];
  for (const scope of model.scopes.slice(0, 3)) {
    columns.push(
      stack(
        [
          text(scope.label, { size: "caption1", color: theme.textSecondary, lines: 1 }),
          text(scope.percentText, { size: "headline", weight: "semibold", color: theme.textPrimary, lines: 1 }),
          text(scope.statusText, { size: "caption2", color: theme.textSecondary, lines: 1 })
        ],
        { direction: "column", alignItems: "start", gap: 2, flex: 1 }
      )
    );
  }
  if (columns.length === 0) return base;
  const existing = base.children ?? [];
  return {
    ...base,
    children: [...existing, stack(columns, { direction: "row", alignItems: "start", gap: 10 })]
  };
}
function accessoryCircularLayout(options) {
  const { model, theme } = options;
  const scope = model.scopes[0];
  if (scope === void 0) {
    return { type: "widget", children: [text("CDT", { size: "caption1" })] };
  }
  const ring = progressRing({
    fraction: scope.fraction,
    size: 64,
    strokeWidth: 6,
    trackColor: svgColor(theme.muted, true),
    progressColor: svgColor(scope.state === "danger" ? "#FF453A" : "#30D158", true)
  });
  const children = [
    ...image(ring, 58, 58),
    // The percentage is also written as text so the state survives even if the
    // ring fails to render.
    text(scope.state === "danger" ? "超限" : scope.percentText, {
      size: "caption2",
      weight: "semibold",
      lines: 1
    })
  ];
  const node = { type: "widget", children, gap: 2 };
  if (options.url !== null) node.url = options.url;
  if (options.refreshAfter !== null) node.refreshAfter = options.refreshAfter;
  return node;
}
function accessoryRectangularLayout(options) {
  const { model } = options;
  const scope = model.scopes[0];
  if (scope === void 0) {
    return { type: "widget", children: [text(model.message ?? "尚未配置 CDT", { size: "caption1" })] };
  }
  const children = [
    text(scope.label, { size: "caption1", weight: "semibold", lines: 1 }),
    text(`${scope.percentText} · ${scope.statusText}`, { size: "caption1", lines: 1 }),
    text(scope.usageText, { size: "caption2", lines: 1, minScale: 0.7 })
  ];
  const node = { type: "widget", children, gap: 2 };
  if (options.url !== null) node.url = options.url;
  if (options.refreshAfter !== null) node.refreshAfter = options.refreshAfter;
  return node;
}
function accessoryInlineLayout(options) {
  const { model } = options;
  const scope = model.scopes[0];
  const value = scope === void 0 ? "CDT 未配置" : scope.state === "danger" ? `CDT 超限 ${scope.percentText}` : `CDT ${scope.percentText} · ${scope.statusText}`;
  const node = { type: "widget", children: [text(value, { size: "caption1", lines: 1 })] };
  if (options.url !== null) node.url = options.url;
  if (options.refreshAfter !== null) node.refreshAfter = options.refreshAfter;
  return node;
}
function renderLayout(family, options) {
  switch (family) {
    case "systemSmall":
      return smallLayout(options);
    case "systemMedium":
      return mediumLayout(options);
    case "systemLarge":
      return largeLayout(options);
    case "systemExtraLarge":
      return extraLargeLayout(options);
    case "accessoryCircular":
      return accessoryCircularLayout(options);
    case "accessoryRectangular":
      return accessoryRectangularLayout(options);
    case "accessoryInline":
      return accessoryInlineLayout(options);
    default:
      return mediumLayout(options);
  }
}

// src/domain/schedule.ts
var MINUTES_PER_DAY = 24 * 60;
function normalizeClockTime(value) {
  const parsed = parseClockTime(value);
  if (parsed === null) return null;
  return `${parsed.hour < 10 ? "0" : ""}${parsed.hour}:${parsed.minute < 10 ? "0" : ""}${parsed.minute}`;
}
function parseClockTime(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/：/g, ":");
  if (normalized === "24:00") {
    return { hour: 0, minute: 0, minutes: 0 };
  }
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(normalized);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return { hour, minute, minutes: hour * 60 + minute };
}

// src/host/crypto.ts
var SHA1_BLOCK_BYTES = 64;
var SHA1_DIGEST_BYTES = 20;
function rotateLeft32(value, count) {
  return (value << count | value >>> 32 - count) >>> 0;
}
function utf8Bytes(input) {
  const out = [];
  for (let i = 0; i < input.length; i++) {
    let codePoint = input.charCodeAt(i);
    if (codePoint >= 55296 && codePoint <= 56319) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 56320 && next <= 57343) {
        codePoint = (codePoint - 55296 << 10) + (next - 56320) + 65536;
        i++;
      } else {
        codePoint = 65533;
      }
    } else if (codePoint >= 56320 && codePoint <= 57343) {
      codePoint = 65533;
    }
    if (codePoint < 128) {
      out.push(codePoint);
    } else if (codePoint < 2048) {
      out.push(192 | codePoint >> 6, 128 | codePoint & 63);
    } else if (codePoint < 65536) {
      out.push(
        224 | codePoint >> 12,
        128 | codePoint >> 6 & 63,
        128 | codePoint & 63
      );
    } else {
      out.push(
        240 | codePoint >> 18,
        128 | codePoint >> 12 & 63,
        128 | codePoint >> 6 & 63,
        128 | codePoint & 63
      );
    }
  }
  return out;
}
var BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64Encode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : void 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : void 0;
    out += BASE64_ALPHABET[b0 >> 2];
    if (b1 === void 0) {
      out += BASE64_ALPHABET[(b0 & 3) << 4];
      out += "==";
      break;
    }
    out += BASE64_ALPHABET[(b0 & 3) << 4 | b1 >> 4];
    if (b2 === void 0) {
      out += BASE64_ALPHABET[(b1 & 15) << 2];
      out += "=";
      break;
    }
    out += BASE64_ALPHABET[(b1 & 15) << 2 | b2 >> 6];
    out += BASE64_ALPHABET[b2 & 63];
  }
  return out;
}
var BASE64_LOOKUP = (() => {
  const table = {};
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    table[BASE64_ALPHABET[i]] = i;
  }
  return table;
})();
function hexEncode(bytes) {
  let out = "";
  for (const byte of bytes) {
    out += (byte < 16 ? "0" : "") + byte.toString(16);
  }
  return out;
}
function sha1(message) {
  const messageLength = message.length;
  const paddedLength = (() => {
    const afterOne = messageLength + 1;
    const remainder = afterOne % SHA1_BLOCK_BYTES;
    const zeroPad = remainder <= 56 ? 56 - remainder : 56 + (SHA1_BLOCK_BYTES - remainder);
    return afterOne + zeroPad + 8;
  })();
  const buffer = new Uint8Array(paddedLength);
  buffer.set(message, 0);
  buffer[messageLength] = 128;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const bitLengthHigh = Math.floor(messageLength / 536870912);
  const bitLengthLow = messageLength % 536870912 * 8;
  view.setUint32(paddedLength - 8, bitLengthHigh, false);
  view.setUint32(paddedLength - 4, bitLengthLow >>> 0, false);
  const h0Init = 1732584193;
  const h1Init = 4023233417;
  const h2Init = 2562383102;
  const h3Init = 271733878;
  const h4Init = 3285377520;
  let h0 = h0Init;
  let h1 = h1Init;
  let h2 = h2Init;
  let h3 = h3Init;
  let h4 = h4Init;
  const words = new Uint32Array(80);
  for (let offset = 0; offset < paddedLength; offset += SHA1_BLOCK_BYTES) {
    for (let i = 0; i < 16; i++) {
      words[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      words[i] = rotateLeft32(
        words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16],
        1
      );
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) {
        f = b & c | ~b & d;
        k = 1518500249;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 1859775393;
      } else if (i < 60) {
        f = b & c | b & d | c & d;
        k = 2400959708;
      } else {
        f = b ^ c ^ d;
        k = 3395469782;
      }
      const temp = rotateLeft32(a, 5) + f + e + k + words[i] >>> 0;
      e = d;
      d = c;
      c = rotateLeft32(b, 30);
      b = a;
      a = temp;
    }
    h0 = h0 + a >>> 0;
    h1 = h1 + b >>> 0;
    h2 = h2 + c >>> 0;
    h3 = h3 + d >>> 0;
    h4 = h4 + e >>> 0;
  }
  const digest = new Uint8Array(SHA1_DIGEST_BYTES);
  const digestView = new DataView(
    digest.buffer,
    digest.byteOffset,
    digest.byteLength
  );
  digestView.setUint32(0, h0, false);
  digestView.setUint32(4, h1, false);
  digestView.setUint32(8, h2, false);
  digestView.setUint32(12, h3, false);
  digestView.setUint32(16, h4, false);
  return Array.from(digest);
}
function hmacSha1(key, message) {
  let normalizedKey = key;
  if (normalizedKey.length > SHA1_BLOCK_BYTES) {
    normalizedKey = sha1(normalizedKey);
  }
  const block = new Array(SHA1_BLOCK_BYTES).fill(0);
  for (let i = 0; i < normalizedKey.length; i++) {
    block[i] = normalizedKey[i];
  }
  const innerPad = block.map((byte) => byte ^ 54);
  const outerPad = block.map((byte) => byte ^ 92);
  const innerDigest = sha1(innerPad.concat(message));
  return sha1(outerPad.concat(innerDigest));
}
var UNRESERVED = (() => {
  const table = new Uint8Array(128);
  const marks = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~";
  for (const ch of marks) {
    table[ch.charCodeAt(0)] = 1;
  }
  return table;
})();
var HEX_UPPER = "0123456789ABCDEF";
function percentEncode(value) {
  const bytes = utf8Bytes(value);
  let out = "";
  for (const byte of bytes) {
    if (byte < 128 && UNRESERVED[byte] === 1) {
      out += String.fromCharCode(byte);
    } else {
      out += "%" + HEX_UPPER[byte >> 4 & 15] + HEX_UPPER[byte & 15];
    }
  }
  return out;
}

// src/providers/cdt-server.ts
var SERVER_ENTITY_PREFIX = "server-row:";
function parseServerRowId(entityId) {
  if (!entityId.startsWith(SERVER_ENTITY_PREFIX)) return null;
  const raw = entityId.slice(SERVER_ENTITY_PREFIX.length);
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}
var KNOWN_STATUSES = /* @__PURE__ */ new Set([
  "Pending",
  "Starting",
  "Running",
  "Stopping",
  "Stopped"
]);
function normalizeStatus(value) {
  if (typeof value === "string" && KNOWN_STATUSES.has(value)) {
    return value;
  }
  return "Unknown";
}
function numberOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function stringOrNull(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function normalizeServerBaseUrl(raw, allowInsecureHttp) {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "") return { ok: false, reason: "未填写服务器地址" };
  const match = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/.exec(trimmed);
  if (match === null) {
    return { ok: false, reason: "服务器地址格式无效" };
  }
  const scheme = match[1].toLowerCase();
  const authority = match[2];
  const path = match[3] ?? "";
  if (scheme === "http" && !allowInsecureHttp) {
    return {
      ok: false,
      reason: "服务器地址必须使用 HTTPS；本机调试需显式开启开发选项"
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
var CdtServerProvider = class {
  constructor(options) {
    __publicField(this, "mode", "server");
    __publicField(this, "capabilities", {
      instanceStatus: true,
      billing: true,
      // The v1 API cannot report a trustworthy observation time.
      verifiedObservationTimes: false
    });
    __publicField(this, "statusMemo", null);
    __publicField(this, "options");
    this.options = options;
  }
  /** Raise a sanitized v1 error with a scope-appropriate message. */
  errorFor(status, scope, entityId) {
    const at = scope.now().toISOString();
    let code;
    let message;
    if (status === 401) {
      code = "TokenRejected";
      message = "只读 Token 无效或已撤销，请重新创建 widget:read Key";
    } else if (status === 403) {
      code = "ScopeMissing";
      message = "只读 Token 缺少 widget:read 权限（不会自动改用管理员登录）";
    } else {
      code = "ServerError";
      message = `服务器返回 HTTP ${status}`;
    }
    const sanitizedError = { code, message, at, retryable: status >= 500 };
    return new ProviderError(sanitizedError);
  }
  /** Fetch `/api/v1/status` once per run. */
  fetchStatus(scope) {
    if (this.statusMemo !== null) return this.statusMemo;
    const pending = (async () => {
      const url = `${this.options.endpoint.baseUrl}/api/v1/status`;
      let response;
      try {
        response = await this.options.http.get(url, {
          headers: {
            Authorization: `Bearer ${this.options.endpoint.token}`,
            Accept: "application/json"
          },
          timeout: this.options.requestTimeoutMs,
          credentials: "omit",
          redirect: "error"
        });
      } catch {
        throw new ProviderError({
          code: "NetworkError",
          message: "无法连接服务器",
          at: scope.now().toISOString(),
          retryable: true
        });
      }
      if (response.status !== 200) {
        throw this.errorFor(response.status, scope, "server");
      }
      let parsed;
      try {
        parsed = JSON.parse(await response.text());
      } catch {
        throw new ProviderError({
          code: "MalformedResponse",
          message: "服务器返回了无法解析的内容",
          at: scope.now().toISOString(),
          retryable: false
        });
      }
      return parseServerStatus(parsed);
    })();
    this.statusMemo = pending;
    return pending;
  }
  /** Look up the row backing an entity id. */
  async rowFor(scope, entityId) {
    const rowId = parseServerRowId(entityId);
    if (rowId === null) {
      throw new ProviderError({
        code: "UnknownEntity",
        message: "server 模式下的实体必须以 server-row:<id> 命名",
        at: scope.now().toISOString(),
        retryable: false
      });
    }
    const status = await this.fetchStatus(scope);
    const row = status.rows.find((candidate) => candidate.id === rowId);
    if (row === void 0) {
      throw new ProviderError({
        code: "RowNotFound",
        message: `服务器快照中不存在配置行 ${rowId}`,
        at: scope.now().toISOString(),
        retryable: false
      });
    }
    return row;
  }
  async getTraffic(scope, query) {
    const row = await this.rowFor(scope, query.scope.id);
    const warnings = [
      "服务器记录时间不是云端采样时间，可能包含陈旧字段"
    ];
    if (row.stale) warnings.push("服务器将该行标记为 stale");
    if (row.flowUsed === null) {
      throw new ProviderError({
        code: "MissingTraffic",
        message: "服务器快照中缺少该行的流量数据",
        at: scope.now().toISOString(),
        retryable: false
      });
    }
    const quality = "legacy-unverified";
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
      warnings
    };
  }
  async getInstanceStatus(scope, query) {
    const row = await this.rowFor(scope, query.instance.id);
    return {
      instanceId: query.instance.instanceId,
      status: row.instanceStatus,
      observedAt: null,
      legacyUpdatedAt: row.lastUpdated
    };
  }
  async getBalance(scope, query) {
    const row = await this.rowFor(scope, query.account.id);
    if (row.billingError !== null && row.billingError !== "") {
      throw new ProviderError({
        code: "BillingError",
        message: "服务器记录了账单查询错误",
        at: scope.now().toISOString(),
        retryable: false
      });
    }
    if (row.balance === null) {
      throw new ProviderError({
        code: "BillingDisabled",
        message: "服务器未启用或尚未缓存账单数据",
        at: scope.now().toISOString(),
        retryable: false
      });
    }
    return {
      amount: row.balance,
      currency: row.currency ?? "CNY",
      observedAt: scope.now().toISOString()
    };
  }
  async getInstanceBill(scope, query, cycle) {
    const row = await this.rowFor(scope, query.instance.id);
    if (row.monthlyCost === null) {
      throw new ProviderError({
        code: "BillingDisabled",
        message: "服务器未启用或尚未缓存实例账单",
        at: scope.now().toISOString(),
        retryable: false
      });
    }
    return {
      totalCost: row.monthlyCost,
      currency: row.currency,
      cycle,
      // v1 caches a single value; pagination state is not exposed.
      partial: false,
      observedAt: scope.now().toISOString()
    };
  }
};
function parseServerStatus(body) {
  const root2 = body !== null && typeof body === "object" ? body : {};
  const rawAccounts = Array.isArray(root2["accounts"]) ? root2["accounts"] : [];
  const rows = [];
  for (const entry of rawAccounts) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry;
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
      keepAlive: typeof record["keep_alive"] === "boolean" ? record["keep_alive"] : null,
      shutdownMode: stringOrNull(record["shutdown_mode"]),
      scheduleEnabled: record["schedule_enabled"] === true,
      startTime: stringOrNull(record["start_time"]),
      stopTime: stringOrNull(record["stop_time"])
    });
  }
  return {
    rows,
    systemLastRun: stringOrNull(root2["system_last_run"])
  };
}

// src/config/env.ts
var IssueCollector = class {
  constructor() {
    __publicField(this, "issues", []);
  }
  add(severity, field, message, entityId = null) {
    this.issues.push({ entityId, field, message, severity });
  }
  error(field, message, entityId = null) {
    this.add("error", field, message, entityId);
  }
  warn(field, message, entityId = null) {
    this.add("warning", field, message, entityId);
  }
  /** Issues that should block the whole configuration. */
  globalErrors() {
    return this.issues.filter((issue) => issue.severity === "error" && issue.entityId === null);
  }
  /** Whether any error (global or scoped) was recorded. */
  hasErrors() {
    return this.issues.some((issue) => issue.severity === "error");
  }
};
function readString(env, key) {
  const raw = env[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}
function readBoolean(env, key, fallback, issues) {
  const raw = env[key];
  if (raw === void 0 || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  issues.warn(key, `${key} 只接受 true/false，已按默认值 ${String(fallback)} 处理`);
  return fallback;
}
function readNumber(env, key, fallback, issues) {
  const raw = env[key];
  if (raw === void 0 || raw.trim() === "") return fallback;
  const trimmed = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    issues.warn(key, `${key} 不是合法数字，已按默认值 ${fallback} 处理`);
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    issues.warn(key, `${key} 不是有限数字，已按默认值 ${fallback} 处理`);
    return fallback;
  }
  return parsed;
}
function readNonNegativeInteger(env, key, fallback, issues) {
  const value = readNumber(env, key, fallback, issues);
  if (!Number.isInteger(value) || value < 0) {
    issues.warn(key, `${key} 必须是非负整数，已按默认值 ${fallback} 处理`);
    return fallback;
  }
  return value;
}
function readEnum(env, key, allowed, fallback, issues) {
  const raw = env[key];
  if (raw === void 0 || raw.trim() === "") return fallback;
  const normalized = raw.trim();
  if (allowed.includes(normalized)) return normalized;
  issues.warn(
    key,
    `${key} 只能是 ${allowed.join(" / ")}，已按默认值 ${fallback} 处理`
  );
  return fallback;
}
function readJson(env, key, issues) {
  const raw = env[key];
  if (raw === void 0 || raw.trim() === "") return void 0;
  try {
    return JSON.parse(raw);
  } catch {
    issues.error(key, `${key} 不是合法的 JSON`);
    return null;
  }
}
function readList(env, key) {
  const raw = readString(env, key);
  if (raw === null) return null;
  const parts = raw.split(",").map((part) => part.trim()).filter((part) => part !== "");
  return parts.length === 0 ? null : parts;
}

// src/domain/timezone.ts
var ASIA_SHANGHAI_OFFSET_MINUTES = 8 * 60;
function pad2(value) {
  return value < 10 ? `0${value}` : String(value);
}
function buildParts(year, month, day, hour, minute, second) {
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    minuteOfDay: hour * 60 + minute,
    date: `${year}-${pad2(month)}-${pad2(day)}`
  };
}
function createIntlFormatter(timeZone) {
  if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") {
    return null;
  }
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    formatter.formatToParts(/* @__PURE__ */ new Date(0));
    return formatter;
  } catch {
    return null;
  }
}
var IntlTimeZoneProvider = class {
  constructor(timeZone, formatter) {
    __publicField(this, "support", "intl");
    __publicField(this, "timeZone");
    __publicField(this, "formatter");
    this.timeZone = timeZone;
    this.formatter = formatter;
  }
  isReliable() {
    return true;
  }
  limitation() {
    return null;
  }
  partsAt(instant) {
    const collected = {};
    for (const part of this.formatter.formatToParts(instant)) {
      if (part.type !== "literal") collected[part.type] = part.value;
    }
    let hour = Number(collected.hour);
    if (hour === 24) hour = 0;
    return buildParts(
      Number(collected.year),
      Number(collected.month),
      Number(collected.day),
      hour,
      Number(collected.minute),
      Number(collected.second)
    );
  }
  offsetMinutesAt(instant) {
    const parts = this.partsAt(instant);
    const asIfUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const instantSeconds = Math.floor(instant.getTime() / 1e3) * 1e3;
    return Math.round((asIfUtc - instantSeconds) / 6e4);
  }
};
var FixedOffsetTimeZoneProvider = class {
  constructor(timeZone, offsetMinutes) {
    __publicField(this, "support", "fixed-offset");
    __publicField(this, "timeZone");
    __publicField(this, "offsetMinutes");
    this.timeZone = timeZone;
    this.offsetMinutes = offsetMinutes;
  }
  isReliable() {
    return true;
  }
  limitation() {
    return "未检测到 Intl 时区支持，已按固定的 UTC+08:00 处理 Asia/Shanghai（该时区自 1991 年起无夏令时，因此结果仍然准确）";
  }
  partsAt(instant) {
    const shifted = new Date(instant.getTime() + this.offsetMinutes * 6e4);
    return buildParts(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth() + 1,
      shifted.getUTCDate(),
      shifted.getUTCHours(),
      shifted.getUTCMinutes(),
      shifted.getUTCSeconds()
    );
  }
  offsetMinutesAt() {
    return this.offsetMinutes;
  }
};
var UnsupportedTimeZoneProvider = class {
  constructor(timeZone, reason) {
    __publicField(this, "support", "unsupported");
    __publicField(this, "timeZone");
    __publicField(this, "reason");
    this.timeZone = timeZone;
    this.reason = reason;
  }
  isReliable() {
    return false;
  }
  limitation() {
    return this.reason;
  }
  partsAt() {
    throw new Error(`timezone ${this.timeZone} is not supported on this host`);
  }
  offsetMinutesAt() {
    throw new Error(`timezone ${this.timeZone} is not supported on this host`);
  }
};
function createTimeZoneProvider(timeZone) {
  const formatter = createIntlFormatter(timeZone);
  if (formatter !== null) {
    return new IntlTimeZoneProvider(timeZone, formatter);
  }
  if (timeZone === "Asia/Shanghai" || timeZone === "UTC+8" || timeZone === "+08:00") {
    return new FixedOffsetTimeZoneProvider(timeZone, ASIA_SHANGHAI_OFFSET_MINUTES);
  }
  return new UnsupportedTimeZoneProvider(
    timeZone,
    `当前运行环境缺少可用的时区数据，无法正确处理 ${timeZone}；本地定时与日报已停用`
  );
}

// src/config/validate.ts
var ADVANCED_SCHEMA_VERSION = 1;
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readRequiredString(record, key, where, issues) {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    issues.error(key, `${where} 缺少必填字符串字段 ${key}`);
    return null;
  }
  return value.trim();
}
function readOptionalString(record, key) {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim();
}
function readOptionalBoolean(record, key, fallback, where, issues) {
  const value = record[key];
  if (value === void 0) return fallback;
  if (typeof value !== "boolean") {
    issues.error(key, `${where} 的 ${key} 必须是布尔值`);
    return fallback;
  }
  return value;
}
function reportUnknownKeys(record, known, where, issues) {
  for (const key of Object.keys(record)) {
    if (!known.includes(key)) {
      issues.warn(key, `${where} 含有未知字段 ${key}，已忽略`);
    }
  }
}
function readQuota(value, where, issues) {
  if (value === void 0 || value === null) return null;
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
  if (source !== void 0 && source !== "user" && source !== "legacy") {
    issues.error("quota.source", `${where} 的 quota.source 必须是 user 或 legacy`);
    return null;
  }
  return {
    value: amount,
    unit,
    source: source === "legacy" ? "legacy" : "user"
  };
}
function readThreshold(value, where, issues) {
  if (value === void 0) return 95;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100) {
    issues.error("thresholdPercent", `${where} 的 thresholdPercent 必须落在 (0, 100]`);
    return 95;
  }
  return value;
}
function readSchedule(value, where, issues) {
  const fallback = { enabled: false, start: "08:00", stop: "23:30" };
  if (value === void 0) return fallback;
  if (!isRecord(value)) {
    issues.error("schedule", `${where} 的 schedule 必须是对象`);
    return fallback;
  }
  reportUnknownKeys(value, ["enabled", "start", "stop"], `${where}.schedule`, issues);
  const enabled = readOptionalBoolean(value, "enabled", false, `${where}.schedule`, issues);
  const start = normalizeClockTime(typeof value["start"] === "string" ? value["start"] : "");
  const stop = normalizeClockTime(typeof value["stop"] === "string" ? value["stop"] : "");
  if (start === null) {
    issues.error("schedule.start", `${where} 的 schedule.start 不是合法 HH:mm`);
    return fallback;
  }
  if (stop === null) {
    issues.error("schedule.stop", `${where} 的 schedule.stop 不是合法 HH:mm`);
    return fallback;
  }
  if (enabled && start === stop) {
    issues.error(
      "schedule",
      `${where} 的 schedule.start 与 schedule.stop 相同；如需全天窗口请等待显式的全天配置项`
    );
    return { enabled: false, start, stop };
  }
  return { enabled, start, stop };
}
function parseAdvancedModel(value, issues) {
  if (!isRecord(value)) {
    issues.error("CDT_ACCOUNTS_JSON", "CDT_ACCOUNTS_JSON 必须是 JSON 对象");
    return null;
  }
  if (value["schemaVersion"] !== ADVANCED_SCHEMA_VERSION) {
    issues.error(
      "schemaVersion",
      `不支持的 schemaVersion（需要 ${ADVANCED_SCHEMA_VERSION}）；不会回退到其他账号配置`
    );
    return null;
  }
  reportUnknownKeys(
    value,
    ["schemaVersion", "namespace", "credentials", "accounts", "trafficScopes", "instances"],
    "CDT_ACCOUNTS_JSON",
    issues
  );
  const credentials = [];
  const credentialIds = /* @__PURE__ */ new Set();
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
      issues
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
      siteType,
      ...readOptionalString(entry, "securityToken") !== null ? { securityToken: readOptionalString(entry, "securityToken") } : {}
    });
  }
  const accounts = [];
  const accountIds = /* @__PURE__ */ new Set();
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
      aliyunUid: readOptionalString(entry, "aliyunUid")
    });
  }
  for (const credential of credentials) {
    if (!accountIds.has(credential.accountId)) {
      issues.error(
        "credentials.accountId",
        `凭据 ${credential.id} 引用了不存在的账户 ${credential.accountId}`,
        credential.id
      );
    }
  }
  const trafficScopes = [];
  const scopeIds = /* @__PURE__ */ new Set();
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
      issues
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
    const controlTargets = [];
    if (entry["controlTargets"] !== void 0) {
      if (!Array.isArray(entry["controlTargets"])) {
        issues.error("controlTargets", `流量范围 ${id} 的 controlTargets 必须是数组`, id);
      } else {
        for (const target of entry["controlTargets"]) {
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
      trafficClass,
      quota: readQuota(entry["quota"], `流量范围 ${id}`, issues),
      thresholdPercent: readThreshold(entry["thresholdPercent"], `流量范围 ${id}`, issues),
      controlTargets
    });
  }
  if (trafficScopes.length === 0) {
    issues.error("trafficScopes", "trafficScopes 不能为空");
    return null;
  }
  const instances = [];
  const instanceIds = /* @__PURE__ */ new Set();
  const rawInstances = value["instances"];
  if (rawInstances !== void 0 && !Array.isArray(rawInstances)) {
    issues.error("instances", "instances 必须是数组");
    return null;
  }
  for (const entry of rawInstances ?? []) {
    if (!isRecord(entry)) {
      issues.error("instances", "instances 中存在非对象条目");
      continue;
    }
    const where = "instances[]";
    reportUnknownKeys(
      entry,
      [
        "id",
        "accountId",
        "credentialId",
        "trafficScopeId",
        "regionId",
        "instanceId",
        "name",
        "keepAlive",
        "shutdownMode",
        "schedule"
      ],
      where,
      issues
    );
    const id = readRequiredString(entry, "id", where, issues);
    const accountId = readRequiredString(entry, "accountId", where, issues);
    const credentialId = readRequiredString(entry, "credentialId", where, issues);
    const trafficScopeId = readRequiredString(entry, "trafficScopeId", where, issues);
    const regionId = readRequiredString(entry, "regionId", where, issues);
    const instanceId = readRequiredString(entry, "instanceId", where, issues);
    if (id === null || accountId === null || credentialId === null || trafficScopeId === null || regionId === null || instanceId === null) {
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
    if (shutdownMode !== void 0 && shutdownMode !== "KeepCharging" && shutdownMode !== "StopCharging") {
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
      shutdownMode: shutdownMode === "StopCharging" ? "StopCharging" : "KeepCharging",
      schedule: readSchedule(entry["schedule"], `实例 ${id}`, issues)
    });
  }
  return { credentials, accounts, trafficScopes, instances };
}
function validateTimeZone(timeZone, issues, field = "CDT_TIMEZONE") {
  const provider = createTimeZoneProvider(timeZone);
  if (!provider.isReliable()) {
    issues.error(field, `无法在当前环境使用该时区：${timeZone}`);
    return false;
  }
  return true;
}
function parseThresholdAction(value, fallback, where, issues) {
  if (value === void 0) return fallback;
  if (value === "notify_only" || value === "stop_and_notify") return value;
  issues.error("thresholdAction", `${where} 的 thresholdAction 非法`);
  return fallback;
}

// src/config/parse.ts
var ENV_KEYS = {
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
  theme: "CDT_THEME"
};
var DEFAULT_REFRESH_SECONDS = 900;
var DEFAULT_AUTOMATION_INTERVAL_SECONDS = 300;
function emptyControlConfig() {
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
    pauseUntil: null
  };
}
function emptyNotificationConfig(localNotify) {
  return {
    schemaVersion: 1,
    local: localNotify,
    telegram: { enabled: false, botToken: "", chatId: "" },
    webhook: { enabled: false, url: "", method: "POST", bodyTemplate: "" },
    dailyReport: { enabled: false, time: "22:00", compensationWindowMinutes: 20 }
  };
}
function readViewSelection(env) {
  return {
    scopeId: readString(env, ENV_KEYS.scopeId),
    instanceIds: readList(env, ENV_KEYS.instanceIds),
    theme: readString(env, ENV_KEYS.theme)
  };
}
function fnv1aHex(input) {
  let hash = 2166136261;
  for (const byte of utf8Bytes(input)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
function computeConfigFingerprint(config) {
  const identity = {
    mode: config.mode,
    namespace: config.namespace,
    credentials: config.credentials.map((credential) => ({
      id: credential.id,
      accountId: credential.accountId,
      // The AK id participates (a rotated key must invalidate caches) but the
      // secret never does: it must not reach cache keys.
      accessKeyId: credential.accessKeyId,
      siteType: credential.siteType
    })).sort((a, b) => a.id < b.id ? -1 : 1),
    accounts: config.accounts.map((account) => account.id).sort(),
    scopes: config.trafficScopes.map((scope) => ({
      id: scope.id,
      accountId: scope.accountId,
      credentialId: scope.credentialId,
      trafficClass: scope.trafficClass,
      quota: scope.quota,
      threshold: scope.thresholdPercent
    })).sort((a, b) => a.id < b.id ? -1 : 1),
    instances: config.instances.map((instance) => ({
      id: instance.id,
      accountId: instance.accountId,
      trafficScopeId: instance.trafficScopeId,
      regionId: instance.regionId,
      instanceId: instance.instanceId
    })).sort((a, b) => a.id < b.id ? -1 : 1),
    server: config.server === null ? null : config.server.baseUrl
  };
  return fnv1aHex(JSON.stringify(identity));
}
function parseControlConfig(value, knownCredentialIds, knownInstanceIds, knownScopeIds, issues) {
  const config = emptyControlConfig();
  if (value === void 0) return config;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    issues.error("CDT_CONTROL_JSON", "CDT_CONTROL_JSON 必须是 JSON 对象，控制保持关闭");
    return config;
  }
  const record = value;
  if (record["schemaVersion"] !== 1) {
    issues.error("CDT_CONTROL_JSON.schemaVersion", "不支持的 control schemaVersion，控制保持关闭");
    return config;
  }
  const knownKeys = [
    "schemaVersion",
    "enabled",
    "deviceVerification",
    "credentialId",
    "allowedInstanceIds",
    "scopes",
    "instances",
    "actionCooldownSeconds",
    "pauseUntil",
    // Shorthands for the common single-instance / single-scope case.
    "verifiedOnDevice",
    "keepAlive",
    "stopWhenOverThreshold"
  ];
  for (const key of Object.keys(record)) {
    if (!knownKeys.includes(key)) {
      issues.error("CDT_CONTROL_JSON", `CDT_CONTROL_JSON 含有未知字段 ${key}，控制保持关闭`);
      return config;
    }
  }
  if (record["enabled"] !== void 0 && typeof record["enabled"] !== "boolean") {
    issues.error("CDT_CONTROL_JSON.enabled", "enabled 必须是布尔值，控制保持关闭");
    return config;
  }
  config.enabled = record["enabled"] === true;
  const verifiedOnDevice = record["verifiedOnDevice"];
  if (verifiedOnDevice !== void 0) {
    if (typeof verifiedOnDevice !== "string" || !Number.isFinite(Date.parse(verifiedOnDevice))) {
      issues.error(
        "CDT_CONTROL_JSON.verifiedOnDevice",
        "verifiedOnDevice 必须是合法的 ISO 8601 日期，控制保持关闭"
      );
      config.enabled = false;
      return config;
    }
    if (record["deviceVerification"] !== void 0) {
      issues.error(
        "CDT_CONTROL_JSON",
        "verifiedOnDevice 与 deviceVerification 不能同时使用，控制保持关闭"
      );
      config.enabled = false;
      return config;
    }
    config.deviceVerification = {
      crossExecutionIntentClaim: true,
      hostSerializesSameTarget: true,
      verifiedAt: verifiedOnDevice,
      note: "verifiedOnDevice"
    };
  }
  const attestation = record["deviceVerification"];
  if (attestation !== void 0) {
    if (attestation === null || typeof attestation !== "object" || Array.isArray(attestation)) {
      issues.error(
        "CDT_CONTROL_JSON.deviceVerification",
        "deviceVerification 必须是对象，控制保持关闭"
      );
      config.enabled = false;
      return config;
    }
    const item = attestation;
    const allowed2 = ["crossExecutionIntentClaim", "hostSerializesSameTarget", "verifiedAt", "note"];
    for (const key of Object.keys(item)) {
      if (!allowed2.includes(key)) {
        issues.error(
          "CDT_CONTROL_JSON.deviceVerification",
          `deviceVerification 含未知字段 ${key}，控制保持关闭`
        );
        config.enabled = false;
        return config;
      }
    }
    for (const key of ["crossExecutionIntentClaim", "hostSerializesSameTarget"]) {
      if (item[key] !== void 0 && typeof item[key] !== "boolean") {
        issues.error(
          "CDT_CONTROL_JSON.deviceVerification",
          `${key} 必须是布尔值，控制保持关闭`
        );
        config.enabled = false;
        return config;
      }
    }
    const crossExecution = item["crossExecutionIntentClaim"] === true;
    const serialises = item["hostSerializesSameTarget"] === true;
    let verifiedAt = null;
    if (item["verifiedAt"] !== void 0 && item["verifiedAt"] !== null) {
      if (typeof item["verifiedAt"] !== "string" || !Number.isFinite(Date.parse(item["verifiedAt"]))) {
        issues.error(
          "CDT_CONTROL_JSON.deviceVerification.verifiedAt",
          "verifiedAt 必须是合法的 ISO 8601 日期或时间，控制保持关闭"
        );
        config.enabled = false;
        return config;
      }
      verifiedAt = item["verifiedAt"];
    }
    if ((crossExecution || serialises) && verifiedAt === null) {
      issues.error(
        "CDT_CONTROL_JSON.deviceVerification.verifiedAt",
        "声明已通过真机验证时必须同时填写 verifiedAt，控制保持关闭"
      );
      config.enabled = false;
      return config;
    }
    config.deviceVerification = {
      crossExecutionIntentClaim: crossExecution,
      hostSerializesSameTarget: serialises,
      verifiedAt,
      note: typeof item["note"] === "string" ? item["note"] : null
    };
  }
  const credentialId = record["credentialId"];
  if (credentialId !== void 0 && credentialId !== null) {
    if (typeof credentialId !== "string" || !knownCredentialIds.includes(credentialId)) {
      issues.error("CDT_CONTROL_JSON.credentialId", "控制凭据不存在，控制保持关闭");
      config.enabled = false;
      return config;
    }
    config.credentialId = credentialId;
  } else if (knownCredentialIds.length === 1) {
    config.credentialId = knownCredentialIds[0];
  }
  const cooldown = record["actionCooldownSeconds"];
  if (cooldown !== void 0) {
    if (typeof cooldown !== "number" || !Number.isFinite(cooldown) || cooldown < 0) {
      issues.error("CDT_CONTROL_JSON.actionCooldownSeconds", "actionCooldownSeconds 必须是非负数");
      config.enabled = false;
      return config;
    }
    config.actionCooldownSeconds = cooldown;
  }
  const pauseUntil = record["pauseUntil"];
  if (pauseUntil !== void 0 && pauseUntil !== null) {
    if (typeof pauseUntil !== "string" || !Number.isFinite(Date.parse(pauseUntil))) {
      issues.error("CDT_CONTROL_JSON.pauseUntil", "pauseUntil 必须是合法的 ISO 8601 时间");
      config.enabled = false;
      return config;
    }
    config.pauseUntil = pauseUntil;
  }
  const rawScopes = record["scopes"];
  if (rawScopes !== void 0) {
    if (!Array.isArray(rawScopes)) {
      issues.error("CDT_CONTROL_JSON.scopes", "scopes 必须是数组");
      config.enabled = false;
      return config;
    }
    for (const entry of rawScopes) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        issues.error("CDT_CONTROL_JSON.scopes", "scopes 中存在非对象条目");
        config.enabled = false;
        return config;
      }
      const item = entry;
      const scopeId = item["scopeId"];
      if (typeof scopeId !== "string" || scopeId === "") {
        issues.error("CDT_CONTROL_JSON.scopes", "scope 缺少 scopeId");
        config.enabled = false;
        return config;
      }
      if (item["thresholdStopEnabled"] !== void 0 && typeof item["thresholdStopEnabled"] !== "boolean") {
        issues.error(
          "CDT_CONTROL_JSON.scopes",
          `scope ${scopeId} 的 thresholdStopEnabled 必须是布尔值`,
          scopeId
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
          issues
        ),
        thresholdStopEnabled: item["thresholdStopEnabled"] === true
      });
    }
  }
  const rawInstances = record["instances"];
  if (rawInstances !== void 0) {
    if (!Array.isArray(rawInstances)) {
      issues.error("CDT_CONTROL_JSON.instances", "instances 必须是数组");
      config.enabled = false;
      return config;
    }
    for (const entry of rawInstances) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        issues.error("CDT_CONTROL_JSON.instances", "instances 中存在非对象条目");
        config.enabled = false;
        return config;
      }
      const item = entry;
      const instanceId = item["instanceId"];
      if (typeof instanceId !== "string" || !knownInstanceIds.includes(instanceId)) {
        issues.error("CDT_CONTROL_JSON.instances", "控制 instances 引用了未知实例");
        config.enabled = false;
        return config;
      }
      const shutdownMode = item["shutdownMode"];
      if (shutdownMode !== void 0 && shutdownMode !== "KeepCharging" && shutdownMode !== "StopCharging") {
        issues.error(
          "CDT_CONTROL_JSON.instances",
          `实例 ${instanceId} 的 shutdownMode 非法`,
          instanceId
        );
        config.enabled = false;
        return config;
      }
      config.instances.push({
        instanceId,
        scheduleControlEnabled: item["scheduleControlEnabled"] === true,
        keepAlive: item["keepAlive"] === true,
        shutdownMode: shutdownMode === "StopCharging" ? "StopCharging" : "KeepCharging"
      });
    }
  }
  const allowed = record["allowedInstanceIds"];
  if (allowed !== void 0) {
    if (!Array.isArray(allowed)) {
      issues.error("CDT_CONTROL_JSON.allowedInstanceIds", "allowedInstanceIds 必须是数组");
      config.enabled = false;
      return config;
    }
    for (const entry of allowed) {
      if (typeof entry !== "string" || !knownInstanceIds.includes(entry)) {
        issues.error(
          "CDT_CONTROL_JSON.allowedInstanceIds",
          `控制白名单包含未知实例 ${String(entry)}，控制保持关闭`
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
  const keepAlive = record["keepAlive"];
  if (keepAlive !== void 0) {
    if (typeof keepAlive !== "boolean") {
      issues.error("CDT_CONTROL_JSON.keepAlive", "keepAlive 必须是布尔值，控制保持关闭");
      config.enabled = false;
      return config;
    }
    if (record["instances"] !== void 0 || record["allowedInstanceIds"] !== void 0) {
      issues.error(
        "CDT_CONTROL_JSON.keepAlive",
        "keepAlive 简写不能与 instances / allowedInstanceIds 同时使用，控制保持关闭"
      );
      config.enabled = false;
      return config;
    }
    if (knownInstanceIds.length === 0) {
      issues.error(
        "CDT_CONTROL_JSON.keepAlive",
        "没有可保活的实例：请先填写 CDT_INSTANCE_ID，控制保持关闭"
      );
      config.enabled = false;
      return config;
    }
    if (knownInstanceIds.length > 1) {
      issues.error(
        "CDT_CONTROL_JSON.keepAlive",
        `配置了 ${knownInstanceIds.length} 个实例，keepAlive 简写无法确定目标；请显式列出 allowedInstanceIds 与 instances`
      );
      config.enabled = false;
      return config;
    }
    const only = knownInstanceIds[0];
    config.allowedInstanceIds = [only];
    config.instances = [
      {
        instanceId: only,
        scheduleControlEnabled: false,
        keepAlive: keepAlive === true,
        shutdownMode: "KeepCharging"
      }
    ];
  }
  const stopShorthand = record["stopWhenOverThreshold"];
  if (stopShorthand !== void 0) {
    if (typeof stopShorthand !== "boolean") {
      issues.error("CDT_CONTROL_JSON.stopWhenOverThreshold", "stopWhenOverThreshold 必须是布尔值，控制保持关闭");
      config.enabled = false;
      return config;
    }
    if (record["scopes"] !== void 0) {
      issues.error(
        "CDT_CONTROL_JSON.stopWhenOverThreshold",
        "stopWhenOverThreshold 简写不能与 scopes 同时使用，控制保持关闭"
      );
      config.enabled = false;
      return config;
    }
    if (knownScopeIds.length === 0) {
      issues.error(
        "CDT_CONTROL_JSON.stopWhenOverThreshold",
        "没有可保护的流量范围，控制保持关闭"
      );
      config.enabled = false;
      return config;
    }
    if (knownScopeIds.length > 1) {
      issues.error(
        "CDT_CONTROL_JSON.stopWhenOverThreshold",
        `配置了 ${knownScopeIds.length} 个流量范围，简写无法确定目标；请显式列出 scopes`
      );
      config.enabled = false;
      return config;
    }
    config.scopes = [
      {
        scopeId: knownScopeIds[0],
        // The shorthand exists precisely to turn stopping on, so it sets both
        // fields the gate requires. `thresholdAction` alone would not be enough.
        thresholdStopEnabled: stopShorthand === true,
        thresholdAction: stopShorthand === true ? "stop_and_notify" : "notify_only"
      }
    ];
  }
  for (const policy of config.instances) {
    if (!config.allowedInstanceIds.includes(policy.instanceId)) {
      issues.error(
        "CDT_CONTROL_JSON",
        `实例 ${policy.instanceId} 有控制策略但不在 allowedInstanceIds 中，控制保持关闭`
      );
      config.enabled = false;
      return config;
    }
  }
  return config;
}
function parseNotificationConfig(value, localNotify, env, issues) {
  const config = emptyNotificationConfig(localNotify);
  if (value === void 0) return config;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    issues.error("CDT_NOTIFICATION_JSON", "CDT_NOTIFICATION_JSON 必须是 JSON 对象");
    return config;
  }
  const record = value;
  if (record["schemaVersion"] !== 1) {
    issues.error("CDT_NOTIFICATION_JSON.schemaVersion", "不支持的 notification schemaVersion");
    return config;
  }
  const telegram = record["telegram"];
  if (telegram !== void 0) {
    if (telegram === null || typeof telegram !== "object" || Array.isArray(telegram)) {
      issues.error("CDT_NOTIFICATION_JSON.telegram", "telegram 必须是对象");
    } else {
      const item = telegram;
      const token = readString(env, ENV_KEYS.telegramToken);
      const chatId = typeof item["chatId"] === "string" ? item["chatId"].trim() : "";
      const enabled = item["enabled"] === true;
      if (enabled && (token === null || chatId === "")) {
        issues.error(
          "CDT_NOTIFICATION_JSON.telegram",
          "启用 Telegram 通知需要 CDT_TELEGRAM_BOT_TOKEN 与 telegram.chatId"
        );
      } else {
        config.telegram = { enabled, botToken: token ?? "", chatId };
      }
    }
  }
  const webhook = record["webhook"];
  if (webhook !== void 0) {
    if (webhook === null || typeof webhook !== "object" || Array.isArray(webhook)) {
      issues.error("CDT_NOTIFICATION_JSON.webhook", "webhook 必须是对象");
    } else {
      const item = webhook;
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
            bodyTemplate: typeof item["bodyTemplate"] === "string" ? item["bodyTemplate"] : ""
          };
        }
      }
    }
  }
  const daily = record["dailyReport"];
  if (daily !== void 0) {
    if (daily === null || typeof daily !== "object" || Array.isArray(daily)) {
      issues.error("CDT_NOTIFICATION_JSON.dailyReport", "dailyReport 必须是对象");
    } else {
      const item = daily;
      const time = normalizeClockTime(typeof item["time"] === "string" ? item["time"] : "");
      if (time === null) {
        issues.error("CDT_NOTIFICATION_JSON.dailyReport.time", "日报时间必须是合法 HH:mm");
      } else {
        const window = item["compensationWindowMinutes"];
        config.dailyReport = {
          enabled: item["enabled"] === true,
          time,
          compensationWindowMinutes: typeof window === "number" && Number.isFinite(window) && window >= 0 ? window : 20
        };
      }
    }
  }
  return config;
}
function parseConfig(env, view = readViewSelection(env)) {
  const issues = new IssueCollector();
  const mode = readEnum(env, ENV_KEYS.mode, ["direct", "server"], "direct", issues);
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
    issues
  );
  const automationIntervalSeconds = readNonNegativeInteger(
    env,
    ENV_KEYS.automationIntervalSeconds,
    DEFAULT_AUTOMATION_INTERVAL_SECONDS,
    issues
  );
  let credentials = [];
  let accounts = [];
  let trafficScopes = [];
  let instances = [];
  const advancedRaw = readJson(env, ENV_KEYS.accountsJson, issues);
  if (advancedRaw === null) {
    issues.error(
      ENV_KEYS.accountsJson,
      "CDT_ACCOUNTS_JSON 无法解析；不会回退到简单模式以免产生重复账号"
    );
  }
  if (advancedRaw !== void 0 && advancedRaw !== null) {
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
        "已设置 CDT_ACCOUNTS_JSON，简单模式凭据字段被忽略，以避免同一账号被重复计数"
      );
    }
  } else {
    const built = buildSimpleModel(env, mode, namespace, displayName, timezone, issues);
    credentials = built.credentials;
    accounts = built.accounts;
    trafficScopes = built.trafficScopes;
    instances = built.instances;
  }
  let server = null;
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
          allowInsecureHttp: allowInsecure
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
    issues
  );
  if (mode === "direct" && control.enabled) {
    for (const scopePolicy of control.scopes) {
      if (!scopePolicy.thresholdStopEnabled) continue;
      const scope = trafficScopes.find((item) => item.id === scopePolicy.scopeId);
      if (scope !== void 0 && scope.quota === null) {
        issues.error(
          ENV_KEYS.controlJson,
          `范围 ${scopePolicy.scopeId} 开启了阈值停机，但 direct 模式没有可用上限；请填写 CDT_QUOTA`
        );
      }
    }
  }
  if (mode === "server" && control.enabled) {
    issues.error(
      ENV_KEYS.controlJson,
      "server 模式不提供本地云写控制（该模式没有云端凭据）；保活已关闭，请改用 direct 模式，或由 Go 后端执行实例操作"
    );
    control.enabled = false;
  }
  const notifications = parseNotificationConfig(
    readJson(env, ENV_KEYS.notificationJson, issues),
    localNotify,
    env,
    issues
  );
  if (billingEnabled && mode === "server" && server === null) {
    issues.warn(ENV_KEYS.billingEnabled, "server 模式未配置成功，账单查询将被跳过");
  }
  const config = {
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
    configFingerprint: ""
  };
  config.configFingerprint = computeConfigFingerprint(config);
  if (issues.globalErrors().length > 0) {
    return { ok: false, issues: issues.issues };
  }
  return { ok: true, config, issues: issues.issues };
}
function buildSimpleModel(env, mode, namespace, displayName, timezone, issues) {
  const accountLabel = readString(env, ENV_KEYS.accountId) ?? "main";
  const credentials = [];
  const accounts = [];
  const trafficScopes = [];
  const instances = [];
  const accountId = `account-${accountLabel}`;
  accounts.push({ id: accountId, name: displayName, aliyunUid: null });
  const regionId = readString(env, ENV_KEYS.regionId) ?? "cn-hongkong";
  const siteType = readEnum(
    env,
    ENV_KEYS.siteType,
    ["china", "international"],
    "china",
    issues
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
        ...securityToken !== null ? { securityToken } : {}
      });
    }
  } else {
    credentials.push({
      id: credentialId,
      accountId,
      accessKeyId: "server-mode",
      accessKeySecret: "",
      siteType
    });
  }
  const explicitClass = readEnum(
    env,
    ENV_KEYS.trafficClass,
    ["auto", "mainland", "overseas"],
    "auto",
    issues
  );
  const trafficClass = explicitClass === "auto" ? trafficClassOfRegion(regionId) : explicitClass;
  let quota = null;
  const quotaRaw = readString(env, ENV_KEYS.quota);
  if (quotaRaw !== null) {
    if (!/^\d+(\.\d+)?$/.test(quotaRaw)) {
      issues.error(ENV_KEYS.quota, "CDT_QUOTA 必须是正数");
    } else {
      const value = Number(quotaRaw);
      if (!Number.isFinite(value) || value <= 0) {
        issues.error(ENV_KEYS.quota, "CDT_QUOTA 必须大于 0");
      } else {
        const unit = readEnum(
          env,
          ENV_KEYS.quotaUnit,
          ["GB", "GiB"],
          "GB",
          issues
        );
        quota = { value, unit, source: "user" };
      }
    }
  }
  const thresholdPercent = validateThresholdSafe(
    readNumber(env, ENV_KEYS.thresholdPercent, 95, issues),
    issues
  );
  const scopeId = `scope-${accountLabel}-${trafficClass}`;
  trafficScopes.push({
    id: scopeId,
    accountId,
    credentialId,
    trafficClass,
    quota,
    thresholdPercent,
    controlTargets: []
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
      schedule: { enabled: false, start: "08:00", stop: "23:30" }
    });
  }
  return { credentials, accounts, trafficScopes, instances };
}
function validateThresholdSafe(value, issues) {
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    issues.error(ENV_KEYS.thresholdPercent, "CDT_THRESHOLD_PERCENT 必须落在 (0, 100]");
    return 95;
  }
  return value;
}

// src/host/egern.ts
function createClock() {
  return {
    now: () => /* @__PURE__ */ new Date()
  };
}
function detectRandomSource() {
  const candidate = globalThis["crypto"];
  if (candidate === null || typeof candidate !== "object") return null;
  const getRandomValues = candidate["getRandomValues"];
  if (typeof getRandomValues !== "function") return null;
  return candidate;
}
function createNonceFactory() {
  const source = detectRandomSource();
  let counter = 0;
  if (source !== null) {
    return {
      create() {
        const bytes = new Uint8Array(16);
        try {
          source.getRandomValues(bytes);
          return hexEncode(Array.from(bytes));
        } catch {
          counter++;
          return degraded(counter);
        }
      },
      describe: () => "crypto.getRandomValues（宿主提供）",
      isCryptographicallyStrong: () => true
    };
  }
  return {
    create() {
      counter++;
      return degraded(counter);
    },
    describe: () => "时间戳 + 计数器 + Math.random（宿主未提供安全随机数，不视为加密安全）",
    isCryptographicallyStrong: () => false
  };
}
function degraded(counter) {
  const random = Math.floor(Math.random() * 4294967296) >>> 0;
  const part = (value, width) => value.toString(16).padStart(width, "0").slice(-width);
  return part(Date.now() >>> 0, 8) + part(Math.floor(Date.now() / 4294967296) >>> 0, 4) + part(counter >>> 0, 4) + part(random, 8);
}
function wrapHttp(ctx) {
  const invoke = async (method, url, options) => {
    const response = await ctx.http[method](url, options);
    return {
      status: response.status,
      text: () => response.text()
    };
  };
  return {
    get: (url, options) => invoke("get", url, options),
    post: (url, options) => invoke("post", url, options)
  };
}
function wrapStorage(ctx) {
  const safeGet = (key) => {
    try {
      const value = ctx.storage.get(key);
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  };
  return {
    get: safeGet,
    set: (key, value) => {
      ctx.storage.set(key, value);
    },
    getJSON: (key) => {
      try {
        return ctx.storage.getJSON(key);
      } catch {
        return null;
      }
    },
    setJSON: (key, value) => {
      ctx.storage.setJSON(key, value);
    },
    delete: (key) => {
      try {
        ctx.storage.delete(key);
      } catch {
      }
    }
  };
}
function wrapNotifier(ctx) {
  return {
    notify(options) {
      ctx.notify(options);
    }
  };
}
function readEnvMap(ctx) {
  const result = {};
  const source = ctx.env;
  if (source === null || typeof source !== "object") return result;
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

// src/providers/aliyun/signing.ts
var SIGNATURE_PARAM = "Signature";
function canonicalizedQueryString(params) {
  const keys = Object.keys(params).filter((key) => key !== SIGNATURE_PARAM).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const parts = [];
  for (const key of keys) {
    parts.push(`${percentEncode(key)}=${percentEncode(params[key])}`);
  }
  return parts.join("&");
}
function stringToSign(httpMethod, canonicalQuery) {
  return `${httpMethod.toUpperCase()}&${percentEncode("/")}&${percentEncode(canonicalQuery)}`;
}
function signParams(params, secret, httpMethod = "POST") {
  const canonicalQuery = canonicalizedQueryString(params);
  const toSign = stringToSign(httpMethod, canonicalQuery);
  const keyBytes = utf8Bytes(`${secret}&`);
  const digest = hmacSha1(keyBytes, utf8Bytes(toSign));
  return base64Encode(digest);
}
function formatRpcTimestamp(instant) {
  const iso = instant.toISOString();
  return `${iso.slice(0, 19)}Z`;
}
function buildCommonParams(input) {
  const params = {
    AccessKeyId: input.accessKeyId,
    Action: input.action,
    Format: "JSON",
    RegionId: input.regionId,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: input.nonce,
    SignatureVersion: "1.0",
    Timestamp: formatRpcTimestamp(input.timestamp),
    Version: input.version
  };
  if (input.securityToken !== void 0 && input.securityToken !== "") {
    params.SecurityToken = input.securityToken;
  }
  return params;
}

// src/providers/aliyun/rpc.ts
var MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
var MAX_JSON_DEPTH = 24;
var SUCCESS_CODES = /* @__PURE__ */ new Set(["ok", "200", "success", "true"]);
function encodeFormBody(params) {
  const parts = [];
  for (const key of Object.keys(params)) {
    parts.push(`${percentEncode(key)}=${percentEncode(params[key])}`);
  }
  return parts.join("&");
}
function jsonDepth(value, limit = MAX_JSON_DEPTH) {
  const stack2 = [{ node: value, depth: 1 }];
  let maxDepth = 0;
  while (stack2.length > 0) {
    const current = stack2.pop();
    if (current.depth > maxDepth) maxDepth = current.depth;
    if (maxDepth > limit) return maxDepth;
    const node = current.node;
    if (Array.isArray(node)) {
      for (const child of node) stack2.push({ node: child, depth: current.depth + 1 });
    } else if (node !== null && typeof node === "object") {
      for (const child of Object.values(node)) {
        stack2.push({ node: child, depth: current.depth + 1 });
      }
    }
  }
  return maxDepth;
}
function sanitized(code, message, at, retryable) {
  return { code, message, at: at.toISOString(), retryable };
}
function isSuccessCode(code) {
  return SUCCESS_CODES.has(code.trim().toLowerCase());
}
function isTimestampError(code, message) {
  const text2 = `${code} ${message}`.toLowerCase().replace(/\s+/g, "");
  return text2.includes("timestamp") && (text2.includes("expired") || text2.includes("notsupplied") || text2.includes("missing"));
}
function isThrottleError(code) {
  return code.toLowerCase().includes("throttl");
}
async function readBoundedText(response) {
  const text2 = await response.text();
  if (text2.length > MAX_RESPONSE_BYTES) {
    return { ok: false };
  }
  return { ok: true, text: text2 };
}
async function callRpc(deps, request) {
  const maxAttempts = Math.max(1, request.idempotent ? deps.maxAttempts : 1);
  let attempts = 0;
  let lastError = null;
  while (attempts < maxAttempts) {
    if (deps.deadlineMs !== void 0 && deps.clock.now().getTime() >= deps.deadlineMs) {
      break;
    }
    attempts++;
    const now = deps.clock.now();
    const signed = {
      ...buildCommonParams({
        accessKeyId: request.credential.accessKeyId,
        action: request.action,
        version: request.version,
        regionId: request.regionId,
        timestamp: now,
        nonce: deps.nonce.create(),
        ...request.credential.securityToken !== void 0 ? { securityToken: request.credential.securityToken } : {}
      }),
      ...request.params
    };
    const signature = signParams(signed, request.credential.accessKeySecret, "POST");
    const body = encodeFormBody({ ...signed, Signature: signature });
    let response;
    try {
      response = await deps.http.post(`https://${request.host}/`, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        timeout: deps.requestTimeoutMs,
        credentials: "omit",
        // A signed request must never be silently re-sent to another origin.
        redirect: "error"
      });
    } catch {
      lastError = sanitized("NetworkError", "网络请求失败或超时", now, true);
      continue;
    }
    const status = response.status;
    let text2;
    try {
      const read = await readBoundedText(response);
      if (!read.ok) {
        return {
          ok: false,
          error: sanitized("ResponseTooLarge", "云接口响应过大，已拒绝解析", now, false),
          attempts
        };
      }
      text2 = read.text;
    } catch {
      lastError = sanitized("NetworkError", "读取云接口响应失败", now, true);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(text2);
    } catch {
      lastError = sanitized(
        "MalformedResponse",
        `云接口返回了无法解析的内容（HTTP ${status}）`,
        now,
        status >= 500
      );
      continue;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: sanitized("MalformedResponse", "云接口返回了非预期的 JSON 结构", now, false),
        attempts
      };
    }
    if (jsonDepth(parsed) > MAX_JSON_DEPTH) {
      return {
        ok: false,
        error: sanitized("MalformedResponse", "云接口响应嵌套过深，已拒绝解析", now, false),
        attempts
      };
    }
    const record = parsed;
    const code = typeof record["Code"] === "string" ? record["Code"] : "";
    const message = typeof record["Message"] === "string" ? record["Message"] : "";
    const success = record["Success"];
    if (status === 401 || status === 403) {
      return {
        ok: false,
        error: sanitized(
          "AccessDenied",
          status === 401 ? "凭据无效或已被撤销" : "凭据缺少所需权限",
          now,
          false
        ),
        attempts
      };
    }
    if (status >= 400) {
      if (isTimestampError(code, message)) {
        lastError = sanitized("TimestampError", "请求时间戳过期，已重新签名", now, true);
        continue;
      }
      const retryable = status >= 500 || status === 429 || isThrottleError(code);
      lastError = sanitized(
        isThrottleError(code) ? "Throttled" : "HttpError",
        `云接口返回 HTTP ${status}`,
        now,
        retryable
      );
      continue;
    }
    if (code !== "" && !isSuccessCode(code)) {
      if (isTimestampError(code, message)) {
        lastError = sanitized("TimestampError", "请求时间戳过期，已重新签名", now, true);
        continue;
      }
      if (isThrottleError(code)) {
        lastError = sanitized("Throttled", "云接口限流，请稍后重试", now, true);
        continue;
      }
      return {
        ok: false,
        error: sanitized("ServiceError", `云接口返回业务错误：${code}`, now, false),
        attempts
      };
    }
    if (success === false) {
      return {
        ok: false,
        error: sanitized("ServiceError", "云接口返回 Success=false", now, false),
        attempts
      };
    }
    return { ok: true, body: record, attempts };
  }
  return {
    ok: false,
    error: lastError ?? sanitized("BudgetExhausted", "本次执行的时间预算已用尽", deps.clock.now(), true),
    attempts
  };
}

// src/providers/aliyun/parse.ts
function asRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}
function getPath(value, ...path) {
  let current = value;
  for (const key of path) {
    const record = asRecord(current);
    if (record === null) return void 0;
    current = record[key];
  }
  return current;
}
function asArray(value) {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (record === null) return null;
  if (Array.isArray(record["Item"])) return record["Item"];
  if (record["Item"] !== void 0 && record["Item"] !== null) return [record["Item"]];
  return null;
}
function strictNonNegativeNumber(value) {
  if (value === void 0 || value === null || value === "") {
    return { ok: false, reason: "missing" };
  }
  let parsed;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return { ok: false, reason: "not-a-number" };
    }
    parsed = Number(trimmed);
  } else {
    return { ok: false, reason: "not-a-number" };
  }
  if (!Number.isFinite(parsed)) return { ok: false, reason: "not-finite" };
  if (parsed < 0) return { ok: false, reason: "negative" };
  if (parsed > Number.MAX_SAFE_INTEGER) return { ok: false, reason: "unsafe-precision" };
  return { ok: true, value: parsed };
}
function strictString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// src/providers/aliyun/traffic.ts
function parseTrafficResponse(body) {
  const warnings = [];
  let raw = getPath(body, "TrafficDetails");
  if (raw === void 0) {
    raw = getPath(body, "Data", "TrafficDetails");
  }
  if (raw === void 0) {
    return {
      entries: [],
      confirmedEmpty: false,
      unrecognized: true,
      rejectedEntries: 0,
      warnings,
      reason: "响应中缺少 TrafficDetails 字段，无法确认用量"
    };
  }
  const list = asArray(raw);
  if (list === null) {
    return {
      entries: [],
      confirmedEmpty: false,
      unrecognized: true,
      rejectedEntries: 0,
      warnings,
      reason: "TrafficDetails 的结构无法识别"
    };
  }
  if (list.length === 0) {
    return {
      entries: [],
      confirmedEmpty: true,
      unrecognized: false,
      rejectedEntries: 0,
      warnings,
      reason: null
    };
  }
  const entries = [];
  let rejectedEntries = 0;
  for (let index = 0; index < list.length; index++) {
    const item = asRecord(list[index]);
    if (item === null) {
      rejectedEntries++;
      warnings.push(`第 ${index + 1} 条流量明细不是对象，已忽略`);
      continue;
    }
    const regionId = strictString(item["BusinessRegionId"]);
    if (regionId === null) {
      rejectedEntries++;
      warnings.push(`第 ${index + 1} 条流量明细缺少 BusinessRegionId，已忽略`);
      continue;
    }
    const traffic = strictNonNegativeNumber(item["Traffic"]);
    if (!traffic.ok) {
      rejectedEntries++;
      warnings.push(
        `地区 ${regionId} 的 Traffic 字段无效（${traffic.reason}），已忽略`
      );
      continue;
    }
    entries.push({ regionId, rawValue: traffic.value });
  }
  if (rejectedEntries > 0) {
    warnings.push(
      `共 ${rejectedEntries} 条明细无法解析；其用量未计入，因此结果可能偏低`
    );
  }
  return {
    entries,
    confirmedEmpty: false,
    unrecognized: false,
    rejectedEntries,
    warnings,
    reason: null
  };
}
function aggregateTraffic(entries, trafficClass, partial = false) {
  let rawTotal = 0;
  const regions = [];
  for (const entry of entries) {
    if (trafficClassOfRegion(entry.regionId) !== trafficClass) continue;
    rawTotal += entry.rawValue;
    regions.push(entry.regionId);
  }
  regions.sort();
  return { rawTotal, regions, partial };
}
var TRAFFIC_UNIT_ASSUMPTION = "bytes-unverified";

// src/providers/aliyun/ecs.ts
var KNOWN_STATUSES2 = /* @__PURE__ */ new Set([
  "Pending",
  "Starting",
  "Running",
  "Stopping",
  "Stopped"
]);
function normalizeInstanceStatus(value) {
  if (value !== null && KNOWN_STATUSES2.has(value)) {
    return value;
  }
  return "Unknown";
}
function parseInstanceStatus(body, targetInstanceId) {
  const list = asArray(getPath(body, "InstanceStatuses", "InstanceStatus"));
  if (list === null) {
    return {
      status: "Unknown",
      matched: false,
      inspectedCount: 0,
      reason: "响应中未包含实例状态列表"
    };
  }
  if (list.length === 0) {
    return {
      status: "Unknown",
      matched: false,
      inspectedCount: 0,
      reason: "响应中的实例状态列表为空"
    };
  }
  const target = targetInstanceId.trim();
  for (const item of list) {
    const record = asRecord(item);
    if (record === null) continue;
    const instanceId = strictString(record["InstanceId"]);
    if (instanceId === null || instanceId !== target) continue;
    const rawStatus = strictString(record["Status"]);
    const status = normalizeInstanceStatus(rawStatus);
    if (rawStatus !== null && status === "Unknown") {
      return {
        status: "Unknown",
        matched: true,
        inspectedCount: list.length,
        reason: `接口返回了无法识别的实例状态：${rawStatus}`
      };
    }
    if (rawStatus === null) {
      return {
        status: "Unknown",
        matched: true,
        inspectedCount: list.length,
        reason: "接口未返回实例状态字段"
      };
    }
    return { status, matched: true, inspectedCount: list.length, reason: null };
  }
  return {
    status: "Unknown",
    matched: false,
    inspectedCount: list.length,
    // Returning the first entry here would be the original bug. Refuse instead.
    reason: `响应中的 ${list.length} 条记录均不等于目标实例 ${target}`
  };
}

// src/providers/aliyun/billing.ts
function parseBalance(body) {
  const data = getPath(body, "Data");
  if (asRecord(data) === null) {
    return { ok: false, reason: "响应中缺少 Data 字段" };
  }
  const amount = strictNonNegativeNumber(getPath(body, "Data", "AvailableAmount"));
  if (!amount.ok) {
    return { ok: false, reason: `可用余额字段无效（${amount.reason}）` };
  }
  const currency = strictString(getPath(body, "Data", "Currency")) ?? "CNY";
  return { ok: true, amount: amount.value, currency };
}
function parseBillPage(body) {
  const items = asArray(getPath(body, "Data", "Items")) ?? [];
  const parsed = [];
  let rejectedItems = 0;
  for (const item of items) {
    const record = asRecord(item);
    if (record === null) {
      rejectedItems++;
      continue;
    }
    parsed.push(record);
  }
  const nextToken = strictString(getPath(body, "Data", "NextToken"));
  const totalCount = strictNonNegativeNumber(getPath(body, "Data", "TotalCount"));
  return {
    items: parsed,
    nextToken,
    totalCount: totalCount.ok ? totalCount.value : null,
    rejectedItems
  };
}
function sumBillItems(items, options) {
  let total = 0;
  let rejectedItems = 0;
  const currencies = /* @__PURE__ */ new Set();
  for (const item of items) {
    const amount = strictNonNegativeNumber(item["PretaxAmount"]);
    if (!amount.ok) {
      rejectedItems++;
      continue;
    }
    total += amount.value;
    const currency = strictString(item["Currency"]);
    if (currency !== null) currencies.add(currency);
  }
  return {
    // Round to cents for display; comparison against money is not a decision
    // this project makes.
    total: Math.round(total * 100) / 100,
    currencies: [...currencies].sort(),
    partial: options.partial || rejectedItems > 0,
    rejectedItems
  };
}

// src/providers/aliyun/direct.ts
var CDT_ENDPOINT = {
  host: "cdt.aliyuncs.com",
  regionId: "cn-hongkong",
  version: "2021-08-13",
  action: "ListCdtInternetTraffic"
};
var ECS_VERSION = "2014-05-26";
var BSS_VERSION = "2017-12-14";
var DEFAULT_MAX_BILL_PAGES = 5;
var DirectAliyunProvider = class _DirectAliyunProvider {
  constructor(deps) {
    __publicField(this, "mode", "direct");
    __publicField(this, "capabilities", {
      instanceStatus: true,
      billing: true,
      verifiedObservationTimes: true
    });
    __publicField(this, "maxBillPages");
    /** Per-run memo of the parsed CDT response, keyed by credential. */
    __publicField(this, "trafficMemo", /* @__PURE__ */ new Map());
    __publicField(this, "deps");
    this.deps = deps;
    this.maxBillPages = Math.max(1, deps.maxBillPages ?? DEFAULT_MAX_BILL_PAGES);
  }
  /** Unwrap an RPC result or raise a sanitized provider error. */
  static unwrap(result) {
    if (result.ok) return result.body;
    throw new ProviderError(result.error);
  }
  /** Fetch (and memoize) the raw CDT traffic detail for one credential. */
  getTrafficDetail(query) {
    const key = query.credential.id;
    const existing = this.trafficMemo.get(key);
    if (existing !== void 0) return existing;
    const pending = (async () => {
      const result = await callRpc(this.deps, {
        credential: query.credential,
        host: CDT_ENDPOINT.host,
        version: CDT_ENDPOINT.version,
        action: CDT_ENDPOINT.action,
        regionId: CDT_ENDPOINT.regionId,
        // No period parameter exists for this action; none is invented.
        // `BusinessRegionId` is left unset, matching the original client.
        params: {},
        idempotent: true
      });
      return parseTrafficResponse(_DirectAliyunProvider.unwrap(result));
    })();
    this.trafficMemo.set(key, pending);
    return pending;
  }
  async getTraffic(scope, query) {
    const detail = await this.getTrafficDetail(query);
    if (detail.unrecognized) {
      throw new ProviderError({
        code: "UnrecognizedTrafficResponse",
        message: detail.reason ?? "CDT 用量响应无法识别",
        at: scope.now().toISOString(),
        retryable: false
      });
    }
    const aggregate = aggregateTraffic(
      detail.entries,
      query.scope.trafficClass,
      detail.rejectedEntries > 0
    );
    const warnings = [...detail.warnings];
    warnings.push("接口未声明 Traffic 单位，当前按字节处理（待核实）");
    return {
      usedBytes: aggregate.rawTotal,
      regions: aggregate.regions,
      partial: aggregate.partial,
      observedAt: scope.now().toISOString(),
      legacyUpdatedAt: null,
      periodId: UNVERIFIED_PERIOD,
      periodTimezone: null,
      sourceUnit: "bytes",
      freshnessQuality: "measured",
      // The CDT endpoint has no concept of a user quota, so nothing is offered.
      suggestedQuotaBytes: null,
      suggestedQuotaSource: null,
      warnings
    };
  }
  async getInstanceStatus(scope, query) {
    const { instance, credential } = query;
    const result = await callRpc(this.deps, {
      credential,
      host: `ecs.${instance.regionId}.aliyuncs.com`,
      version: ECS_VERSION,
      action: "DescribeInstanceStatus",
      regionId: instance.regionId,
      params: {
        RegionId: instance.regionId,
        // Sent as the scalar form the original client uses in production; the
        // official SDK's repeat-list form (`InstanceId.1`) is an open item.
        // Either way the response is matched exactly by id below.
        InstanceId: instance.instanceId
      },
      idempotent: true
    });
    const parsed = parseInstanceStatus(
      _DirectAliyunProvider.unwrap(result),
      instance.instanceId
    );
    if (!parsed.matched) {
      throw new ProviderError({
        code: "InstanceNotMatched",
        message: parsed.reason ?? "响应中未找到目标实例",
        at: scope.now().toISOString(),
        retryable: false
      });
    }
    if (parsed.status === "Unknown") {
      throw new ProviderError({
        code: "UnknownInstanceStatus",
        message: parsed.reason ?? "实例状态未知",
        at: scope.now().toISOString(),
        retryable: false
      });
    }
    return {
      instanceId: instance.instanceId,
      status: parsed.status,
      observedAt: scope.now().toISOString(),
      legacyUpdatedAt: null
    };
  }
  async getBalance(scope, query) {
    const endpoint = bssEndpointFor(query.credential.siteType);
    const result = await callRpc(this.deps, {
      credential: query.credential,
      host: endpoint.host,
      version: BSS_VERSION,
      action: "QueryAccountBalance",
      regionId: endpoint.regionId,
      params: {},
      idempotent: true
    });
    const parsed = parseBalance(_DirectAliyunProvider.unwrap(result));
    if (!parsed.ok) {
      throw new ProviderError({
        code: "BalanceParseError",
        message: parsed.reason,
        at: scope.now().toISOString(),
        retryable: false
      });
    }
    return {
      amount: parsed.amount,
      currency: parsed.currency,
      observedAt: scope.now().toISOString()
    };
  }
  async getInstanceBill(scope, query, cycle) {
    const endpoint = bssEndpointFor(query.credential.siteType);
    const collected = [];
    let nextToken = null;
    let pages = 0;
    let stoppedEarly = false;
    let rejectedItems = 0;
    do {
      const params = {
        BillingCycle: cycle,
        // The contract spells this parameter `InstanceID` (capital ID).
        InstanceID: query.instance.instanceId,
        Granularity: "MONTHLY"
      };
      if (nextToken !== null) params["NextToken"] = nextToken;
      const result = await callRpc(this.deps, {
        credential: query.credential,
        host: endpoint.host,
        version: BSS_VERSION,
        action: "DescribeInstanceBill",
        regionId: endpoint.regionId,
        params,
        idempotent: true
      });
      const page = parseBillPage(_DirectAliyunProvider.unwrap(result));
      collected.push(...page.items);
      rejectedItems += page.rejectedItems;
      nextToken = page.nextToken;
      pages++;
      if (nextToken !== null && pages >= this.maxBillPages) {
        stoppedEarly = true;
        break;
      }
    } while (nextToken !== null);
    const total = sumBillItems(collected, { partial: stoppedEarly || rejectedItems > 0 });
    return {
      totalCost: total.total,
      currency: total.currencies.length === 1 ? total.currencies[0] : null,
      cycle,
      partial: total.partial,
      observedAt: scope.now().toISOString()
    };
  }
  /** Expose the unit caveat for diagnostics. */
  get trafficUnitAssumption() {
    return TRAFFIC_UNIT_ASSUMPTION;
  }
};

// src/entries/runtime.ts
var WIDGET_BUDGET_MS = 15e3;
var MIN_REQUEST_TIMEOUT_MS = 2e3;
var MAX_REQUEST_TIMEOUT_MS = 8e3;
var READ_ATTEMPTS = 2;
function prepareRuntime(ctx, budgetMs) {
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
        fingerprint: config.configFingerprint
      }),
      clock,
      nonce: createNonceFactory(),
      http: wrapHttp(ctx),
      storage,
      notifier: wrapNotifier(ctx),
      deadlineMs: clock.now().getTime() + budgetMs
    }
  };
}
function requestTimeoutFor(runtime) {
  const remaining = runtime.deadlineMs - runtime.clock.now().getTime();
  const allowance = Math.floor(remaining / READ_ATTEMPTS) - 500;
  return Math.max(
    MIN_REQUEST_TIMEOUT_MS,
    Math.min(MAX_REQUEST_TIMEOUT_MS, allowance > 0 ? allowance : MIN_REQUEST_TIMEOUT_MS)
  );
}
function createProvider(runtime) {
  const requestTimeoutMs = requestTimeoutFor(runtime);
  if (runtime.config.mode === "server") {
    if (runtime.config.server === null) {
      throw new Error("server mode requires a configured endpoint");
    }
    return new CdtServerProvider({
      http: runtime.http,
      endpoint: {
        baseUrl: runtime.config.server.baseUrl,
        token: runtime.config.server.token
      },
      requestTimeoutMs
    });
  }
  return new DirectAliyunProvider({
    http: runtime.http,
    clock: runtime.clock,
    nonce: runtime.nonce,
    requestTimeoutMs,
    maxAttempts: READ_ATTEMPTS,
    deadlineMs: runtime.deadlineMs
  });
}
function describeIssues(issues, limit = 3) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const chosen = (errors.length > 0 ? errors : issues).slice(0, limit);
  return chosen.map((issue) => `${issue.field}: ${issue.message}`).join("；");
}

// src/entries/widget.ts
var MIN_REFRESH_AFTER_SECONDS = 60;
var MAX_REFRESH_AFTER_SECONDS = 3600;
async function main(ctx) {
  const family = asWidgetFamily(ctx.widgetFamily);
  try {
    return await renderWidget(ctx, family);
  } catch {
    return fallbackWidget("CDT Monitor", "小组件渲染失败", "请检查模块配置后重试", family);
  }
}
async function renderWidget(ctx, family) {
  const prepared = prepareRuntime(ctx, WIDGET_BUDGET_MS);
  if (!prepared.ok) {
    return fallbackWidget(
      "CDT Monitor",
      "配置有误，无法采集",
      describeIssues(prepared.issues),
      family
    );
  }
  const runtime = prepared.runtime;
  const { config, cache, clock } = runtime;
  const now = clock.now();
  const theme = resolveTheme(config.view.theme);
  let snapshot = loadSnapshotFromCache(config, cache, now);
  const cacheIsFresh = snapshot !== null && isSnapshotFresh(snapshot, now, Math.max(MIN_REFRESH_AFTER_SECONDS, config.refreshSeconds));
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
        skipBilling: true
      });
      if (collected.snapshot.trafficScopes.length > 0) {
        snapshot = collected.snapshot;
      }
    }
  }
  const resolved = snapshot ?? emptySnapshot(runtime);
  const histories = collectHistories(resolved, cache, config.trafficScopes.map((scope) => scope.id));
  const model = buildViewModel({ snapshot: resolved, config, now, histories, theme });
  return renderLayout(family, {
    model,
    theme,
    refreshAfter: nextRefreshIso(now, config.refreshSeconds),
    url: consoleUrl(config)
  });
}
function collectHistories(snapshot, cache, scopeIds) {
  const histories = /* @__PURE__ */ new Map();
  for (const scope of snapshot.trafficScopes) {
    const history = readCachedHistory(cache, scope.id);
    if (history !== null) histories.set(scope.id, history);
  }
  return histories;
}
function emptySnapshot(runtime) {
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
      balanceError: null
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
      thresholdPercent: scope.thresholdPercent
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
      actionState: null
    })),
    errors: []
  };
}
function nextRefreshIso(now, refreshSeconds) {
  const seconds = Math.min(
    MAX_REFRESH_AFTER_SECONDS,
    Math.max(MIN_REFRESH_AFTER_SECONDS, refreshSeconds)
  );
  return new Date(now.getTime() + seconds * 1e3).toISOString();
}
function consoleUrl(config) {
  if (config.mode === "server" && config.server !== null) {
    return config.server.baseUrl;
  }
  return "https://cdt.console.aliyun.com/";
}
function fallbackWidget(title, message, detail, family) {
  if (family === "accessoryInline") {
    return { type: "widget", children: [{ type: "text", text: `${title} ${message}`, font: { size: "caption1" } }] };
  }
  const children = [
    { type: "text", text: title, font: { size: "headline", weight: "semibold" }, maxLines: 1 },
    { type: "text", text: message, font: { size: "subheadline", weight: "medium" }, maxLines: 2 }
  ];
  if (detail !== "") {
    children.push({ type: "text", text: detail, font: { size: "caption2" }, maxLines: 3 });
  }
  if (family === "accessoryCircular") {
    return { type: "widget", children: [{ type: "text", text: "CDT", font: { size: "caption1" } }] };
  }
  return { type: "widget", children, padding: 16, gap: 6 };
}
export {
  main as default,
  fallbackWidget,
  nextRefreshIso
};
