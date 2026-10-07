/**
 * T02, T03, F01, F02, K01, K02 — collection, de-duplication, field-level
 * freshness and cache identity.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { collectSnapshot, mapWithConcurrency, billingDue } from "../src/services/collect.ts";
import {
  Cache,
  enforceBudget,
  isSnapshotFresh,
  knownCacheKeys,
  loadSnapshotFromCache,
  validateScopeSnapshot,
} from "../src/services/cache.ts";
import { FakeReadProvider, memoryStorage } from "./host-fake.ts";
import { appConfig, cacheFor, scopeSnapshot } from "./fixtures.ts";
import type { Snapshot } from "../src/domain/models.ts";
import { UNVERIFIED_PERIOD } from "../src/domain/models.ts";

/** A clock whose readings advance by a fixed step on every call. */
function advanceClock(startIso: string, stepMs: number) {
  let current = new Date(startIso).getTime();
  return {
    now: () => {
      const value = new Date(current);
      current += stepMs;
      return value;
    },
  };
}

/* ------------------------------ T02/T03 de-duplication -------------------- */

test("T02: two instances sharing one scope cause one traffic call, not two", async () => {
  const config = appConfig({
    instances: [
      {
        id: "hk-ecs", accountId: "account-main", credentialId: "cred-main",
        trafficScopeId: "main-overseas", regionId: "cn-hongkong", instanceId: "i-a",
        name: "实例 A", keepAlive: false, shutdownMode: "KeepCharging",
        schedule: { enabled: false, start: "08:00", stop: "23:30" },
      },
      {
        id: "hk-ecs-2", accountId: "account-main", credentialId: "cred-main",
        trafficScopeId: "main-overseas", regionId: "cn-hongkong", instanceId: "i-b",
        name: "实例 B", keepAlive: false, shutdownMode: "KeepCharging",
        schedule: { enabled: false, start: "08:00", stop: "23:30" },
      },
    ],
  });
  const provider = new FakeReadProvider("direct", { traffic: { usedBytes: 100 }, status: "Running" });
  const result = await collectSnapshot({
    config,
    cache: cacheFor(config),
    provider,
    clock: advanceClock("2026-10-08T12:00:00Z", 1000),
    deadlineMs: Date.parse("2026-10-08T12:00:15Z"),
  });

  // The shared scope is fetched once and appears once.
  assert.equal(provider.calls.filter((call) => call.startsWith("traffic:")).length, 1);
  assert.equal(result.snapshot.trafficScopes.length, 1);
  // Both instances are still tracked individually.
  assert.equal(result.snapshot.instances.length, 2);
});

test("T03: two credentials for one account yield a single balance lookup", async () => {
  const config = appConfig({
    billingEnabled: true,
    credentials: [
      {
        id: "cred-a", accountId: "account-main", accessKeyId: "AK-A",
        accessKeySecret: "s", siteType: "international",
      },
      {
        id: "cred-b", accountId: "account-main", accessKeyId: "AK-B",
        accessKeySecret: "s", siteType: "international",
      },
    ],
  });
  const provider = new FakeReadProvider("direct", {
    traffic: { usedBytes: 1 },
    status: "Running",
    balance: { amount: 42, currency: "USD" },
  });
  const result = await collectSnapshot({
    config,
    cache: cacheFor(config),
    provider,
    clock: advanceClock("2026-10-08T12:00:00Z", 1000),
    deadlineMs: Date.parse("2026-10-08T12:00:15Z"),
  });

  // Balance belongs to the account, so a second AK must not double it.
  assert.equal(provider.calls.filter((call) => call.startsWith("balance:")).length, 1);
  assert.equal(result.snapshot.accounts.length, 1);
  assert.equal(result.snapshot.accounts[0]?.balance, 42);
});

/* ------------------------- F01/F02 field-level freshness ------------------ */

