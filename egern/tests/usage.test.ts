/**
 * T05, T06 — units, usage arithmetic and the comparison discipline.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BYTES_PER_GB,
  BYTES_PER_GIB,
  bytesToUnit,
  clampFraction,
  computeUsage,
  legacyGibToBytes,
  quotaToBytes,
  sumByCurrency,
  sumScopeUsage,
  trafficClassOfRegion,
} from "../src/domain/usage.ts";
import {
  EM_DASH,
  formatBytes,
  formatMoney,
  formatNumber,
  formatPercent,
  formatSampleAge,
  instanceStatusLabel,
  truncateName,
} from "../src/domain/format.ts";

/* ------------------------------- T05 units -------------------------------- */

test("T05: 1073741824 bytes is 1 GiB and 1.073741824 GB", () => {
  const bytes = 1_073_741_824;
  assert.equal(bytesToUnit(bytes, "GiB"), 1);
  assert.ok(Math.abs(bytesToUnit(bytes, "GB") - 1.073741824) < 1e-12);
  // Round-trips exactly in both directions.
  assert.equal(quotaToBytes(1, "GiB"), bytes);
  assert.equal(quotaToBytes(1, "GB"), 1_000_000_000);
  // The legacy Go API reported GiB, so import must not relabel it as GB.
  assert.equal(legacyGibToBytes(1), BYTES_PER_GIB);
  assert.notEqual(legacyGibToBytes(1), BYTES_PER_GB);
});

test("T05: legacy GiB import and explicit GB quota differ by ~7.4%", () => {
  const legacyBytes = legacyGibToBytes(200);
  const explicitBytes = quotaToBytes(200, "GB");
  const ratio = legacyBytes / explicitBytes;
  assert.ok(ratio > 1.07 && ratio < 1.08, `ratio was ${ratio}`);
});

/* ---------------------------- T06 threshold ------------------------------- */

test("T06: 189.98/200 is below 95% and 190/200 is exactly at it", () => {
  const quota = quotaToBytes(200, "GB");
  const below = computeUsage(189.98 * BYTES_PER_GB, quota, 95);
  assert.equal(below.overThreshold, false);
  assert.ok(Math.abs((below.usagePercent ?? 0) - 94.99) < 1e-9);

  const at = computeUsage(190 * BYTES_PER_GB, quota, 95);
  assert.equal(at.overThreshold, true);
  assert.equal(at.usagePercent, 95);
});

test("T06: 94.995% does not trip a 95% threshold even though it displays as 95.00", () => {
  const quota = quotaToBytes(200, "GB");
  // 94.9999% displays as 95.00% but is genuinely below the threshold.
  const used = 0.949999 * quota;
  const result = computeUsage(used, quota, 95);
  assert.equal(result.overThreshold, false);
  // Display rounds up to 95.00%, which is exactly why the decision must not.
  assert.equal(formatPercent(result.usagePercent), "95.00%");
});

test("T06: missing, zero, negative or non-finite quota yields unknown and blocks protection", () => {
  for (const quota of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = computeUsage(1000, quota, 95);
    assert.equal(result.usagePercent, null, `quota=${String(quota)}`);
    assert.equal(result.overThreshold, null, `quota=${String(quota)}`);
    assert.equal(result.remainingBytes, null, `quota=${String(quota)}`);
    assert.ok(result.unknownReason !== null);
  }
});

test("T06: unknown usage stays unknown rather than becoming zero", () => {
  const result = computeUsage(null, 1_000_000, 95);
  assert.equal(result.usagePercent, null);
  assert.equal(result.overThreshold, null);
});

test("T06: an invalid threshold is rejected rather than silently applied", () => {
  for (const threshold of [0, -5, 101, Number.NaN]) {
    const result = computeUsage(500, 1000, threshold);
    assert.equal(result.overThreshold, null, `threshold=${String(threshold)}`);
  }
});

test("a legal zero usage with a valid quota is a real 0%, not missing data", () => {
  const result = computeUsage(0, 1000, 95);
  assert.equal(result.usagePercent, 0);
  assert.equal(result.overThreshold, false);
  assert.equal(result.remainingBytes, 1000);
});

test("over-quota reports the true percentage while graphics clamp", () => {
  const result = computeUsage(2740, 2000, 95);
  assert.ok(Math.abs((result.usagePercent ?? 0) - 137) < 1e-9);
  assert.equal(result.remainingBytes, 0);
  assert.equal(clampFraction(1.37), 1);
  assert.equal(clampFraction(-0.5), 0);
  assert.equal(clampFraction(Number.NaN), 0);
});

