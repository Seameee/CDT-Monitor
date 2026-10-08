/**
 * C02–C07 — control policy, intent authorization and action-state handling.
 *
 * The central assertion throughout: **an unauthorized or unproven action
 * produces zero cloud calls**, and every refusal carries a visible reason.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateAutomation,
  maxObservationAgeMs,
  trafficAllowsControl,
  validateControlIntent,
} from "../src/domain/policy.ts";
import type {
  AppConfig,
  ControlConfig,
  ControlIntent,
  InstanceSnapshot,
  Snapshot,
  TrafficScopeSnapshot,
} from "../src/domain/models.ts";
import { createTimeZoneProvider } from "../src/domain/timezone.ts";
import {
  NO_CONTROL_CAPABILITY,
  buildConsoleGuidance,
  capabilityFromConfig,
  describeCapability,
  executeControlIntent,
  isControlVerified,
  isIntentConsumed,
} from "../src/services/control.ts";
import { parseConfig } from "../src/config/parse.ts";
import { FakeControlProvider, fixedClock } from "./host-fake.ts";
import {
  NOW,
  PROVEN,
  attestedControlConfig,
  appConfig,
  cacheFor,
  controlConfig,
  instanceSnapshot,
  intent,
  requestScope,
  scopeSnapshot,
  snapshot,
} from "./fixtures.ts";

const TZ = createTimeZoneProvider("Asia/Shanghai");

/* ------------------------------ C02 authorization ------------------------- */

test("C02: control disabled means no decisions and no actions", () => {
  const config = appConfig({ control: controlConfig({ enabled: false }) });
  const result = evaluateAutomation(snapshot(), config, NOW, TZ);
  assert.equal(result.decisions.length, 0);
});

test("C02: an instance outside the allow-list is blocked with a reason", () => {
  const config = appConfig({
    control: controlConfig({ allowedInstanceIds: [], scopes: [{ scopeId: "main-overseas", thresholdAction: "stop_and_notify", thresholdStopEnabled: true }] }),
  });
  const result = evaluateAutomation(snapshot(), config, NOW, TZ);
  // No *action* may be taken, but alerting is independent of authorization.
  assert.equal(result.decisions.filter((item) => item.kind === "stop_instance").length, 0);
  assert.equal(result.decisions.filter((item) => item.kind === "start_instance").length, 0);
  assert.ok(result.blocked.some((block) => block.code === "NotAuthorized"));
});

test("C02: an expired intent is refused", () => {
  const config = appConfig();
  const validation = validateControlIntent(
    intent({ expiresAt: "2026-10-08T11:59:00Z" }),
    snapshot(),
    config,
    NOW,
    false,
  );
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "Expired");
});

test("C02: a consumed intent is refused", () => {
  const validation = validateControlIntent(intent(), snapshot(), appConfig(), NOW, true);
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "AlreadyConsumed");
});

test("C02: a target that does not match the configuration is refused", () => {
  const validation = validateControlIntent(
    intent({ instanceId: "i-someone-else" }),
    snapshot(),
    appConfig(),
    NOW,
    false,
  );
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "TargetMismatch");
});

test("C02: an invalid intent window is refused", () => {
  const validation = validateControlIntent(
    intent({ issuedAt: "2026-10-08T12:00:00Z", expiresAt: "2026-10-08T11:00:00Z" }),
    snapshot(),
    appConfig(),
    NOW,
    false,
  );
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "BadWindow");
});

test("C02: an Unknown instance state blocks the action rather than assuming Stopped", () => {
  const validation = validateControlIntent(
    intent({ action: "start" }),
    snapshot({ instances: [instanceSnapshot({ status: "Unknown" })] }),
    appConfig(),
    NOW,
    false,
  );
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "UnknownStatus");
});

test("C02: starting while protection is active requires a separate override", () => {
  const config = appConfig({
    control: controlConfig({
      scopes: [{ scopeId: "main-overseas", thresholdAction: "stop_and_notify", thresholdStopEnabled: true }],
    }),
  });
  const validation = validateControlIntent(
    intent({ action: "start" }),
    snapshot({ instances: [instanceSnapshot({ status: "Stopped" })] }),
    config,
    NOW,
    false,
  );
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "ProtectionActive");
});

/* -------------------------- C06/C07 execution gating ---------------------- */

test("C06: without proven capability the executor issues zero cloud calls", async () => {
  const config = appConfig();
  const provider = new FakeControlProvider();
  const outcome = await executeControlIntent({
    intent: intent(),
    snapshot: snapshot(),
    config,
    cache: cacheFor(config),
    provider: provider as never,
    capability: NO_CONTROL_CAPABILITY,
    scope: { deadlineMs: NOW.getTime() + 15000, remainingMs: () => 15000, now: () => NOW },
    now: NOW,
  });
  assert.equal(outcome.executed, false);
  assert.equal(outcome.code, "CapabilityUnproven");
  assert.equal(provider.stopped.length, 0);
  assert.equal(provider.started.length, 0);
});

