/**
 * Unit handling and usage arithmetic.
 *
 * Three separate concerns live here, deliberately kept apart:
 *  1. **Units.** `GB` is decimal (10^9) and `GiB` is binary (2^30). The original
 *     Go implementation divided by 1024^3 but labelled the result "GB", which
 *     silently overstated or understated every threshold decision. All
 *     comparisons here happen on a single normalized unit: **bytes**.
 *  2. **Usage.** `remainingBytes` / `usagePercent` / `overThreshold`.
 *  3. **Comparison discipline.** Threshold decisions use the *raw* ratio. Only
 *     display rounds. The Go `usagePercent` rounded to 2 decimals *before*
 *     comparing, so a true 94.995% displayed as "95.00" and tripped a 95%
 *     threshold early. That behaviour is intentionally not reproduced.
 */

import type { QuotaUnit, TrafficClass } from "./models.ts";

/** Bytes in one decimal gigabyte (10^9). */
export const BYTES_PER_GB = 1_000_000_000;

/** Bytes in one binary gibibyte (2^30). */
export const BYTES_PER_GIB = 1_073_741_824;

/** Convert a user-facing quota into bytes. */
export function quotaToBytes(value: number, unit: QuotaUnit): number {
  return unit === "GB" ? value * BYTES_PER_GB : value * BYTES_PER_GIB;
}

/** Convert bytes into the given display unit. */
export function bytesToUnit(bytes: number, unit: QuotaUnit): number {
  return bytes / (unit === "GB" ? BYTES_PER_GB : BYTES_PER_GIB);
}

/**
 * Convert the Go v1 API's GiB-denominated figures into bytes.
 *
 * The legacy API reports `flow_used`/`flow_total` in GiB but both the Web UI and
 * the Android widget label them "GB". Imported values must be converted and
 * tagged `legacyGiB` so the mislabelling is not carried forward silently.
 */
export function legacyGibToBytes(gib: number): number {
  return gib * BYTES_PER_GIB;
}

/**
 * Derive the traffic class from a region id.
 *
 * `cn-hongkong` is deliberately `overseas`: it is a China-site region that
 * Aliyun still bills as international traffic. Whether the account is China or
 * International site does not affect this classification.
 */
export function trafficClassOfRegion(regionId: string): TrafficClass {
  if (regionId.startsWith("cn-") && regionId !== "cn-hongkong") {
    return "mainland";
  }
  return "overseas";
}

/** Result of a usage computation, distinguishing "zero" from "unknown". */
export interface UsageComputation {
  remainingBytes: number | null;
  usagePercent: number | null;
  overThreshold: boolean | null;
  /** Why the result is unknown, for user-facing diagnostics. */
  unknownReason: string | null;
}

function isFiniteNonNegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

/**
 * Compute remaining bytes, percentage and threshold state.
 *
 * A missing, zero, negative or non-finite quota yields `null` percentage and
 * `null` threshold state — never a fabricated `0%`, and never an automatic
 * control decision. A legal `0` usage with a valid quota is `0%`, which is a
 * real value rather than missing data.
 */
export function computeUsage(
  usedBytes: number | null,
  quotaBytes: number | null,
  thresholdPercent: number,
): UsageComputation {
  if (!isFiniteNonNegative(usedBytes)) {
    return {
      remainingBytes: null,
      usagePercent: null,
      overThreshold: null,
      unknownReason: "未获取到用量数据",
    };
  }
  if (!isFiniteNonNegative(quotaBytes) || quotaBytes <= 0) {
    return {
      remainingBytes: null,
      usagePercent: null,
      overThreshold: null,
      unknownReason: "未配置有效的流量上限",
    };
  }
  if (!Number.isFinite(thresholdPercent) || thresholdPercent <= 0 || thresholdPercent > 100) {
    return {
      remainingBytes: null,
      usagePercent: null,
      overThreshold: null,
      unknownReason: "告警阈值配置无效",
    };
  }

  // Raw comparison: no rounding, so 189.98/200 stays below a 95% threshold.
  const usagePercent = (usedBytes / quotaBytes) * 100;
  return {
    remainingBytes: Math.max(0, quotaBytes - usedBytes),
    usagePercent,
    overThreshold: usagePercent >= thresholdPercent,
    unknownReason: null,
  };
}

/**
 * Clamp a fraction into `[0, 1]` for drawing.
 *
 * Used only for graphics; text keeps the true percentage so an over-quota
 * state still reads "137%".
 */
export function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Sum scope usage for a total, counting each scope exactly once.
 *
 * Returns `null` when *any* contributing scope is unknown: reporting a partial
 * total as if it were complete is exactly the "sums look fine but are wrong"
 * failure mode the contract warns about.
 */
export function sumScopeUsage(
  scopes: ReadonlyArray<{ usedBytes: number | null }>,
): number | null {
  let total = 0;
  for (const scope of scopes) {
    if (scope.usedBytes === null || !Number.isFinite(scope.usedBytes)) return null;
    total += scope.usedBytes;
  }
  return total;
}

/**
 * Group monetary amounts by currency without converting between them.
 *
 * Balances for the same account must only be counted once; callers are
 * responsible for passing already-deduplicated entries.
 */
export function sumByCurrency(
  entries: ReadonlyArray<{ amount: number | null; currency: string | null }>,
): Array<{ currency: string; amount: number }> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.amount === null || !Number.isFinite(entry.amount)) continue;
    const currency = entry.currency ?? "UNKNOWN";
    totals.set(currency, (totals.get(currency) ?? 0) + entry.amount);
  }
  return [...totals.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}
