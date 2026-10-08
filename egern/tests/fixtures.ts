/**
 * Shared test fixtures.
 *
 * Kept in one place so the policy, collection and widget suites all describe the
 * same world; drifting builders would let a test pass against a configuration
 * the others never produce.
 */

import { unverifiedDevice } from "../src/domain/models.ts";
import type {
  AppConfig,
  ControlConfig,
  ControlIntent,
  InstanceSnapshot,
  Snapshot,
  TrafficScopeSnapshot,
} from "../src/domain/models.ts";
import type { ControlCapability } from "../src/services/control.ts";
import { Cache } from "../src/services/cache.ts";
import { memoryStorage } from "./host-fake.ts";

export const GIB = 1_073_741_824;
export const NOW = new Date("2026-10-08T12:00:00Z");

/** A scope that is exactly at its 95% threshold. */
export function scopeSnapshot(overrides: Partial<TrafficScopeSnapshot> = {}): TrafficScopeSnapshot {
  return {
    id: "main-overseas",
    accountId: "account-main",
    trafficClass: "overseas",
    sourceScope: "cn-hongkong",
    periodId: "unverified",
    periodTimezone: null,
    usedBytes: 190 * GIB,
    quotaBytes: 200 * GIB,
    quotaSource: "user",
    sourceUnit: "bytes",
    trafficObservedAt: NOW.toISOString(),
    trafficAttemptedAt: NOW.toISOString(),
    legacyUpdatedAt: null,
    trafficError: null,
    stale: false,
    freshnessQuality: "measured",
    remainingBytes: 10 * GIB,
    usagePercent: 95,
    overThreshold: true,
    thresholdPercent: 95,
    ...overrides,
  };
}

/** A running instance belonging to {@link scopeSnapshot}. */
export function instanceSnapshot(overrides: Partial<InstanceSnapshot> = {}): InstanceSnapshot {
  return {
    id: "hk-ecs",
    accountId: "account-main",
    trafficScopeId: "main-overseas",
    regionId: "cn-hongkong",
    instanceId: "i-example",
    name: "香港实例",
    status: "Running",
    statusObservedAt: NOW.toISOString(),
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
    ...overrides,
  };
}

/** Control configuration with the fixture instance already authorized. */
export function controlConfig(overrides: Partial<ControlConfig> = {}): ControlConfig {
  return {
    schemaVersion: 1,
    enabled: true,
    // Attests nothing by default: individual tests opt in explicitly.
    deviceVerification: unverifiedDevice(),
    credentialId: "cred-main",
    allowedInstanceIds: ["hk-ecs"],
    scopes: [],
    instances: [
      {
        instanceId: "hk-ecs",
        scheduleControlEnabled: false,
        keepAlive: false,
        shutdownMode: "KeepCharging",
      },
    ],
    actionCooldownSeconds: 600,
    pauseUntil: null,
    ...overrides,
  };
}

/** A complete application configuration for tests. */
export function appConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    mode: "direct",
    namespace: "test",
    accountLabel: "main",
    displayName: "CDT",
    timezone: "Asia/Shanghai",
    debug: false,
    // No throttle in fixtures: tests must not depend on a previous run's log.
    automationIntervalSeconds: 0,
    refreshSeconds: 900,
    billingEnabled: false,
    localNotify: false,
    credentials: [
      {
        id: "cred-main",
        accountId: "account-main",
        accessKeyId: "EXAMPLE_AK_ID",
        accessKeySecret: "EXAMPLE_SECRET",
        siteType: "international",
      },
    ],
    accounts: [{ id: "account-main", name: "主账号", aliyunUid: null }],
    trafficScopes: [
      {
        id: "main-overseas",
        accountId: "account-main",
        credentialId: "cred-main",
        trafficClass: "overseas",
        quota: { value: 200, unit: "GB", source: "user" },
        thresholdPercent: 95,
        controlTargets: [],
      },
    ],
    instances: [
      {
        id: "hk-ecs",
        accountId: "account-main",
        credentialId: "cred-main",
        trafficScopeId: "main-overseas",
        regionId: "cn-hongkong",
        instanceId: "i-example",
        name: "香港实例",
        keepAlive: false,
        shutdownMode: "KeepCharging",
        schedule: { enabled: false, start: "08:00", stop: "23:30" },
      },
    ],
    control: controlConfig(),
    notifications: {
      schemaVersion: 1,
      local: false,
      telegram: { enabled: false, botToken: "", chatId: "" },
      webhook: { enabled: false, url: "", method: "POST", bodyTemplate: "" },
      dailyReport: { enabled: false, time: "22:00", compensationWindowMinutes: 20 },
    },
    server: null,
    view: { scopeId: null, instanceIds: null, theme: null },
    configFingerprint: "fp-test",
    ...overrides,
  };
}

/** A snapshot matching {@link appConfig}. */
export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: 1,
    namespace: "test",
    configFingerprint: "fp-test",
    provider: "direct",
    generatedAt: NOW.toISOString(),
    accounts: [],
    trafficScopes: [scopeSnapshot()],
    instances: [instanceSnapshot()],
    errors: [],
    ...overrides,
  };
}

/** A one-shot control intent matching the fixture instance. */
export function intent(overrides: Partial<ControlIntent> = {}): ControlIntent {
  return {
    schemaVersion: 1,
    nonce: "intent-1",
    accountId: "account-main",
    regionId: "cn-hongkong",
    instanceId: "i-example",
    action: "stop",
    shutdownMode: "KeepCharging",
    issuedAt: "2026-10-08T11:55:00Z",
    expiresAt: "2026-10-08T12:05:00Z",
    ...overrides,
  };
}

/** A cache bound to the fixture configuration. */
export function cacheFor(config: AppConfig): Cache {
  return new Cache({
    store: memoryStorage(),
    namespace: config.namespace,
    provider: config.mode,
    fingerprint: config.configFingerprint,
  });
}

/** A control config whose device attestation claims both preconditions. */
export function attestedControlConfig(
  overrides: Partial<ControlConfig> = {},
): ControlConfig {
  return controlConfig({
    deviceVerification: {
      crossExecutionIntentClaim: true,
      hostSerializesSameTarget: true,
      verifiedAt: "2026-10-09T00:00:00Z",
      note: "test attestation",
    },
    ...overrides,
  });
}

/** Capability flags claiming both device-verified preconditions. */
export const PROVEN: ControlCapability = {
  crossExecutionIntentClaim: true,
  hostSerializesSameTarget: true,
};

/** A request scope with a fixed budget. */
export function requestScope(now: Date = NOW, budgetMs = 15_000) {
  return {
    deadlineMs: now.getTime() + budgetMs,
    remainingMs: () => budgetMs,
    now: () => now,
  };
}