test("C07: with proven capability a stop is accepted, not reported as confirmed", async () => {
  // An intent may not escalate beyond policy: requesting StopCharging requires
  // the instance policy to already specify it.
  const config = appConfig({
    control: controlConfig({
      instances: [
        { instanceId: "hk-ecs", scheduleControlEnabled: false, keepAlive: false, shutdownMode: "StopCharging" },
      ],
    }),
  });
  const provider = new FakeControlProvider();
  const outcome = await executeControlIntent({
    intent: intent({ shutdownMode: "StopCharging" }),
    snapshot: snapshot(),
    config,
    cache: cacheFor(config),
    provider: provider as never,
    capability: PROVEN,
    scope: { deadlineMs: NOW.getTime() + 15000, remainingMs: () => 15000, now: () => NOW },
    now: NOW,
  });
  assert.equal(outcome.executed, true);
  // Acceptance is not completion; the instance is still only "stopping".
  assert.equal(outcome.state, "accepted");
  assert.equal(outcome.requiresStateCheck, true);
  assert.equal(provider.stopped.length, 1);
  assert.equal(provider.stopped[0]?.mode, "StopCharging");
});

test("C07: a stop mode that contradicts policy is refused rather than escalated", async () => {
  const config = appConfig();
  const provider = new FakeControlProvider();
  const outcome = await executeControlIntent({
    intent: intent({ shutdownMode: "StopCharging" }),
    snapshot: snapshot(),
    config,
    cache: cacheFor(config),
    provider: provider as never,
    capability: PROVEN,
    scope: { deadlineMs: NOW.getTime() + 15000, remainingMs: () => 15000, now: () => NOW },
    now: NOW,
  });
  assert.equal(outcome.executed, false);
  assert.equal(outcome.code, "ShutdownModeMismatch");
  assert.equal(provider.stopped.length, 0);
});

test("C06: a timeout is uncertain and must not be blind-replayed", async () => {
  const config = appConfig();
  const provider = new FakeControlProvider({
    code: "NetworkError",
    message: "timeout",
    at: NOW.toISOString(),
    retryable: true,
  });
  const cache = cacheFor(config);
  const outcome = await executeControlIntent({
    intent: intent(),
    snapshot: snapshot(),
    config,
    cache,
    provider: provider as never,
    capability: PROVEN,
    scope: { deadlineMs: NOW.getTime() + 15000, remainingMs: () => 15000, now: () => NOW },
    now: NOW,
  });
  assert.equal(outcome.state, "uncertain");
  assert.equal(outcome.requiresStateCheck, true);
  // The nonce is claimed before the write, so a repeat run is refused.
  assert.equal(isIntentConsumed(cache, "intent-1"), true);
});

test("C06: the intent is consumed before the write, so an interrupted run is not repeatable", async () => {
  const config = appConfig();
  const provider = new FakeControlProvider();
  const cache = cacheFor(config);
  const options = {
    intent: intent(),
    snapshot: snapshot(),
    config,
    cache,
    provider: provider as never,
    capability: PROVEN,
    scope: { deadlineMs: NOW.getTime() + 15000, remainingMs: () => 15000, now: () => NOW },
    now: NOW,
  };
  await executeControlIntent(options);
  // A second run with the same nonce must be refused.
  const second = await executeControlIntent(options);
  assert.equal(second.executed, false);
  assert.equal(second.code, "AlreadyConsumed");
  assert.equal(provider.stopped.length, 1);
});

/* --------------------------------- C03/C04 -------------------------------- */

test("C03: notify_only over the limit produces a notification and no stop", () => {
  const config = appConfig({
    control: controlConfig({
      scopes: [{ scopeId: "main-overseas", thresholdAction: "notify_only", thresholdStopEnabled: false }],
    }),
  });
  const result = evaluateAutomation(snapshot(), config, NOW, TZ);
  assert.equal(result.decisions.filter((item) => item.kind === "stop_instance").length, 0);
  assert.equal(result.decisions.filter((item) => item.kind === "notify_threshold").length, 1);
});

