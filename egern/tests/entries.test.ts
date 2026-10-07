/**
 * C01 and entry-point behaviour: the read-only guarantee, configuration failure
 * handling, notification policy and secret hygiene.
 *
 * The responder below emulates the two direct-mode endpoints. Any unexpected
 * request is answered with an error, so a stray write shows up as a failure
 * rather than passing silently.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import widgetEntry from "../src/entries/widget.ts";
import refreshEntry from "../src/entries/refresh.ts";
import diagnosticsEntry from "../src/entries/diagnostics.ts";
import automationEntry from "../src/entries/automation.ts";
import controlEntry from "../src/entries/control.ts";
import { WIDGET_FAMILIES } from "../src/host/types.ts";
import { createFakeContext } from "./host-fake.ts";
import type { RecordedRequest } from "./host-fake.ts";

const SECRET = "SUPER_SECRET_ACCESS_KEY_VALUE";
const QUOTA_BYTES = 200;

/** Emulate the CDT and ECS endpoints; refuse anything else. */
function aliyunResponder(request: RecordedRequest): { status: number; body: string } {
  const action = request.form?.["Action"] ?? "";
  if (action === "ListCdtInternetTraffic") {
    return {
      status: 200,
      body: JSON.stringify({
        RequestId: "r",
        TrafficDetails: [{ BusinessRegionId: "cn-hongkong", Traffic: 1_073_741_824 }],
      }),
    };
  }
  if (action === "DescribeInstanceStatus") {
    return {
      status: 200,
      body: JSON.stringify({
        InstanceStatuses: { InstanceStatus: [{ InstanceId: "i-example", Status: "Running" }] },
      }),
    };
  }
  // Any other action (including StartInstance/StopInstance) is a hard failure.
  return { status: 400, body: JSON.stringify({ Code: "UnexpectedAction", Message: action }) };
}

function baseEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    CDT_ACCESS_KEY_ID: "EXAMPLE_AK_ID",
    CDT_ACCESS_KEY_SECRET: SECRET,
    CDT_INSTANCE_ID: "i-example",
    CDT_QUOTA: String(QUOTA_BYTES),
    CDT_QUOTA_UNIT: "GB",
    ...extra,
  };
}

/** Actions present in any recorded request, for the boundary assertion. */
function actionsIn(requests: readonly RecordedRequest[]): string[] {
  return requests
    .map((request) => request.form?.["Action"] ?? "")
    .filter((action) => action !== "");
}

/* --------------------------------- C01 ------------------------------------ */

test("C01: the widget entry issues zero instance-control calls", async () => {
  for (const family of WIDGET_FAMILIES) {
    const fake = createFakeContext({
      env: baseEnv(),
      responder: aliyunResponder,
      widgetFamily: family,
    });
    const result = await widgetEntry(fake.ctx);
    assert.equal((result as { type?: string }).type, "widget", family);
    for (const action of actionsIn(fake.requests)) {
      assert.notEqual(action, "StartInstance", family);
      assert.notEqual(action, "StopInstance", family);
    }
  }
});

test("C01: the refresh entry issues zero instance-control calls", async () => {
  const fake = createFakeContext({ env: baseEnv(), responder: aliyunResponder });
  await refreshEntry(fake.ctx);
  for (const action of actionsIn(fake.requests)) {
    assert.notEqual(action, "StartInstance");
    assert.notEqual(action, "StopInstance");
  }
});

test("C01: the diagnostics entry performs no cloud calls and no writes", async () => {
  const fake = createFakeContext({ env: baseEnv(), responder: aliyunResponder });
  const result = await diagnosticsEntry(fake.ctx);
  assert.equal((result as { type?: string }).type, "widget");
  assert.equal(fake.requests.length, 0);
});

test("C01: the automation entry does nothing at all while control is disabled", async () => {
  const fake = createFakeContext({ env: baseEnv(), responder: aliyunResponder, cron: "*/5 * * * *" });
  await automationEntry(fake.ctx);
  // The master switch is off by default, so not even a read is performed.
  assert.equal(fake.requests.length, 0);
});

/* ------------------------------- configuration ---------------------------- */

test("a broken configuration still renders a valid, explanatory widget", async () => {
  // No credentials at all in direct mode.
  const fake = createFakeContext({ env: {}, responder: aliyunResponder, widgetFamily: "systemSmall" });
  const result = await widgetEntry(fake.ctx);
  assert.equal((result as { type?: string }).type, "widget");
  const text = JSON.stringify(result);
  assert.ok(text.includes("配置"), `expected a configuration message, got ${text.slice(0, 200)}`);
  // Nothing was attempted against the cloud.
  assert.equal(fake.requests.length, 0);
});

test("an unparseable advanced JSON is refused rather than silently ignored", async () => {
  const fake = createFakeContext({
    env: baseEnv({ CDT_ACCOUNTS_JSON: "{not json" }),
    responder: aliyunResponder,
    widgetFamily: "systemSmall",
  });
  const result = await widgetEntry(fake.ctx);
  assert.equal((result as { type?: string }).type, "widget");
  const text = JSON.stringify(result);
  assert.ok(text.includes("JSON") || text.includes("配置"));
  assert.equal(fake.requests.length, 0);
});

test("a network failure still yields a renderable widget", async () => {
  const fake = createFakeContext({
    env: baseEnv(),
    responder: () => ({ status: 500, body: "boom" }),
    widgetFamily: "systemMedium",
  });
  const result = await widgetEntry(fake.ctx);
  assert.equal((result as { type?: string }).type, "widget");
  const text = JSON.stringify(result);
  assert.ok(!text.includes("NaN"));
  assert.ok(!text.includes("undefined"));
});