test("F01: a failing status read keeps the previous status and its observation time", async () => {
  const config = appConfig();
  const cache = cacheFor(config);
  const at = "2026-10-08T12:00:00Z";

  // First run: everything succeeds.
  const healthy = new FakeReadProvider("direct", { traffic: { usedBytes: 10 }, status: "Running" });
  const first = await collectSnapshot({
    config, cache, provider: healthy,
    clock: advanceClock(at, 0),
    deadlineMs: Date.parse("2026-10-08T12:00:15Z"),
  });
  const firstStatusAt = first.snapshot.instances[0]?.statusObservedAt;
  const firstTrafficAt = first.snapshot.trafficScopes[0]?.trafficObservedAt;
  assert.ok(firstStatusAt !== null);

  // Second run: traffic succeeds, status fails.
  const degraded = new FakeReadProvider("direct", {
    traffic: { usedBytes: 20 },
    failStatus: {
      code: "NetworkError", message: "status failed",
      at: "2026-10-08T12:05:00Z", retryable: true,
    },
  });
  const second = await collectSnapshot({
    config, cache, provider: degraded,
    clock: advanceClock("2026-10-08T12:05:00Z", 0),
    deadlineMs: Date.parse("2026-10-08T12:05:15Z"),
  });

  const instance = second.snapshot.instances[0];
  const scope = second.snapshot.trafficScopes[0];
  // Traffic advanced...
  assert.notEqual(scope?.trafficObservedAt, firstTrafficAt);
  assert.equal(scope?.trafficError, null);
  // ...while the failed field kept BOTH its value and its original timestamp.
  assert.equal(instance?.status, "Running");
  assert.equal(instance?.statusObservedAt, firstStatusAt);
  assert.equal(instance?.statusError?.code, "NetworkError");
});

test("F01: a failing traffic read does not clear a successful status", async () => {
  const config = appConfig();
  const cache = cacheFor(config);
  const provider = new FakeReadProvider("direct", {
    failTraffic: {
      code: "AccessDenied", message: "denied",
      at: "2026-10-08T12:00:00Z", retryable: false,
    },
    status: "Stopped",
  });
  const result = await collectSnapshot({
    config, cache, provider,
    clock: advanceClock("2026-10-08T12:00:00Z", 0),
    deadlineMs: Date.parse("2026-10-08T12:00:15Z"),
  });
  assert.equal(result.snapshot.instances[0]?.status, "Stopped");
  assert.equal(result.snapshot.instances[0]?.statusError, null);
  assert.equal(result.snapshot.trafficScopes[0]?.trafficError?.code, "AccessDenied");
  // Unknown usage must not become a fabricated 0.
  assert.equal(result.snapshot.trafficScopes[0]?.usedBytes, null);
  assert.equal(result.snapshot.trafficScopes[0]?.usagePercent, null);
});

test("F02: a read-only collection never advances traffic freshness from status work", async () => {
  const config = appConfig();
  const cache = cacheFor(config);
  const provider = new FakeReadProvider("direct", { status: "Running" });

  const result = await collectSnapshot({
    config, cache, provider,
    clock: advanceClock("2026-10-08T12:00:00Z", 0),
    deadlineMs: Date.parse("2026-10-08T12:00:15Z"),
  });
  const scope = result.snapshot.trafficScopes[0];
  // No traffic reading was scripted, so the traffic fields stay empty.
  assert.equal(scope?.trafficObservedAt, null);
  assert.equal(scope?.usedBytes, null);
  assert.ok(scope?.trafficError !== null);
});

/* ------------------------------ K01 cache identity ------------------------ */

test("K01: a changed fingerprint, namespace or provider invalidates the cache", () => {
  const store = memoryStorage();
  const base = { store, namespace: "test", provider: "direct" as const, fingerprint: "fp-A" };
  const cacheA = new Cache(base);
  const now = new Date("2026-10-08T12:00:00Z");
  cacheA.write("scope-1", "scope", { marker: true }, now);
  assert.notEqual(cacheA.read("scope-1", "scope", () => "hit"), null);

  // A different identity must NOT read the previous value.
  const cacheB = new Cache({ ...base, fingerprint: "fp-B" });
  assert.equal(cacheB.read("scope-1", "scope", () => "hit"), null);
  const cacheC = new Cache({ ...base, namespace: "other" });
  assert.equal(cacheC.read("scope-1", "scope", () => "hit"), null);
  const cacheD = new Cache({ ...base, provider: "server" });
  assert.equal(cacheD.read("scope-1", "scope", () => "hit"), null);
});