/* ---------------------------- traffic classes ----------------------------- */

test("cn-hongkong is overseas while other cn-* regions are mainland", () => {
  assert.equal(trafficClassOfRegion("cn-hongkong"), "overseas");
  assert.equal(trafficClassOfRegion("cn-hangzhou"), "mainland");
  assert.equal(trafficClassOfRegion("cn-beijing"), "mainland");
  assert.equal(trafficClassOfRegion("ap-southeast-1"), "overseas");
  assert.equal(trafficClassOfRegion("us-west-1"), "overseas");
});

/* --------------------------- totals and currency -------------------------- */

test("scope totals return null when any contributor is unknown", () => {
  assert.equal(sumScopeUsage([{ usedBytes: 1 }, { usedBytes: 2 }]), 3);
  // A partial total presented as complete is the failure mode being avoided.
  assert.equal(sumScopeUsage([{ usedBytes: 1 }, { usedBytes: null }]), null);
});

test("balances are grouped by currency and never auto-converted", () => {
  const totals = sumByCurrency([
    { amount: 100, currency: "CNY" },
    { amount: 20, currency: "USD" },
    { amount: 50, currency: "CNY" },
    { amount: null, currency: "CNY" },
  ]);
  assert.deepEqual(totals, [
    { currency: "CNY", amount: 150 },
    { currency: "USD", amount: 20 },
  ]);
});

/* ------------------------------ formatting -------------------------------- */

test("formatting never leaks NaN, Infinity or undefined", () => {
  for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(formatNumber(value as number | null), EM_DASH);
    assert.equal(formatPercent(value as number | null), EM_DASH);
    assert.equal(formatBytes(value as number | null, "GB"), EM_DASH);
    assert.equal(formatMoney(value as number | null, "CNY"), EM_DASH);
  }
  // Negative byte counts are not real quantities.
  assert.equal(formatBytes(-1, "GB"), EM_DASH);
  // -0 must not render as "-0.00".
  assert.equal(formatNumber(-0), "0.00");
});

test("formatting distinguishes GB from GiB explicitly", () => {
  assert.equal(formatBytes(1_000_000_000, "GB"), "1.00 GB");
  assert.equal(formatBytes(1_073_741_824, "GiB"), "1.00 GiB");
  assert.notEqual(formatBytes(1_073_741_824, "GB"), "1.00 GB");
});

test("money uses a known symbol or a code prefix, never a wrong symbol", () => {
  assert.equal(formatMoney(123.456, "CNY"), "¥123.46");
  assert.equal(formatMoney(10, "USD"), "$10.00");
  assert.equal(formatMoney(5, "XYZ"), "XYZ 5.00");
  assert.equal(formatMoney(5, null), "5.00");
});

test("a zero balance renders as zero rather than as missing", () => {
  assert.equal(formatMoney(0, "CNY"), "¥0.00");
});

test("sample age degrades gracefully and never reports a negative age", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  assert.equal(formatSampleAge("2026-10-08T11:59:30Z", now), "刚刚");
  assert.equal(formatSampleAge("2026-10-08T11:45:00Z", now), "15 分钟前");
  assert.equal(formatSampleAge("2026-10-08T09:00:00Z", now), "3 小时前");
  assert.equal(formatSampleAge("2026-10-06T12:00:00Z", now), "2 天前");
  // A future timestamp is treated as "just now", not a negative age.
  assert.equal(formatSampleAge("2026-10-08T13:00:00Z", now), "刚刚");
  assert.equal(formatSampleAge(null, now), EM_DASH);
  assert.equal(formatSampleAge("not-a-date", now), EM_DASH);
});

test("names are truncated on code points so surrogate pairs survive", () => {
  assert.equal(truncateName("香港实例", 10), "香港实例");
  // An emoji is one code point; a code-unit slice would corrupt it.
  assert.equal(truncateName("😀😀😀😀", 3), "😀😀…");
  assert.equal(truncateName("短", 5), "短");
});

test("instance status is always rendered as text, never implied by colour", () => {
  assert.equal(instanceStatusLabel("Running"), "运行中");
  assert.equal(instanceStatusLabel("Stopped"), "已停止");
  // "Unknown" must not be conflated with "Stopped".
  assert.equal(instanceStatusLabel("Unknown"), "未知");
  assert.equal(instanceStatusLabel("something-else"), "未知");
});