test("C04: protection is re-evaluated from the current observation, not a stale alert latch", () => {
  const config = appConfig({
    control: controlConfig({
      scopes: [{ scopeId: "main-overseas", thresholdAction: "stop_and_notify", thresholdStopEnabled: true }],
    }),
  });

  // First observation: stop is decided.
  const first = evaluateAutomation(snapshot(), config, NOW, TZ);
  const firstStop = first.decisions.find((item) => item.kind === "stop_instance");
  assert.ok(firstStop !== undefined);

  // The instance came back up while still over the limit, with a NEW observation.
  const later = new Date("2026-10-08T13:00:00Z");
  const second = evaluateAutomation(
    snapshot({
      trafficScopes: [scopeSnapshot({ trafficObservedAt: later.toISOString() })],
      instances: [instanceSnapshot({ status: "Running", statusObservedAt: later.toISOString() })],
    }),
    config,
    later,
    TZ,
  );
  const secondStop = second.decisions.find((item) => item.kind === "stop_instance");
  // The original engine's `threshold:<id>:active` latch would have suppressed this.
  assert.ok(secondStop !== undefined, "protection must apply again after a restart");
  assert.notEqual(secondStop?.idempotencyKey, firstStop?.idempotencyKey);
});

test("C04: an over-threshold instance is never started by schedule or keep-alive", () => {
  const config = appConfig({
    control: controlConfig({
      scopes: [{ scopeId: "main-overseas", thresholdAction: "stop_and_notify", thresholdStopEnabled: true }],
      instances: [
        { instanceId: "hk-ecs", scheduleControlEnabled: true, keepAlive: true, shutdownMode: "KeepCharging" },
      ],
    }),
    instances: [
      {
        id: "hk-ecs",
        accountId: "account-main",
        credentialId: "cred-main",
        trafficScopeId: "main-overseas",
        regionId: "cn-hongkong",
        instanceId: "i-example",
        name: "香港实例",
        keepAlive: true,
        shutdownMode: "KeepCharging",
        schedule: { enabled: true, start: "08:00", stop: "23:30" },
      },
    ],
  });
  // 08:05 local (00:05Z) is inside the start window.
  const result = evaluateAutomation(
    snapshot({ instances: [instanceSnapshot({ status: "Stopped" })] }),
    config,
    new Date("2026-10-08T00:05:00Z"),
    TZ,
  );
  for (const decision of result.decisions) {
    assert.notEqual(decision.kind, "start_instance");
  }
  assert.ok(result.blocked.some((block) => block.code === "ProtectionActive"));
});

/* ------------------------------- C05 ordering ----------------------------- */

test("C05: a manual stop pause suppresses keep-alive", () => {
  const config = appConfig({
    control: controlConfig({
      pauseUntil: "2026-10-08T18:00:00Z",
      instances: [
        { instanceId: "hk-ecs", scheduleControlEnabled: false, keepAlive: true, shutdownMode: "KeepCharging" },
      ],
    }),
    instances: [
      {
        id: "hk-ecs",
        accountId: "account-main",
        credentialId: "cred-main",
        trafficScopeId: "main-overseas",
        regionId: "cn-hongkong",
        instanceId: "i-example",
        name: "香港实例",
        keepAlive: true,
        shutdownMode: "KeepCharging",
        schedule: { enabled: false, start: "08:00", stop: "23:30" },
      },
    ],
  });
  const result = evaluateAutomation(
    snapshot({
      trafficScopes: [scopeSnapshot({ overThreshold: false, usagePercent: 10 })],
      instances: [instanceSnapshot({ status: "Stopped" })],
    }),
    config,
    NOW,
    TZ,
  );
  assert.equal(result.decisions.filter((item) => item.kind === "start_instance").length, 0);
  assert.ok(result.blocked.some((block) => block.code === "Paused"));
});

test("C05: keep-alive starts a Stopped instance when nothing outranks it", () => {
  const config = appConfig({
    control: controlConfig({
      instances: [
        { instanceId: "hk-ecs", scheduleControlEnabled: false, keepAlive: true, shutdownMode: "KeepCharging" },
      ],
    }),
  });
  const result = evaluateAutomation(
    snapshot({
      trafficScopes: [scopeSnapshot({ overThreshold: false, usagePercent: 10 })],
      instances: [instanceSnapshot({ status: "Stopped" })],
    }),
    config,
    NOW,
    TZ,
  );
  assert.equal(result.decisions.filter((item) => item.kind === "start_instance").length, 1);
});

test("a transitional instance is never re-commanded", () => {
  const config = appConfig({
    control: controlConfig({
      scopes: [{ scopeId: "main-overseas", thresholdAction: "stop_and_notify", thresholdStopEnabled: true }],
    }),
  });
  const result = evaluateAutomation(
    snapshot({ instances: [instanceSnapshot({ status: "Stopping" })] }),
    config,
    NOW,
    TZ,
  );
  assert.equal(result.decisions.filter((item) => item.kind === "stop_instance").length, 0);
  assert.ok(result.blocked.some((block) => block.code === "Transitional"));
});

/* ---------------------------- freshness gating ---------------------------- */

test("legacy v1 freshness can never authorize a control action", () => {
  const config = appConfig();
  const state = trafficAllowsControl(
    scopeSnapshot({ freshnessQuality: "legacy-unverified", trafficObservedAt: null }),
    config,
    NOW,
  );
  assert.equal(state.allowed, false);
  if (!state.allowed) assert.equal(state.code, "UnverifiedFreshness");
});

