/**
 * T01, T04 — CDT traffic parsing and aggregation.
 *
 * These fixtures are synthetic; no real cloud response is embedded.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aggregateTraffic,
  parseTrafficResponse,
} from "../src/providers/aliyun/traffic.ts";
import { parseInstanceStatus } from "../src/providers/aliyun/ecs.ts";
import { parseBalance, parseBillPage, sumBillItems } from "../src/providers/aliyun/billing.ts";
import {
  asArray,
  getPath,
  strictNonNegativeNumber,
  strictString,
} from "../src/providers/aliyun/parse.ts";

const GIB = 1_073_741_824;

/* ------------------------------ T01 aggregation --------------------------- */

test("T01: mainland is 1GiB + 2GiB and overseas is the Hong Kong 4GiB", () => {
  const response = {
    RequestId: "req-1",
    TrafficDetails: [
      { BusinessRegionId: "cn-hangzhou", Traffic: 1 * GIB },
      { BusinessRegionId: "cn-beijing", Traffic: 2 * GIB },
      { BusinessRegionId: "cn-hongkong", Traffic: 4 * GIB },
    ],
  };
  const parsed = parseTrafficResponse(response);
  assert.equal(parsed.unrecognized, false);
  assert.equal(parsed.rejectedEntries, 0);

  const mainland = aggregateTraffic(parsed.entries, "mainland");
  assert.equal(mainland.rawTotal, 3 * GIB);
  assert.deepEqual(mainland.regions, ["cn-beijing", "cn-hangzhou"]);

  const overseas = aggregateTraffic(parsed.entries, "overseas");
  assert.equal(overseas.rawTotal, 4 * GIB);
  assert.deepEqual(overseas.regions, ["cn-hongkong"]);
});

test("T01: account site does not influence the traffic classification", () => {
  // The same response yields the same classification regardless of siteType,
  // because siteType only selects the BSS endpoint and currency.
  const response = {
    TrafficDetails: [
      { BusinessRegionId: "cn-hongkong", Traffic: 5 },
      { BusinessRegionId: "cn-shanghai", Traffic: 7 },
    ],
  };
  const parsed = parseTrafficResponse(response);
  assert.equal(aggregateTraffic(parsed.entries, "overseas").rawTotal, 5);
  assert.equal(aggregateTraffic(parsed.entries, "mainland").rawTotal, 7);
});

test("T01: a Data-wrapped response is still accepted", () => {
  const parsed = parseTrafficResponse({
    Data: { TrafficDetails: [{ BusinessRegionId: "cn-hongkong", Traffic: 9 }] },
  });
  assert.equal(parsed.unrecognized, false);
  assert.equal(aggregateTraffic(parsed.entries, "overseas").rawTotal, 9);
});

/* ------------------------------ T04 empty vs broken ----------------------- */

test("T04: a present-but-empty TrafficDetails is a confirmed zero", () => {
  const parsed = parseTrafficResponse({ RequestId: "r", TrafficDetails: [] });
  assert.equal(parsed.confirmedEmpty, true);
  assert.equal(parsed.unrecognized, false);
  assert.equal(aggregateTraffic(parsed.entries, "overseas").rawTotal, 0);
});

test("T04: a missing TrafficDetails is unknown, not zero", () => {
  const parsed = parseTrafficResponse({ RequestId: "r" });
  assert.equal(parsed.unrecognized, true);
  assert.equal(parsed.confirmedEmpty, false);
  assert.ok(parsed.reason !== null);
});

test("T04: an unreadable TrafficDetails shape is unknown", () => {
  const parsed = parseTrafficResponse({ TrafficDetails: "not-a-list" });
  assert.equal(parsed.unrecognized, true);
});

/* --------------------------- strict field parsing ------------------------- */

test("invalid entries are rejected and the result is marked partial", () => {
  const parsed = parseTrafficResponse({
    TrafficDetails: [
      { BusinessRegionId: "cn-hongkong", Traffic: 10 },
      { BusinessRegionId: "cn-hongkong", Traffic: "123bad" },
      { BusinessRegionId: "cn-hongkong", Traffic: -5 },
      { Traffic: 99 },
      { BusinessRegionId: "cn-hangzhou", Traffic: 3 },
    ],
  });
  assert.equal(parsed.rejectedEntries, 3);
  const aggregate = aggregateTraffic(parsed.entries, "overseas", parsed.rejectedEntries > 0);
  assert.equal(aggregate.rawTotal, 10);
  // Understating silently would be the dangerous outcome.
  assert.equal(aggregate.partial, true);
  assert.ok(parsed.warnings.length >= 3);
});

test("strictNonNegativeNumber refuses partially numeric strings", () => {
  assert.deepEqual(strictNonNegativeNumber("123bad"), { ok: false, reason: "not-a-number" });
  assert.deepEqual(strictNonNegativeNumber("1e5"), { ok: false, reason: "not-a-number" });
  assert.deepEqual(strictNonNegativeNumber("12,3"), { ok: false, reason: "not-a-number" });
  assert.deepEqual(strictNonNegativeNumber(-1), { ok: false, reason: "negative" });
  assert.deepEqual(strictNonNegativeNumber(Number.MAX_SAFE_INTEGER + 10), {
    ok: false,
    reason: "unsafe-precision",
  });
  assert.deepEqual(strictNonNegativeNumber("123.5"), { ok: true, value: 123.5 });
  assert.deepEqual(strictNonNegativeNumber(0), { ok: true, value: 0 });
});

