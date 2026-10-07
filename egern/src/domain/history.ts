/**
 * History handling.
 *
 * The original Go store keeps "hourly" and "daily" tables that hold **samples
 * of the provider's cumulative counter**, overwritten in place per bucket. Its
 * UI and daily report then re-interpret those as per-month consumption, even
 * though the provider request carries no explicit period parameter. The
 * consequences this module must avoid:
 *
 *  - presenting a cumulative counter as an exact per-interval consumption;
 *  - treating a cumulative *decrease* as evidence that the free allowance reset;
 *  - inventing a 24-hour baseline from two hours of data;
 *  - losing the real observation time behind a coarse bucket start.
 *
 * So samples keep both `bucket` (overwrite key) and `observedAt` (truth), and
 * every derived number carries a quality label describing what it really is.
 */

import type { FreshnessQuality, HistorySample, ProviderMode } from "./models.ts";
import { MAX_DAILY_SAMPLES, MAX_HOURLY_SAMPLES, UNVERIFIED_PERIOD } from "./models.ts";

/** Quality of a derived consumption figure. */
export type ConsumptionQuality =
  | "ok"
  /** The cumulative counter went backwards within one period: a data revision. */
  | "revision"
  /** The window spans a period boundary, so tail data is missing. */
  | "partial"
  /** The provider's period is unconfirmed, so only the cumulative value is shown. */
  | "unknown-period"
  /** Nothing to compare against. */
  | "no-baseline";

/** What a consumption figure actually represents. */
export type ConsumptionBasis =
  /** A raw cumulative counter reading, not a delta. */
  | "cumulative"
  /** A real delta over a measured interval. */
  | "window"
  | "unknown";

/** A consumption estimate with explicit provenance. */
export interface ConsumptionWindow {
  /** Consumption in bytes, or null when it must not be claimed. */
  consumedBytes: number | null;
  /** Real elapsed time between the two observations, in minutes. */
  coverageMinutes: number | null;
  basis: ConsumptionBasis;
  quality: ConsumptionQuality;
  /** Chinese description ready to render. */
  description: string;
}

/**
 * Insert or replace a sample in a bucket-ordered list.
 *
 * Replacement is keyed on `bucket` (matching the Go `ON CONFLICT DO UPDATE`),
 * but the *new* `observedAt` is kept, so the bucket start never masquerades as
 * the sampling instant. The list stays ascending by bucket and is trimmed to
 * `maxSamples` from the oldest end.
 */
export function upsertSample(
  samples: readonly HistorySample[],
  sample: HistorySample,
  maxSamples: number,
): HistorySample[] {
  const next = samples.filter((existing) => existing.bucket !== sample.bucket);
  next.push(sample);
  next.sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));
  if (next.length > maxSamples) {
    return next.slice(next.length - maxSamples);
  }
  return next;
}

/** Upsert into an hourly series, applying the hourly retention budget. */
export function upsertHourly(
  samples: readonly HistorySample[],
  sample: HistorySample,
): HistorySample[] {
  return upsertSample(samples, sample, MAX_HOURLY_SAMPLES);
}

/** Upsert into a daily series, applying the daily retention budget. */
export function upsertDaily(
  samples: readonly HistorySample[],
  sample: HistorySample,
): HistorySample[] {
  return upsertSample(samples, sample, MAX_DAILY_SAMPLES);
}

/**
 * Truncate an instant to the start of its UTC hour.
 *
 * Uses UTC rather than local time so the bucket key is stable regardless of the
 * device's timezone; the real observation time is preserved separately.
 */
export function hourlyBucket(instant: Date): string {
  const truncated = new Date(
    Date.UTC(
      instant.getUTCFullYear(),
      instant.getUTCMonth(),
      instant.getUTCDate(),
      instant.getUTCHours(),
    ),
  );
  return truncated.toISOString();
}

/** Truncate an instant to the start of its UTC day. */
export function dailyBucket(instant: Date): string {
  const truncated = new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()),
  );
  return truncated.toISOString();
}

/** Build a sample from a fresh observation. */
export function makeSample(input: {
  instant: Date;
  bytes: number;
  source: ProviderMode;
  periodId: string;
  quality: FreshnessQuality;
  granularity: "hour" | "day";
}): HistorySample {
  return {
    bucket: input.granularity === "hour" ? hourlyBucket(input.instant) : dailyBucket(input.instant),
    observedAt: input.instant.toISOString(),
    bytes: input.bytes,
    source: input.source,
    periodId: input.periodId,
    quality: input.quality,
  };
}

function minutesBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return (to - from) / 60000;
}

function formatHours(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  const hours = minutes / 60;
  return hours < 10 ? `${hours.toFixed(1)} 小时` : `${Math.round(hours)} 小时`;
}

