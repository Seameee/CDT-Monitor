/**
 * `cdt-diagnostics` — generic entry point for offline capability probing.
 *
 * Purpose: establish, on a real device, which host capabilities this plugin can
 * rely on. The contract lists these as unverified, and the project's whole
 * architecture depends on knowing the answers — so this entry reports them
 * instead of assuming them.
 *
 * Safety properties:
 *  - it **never reads a secret back**. Credentials are reported only as
 *    configured / not configured, never by value;
 *  - it performs no cloud calls and no writes;
 *  - it returns a valid Widget DSL document in every case, including when
 *    configuration is broken, because diagnosing a broken configuration is
 *    precisely its job.
 */

import type { EgernScriptContext } from "../host/types.ts";
import { prepareRuntime, WIDGET_BUDGET_MS } from "./runtime.ts";
import { describeCapability } from "../services/control.ts";
import type { ConfigIssue } from "../config/env.ts";

/** A single probe result. */
interface Probe {
  label: string;
  value: string;
  ok: boolean | null;
}

/** Detect a global by name without throwing when it is undeclared. */
function detectGlobal(name: string): boolean {
  try {
    return typeof (globalThis as unknown as Record<string, unknown>)[name] !== "undefined";
  } catch {
    return false;
  }
}

/** Probe a global whose presence we can test with `typeof` safely. */
function describeFeature(name: string, present: boolean): string {
  return present ? "可用" : "不可用";
}

/**
 * Run the capability probes.
 *
 * Deliberately reports *presence*, not values, so nothing sensitive can leak
 * into a widget or a screenshot.
 */
export function runProbes(ctx: EgernScriptContext): Probe[] {
  const probes: Probe[] = [];

  // --- host globals the project explicitly does NOT depend on ---
  const hasCrypto = detectGlobal("crypto");
  const hasGetRandomValues = (() => {
    const candidate = (globalThis as unknown as Record<string, unknown>)["crypto"];
    if (candidate === null || typeof candidate !== "object") return false;
    return typeof (candidate as Record<string, unknown>)["getRandomValues"] === "function";
  })();
  probes.push({
    label: "crypto.getRandomValues",
    value: hasGetRandomValues ? "可用（非ce安全随机数）" : hasCrypto ? "存在但无 getRandomValues" : "不可用",
    ok: hasGetRandomValues,
  });
  probes.push({
    label: "TextEncoder",
    value: describeFeature("TextEncoder", detectGlobal("TextEncoder")),
    ok: detectGlobal("TextEncoder"),
  });
  probes.push({
    label: "btoa/atob",
    value: describeFeature("btoa", typeof (globalThis as unknown as Record<string, unknown>)["btoa"] === "function"),
    ok: typeof (globalThis as unknown as Record<string, unknown>)["btoa"] === "function",
  });
  probes.push({
    label: "fetch",
    value: describeFeature("fetch", detectGlobal("fetch")),
    ok: detectGlobal("fetch"),
  });
  probes.push({
    label: "Buffer/process",
    value:
      detectGlobal("Buffer") || detectGlobal("process")
        ? "存在（本项目不依赖）"
        : "不可用（符合预期）",
    ok: null,
  });

  // --- timezone support ---
  probes.push({
    label: "Intl.DateTimeFormat",
    value: describeFeature("Intl", detectGlobal("Intl")),
    ok: detectGlobal("Intl"),
  });

  // --- ctx surface actually documented ---
  probes.push({ label: "ctx.http", value: ctx.http === undefined ? "缺失" : "可用", ok: ctx.http !== undefined });
  probes.push({ label: "ctx.storage", value: ctx.storage === undefined ? "缺失" : "可用", ok: ctx.storage !== undefined });
  probes.push({ label: "ctx.notify", value: typeof ctx.notify === "function" ? "可用" : "缺失", ok: typeof ctx.notify === "function" });
  probes.push({
    label: "ctx.widgetFamily",
    value: ctx.widgetFamily === undefined ? "未提供（手动运行）" : ctx.widgetFamily,
    ok: null,
  });
  probes.push({
    label: "ctx.cron",
    value: ctx.cron === undefined ? "未提供" : ctx.cron,
    ok: null,
  });
  probes.push({
    label: "ctx.app.version",
    value: ctx.app?.version ?? "未知",
    ok: null,
  });
  probes.push({
    label: "ctx.app.language",
    value: ctx.app?.language ?? "未知",
    ok: null,
  });

  // --- storage round trip (proves read/write/persistence in this context) ---
  probes.push(probeStorage(ctx));

  return probes;
}

