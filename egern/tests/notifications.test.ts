/**
 * N01 — notification templates, encoding and business-level failure detection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDailyReportEvent,
  buildRecoveredEvent,
  buildThresholdEvent,
  defaultWebhookBody,
  dispatchNotification,
  renderTemplate,
  shouldNotify,
} from "../src/services/notifications.ts";
import type { NotificationEvent } from "../src/services/notifications.ts";
import { Cache } from "../src/services/cache.ts";
import { fakeHttp, memoryStorage } from "./host-fake.ts";
import { appConfig, scopeSnapshot, snapshot, NOW } from "./fixtures.ts";

const SECRET = "SUPER_SECRET_TOKEN";

function event(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: "evt-1",
    type: "threshold",
    title: "标题",
    summary: "摘要",
    fields: { "已用流量": "12.50 GB" },
    at: NOW.toISOString(),
    ...overrides,
  };
}

function cache(): Cache {
  return new Cache({
    store: memoryStorage(),
    namespace: "test",
    provider: "direct",
    fingerprint: "fp-test",
  });
}

function deps(responder: Parameters<typeof fakeHttp>[0]) {
  const { http, requests } = fakeHttp(responder);
  return {
    deps: {
      http,
      notifier: { notify: () => {} },
      cache: cache(),
      requestTimeoutMs: 5000,
    },
    requests,
  };
}

/* ------------------------------- templating -------------------------------- */

test("N01: template placeholders are JSON-escaped, so quotes cannot break out", () => {
  const payload = renderTemplate(
    '{"t":"{{{title}}}","s":"{{{summary}}}"}',
    event({ title: 'He said "hi"', summary: "line1\nline2\\end" }),
  );
  // The result must still be valid JSON.
  const parsed = JSON.parse(payload) as Record<string, string>;
  assert.equal(parsed["t"], 'He said "hi"');
  assert.equal(parsed["s"], "line1\nline2\\end");
});

test("N01: template substitution handles Unicode and missing fields", () => {
  const payload = renderTemplate('{"v":"{{{fields.已用流量}}}","x":"{{{missing}}}"}', event());
  const parsed = JSON.parse(payload) as Record<string, string>;
  assert.equal(parsed["v"], "12.50 GB");
  assert.equal(parsed["x"], "");
});

test("N01: a backslash and a raw newline survive round-trip through JSON", () => {
  const payload = renderTemplate('{"a":"{{{summary}}}"}', event({ summary: "a\\b\tc\u0000d" }));
  const parsed = JSON.parse(payload) as Record<string, string>;
  assert.equal(parsed["a"], "a\\b\tc\u0000d");
});

test("N01: the default webhook body is structured JSON, not string concatenation", () => {
  const body = defaultWebhookBody(event({ fields: { 'x"y': 'p"q' } }));
  const parsed = JSON.parse(body) as Record<string, unknown>;
  assert.equal(parsed["title"], "标题");
  assert.equal((parsed["fields"] as Record<string, string>)['x"y'], 'p"q');
});

/* ------------------------------ event building ----------------------------- */

test("N01: the threshold event states the true percentage and the unverified period", () => {
  const built = buildThresholdEvent(scopeSnapshot(), NOW);
  assert.equal(built.type, "threshold");
  assert.equal(built.fields["使用率"], "95.00%");
  assert.equal(built.fields["阈值"], "95%");
  assert.equal(built.fields["统计周期"], "接口累计（待确认）");
});

test("N01: the recovered event is a distinct type with its own key", () => {
  const recovered = buildRecoveredEvent(scopeSnapshot({ overThreshold: false }), NOW);
  assert.equal(recovered.type, "recovered");
  assert.notEqual(recovered.id, buildThresholdEvent(scopeSnapshot(), NOW).id);
});

test("N01: the daily report covers scopes and instances without claiming per-instance traffic", () => {
  const config = appConfig({ billingEnabled: true });
  const built = buildDailyReportEvent(
    snapshot({
      instances: [
        {
          id: "hk-ecs", accountId: "account-main", trafficScopeId: "main-overseas",
          regionId: "cn-hongkong", instanceId: "i-example", name: "香港实例",
          status: "Running", statusObservedAt: NOW.toISOString(), legacyUpdatedAt: null,
          statusError: null, monthlyCost: 12.34, currency: "CNY", billingCycle: "2026-10",
          billingObservedAt: NOW.toISOString(), billingError: null, lastAction: null,
          actionRequestedAt: null, actionState: null,
        },
      ],
    }),
    config,
    "2026-10-08",
    "22:00 窗口",
    NOW,
  );
  assert.equal(built.type, "daily_report");
  assert.equal(built.fields["统计日期"], "2026-10-08");
  assert.ok(built.fields["实例 香港实例"]?.includes("运行中"));
  // Per-instance traffic is never asserted; only status and cost.
  assert.ok(!built.fields["实例 香港实例"]?.includes("GB"));
});

/* ------------------------------ deduplication ----------------------------- */

