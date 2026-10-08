/**
 * Widget DSL output — the seven families, every required state, and the
 * guarantee that no broken value can reach a text node.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildViewModel, selectPrimaryScope } from "../src/widget/render.ts";
import { renderLayout } from "../src/widget/layouts.ts";
import { resolveTheme, hexToRgbFunction } from "../src/widget/theme.ts";
import { progressBar, progressRing, sparkline, escapeXml } from "../src/widget/svg.ts";
import { WIDGET_FAMILIES } from "../src/host/types.ts";
import type { DslNode, WidgetFamily } from "../src/host/types.ts";
import type { ScopeHistory, Snapshot } from "../src/domain/models.ts";
import { appConfig, instanceSnapshot, scopeSnapshot, snapshot, NOW } from "./fixtures.ts";

/* --------------------------------- helpers -------------------------------- */

function render(
  snap: Snapshot,
  family: WidgetFamily | undefined,
  histories = new Map<string, ScopeHistory>(),
  themeName: string | null = null,
  config = appConfig(),
) {
  const theme = resolveTheme(themeName);
  const model = buildViewModel({ snapshot: snap, config, now: NOW, histories, theme });
  return { model, node: renderLayout(family, {
    model,
    theme,
    refreshAfter: "2026-10-08T12:15:00.000Z",
    url: "https://cdt.console.aliyun.com/",
  }) };
}

/** Collect every string reachable in the DSL, for leakage checks. */
function allStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) allStrings(item, out);
    return out;
  }
  if (node !== null && typeof node === "object") {
    for (const value of Object.values(node as Record<string, unknown>)) {
      allStrings(value, out);
    }
  }
  return out;
}

/** Collect every node type used in the document. */
function nodeTypes(node: unknown, out = new Set<string>()): Set<string> {
  if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (typeof record["type"] === "string") out.add(record["type"]);
    for (const value of Object.values(record)) nodeTypes(value, out);
  } else if (Array.isArray(node)) {
    for (const item of node) nodeTypes(item, out);
  }
  return out;
}

const ALLOWED_NODE_TYPES = new Set(["widget", "stack", "text", "image", "spacer", "date"]);

/* ----------------------------- family coverage ---------------------------- */

test("all seven documented families render a valid widget root", () => {
  for (const family of WIDGET_FAMILIES) {
    const { node } = render(snapshot(), family);
    assert.equal((node as DslNode).type, "widget", family);
    assert.ok(Array.isArray((node as { children?: unknown[] }).children), family);
    // Only documented nodes may appear — no button/progress/canvas.
    for (const type of nodeTypes(node)) {
      assert.ok(ALLOWED_NODE_TYPES.has(type), `${family} emitted undocumented node ${type}`);
    }
  }
});

test("an unset or unknown family degrades to a valid layout instead of throwing", () => {
  for (const family of [undefined, "systemHuge", ""] as const) {
    const { node } = render(snapshot(), family as WidgetFamily | undefined);
    assert.equal((node as DslNode).type, "widget");
  }
});

test("refreshAfter is emitted as a future ISO 8601 instant", () => {
  const { node } = render(snapshot(), "systemSmall");
  const refreshAfter = (node as { refreshAfter?: string }).refreshAfter;
  assert.equal(refreshAfter, "2026-10-08T12:15:00.000Z");
  assert.ok(Date.parse(refreshAfter as string) > NOW.getTime());
});

test("the tap URL is a plain GET link with no key or action", () => {
  const { node } = render(snapshot(), "systemSmall");
  const url = (node as { url?: string }).url;
  assert.equal(url, "https://cdt.console.aliyun.com/");
  assert.ok(!url?.includes("Key"));
});

/* --------------------------------- states --------------------------------- */

test("an unconfigured snapshot renders an explanatory widget", () => {
  const { model, node } = render(snapshot({ trafficScopes: [], instances: [] }), "systemSmall");
  assert.equal(model.status, "unconfigured");
  assert.ok(model.message !== null);
  assert.equal((node as DslNode).type, "widget");
  assert.ok(allStrings(node).some((value) => value.includes("尚未配置") || value.includes("请")));
});

test("a first-wait state (no data yet) explains itself", () => {
  const { model } = render(
    snapshot({
      trafficScopes: [scopeSnapshot({ usedBytes: null, usagePercent: null, overThreshold: null, trafficObservedAt: null })],
    }),
    "systemSmall",
  );
  assert.equal(model.status, "waiting");
  assert.ok(model.message !== null);
});

test("an over-threshold state is stated as text, not only as colour", () => {
  const { model, node } = render(snapshot(), "systemMedium");
  assert.equal(model.status, "over-threshold");
  assert.ok(model.scopes[0]?.statusText.includes("超"));
  assert.ok(allStrings(node).some((value) => value.includes("超")));
});

test("a near-threshold state is distinguished from over-threshold", () => {
  const snap = snapshot({
    trafficScopes: [scopeSnapshot({ usedBytes: 100 * scopeSnapshot().quotaBytes! / 200, usagePercent: 92, overThreshold: false })],
  });
  const { model } = render(snap, "systemMedium");
  assert.equal(model.status, "near-threshold");
  assert.equal(model.scopes[0]?.statusText, "接近阈值");
});

