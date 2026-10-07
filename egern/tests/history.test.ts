/**
 * H01–H03 and Q01/Q02 — history semantics and schedule arithmetic.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeConsumption,
  dailyBucket,
  hourlyBucket,
  hourlyIncrements,
  makeSample,
  upsertDaily,
  upsertHourly,
  upsertSample,
} from "../src/domain/history.ts";
import type { HistorySample } from "../src/domain/models.ts";
import { MAX_HOURLY_SAMPLES } from "../src/domain/models.ts";
import {
  dueWithinMinutes,
  formatMinuteOfDay,
  isOvernightWindow,
  isWithinWindow,
  normalizeClockTime,
  normalizeSchedule,
  parseClockTime,
  scheduleCycleDate,
  shiftCalendarDate,
} from "../src/domain/schedule.ts";
import { createTimeZoneProvider } from "../src/domain/timezone.ts";

const GIB = 1_073_741_824;

function sample(observedAt: string, bytes: number, periodId = "2026-10"): HistorySample {
  return {
    bucket: hourlyBucket(new Date(observedAt)),
    observedAt,
    bytes,
    source: "direct",
    periodId,
    quality: "measured",
  };
}

/* -------------------------------- H01 ------------------------------------- */

test("H01: 10 -> 15 over two hours reports 5, covering two hours (not 24)", () => {
  const samples = [sample("2026-10-08T10:00:00Z", 10 * GIB), sample("2026-10-08T12:00:00Z", 15 * GIB)];
  const result = computeConsumption(samples, {
    periodVerified: true,
    requestedHours: 24,
    now: new Date("2026-10-08T12:05:00Z"),
  });
  assert.equal(result.consumedBytes, 5 * GIB);
  assert.equal(result.coverageMinutes, 120);
  // Only two hours of data exist, so it must be labelled an estimate.
  assert.equal(result.quality, "partial");
  assert.ok(result.description.includes("2.0 小时"));
});

test("H01: no baseline yields an explicit empty result rather than zero", () => {
  const result = computeConsumption([], {
    periodVerified: true,
    requestedHours: 24,
    now: new Date("2026-10-08T12:00:00Z"),
  });
  assert.equal(result.consumedBytes, null);
  assert.equal(result.quality, "no-baseline");
  assert.equal(result.description, "暂无历史数据");
});

test("H01: a single sample cannot produce a delta", () => {
  const result = computeConsumption([sample("2026-10-08T12:00:00Z", 10 * GIB)], {
    periodVerified: true,
    requestedHours: 24,
    now: new Date("2026-10-08T12:00:00Z"),
  });
  assert.equal(result.consumedBytes, null);
  assert.equal(result.quality, "no-baseline");
});

test("H01: an unverified period yields the cumulative value only, never a delta", () => {
  const samples = [
    sample("2026-10-08T10:00:00Z", 10 * GIB, "unverified"),
    sample("2026-10-08T12:00:00Z", 15 * GIB, "unverified"),
  ];
  const result = computeConsumption(samples, {
    periodVerified: false,
    requestedHours: 24,
    now: new Date("2026-10-08T12:05:00Z"),
  });
  assert.equal(result.consumedBytes, null);
  assert.equal(result.basis, "cumulative");
  assert.equal(result.quality, "unknown-period");
  assert.ok(result.description.includes("周期待确认"));
});

/* -------------------------------- H02 ------------------------------------- */

test("H02: a cross-period drop is segmented, not treated as a free-quota reset", () => {
  const samples = [
    sample("2026-09-30T23:00:00Z", 100 * GIB, "2026-09"),
    sample("2026-10-01T01:00:00Z", 2 * GIB, "2026-10"),
  ];
  const result = computeConsumption(samples, {
    periodVerified: true,
    requestedHours: 24,
    now: new Date("2026-10-01T01:05:00Z"),
  });
  // 2 - 100 must not be reported, and no reset may be inferred.
  assert.equal(result.consumedBytes, null);
  assert.equal(result.quality, "partial");
  assert.equal(result.basis, "cumulative");
});

test("H02: a within-period decrease is a data revision, not a reset", () => {
  const samples = [
    sample("2026-10-08T10:00:00Z", 100 * GIB),
    sample("2026-10-08T11:00:00Z", 90 * GIB),
  ];
  const result = computeConsumption(samples, {
    periodVerified: true,
    requestedHours: 24,
    now: new Date("2026-10-08T11:05:00Z"),
  });
  assert.equal(result.consumedBytes, null);
  assert.equal(result.quality, "revision");
  assert.ok(result.description.includes("数据修订"));
  assert.ok(result.description.includes("不视为额度重置"));
});