test("N01: alerts are de-duplicated, daily reports and actions are not", () => {
  const store = cache();
  const alert = event({ id: "threshold:scope:period" });
  assert.equal(shouldNotify(store, alert, NOW), true);
  // Same key, later run: suppressed.
  assert.equal(shouldNotify(store, alert, new Date(NOW.getTime() + 60000)), false);
  // A different period re-notifies.
  assert.equal(shouldNotify(store, event({ id: "threshold:scope:period2" }), NOW), true);

  // Daily reports and action notices bypass alert de-duplication entirely.
  assert.equal(shouldNotify(store, event({ id: "d", type: "daily_report" }), NOW), true);
  assert.equal(shouldNotify(store, event({ id: "d", type: "daily_report" }), NOW), true);
  assert.equal(shouldNotify(store, event({ id: "a", type: "action" }), NOW), true);
  assert.equal(shouldNotify(store, event({ id: "a", type: "action" }), NOW), true);
});

/* --------------------------- delivery and failure ------------------------- */

test("N01: Telegram ok=false inside HTTP 200 is a failure", async () => {
  const { deps: d } = deps(() => ({ status: 200, body: JSON.stringify({ ok: false, description: "bad" }) }));
  const config = appConfig();
  const results = await dispatchNotification(
    d,
    event(),
    {
      ...config.notifications,
      telegram: { enabled: true, botToken: "123:ABC", chatId: "42" },
    },
    NOW,
  );
  const telegram = results.find((result) => result.channel === "telegram");
  assert.equal(telegram?.ok, false);
});

test("N01: a webhook errcode other than zero is a failure", async () => {
  const { deps: d } = deps(() => ({ status: 200, body: JSON.stringify({ errcode: 310000, errmsg: "denied" }) }));
  const config = appConfig();
  const results = await dispatchNotification(
    d,
    event(),
    {
      ...config.notifications,
      webhook: { enabled: true, url: "https://example.invalid/hook", method: "POST", bodyTemplate: "" },
    },
    NOW,
  );
  const webhook = results.find((result) => result.channel === "webhook");
  assert.equal(webhook?.ok, false);
});

test("N01: a webhook returning HTTP 500 is a failure even with a 200-shaped body", async () => {
  const { deps: d } = deps(() => ({ status: 500, body: JSON.stringify({ errcode: 0 }) }));
  const config = appConfig();
  const results = await dispatchNotification(
    d,
    event(),
    {
      ...config.notifications,
      webhook: { enabled: true, url: "https://example.invalid/hook", method: "POST", bodyTemplate: "" },
    },
    NOW,
  );
  assert.equal(results.find((result) => result.channel === "webhook")?.ok, false);
});

test("N01: a working webhook reports success", async () => {
  const { deps: d } = deps(() => ({ status: 200, body: '{"errcode":0}' }));
  const config = appConfig();
  const results = await dispatchNotification(
    d,
    event(),
    {
      ...config.notifications,
      webhook: { enabled: true, url: "https://example.invalid/hook", method: "POST", bodyTemplate: "" },
    },
    NOW,
  );
  assert.equal(results.find((result) => result.channel === "webhook")?.ok, true);
});

test("N01: a transport failure never throws out of dispatch", async () => {
  const { http } = fakeHttp(() => {
    throw new Error("network down");
  });
  const results = await dispatchNotification(
    { http, notifier: { notify: () => {} }, cache: cache(), requestTimeoutMs: 5000 },
    event(),
    {
      ...appConfig().notifications,
      webhook: { enabled: true, url: "https://example.invalid/hook", method: "POST", bodyTemplate: "" },
    },
    NOW,
  );
  assert.equal(results.find((result) => result.channel === "webhook")?.ok, false);
});

test("N01: no outbound payload may contain the configured secret", async () => {
  const { deps: d, requests } = deps(() => ({ status: 200, body: '{"errcode":0}' }));
  await dispatchNotification(
    d,
    event(),
    {
      ...appConfig().notifications,
      local: false,
      webhook: { enabled: true, url: "https://example.invalid/hook", method: "POST", bodyTemplate: "" },
    },
    NOW,
  );
  for (const request of requests) {
    assert.ok(!(request.options?.body ?? "").includes(SECRET));
    assert.ok(!request.url.includes(SECRET));
  }
});

test("N01: a disabled channel produces no request at all", async () => {
  const { deps: d, requests } = deps(() => ({ status: 200, body: "{}" }));
  const results = await dispatchNotification(d, event(), appConfig().notifications, NOW);
  assert.equal(results.length, 0);
  assert.equal(requests.length, 0);
});

test("N01: a failing local notification does not prevent other channels", async () => {
  const { deps: d, requests } = deps(() => ({ status: 200, body: '{"errcode":0}' }));
  const results = await dispatchNotification(
    {
      ...d,
      notifier: {
        notify: () => {
          throw new Error("notifications denied");
        },
      },
    },
    event(),
    {
      ...appConfig().notifications,
      local: true,
      webhook: { enabled: true, url: "https://example.invalid/hook", method: "POST", bodyTemplate: "" },
    },
    NOW,
  );
  assert.equal(results.find((result) => result.channel === "local")?.ok, false);
  // The webhook was still attempted.
  assert.equal(results.find((result) => result.channel === "webhook")?.ok, true);
  assert.equal(requests.length, 1);
});