let storageProbeCounter = 0;

/**
 * Round-trip a nonce through storage.
 *
 * Records whether a value written in this execution can be read back, which is
 * the minimum evidence for any future cross-execution claim. It does **not**
 * prove persistence across executions — that requires a second run, which is
 * why the control capability stays closed until a device test records it.
 */
function probeStorage(ctx: EgernScriptContext): Probe {
  const key = "cdt:egern:v1:diagnostics:probe";
  try {
    storageProbeCounter++;
    const token = `probe-${Date.now()}-${storageProbeCounter}`;
    ctx.storage.set(key, token);
    const readBack = ctx.storage.get(key);
    const json = ctx.storage.getJSON("cdt:egern:v1:diagnostics:missing");
    const ok = readBack === token;
    return {
      label: "storage 写入/读回",
      value: ok
        ? json === null
          ? "同步读写正常，缺失键返回 null"
          : "读回正常，但缺失键未返回 null（与文档不符）"
        : "写入后无法读回",
      ok,
    };
  } catch {
    return { label: "storage 写入/读回", value: "抛出异常", ok: false };
  }
}

/** Format configuration issues without leaking any value that could be secret. */
export function summarizeIssues(issues: readonly ConfigIssue[]): string[] {
  return issues.slice(0, 6).map((issue) => {
    const severity = issue.severity === "error" ? "错误" : "警告";
    return `${severity} · ${issue.field}`;
  });
}

export default async function main(ctx: EgernScriptContext): Promise<unknown> {
  const prepared = prepareRuntime(ctx, WIDGET_BUDGET_MS);
  const probes = runProbes(ctx);

  if (!prepared.ok) {
    // Lead with the problems: a truncated report that hides the cause is worse
    // than no report at all.
    return renderReport(
      "CDT Monitor 诊断",
      "配置存在错误，以下为该环境的探测结果",
      [...summarizeIssues(prepared.issues), "— 能力探测 —", ...probes.map(describeProbe)],
      false,
    );
  }

  const { config, issues } = prepared.runtime;

  // Configuration summary first, capability probes after: the summary is what
  // the user acts on, and the report is bounded.
  const lines: string[] = [
    `数据来源：${config.mode === "direct" ? "直连阿里云" : "自建服务器"}`,
    `命名空间：${config.namespace}`,
    `业务时区：${config.timezone}`,
    `账户 ${config.accounts.length} · 流量范围 ${config.trafficScopes.length} · 实例 ${config.instances.length}`,
    `AccessKey：${
      config.credentials.some((credential) => credential.accessKeySecret !== "")
        ? "已配置"
        : "未配置"
    }`,
    `账单 ${config.billingEnabled ? "开" : "关"} · 本地通知 ${
      config.localNotify ? "开" : "关"
    } · 控制 ${config.control.enabled ? "开" : "关（默认）"}`,
    `写入能力：${describeCapability(config)}`,
  ];

  const problems = summarizeIssues(issues);
  if (problems.length > 0) {
    lines.push("— 配置问题 —", ...problems);
  }
  lines.push("— 能力探测 —", ...probes.map(describeProbe));

  const healthy = issues.every((issue) => issue.severity !== "error");
  return renderReport(
    "CDT Monitor 诊断",
    healthy ? "环境与配置检查完成" : "存在配置错误",
    lines,
    healthy,
  );
}

/** Render one probe as a compact line. */
function describeProbe(probe: Probe): string {
  return `${probe.label}：${probe.value}`;
}

/** Render diagnostics as a valid widget, describing rather than charting. */
function renderReport(
  title: string,
  subtitle: string,
  lines: string[],
  healthy: boolean,
): unknown {
  const children: unknown[] = [
    { type: "text", text: title, font: { size: "headline", weight: "semibold" }, maxLines: 1 },
    {
      type: "text",
      text: subtitle,
      font: { size: "caption1", weight: "medium" },
      textColor: healthy ? { light: "#1B7A3A", dark: "#4CD964" } : { light: "#C0271D", dark: "#FF6B60" },
      maxLines: 2,
    },
  ];
  // Bounded so the widget cannot overflow. Callers order lines by importance,
  // so truncation only ever drops the least actionable detail.
  for (const line of lines.slice(0, 18)) {
    children.push({ type: "text", text: line, font: { size: "caption2" }, maxLines: 1, minScale: 0.8 });
  }
  return { type: "widget", children, padding: 14, gap: 3 };
}