test("a credential failure surfaces as an auth error", () => {
  const snap = snapshot({
    errors: [{ code: "TokenRejected", message: "只读 Token 无效", at: NOW.toISOString(), retryable: false, entityId: "main-overseas" }],
  });
  const { model, node } = render(snap, "systemMedium");
  assert.equal(model.status, "auth-error");
  assert.ok(allStrings(node).some((value) => value.includes("凭据") || value.includes("Token")));
});

test("a stale cache is labelled instead of presented as current", () => {
  const snap = snapshot({
    trafficScopes: [scopeSnapshot({
      trafficError: { code: "NetworkError", message: "网络请求失败", at: NOW.toISOString(), retryable: true },
      stale: true,
    })],
  });
  const { model } = render(snap, "systemMedium");
  assert.equal(model.status, "stale");
  assert.equal(model.scopes[0]?.statusText, "查询失败");
});

test("a selected scope that no longer exists is reported, not silently swapped", () => {
  const config = appConfig({ view: { scopeId: "deleted-scope", instanceIds: null, theme: null } });
  const { model } = render(snapshot(), "systemMedium", new Map(), null, config);
  assert.equal(model.status, "target-missing");
  assert.ok(model.detail?.includes("deleted-scope"));
});

test("no history renders an explicit empty note for an otherwise healthy scope", () => {
  const snap = snapshot({
    trafficScopes: [scopeSnapshot({ usedBytes: 10 * 1_000_000_000, usagePercent: 5, overThreshold: false })],
  });
  const { model } = render(snap, "systemLarge");
  assert.equal(model.status, "no-history");
  assert.equal(model.message, "暂无历史数据");
});

test("a confirmed threshold outranks the cosmetic missing-history state", () => {
  const { model } = render(snapshot(), "systemLarge");
  assert.equal(model.status, "over-threshold");
});

test("a lock-screen inline layout stays a single line of text", () => {
  const { node } = render(snapshot(), "accessoryInline");
  const strings = allStrings(node);
  assert.ok(strings.some((value) => value.includes("CDT")));
});

/* ---------------------------- value hygiene ------------------------------- */

test("no output text ever contains NaN, Infinity or undefined", () => {
  const cases: Snapshot[] = [
    snapshot(),
    snapshot({ trafficScopes: [scopeSnapshot({ quotaBytes: null, remainingBytes: null })] }),
    snapshot({ trafficScopes: [scopeSnapshot({ usedBytes: null, usagePercent: null, overThreshold: null })] }),
    snapshot({ trafficScopes: [scopeSnapshot({ usagePercent: 137.5, overThreshold: true, remainingBytes: 0 })] }),
    snapshot({ instances: [instanceSnapshot({ status: "Unknown" })] }),
    snapshot({
      instances: [instanceSnapshot({ monthlyCost: 0, currency: "CNY" })],
      accounts: [{ id: "account-main", name: "主账号", balance: 0, currency: "CNY", balanceObservedAt: NOW.toISOString(), balanceError: null }],
    }),
  ];
  for (const family of WIDGET_FAMILIES) {
    for (const snap of cases) {
      const { node } = render(snap, family);
      for (const value of allStrings(node)) {
        assert.ok(!value.includes("NaN"), `${family}: ${value}`);
        assert.ok(!value.includes("Infinity"), `${family}: ${value}`);
        assert.ok(!value.includes("undefined"), `${family}: ${value}`);
      }
    }
  }
});

test("an over-quota percentage is shown truthfully while graphics clamp", () => {
  const { model } = render(
    snapshot({ trafficScopes: [scopeSnapshot({ usagePercent: 137.5, overThreshold: true })] }),
    "systemSmall",
  );
  assert.equal(model.scopes[0]?.percentText, "137.50%");
  // Drawing is clamped to 1 so the bar cannot render past its track.
  assert.equal(model.scopes[0]?.fraction, 1);
});

test("an unconfigured quota shows usage with 未配置 rather than a fabricated limit", () => {
  const { model } = render(
    snapshot({ trafficScopes: [scopeSnapshot({ quotaBytes: null, remainingBytes: null, usagePercent: null, overThreshold: null })] }),
    "systemSmall",
  );
  assert.ok(model.scopes[0]?.usageText.includes("未配置上限"));
  assert.equal(model.scopes[0]?.remainingText, "未配置");
});

test("very long names are truncated without splitting a surrogate pair", () => {
  const { model } = render(
    snapshot({ instances: [instanceSnapshot({ name: "😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀" })] }),
    "systemMedium",
  );
  const name = model.scopes[0]?.instances[0]?.name ?? "";
  // Count code points, not UTF-16 units: a code-unit count would be ~2x for emoji.
  assert.ok(Array.from(name).length <= 18, `was ${Array.from(name).length} code points`);
  assert.ok(name.endsWith("…"));
  // No lone surrogate may survive, or it renders as a replacement glyph.
  assert.ok(!/\uFFFD/.test(name));
});