test("H02: hourly increments are suppressed for unverified periods", () => {
  const samples = [
    sample("2026-10-08T10:00:00Z", 10 * GIB, "unverified"),
    sample("2026-10-08T11:00:00Z", 12 * GIB, "unverified"),
  ];
  const increments = hourlyIncrements(samples, false);
  assert.equal(increments.length, 1);
  assert.equal(increments[0]?.quality, "unknown-period");
  assert.equal(increments[0]?.bytes, 0);
  // The real interval is still recorded, just not claimed as a rate.
  assert.equal(increments[0]?.intervalMinutes, 60);
});

test("hourly increments carry their true interval", () => {
  const samples = [sample("2026-10-08T10:00:00Z", 10 * GIB), sample("2026-10-08T10:30:00Z", 11 * GIB)];
  const increments = hourlyIncrements(samples, true);
  assert.equal(increments[0]?.bytes, GIB);
  assert.equal(increments[0]?.intervalMinutes, 30);
  assert.equal(increments[0]?.quality, "ok");
});

/* ------------------------------ bucket storage ---------------------------- */

test("upsert replaces within a bucket but keeps the real observation time", () => {
  const first = sample("2026-10-08T10:05:00Z", 10 * GIB);
  const second = sample("2026-10-08T10:50:00Z", 12 * GIB);
  // Same hour, so the same bucket key.
  assert.equal(first.bucket, second.bucket);
  const series = upsertHourly(upsertHourly([], first), second);
  assert.equal(series.length, 1);
  assert.equal(series[0]?.bytes, 12 * GIB);
  // The bucket start must never masquerade as the sample time.
  assert.equal(series[0]?.observedAt, "2026-10-08T10:50:00Z");
  assert.notEqual(series[0]?.observedAt, series[0]?.bucket);
});

test("retention keeps only the newest samples", () => {
  let series: HistorySample[] = [];
  for (let index = 0; index < MAX_HOURLY_SAMPLES + 5; index++) {
    // Advance whole hours: incrementing minutes would collapse every sample
    // into one hourly bucket and the retention cap would never be exercised.
    const at = new Date(Date.UTC(2026, 9, 8, index)).toISOString();
    series = upsertHourly(series, sample(at, index));
  }
  assert.equal(series.length, MAX_HOURLY_SAMPLES);
  // Oldest are dropped, newest retained.
  assert.equal(series[series.length - 1]?.bytes, MAX_HOURLY_SAMPLES + 4);
});

test("samples are stored in ascending bucket order regardless of insert order", () => {
  const a = sample("2026-10-08T09:00:00Z", 1);
  const b = sample("2026-10-08T11:00:00Z", 3);
  const c = sample("2026-10-08T10:00:00Z", 2);
  const series = upsertSample(upsertSample(upsertSample([], b, 10), a, 10), c, 10);
  assert.deepEqual(
    series.map((item) => item.bytes),
    [1, 2, 3],
  );
});

test("daily buckets truncate to the UTC day", () => {
  assert.equal(dailyBucket(new Date("2026-10-08T23:59:59Z")), "2026-10-08T00:00:00.000Z");
  assert.equal(hourlyBucket(new Date("2026-10-08T23:59:59Z")), "2026-10-08T23:00:00.000Z");
});

test("makeSample records the requested granularity and quality", () => {
  const made = makeSample({
    instant: new Date("2026-10-08T12:34:56Z"),
    bytes: 5,
    source: "server",
    periodId: "unverified",
    quality: "legacy-unverified",
    granularity: "day",
  });
  assert.equal(made.bucket, "2026-10-08T00:00:00.000Z");
  assert.equal(made.observedAt, "2026-10-08T12:34:56.000Z");
  assert.equal(made.quality, "legacy-unverified");
  void upsertDaily;
});

/* ------------------------------ Q01 / Q02 --------------------------------- */

test("Q01: an overnight window belongs to the day it started", () => {
  // 08:00 -> next day 00:34.
  const start = parseClockTime("08:00");
  const stop = parseClockTime("00:34");
  assert.ok(start !== null && stop !== null);

  // 23:00 on the start day.
  assert.equal(
    scheduleCycleDate({ date: "2026-10-08", minuteOfDay: 23 * 60 }, start.minutes, stop.minutes),
    "2026-10-08",
  );
  // 00:10 the following morning still belongs to 2026-10-08.
  assert.equal(
    scheduleCycleDate({ date: "2026-10-09", minuteOfDay: 10 }, start.minutes, stop.minutes),
    "2026-10-08",
  );
});