test("K01: corrupt cache entries behave like a miss instead of throwing", () => {
  const store = memoryStorage({
    "cdt:egern:v1:test:direct:scope-1:scope": "{not json",
  });
  const cache = new Cache({ store, namespace: "test", provider: "direct", fingerprint: "fp-test" });
  assert.equal(cache.read("scope-1", "scope", () => "hit"), null);
  // A wrong envelope version is also a miss.
  store.set("cdt:egern:v1:test:direct:scope-2:scope", JSON.stringify({ cacheVersion: 99 }));
  assert.equal(cache.read("scope-2", "scope", () => "hit"), null);
});

test("K01: a cached scope with an invalid shape is rejected", () => {
  const store = memoryStorage();
  const cache = new Cache({ store, namespace: "test", provider: "direct", fingerprint: "fp-test" });
  const now = new Date("2026-10-08T12:00:00Z");
  // An unknown traffic class is structurally invalid and must not be rendered.
  cache.write("bad", "scope", { id: "bad", accountId: "a", trafficClass: "nope" }, now);
  assert.equal(cache.read("bad", "scope", validateScopeSnapshot), null);
  // A structurally valid entry is accepted, proving the check is not vacuous.
  cache.write("good", "scope", scopeSnapshot({ id: "good" }), now);
  assert.notEqual(cache.read("good", "scope", validateScopeSnapshot), null);
});

test("a cache assembled snapshot preserves configuration identity", () => {
  const config = appConfig();
  const cache = cacheFor(config);
  const now = new Date("2026-10-08T12:00:00Z");
  cache.write("main-overseas", "scope", scopeSnapshot(), now);
  cache.write("hk-ecs", "instance", {
    id: "hk-ecs", accountId: "account-main", trafficScopeId: "main-overseas",
    regionId: "cn-hongkong", instanceId: "i-example", name: "旧的名称",
    status: "Running", statusObservedAt: now.toISOString(), legacyUpdatedAt: null,
    statusError: null, monthlyCost: null, currency: null, billingCycle: null,
    billingObservedAt: null, billingError: null, lastAction: null,
    actionRequestedAt: null, actionState: null,
  }, now);

  const restored = loadSnapshotFromCache(config, cache, now);
  assert.ok(restored !== null);
  // The name comes from configuration, never from the cache.
  assert.equal(restored?.instances[0]?.name, "香港实例");
  assert.equal(restored?.trafficScopes[0]?.overThreshold, true);
});

test("loadSnapshotFromCache returns null when nothing is cached", () => {
  const config = appConfig();
  assert.equal(loadSnapshotFromCache(config, cacheFor(config), new Date()), null);
});

test("isSnapshotFresh requires a real, recent observation", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const fresh: Snapshot = {
    schemaVersion: 1, namespace: "test", configFingerprint: "fp-test",
    provider: "direct", generatedAt: now.toISOString(), accounts: [],
    trafficScopes: [scopeSnapshot({ trafficObservedAt: "2026-10-08T11:55:00Z" })],
    instances: [], errors: [],
  };
  assert.equal(isSnapshotFresh(fresh, now, 900), true);
  assert.equal(isSnapshotFresh(fresh, now, 60), false);
  // A v1 server observation has no timestamp at all, so it is never "fresh".
  const legacy: Snapshot = {
    ...fresh,
    trafficScopes: [scopeSnapshot({ trafficObservedAt: null, legacyUpdatedAt: now.toISOString() })],
  };
  assert.equal(isSnapshotFresh(legacy, now, 900), false);
});

/* ---------------------------- K02 budget and partial --------------------- */