/**
 * Derive consumption over the requested window from cumulative samples.
 *
 * Follows the contract's rules:
 *  - only a **verified** period may be labelled as a month-to-date delta;
 *  - an unverified period yields the cumulative reading only, never a delta;
 *  - a cumulative decrease inside one period is a revision, not a reset;
 *  - a window spanning two periods is `partial`;
 *  - two hours of data is reported as two hours, never as 24.
 */
export function computeConsumption(
  samples: readonly HistorySample[],
  options: {
    /** True only when the provider's accumulation period is confirmed. */
    periodVerified: boolean;
    /** Requested lookback in hours. */
    requestedHours: number;
    now: Date;
  },
): ConsumptionWindow {
  if (samples.length === 0) {
    return {
      consumedBytes: null,
      coverageMinutes: null,
      basis: "unknown",
      quality: "no-baseline",
      description: "暂无历史数据",
    };
  }

  const ordered = [...samples].sort((a, b) =>
    a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0,
  );
  const latest = ordered[ordered.length - 1] as HistorySample;

  // An unconfirmed period means we cannot say "this month" at all.
  if (!options.periodVerified) {
    return {
      consumedBytes: null,
      coverageMinutes: null,
      basis: "cumulative",
      quality: "unknown-period",
      description: "接口累计值（统计周期待确认）",
    };
  }

  const cutoff = options.now.getTime() - options.requestedHours * 3600000;
  let baseline: HistorySample | null = null;
  for (const sample of ordered) {
    if (Date.parse(sample.observedAt) <= cutoff) baseline = sample;
  }
  // Without a sample older than the cutoff, fall back to the earliest we have
  // and report the *real* coverage rather than pretending it is a full window.
  if (baseline === null) baseline = ordered[0] as HistorySample;

  if (baseline === latest || baseline.bucket === latest.bucket) {
    return {
      consumedBytes: null,
      coverageMinutes: null,
      basis: "unknown",
      quality: "no-baseline",
      description: "暂无足够的历史样本",
    };
  }

  const coverageMinutes = minutesBetween(baseline.observedAt, latest.observedAt);

  if (baseline.periodId !== latest.periodId) {
    // Crossed a period boundary: the tail of the old period is missing, so any
    // simple subtraction would be wrong. Report the cumulative value instead.
    return {
      consumedBytes: null,
      coverageMinutes,
      basis: "cumulative",
      quality: "partial",
      description:
        coverageMinutes === null
          ? "跨越统计周期，累计值分段"
          : `跨越统计周期，仅覆盖最近 ${formatHours(coverageMinutes)}`,
    };
  }

  if (latest.bytes < baseline.bytes) {
    return {
      consumedBytes: null,
      coverageMinutes,
      basis: "cumulative",
      quality: "revision",
      description: "累计值出现回退，已按数据修订处理（不视为额度重置）",
    };
  }

  const consumedBytes = latest.bytes - baseline.bytes;
  const coverageText =
    coverageMinutes === null ? "区间未知" : `最近 ${formatHours(coverageMinutes)}`;
  const fullWindow = coverageMinutes !== null && coverageMinutes >= options.requestedHours * 60;
  return {
    consumedBytes,
    coverageMinutes,
    basis: "window",
    quality: fullWindow ? "ok" : "partial",
    description: fullWindow ? `${coverageText}消耗` : `${coverageText}，估算`,
  };
}

/**
 * Per-interval increments from cumulative samples.
 *
 * Every entry carries the real interval it covers. When the period is
 * unverified the deltas are not produced at all, because labelling them as
 * "hourly consumption" would be a claim the provider cannot support.
 */
export function hourlyIncrements(
  samples: readonly HistorySample[],
  periodVerified: boolean,
): Array<{ observedAt: string; bytes: number; intervalMinutes: number | null; quality: ConsumptionQuality }> {
  const ordered = [...samples].sort((a, b) =>
    a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0,
  );
  const result: Array<{
    observedAt: string;
    bytes: number;
    intervalMinutes: number | null;
    quality: ConsumptionQuality;
  }> = [];

  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1] as HistorySample;
    const current = ordered[i] as HistorySample;
    const intervalMinutes = minutesBetween(previous.observedAt, current.observedAt);

    if (!periodVerified) {
      result.push({
        observedAt: current.observedAt,
        bytes: 0,
        intervalMinutes,
        quality: "unknown-period",
      });
      continue;
    }
    if (previous.periodId !== current.periodId) {
      result.push({ observedAt: current.observedAt, bytes: 0, intervalMinutes, quality: "partial" });
      continue;
    }
    if (current.bytes < previous.bytes) {
      result.push({ observedAt: current.observedAt, bytes: 0, intervalMinutes, quality: "revision" });
      continue;
    }
    result.push({
      observedAt: current.observedAt,
      bytes: current.bytes - previous.bytes,
      intervalMinutes,
      quality: "ok",
    });
  }
  return result;
}

/** True when the sample carries a confirmed accumulation period. */
export function hasVerifiedPeriod(sample: HistorySample): boolean {
  return sample.periodId !== UNVERIFIED_PERIOD && sample.periodId !== "";
}