test("Q01: the 10-minute catch-up window closes rather than drifting", () => {
  const eight = parseClockTime("08:00");
  assert.ok(eight !== null);
  // 08:07 and 08:11 are both inside the window...
  assert.equal(dueWithinMinutes(8 * 60 + 7, eight.minutes, 10), true);
  assert.equal(dueWithinMinutes(8 * 60 + 10, eight.minutes, 10), true);
  // ...but 08:11 is not.
  assert.equal(dueWithinMinutes(8 * 60 + 11, eight.minutes, 10), false);
  // And the window does not wrap backwards past midnight.
  const late = parseClockTime("23:55");
  assert.ok(late !== null);
  assert.equal(dueWithinMinutes(2, late.minutes, 10), false);
});

test("Q01: an overnight window contains late and early hours", () => {
  assert.equal(isOvernightWindow(23 * 60, 7 * 60), true);
  assert.equal(isWithinWindow(23 * 60 + 30, 23 * 60, 7 * 60), true);
  assert.equal(isWithinWindow(2 * 60, 23 * 60, 7 * 60), true);
  assert.equal(isWithinWindow(12 * 60, 23 * 60, 7 * 60), false);
  // The end of a normal window is exclusive, matching the original engine.
  assert.equal(isWithinWindow(18 * 60, 8 * 60, 18 * 60), false);
});

test("Q02: full-width colons, 24:00 and out-of-range times are normalized or rejected", () => {
  assert.equal(normalizeClockTime("08：30"), "08:30");
  assert.equal(normalizeClockTime("8:05"), "08:05");
  assert.equal(normalizeClockTime("24:00"), "00:00");
  assert.equal(normalizeClockTime("25:00"), null);
  assert.equal(normalizeClockTime("08:60"), null);
  assert.equal(normalizeClockTime(""), null);
  assert.equal(normalizeClockTime("8"), null);
  assert.equal(normalizeClockTime("08:30:00"), null);
});

test("Q02: start equal to stop is rejected instead of meaning 24 hours", () => {
  const rejected = normalizeSchedule("08:00", "08:00", true);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.ok(rejected.reason.includes("相同"));
  // When the schedule is disabled, equality is harmless.
  assert.equal(normalizeSchedule("08:00", "08:00", false).ok, true);
});

test("Q02: invalid times are rejected with a specific reason", () => {
  const bad = normalizeSchedule("08:00", "99:99", true);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.reason.includes("停止时间"));
});

test("Q02: comparisons use integer minutes, never string ordering", () => {
  // String comparison would place "8:00" after "10:00".
  assert.equal(formatMinuteOfDay(8 * 60), "08:00");
  assert.equal(formatMinuteOfDay(0), "00:00");
  assert.equal(shiftCalendarDate("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftCalendarDate("2024-03-01", -1), "2024-02-29");
});

test("Q02: a DST-observing zone resolves through Intl when available", () => {
  const provider = createTimeZoneProvider("America/New_York");
  if (provider.support !== "intl") {
    // Without Intl the provider must refuse rather than guess an offset.
    assert.equal(provider.isReliable(), false);
    return;
  }
  // 2026-03-08 is the US spring-forward date: 07:00Z is 03:00 local (EDT).
  const parts = provider.partsAt(new Date("2026-03-08T07:00:00Z"));
  assert.equal(parts.hour, 3);
  assert.equal(provider.offsetMinutesAt(new Date("2026-03-08T07:00:00Z")), -240);
});

test("an unusable timezone degrades instead of guessing", () => {
  const provider = createTimeZoneProvider("Not/AZone");
  assert.equal(provider.isReliable(), false);
  assert.ok(provider.limitation() !== null);
});

test("Asia/Shanghai is reliable and has no DST", () => {
  const provider = createTimeZoneProvider("Asia/Shanghai");
  assert.equal(provider.isReliable(), true);
  assert.equal(provider.offsetMinutesAt(new Date("2026-01-15T00:00:00Z")), 480);
  assert.equal(provider.offsetMinutesAt(new Date("2026-07-15T00:00:00Z")), 480);
});