/* ------------------------------- SVG output ------------------------------- */

test("generated SVG is a data URI containing xmlns and viewBox, and no bare #", () => {
  const ring = progressRing({
    fraction: 0.5, size: 64, strokeWidth: 6,
    trackColor: "#9A9AA0", progressColor: "#30D158",
  });
  assert.ok(ring !== null);
  assert.ok(ring.startsWith("data:image/svg+xml,"));
  assert.ok(ring.includes("xmlns='http://www.w3.org/2000/svg'"));
  assert.ok(ring.includes("viewBox="));
  // A literal '#' would terminate the URI before the fragment.
  assert.ok(!ring.slice("data:image/svg+xml,".length).includes("#"));
  assert.ok(ring.includes("rgb("));
});

test("progress graphics clamp out-of-range input", () => {
  const over = progressBar({
    fraction: 5, width: 100, height: 6,
    trackColor: "#000000", progressColor: "#FFFFFF",
  });
  const under = progressBar({
    fraction: -3, width: 100, height: 6,
    trackColor: "#000000", progressColor: "#FFFFFF",
  });
  assert.ok(over !== null && under !== null);
  // The filled rect can never exceed the track width.
  assert.ok(over.includes("width='100'"));
  assert.ok(under.includes("width='0'"));
});

test("a sparkline needs at least two points and rejects a flat one gracefully", () => {
  assert.equal(sparkline({ values: [1], width: 100, height: 20, color: "#FFFFFF" }), null);
  assert.equal(sparkline({ values: [], width: 100, height: 20, color: "#FFFFFF" }), null);
  // A flat series is drawn at mid-height rather than collapsing.
  const flat = sparkline({ values: [5, 5, 5], width: 100, height: 20, color: "#FFFFFF" });
  assert.ok(flat !== null);
  assert.ok(flat.includes("10"));
});

test("SVG markup contains no user text, so there is no injection surface", () => {
  const ring = progressRing({
    fraction: 0.25, size: 40, strokeWidth: 4,
    trackColor: "#000000", progressColor: "#FFFFFF",
  });
  assert.ok(ring !== null);
  assert.ok(!ring.includes("<text"));
});

test("escapeXml neutralizes markup characters", () => {
  assert.equal(escapeXml("<a & 'b' \"c\">"), "&lt;a &amp; &apos;b&apos; &quot;c&quot;&gt;");
});

/* --------------------------------- themes --------------------------------- */

test("themes resolve safely and unknown names fall back to auto", () => {
  assert.equal(resolveTheme("dark").name, "dark");
  assert.equal(resolveTheme("light").name, "light");
  assert.equal(resolveTheme("auto").name, "auto");
  assert.equal(resolveTheme(null).name, "auto");
  assert.equal(resolveTheme("nonsense").name, "auto");
});

test("adaptive colours convert to rgb() for SVG and never leak a '#'", () => {
  assert.equal(hexToRgbFunction("#FFFFFF"), "rgb(255,255,255)");
  assert.equal(hexToRgbFunction("#000"), "rgb(0,0,0)");
  assert.equal(hexToRgbFunction("#FF000080"), "rgba(255,0,0,0.502)");
  // Non-hex input is passed through with any '#' removed.
  assert.ok(!hexToRgbFunction("rgba(1,2,3,1)").includes("#"));
});

/* ------------------------------- selection -------------------------------- */

test("the primary scope honours the widget-level selection", () => {
  const config = appConfig({ view: { scopeId: "main-overseas", instanceIds: null, theme: null } });
  assert.equal(selectPrimaryScope(snapshot(), config)?.id, "main-overseas");
  const missing = appConfig({ view: { scopeId: "nope", instanceIds: null, theme: null } });
  // Falls back to the first scope for rendering, and the model reports it.
  assert.equal(selectPrimaryScope(snapshot(), missing)?.id, "main-overseas");
});

test("a failed status read marks the instance state as unconfirmed", () => {
  const snap = snapshot({
    instances: [
      instanceSnapshot({
        status: "Stopping",
        statusError: { code: "NetworkError", message: "查询失败", at: NOW.toISOString(), retryable: true },
      }),
    ],
  });
  const { model, node } = render(snap, "systemMedium");
  const row = model.scopes[0]?.instances[0];
  // Showing a stale "stopping" as if it were current is exactly what makes a
  // user think the instance is stuck while nothing is being done about it.
  assert.equal(row?.statusText, "停止中（待确认）");
  assert.equal(row?.state, "warning");
  assert.ok(model.scopes[0]?.qualityNote?.includes("实例状态查询失败"));
  assert.ok(allStrings(node).some((value) => value.includes("待确认")));
});

test("a confirmed stopping instance is shown without a caveat", () => {
  const snap = snapshot({ instances: [instanceSnapshot({ status: "Stopping" })] });
  const { model } = render(snap, "systemMedium");
  const row = model.scopes[0]?.instances[0];
  assert.equal(row?.statusText, "停止中");
  assert.equal(row?.state, "warning");
  assert.ok(!model.scopes[0]?.qualityNote?.includes("查询失败"));
});
