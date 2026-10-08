/**
 * `cdt-control` — standalone generic entry point for one-shot manual actions.
 *
 * Not associated with any widget, schedule or network script, and not
 * referenced by any read bundle.
 *
 * Design decisions worth stating plainly:
 *  - A long-lived `ACTION=stop` variable is **not** an authorization. Each run
 *    requires a freshly authored one-shot `ControlIntent` with its own nonce and
 *    short expiry.
 *  - `ctx.widgetFamily === undefined` (i.e. "this is not a widget") is an
 *    *additional* check, never the authorization itself.
 *  - There is no `ctx.confirm` call and no `scripts/run` protocol: the contract
 *    forbids inventing those. Confirmation is the user authoring the intent.
 *  - Because Egern documents no cross-execution atomic claim, the executor's
 *    capability gate is closed by default, and this entry then renders the
 *    console-navigation fallback instead of writing to the cloud.
 */

import type { EgernScriptContext } from "../host/types.ts";
import type { ControlIntent, ShutdownMode } from "../domain/models.ts";
import { loadSnapshotFromCache } from "../services/cache.ts";
import { collectSnapshot } from "../services/collect.ts";
import {
  buildConsoleGuidance,
  capabilityFromConfig,
  executeControlIntent,
} from "../services/control.ts";
import { createRpcDependencies, createProvider, prepareRuntime, WIDGET_BUDGET_MS } from "./runtime.ts";
import { DirectControlProvider } from "../providers/aliyun/control.ts";

/** Parse a `ControlIntent` from JSON, strictly. */
export function parseIntents(
  raw: unknown,
): { ok: true; intent: ControlIntent } | { ok: false; reason: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "CDT_CONTROL_INTENT_JSON 必须是 JSON 对象" };
  }
  const record = raw as Record<string, unknown>;
  if (record["schemaVersion"] !== 1) {
    return { ok: false, reason: "不支持的 control intent schemaVersion" };
  }
  const action = record["action"];
  if (action !== "start" && action !== "stop") {
    return { ok: false, reason: "action 必须是 start 或 stop" };
  }
  const required = ["nonce", "accountId", "regionId", "instanceId", "issuedAt", "expiresAt"];
  for (const key of required) {
    if (typeof record[key] !== "string" || (record[key] as string).trim() === "") {
      return { ok: false, reason: `控制意图缺少必填字段 ${key}` };
    }
  }
  const shutdownMode = record["shutdownMode"];
  if (
    shutdownMode !== undefined &&
    shutdownMode !== "KeepCharging" &&
    shutdownMode !== "StopCharging"
  ) {
    return { ok: false, reason: "shutdownMode 必须是 KeepCharging 或 StopCharging" };
  }
  return {
    ok: true,
    intent: {
      schemaVersion: 1,
      nonce: record["nonce"] as string,
      accountId: record["accountId"] as string,
      regionId: record["regionId"] as string,
      instanceId: record["instanceId"] as string,
      action,
      shutdownMode: (shutdownMode === "StopCharging" ? "StopCharging" : "KeepCharging") as ShutdownMode,
      issuedAt: record["issuedAt"] as string,
      expiresAt: record["expiresAt"] as string,
      ...(typeof record["note"] === "string" ? { note: record["note"] as string } : {}),
    },
  };
}

export default async function main(ctx: EgernScriptContext): Promise<unknown> {
  const prepared = prepareRuntime(ctx, WIDGET_BUDGET_MS);
  if (!prepared.ok) {
    return renderResult("配置有误，未执行任何控制", [
      "请先修正模块配置中的错误",
      ...prepared.issues.slice(0, 3).map((issue) => `${issue.field}: ${issue.message}`),
    ], false);
  }

  const runtime = prepared.runtime;
  const { config, cache, clock } = runtime;
  const now = clock.now();

  // Additional check: a control run must not be a widget render.
  if (ctx.widgetFamily !== undefined) {
    return renderResult("拒绝执行", ["控制脚本不能作为小组件运行"], false);
  }

  const raw = runtime.env["CDT_CONTROL_INTENT_JSON"];
  if (raw === undefined || raw.trim() === "") {
    return renderResult("没有待执行的控制意图", [
      "本脚本不会使用长期的 ACTION 变量作为授权",
      "请在模块 Env 中临时填写一次性 CDT_CONTROL_INTENT_JSON 后再运行",
      ...buildConsoleGuidance(config).steps.slice(0, 2),
    ], false);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return renderResult("控制意图 JSON 无法解析", ["请检查 CDT_CONTROL_INTENT_JSON 的格式"], false);
  }

  const intentResult = parseIntents(parsedJson);
  if (!intentResult.ok) {
    return renderResult("控制意图无效", [intentResult.reason], false);
  }

  // A snapshot is required to authorize against real, current state.
  let snapshot = loadSnapshotFromCache(config, cache, now);
  if (snapshot === null) {
    const provider = createProvider(runtime);
    const collected = await collectSnapshot({
      config,
      cache,
      provider,
      clock,
      deadlineMs: runtime.deadlineMs,
      skipBilling: true,
    });
    snapshot = collected.snapshot;
  }

  // The capability gate is closed unless the user has explicitly attested both
  // preconditions in CDT_CONTROL_JSON; see services/control.ts.
  const capability = capabilityFromConfig(config);
  const provider = capability.crossExecutionIntentClaim && capability.hostSerializesSameTarget
    ? new DirectControlProvider(createRpcDependencies(runtime))
    : null;

  const outcome = await executeControlIntent({
    intent: intentResult.intent,
    snapshot,
    config,
    cache,
    provider,
    capability,
    scope: {
      deadlineMs: runtime.deadlineMs,
      remainingMs: () => Math.max(0, runtime.deadlineMs - clock.now().getTime()),
      now: () => clock.now(),
    },
    now,
  });

  if (!outcome.executed) {
    const guidance = buildConsoleGuidance(config);
    // Record the refusal so repeated runs are visible in the cache, and so a
    // later capability review has evidence to look at.
    cache.write(`control-refusal:${intentResult.intent.nonce}`, "alert", outcome.code, now);
    return renderResult(`未执行控制（${outcome.code}）`, [
      outcome.message,
      `控制台入口：${guidance.title}`,
      ...guidance.steps.slice(0, 2),
    ], false);
  }

  return renderResult(`已受理控制（${outcome.code}）`, [
    outcome.message,
    outcome.requiresStateCheck ? "请稍后查看实例状态以确认最终结果" : "动作已完成",
  ], true);
}

/** Render a control result as a valid widget document. */
function renderResult(title: string, lines: string[], success: boolean): unknown {
  const children: unknown[] = [
    {
      type: "text",
      text: title,
      font: { size: "headline", weight: "semibold" },
      textColor: success
        ? { light: "#1B7A3A", dark: "#4CD964" }
        : { light: "#C0271D", dark: "#FF6B60" },
      maxLines: 2,
    },
  ];
  for (const line of lines.slice(0, 6)) {
    children.push({ type: "text", text: line, font: { size: "caption2" }, maxLines: 2 });
  }
  return { type: "widget", children, padding: 16, gap: 5 };
}