test("a stale observation is refused once it exceeds the freshness budget", () => {
  const config = appConfig();
  const old = new Date(NOW.getTime() - maxObservationAgeMs(config) - 1000).toISOString();
  const state = trafficAllowsControl(scopeSnapshot({ trafficObservedAt: old }), config, NOW);
  assert.equal(state.allowed, false);
  if (!state.allowed) assert.equal(state.code, "StaleObservation");
});

test("an unknown threshold state blocks protection", () => {
  const state = trafficAllowsControl(
    scopeSnapshot({ overThreshold: null, usagePercent: null }),
    appConfig(),
    NOW,
  );
  assert.equal(state.allowed, false);
});

/* --------------------------- degraded console path ------------------------ */

test("the degraded control path always offers a working, GET-only console entry", () => {
  const guidance = buildConsoleGuidance(appConfig());
  assert.ok(guidance.url.startsWith("https://"));
  // The URL must not embed a key or an action.
  assert.ok(!guidance.url.includes("Key"));
  assert.ok(!guidance.url.includes("stop"));
  assert.ok(guidance.steps.length >= 3);
});

test("an unproven capability refuses even with a valid intent", async () => {
  const config = appConfig();
  const outcome = await executeControlIntent({
    intent: intent(),
    snapshot: snapshot(),
    config,
    cache: cacheFor(config),
    provider: null,
    capability: NO_CONTROL_CAPABILITY,
    scope: { deadlineMs: NOW.getTime() + 15000, remainingMs: () => 15000, now: () => NOW },
    now: NOW,
  });
  assert.equal(outcome.executed, false);
  assert.equal(outcome.code, "ControlUnavailable");
});

test("the fixed clock helper is used so policy never reads wall time", () => {
  const clock = fixedClock("2026-10-08T12:00:00Z");
  assert.equal(clock.now().toISOString(), "2026-10-08T12:00:00.000Z");
});

/* ------------------- device attestation (opt-in write gate) --------------- */

test("capability is closed by default and only opens on an explicit attestation", () => {
  // Default: attests nothing.
  assert.equal(capabilityFromConfig(appConfig()).crossExecutionIntentClaim, false);
  assert.equal(isControlVerified(appConfig()), false);

  // Only one of the two preconditions is not enough.
  const half = appConfig({
    control: controlConfig({
      deviceVerification: {
        crossExecutionIntentClaim: true,
        hostSerializesSameTarget: false,
        verifiedAt: "2026-10-09T00:00:00Z",
        note: null,
      },
    }),
  });
  assert.equal(isControlVerified(half), false);

  // Both, with a date, opens it.
  assert.equal(isControlVerified(appConfig({ control: attestedControlConfig() })), true);
  assert.ok(describeCapability(appConfig({ control: attestedControlConfig() })).includes("真机验证"));
  assert.ok(describeCapability(appConfig()).includes("未验证"));
});

test("an attestation without a date is refused by configuration parsing", () => {
  const outcome = parseConfig({
    CDT_ACCESS_KEY_ID: "EXAMPLE_AK_ID",
    CDT_ACCESS_KEY_SECRET: "EXAMPLE_SECRET",
    CDT_CONTROL_JSON: JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      deviceVerification: {
        crossExecutionIntentClaim: true,
        hostSerializesSameTarget: true,
      },
    }),
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.issues.some((issue) => issue.field.includes("verifiedAt")));
});

test("an unknown field inside deviceVerification keeps control closed", () => {
  const outcome = parseConfig({
    CDT_ACCESS_KEY_ID: "EXAMPLE_AK_ID",
    CDT_ACCESS_KEY_SECRET: "EXAMPLE_SECRET",
    CDT_CONTROL_JSON: JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      deviceVerification: {
        crossExecutionIntentClaim: true,
        hostSerializesSameTarget: true,
        verifiedAt: "2026-10-09T00:00:00Z",
        trustMeBro: true,
      },
    }),
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.issues.some((issue) => issue.field.includes("deviceVerification")));
});

test("an attested capability actually lets a control intent execute", async () => {
  const config = appConfig({ control: attestedControlConfig() });
  const provider = new FakeControlProvider();
  const outcome = await executeControlIntent({
    intent: intent(),
    snapshot: snapshot(),
    config,
    cache: cacheFor(config),
    provider: provider as never,
    capability: capabilityFromConfig(config),
    scope: requestScope(),
    now: NOW,
  });
  // This is the proof that the switch is wired through, not just documented.
  assert.equal(outcome.executed, true);
  assert.equal(outcome.code, "Accepted");
  assert.equal(provider.stopped.length, 1);
});