/* ------------------------------ ECS matching ------------------------------ */

test("an exact instance match is required; response position is never trusted", () => {
  const body = {
    InstanceStatuses: {
      InstanceStatus: [
        { InstanceId: "i-other", Status: "Running" },
        { InstanceId: "i-target", Status: "Stopped" },
      ],
    },
  };
  const matched = parseInstanceStatus(body, "i-target");
  assert.equal(matched.matched, true);
  // Taking results[0] would have reported "Running" here.
  assert.equal(matched.status, "Stopped");
});

test("a target absent from the response yields Unknown, never another instance's state", () => {
  const body = {
    InstanceStatuses: { InstanceStatus: [{ InstanceId: "i-other", Status: "Running" }] },
  };
  const result = parseInstanceStatus(body, "i-missing");
  assert.equal(result.matched, false);
  assert.equal(result.status, "Unknown");
  assert.ok(result.reason !== null);
});

test("an unrecognised status string is Unknown with a reason, not a guess", () => {
  const body = {
    InstanceStatuses: { InstanceStatus: [{ InstanceId: "i-x", Status: "Rebooting" }] },
  };
  const result = parseInstanceStatus(body, "i-x");
  assert.equal(result.status, "Unknown");
  assert.ok(result.reason !== null);
});

test("Unknown is never conflated with Stopped", () => {
  const missing = parseInstanceStatus({}, "i-x");
  assert.equal(missing.status, "Unknown");
  assert.notEqual(missing.status, "Stopped");
});

/* ------------------------------- BSS parsing ------------------------------ */

test("balance accepts the BSS string amount and defaults the currency to CNY", () => {
  const parsed = parseBalance({ Code: "200", Data: { AvailableAmount: "123.45" } });
  assert.deepEqual(parsed, { ok: true, amount: 123.45, currency: "CNY" });
});

test("a zero balance is parsed as zero, not as missing", () => {
  const parsed = parseBalance({ Data: { AvailableAmount: "0", Currency: "USD" } });
  assert.deepEqual(parsed, { ok: true, amount: 0, currency: "USD" });
});

test("bill pages expose NextToken so callers must follow pagination", () => {
  const page = parseBillPage({
    Data: {
      Items: [
        { PretaxAmount: 10.5, Currency: "CNY" },
        { PretaxAmount: "0.005", Currency: "CNY" },
      ],
      NextToken: "page-2",
      TotalCount: 3,
    },
  });
  assert.equal(page.items.length, 2);
  assert.equal(page.nextToken, "page-2");
  assert.equal(page.totalCount, 3);
  const total = sumBillItems(page.items, { partial: false });
  assert.equal(total.total, 10.51);
  assert.deepEqual(total.currencies, ["CNY"]);
});

test("an empty NextToken means the last page", () => {
  const page = parseBillPage({ Data: { Items: [{ PretaxAmount: 1 }], NextToken: "" } });
  assert.equal(page.nextToken, null);
});

test("unreadable bill items are excluded and the total is marked partial", () => {
  const total = sumBillItems(
    [{ PretaxAmount: 5 }, { PretaxAmount: "n/a" }],
    { partial: false },
  );
  assert.equal(total.total, 5);
  assert.equal(total.partial, true);
  assert.equal(total.rejectedItems, 1);
});

test("mixed currencies are reported rather than summed into one number", () => {
  const total = sumBillItems(
    [{ PretaxAmount: 1, Currency: "CNY" }, { PretaxAmount: 2, Currency: "USD" }],
    { partial: false },
  );
  assert.deepEqual(total.currencies, ["CNY", "USD"]);
});

/* ------------------------------ parse helpers ----------------------------- */

test("asArray handles arrays, Item wrappers and single objects", () => {
  assert.deepEqual(asArray([1, 2]), [1, 2]);
  assert.deepEqual(asArray({ Item: [1, 2] }), [1, 2]);
  assert.deepEqual(asArray({ Item: 1 }), [1]);
  assert.equal(asArray({}), null);
  assert.equal(asArray("x"), null);
  // An empty array is a legitimate value, distinct from absence.
  assert.deepEqual(asArray([]), []);
  assert.equal(asArray(undefined), null);
});

test("getPath distinguishes an absent field from an empty one", () => {
  assert.equal(getPath({ a: { b: [] } }, "a", "b")?.constructor, Array);
  assert.equal(getPath({ a: {} }, "a", "b"), undefined);
  assert.equal(getPath({}, "a", "b"), undefined);
  assert.equal(getPath(null, "a"), undefined);
});

test("strictString trims and rejects blank or non-string values", () => {
  assert.equal(strictString("  x "), "x");
  assert.equal(strictString("   "), null);
  assert.equal(strictString(5), null);
  assert.equal(strictString(null), null);
});