test("K02: concurrency is bounded and every item still completes", async () => {
  let inFlight = 0;
  let peak = 0;
  const items = [1, 2, 3, 4, 5, 6, 7];
  const results = await mapWithConcurrency(items, 2, async (item) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight--;
    return item * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14]);
  assert.ok(peak <= 2, `peak concurrency was ${peak}`);
});

test("K02: one failing scope does not blank the others", async () => {
  const config = appConfig({
    trafficScopes: [
      {
        id: "main-overseas", accountId: "account-main", credentialId: "cred-main",
        trafficClass: "overseas", quota: { value: 200, unit: "GB", source: "user" },
        thresholdPercent: 95, controlTargets: [],
      },
      {
        id: "main-mainland", accountId: "account-main", credentialId: "cred-main",
        trafficClass: "mainland", quota: null, thresholdPercent: 95, controlTargets: [],
      },
    ],
    instances: [],
  });

  // Every scope read fails, so both keep an explicit error rather than vanishing.
  const provider = new FakeReadProvider("direct", {
    failTraffic: { code: "NetworkError", message: "down", at: "2026-10-08T12:00:00Z", retryable: true },
  });
  const result = await collectSnapshot({
    config, cache: cacheFor(config), provider,
    clock: advanceClock("2026-10-08T12:00:00Z", 0),
    deadlineMs: Date.parse("2026-10-08T12:00:15Z"),
  });
  assert.equal(result.snapshot.trafficScopes.length, 2);
  for (const scope of result.snapshot.trafficScopes) {
    assert.equal(scope.trafficError?.code, "NetworkError");
    assert.equal(scope.usagePercent, null);
  }
  assert.equal(result.errors.length, 2);
});

test("K02: budget enforcement trims the most expendable entries first", () => {
  const cache = new Cache({
    store: memoryStorage(), namespace: "test", provider: "direct", fingerprint: "fp-test",
  });
  const now = new Date("2026-10-08T12:00:00Z");
  const keys = knownCacheKeys({
    namespace: "test", provider: "direct",
    scopeIds: ["s1"], instanceIds: ["i1"], accountIds: ["a1"],
  });
  // Write a large payload into every slot, then enforce a tiny budget.
  for (const entry of keys) {
    cache.write(entry.entityId, entry.kind, "x".repeat(2000), now);
  }
  const removed = enforceBudget(cache, keys, 3000);
  assert.ok(removed > 0);
  // History/alert entries are listed last and therefore discarded first.
  assert.equal(cache.sizeOf("s1", "history"), 0);
  // The latest scope snapshot is the most valuable and survives.
  assert.ok(cache.sizeOf("s1", "scope") > 0);
});

/* ------------------------------- billing TTL ------------------------------ */

test("billing is skipped while its cached value is still within the TTL", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  // Six hour TTL, observed one hour ago.
  assert.equal(billingDue({ balanceObservedAt: "2026-10-08T11:00:00Z" }, now, 6 * 3600), false);
  assert.equal(billingDue({ balanceObservedAt: "2026-10-08T05:00:00Z" }, now, 6 * 3600), true);
  // Never observed → due.
  assert.equal(billingDue({ balanceObservedAt: null }, now, 6 * 3600), true);
  // A new billing cycle invalidates regardless of age.
  assert.equal(
    billingDue({ billingObservedAt: "2026-10-08T11:00:00Z", billingCycle: "2026-09" }, now, 6 * 3600, "2026-10"),
    true,
  );
});

test("the direct provider leaves the period unverified rather than assuming a month", async () => {
  const config = appConfig();
  const provider = new FakeReadProvider("direct", { traffic: { usedBytes: 5 }, status: "Running" });
  const result = await collectSnapshot({
    config, cache: cacheFor(config), provider,
    clock: advanceClock("2026-10-08T12:00:00Z", 0),
    deadlineMs: Date.parse("2026-10-08T12:00:15Z"),
  });
  assert.equal(result.snapshot.trafficScopes[0]?.periodId, UNVERIFIED_PERIOD);
});