/* ------------------------------- notifications ---------------------------- */

test("refresh sends no notification while local notify is disabled", async () => {
  const fake = createFakeContext({ env: baseEnv(), responder: aliyunResponder });
  await refreshEntry(fake.ctx);
  assert.equal(fake.notifications.length, 0);
});

test("refresh notifies on a threshold crossing only when explicitly enabled", async () => {
  // 1 GiB used against a 0.5 GB quota is 214% — well over the 95% threshold.
  const fake = createFakeContext({
    env: baseEnv({ CDT_QUOTA: "0.5", CDT_LOCAL_NOTIFY: "true" }),
    responder: aliyunResponder,
  });
  await refreshEntry(fake.ctx);
  assert.equal(fake.notifications.length, 1);
  assert.ok(fake.notifications[0]?.title.includes("告警"));

  // The same run must not notify again: the alert is de-duplicated by event key.
  const second = createFakeContext({
    env: baseEnv({ CDT_QUOTA: "0.5", CDT_LOCAL_NOTIFY: "true" }),
    responder: aliyunResponder,
    seedStorage: {},
  });
  await refreshEntry(second.ctx);
  // A fresh storage namespace legitimately notifies again; the same-storage case
  // is asserted by reusing one context below.
  assert.equal(second.notifications.length, 1);

  const shared = createFakeContext({
    env: baseEnv({ CDT_QUOTA: "0.5", CDT_LOCAL_NOTIFY: "true" }),
    responder: aliyunResponder,
  });
  await refreshEntry(shared.ctx);
  const afterFirst = shared.notifications.length;
  await refreshEntry(shared.ctx);
  assert.equal(shared.notifications.length, afterFirst, "duplicate alert was delivered");
});

test("notifications never carry a credential", async () => {
  const fake = createFakeContext({
    env: baseEnv({ CDT_QUOTA: "0.5", CDT_LOCAL_NOTIFY: "true" }),
    responder: aliyunResponder,
  });
  await refreshEntry(fake.ctx);
  const serialized = JSON.stringify(fake.notifications);
  assert.ok(!serialized.includes(SECRET), "the AccessKeySecret leaked into a notification");
  assert.ok(!serialized.includes("EXAMPLE_AK_ID"), "the AccessKeyId leaked into a notification");
});

/* ------------------------------- diagnostics ------------------------------ */

test("diagnostics reports configuration presence without echoing secrets", async () => {
  const fake = createFakeContext({ env: baseEnv(), responder: aliyunResponder });
  const result = await diagnosticsEntry(fake.ctx);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(SECRET), "the AccessKeySecret leaked into diagnostics");
  assert.ok(!serialized.includes("EXAMPLE_AK_ID"), "the AccessKeyId leaked into diagnostics");
  // It should still be useful.
  assert.ok(serialized.includes("AccessKey"));
  assert.ok(serialized.includes("storage"));
});

test("diagnostics lists configuration errors when the configuration is broken", async () => {
  const fake = createFakeContext({
    env: { CDT_MODE: "direct" },
    responder: aliyunResponder,
    widgetFamily: "systemLarge",
  });
  const result = await diagnosticsEntry(fake.ctx);
  assert.equal((result as { type?: string }).type, "widget");
  const serialized = JSON.stringify(result);
  assert.ok(serialized.includes("ACCESS_KEY") || serialized.includes("AccessKey"));
});

/* --------------------------------- control -------------------------------- */

test("the control entry refuses to act outside a widget context only as an extra check", async () => {
  const fake = createFakeContext({
    env: baseEnv(),
    responder: aliyunResponder,
    // Present widgetFamily means this run is being used as a widget.
    widgetFamily: "systemSmall",
  });
  const result = await controlEntry(fake.ctx);
  const serialized = JSON.stringify(result);
  assert.ok(serialized.includes("拒绝") || serialized.includes("不能作为小组件"));
  assert.equal(fake.requests.filter((request) => request.form?.["Action"] === "StopInstance").length, 0);
});

test("the control entry with no intent renders guidance and performs no write", async () => {
  const fake = createFakeContext({ env: baseEnv(), responder: aliyunResponder });
  const result = await controlEntry(fake.ctx);
  assert.equal((result as { type?: string }).type, "widget");
  const serialized = JSON.stringify(result);
  assert.ok(serialized.includes("意图"));
  for (const action of actionsIn(fake.requests)) {
    assert.notEqual(action, "StartInstance");
    assert.notEqual(action, "StopInstance");
  }
});

test("the control entry with a valid intent still performs no write while capability is unproven", async () => {
  const fake = createFakeContext({
    env: baseEnv({
      CDT_CONTROL_JSON: JSON.stringify({
        schemaVersion: 1,
        enabled: true,
        credentialId: "cred-main",
        allowedInstanceIds: ["instance-main"],
      }),
      CDT_CONTROL_INTENT_JSON: JSON.stringify({
        schemaVersion: 1,
        nonce: "n-1",
        accountId: "account-main",
        regionId: "cn-hongkong",
        instanceId: "i-example",
        action: "stop",
        shutdownMode: "KeepCharging",
        issuedAt: "2026-10-08T11:55:00Z",
        expiresAt: "2099-01-01T00:00:00Z",
      }),
    }),
    responder: aliyunResponder,
  });
  const result = await controlEntry(fake.ctx);
  const serialized = JSON.stringify(result);
  assert.ok(serialized.includes("未执行") || serialized.includes("未验证"));
  for (const action of actionsIn(fake.requests)) {
    assert.notEqual(action, "StartInstance");
    assert.notEqual(action, "StopInstance");
  }
});
