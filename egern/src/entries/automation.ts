/**
 * `cdt-automation` — schedule entry point for policy evaluation.
 *
 * Shipped **disabled** in every module template, and its three independent
 * switches (threshold stop, schedule control, keep-alive) all default to false
 * in code as well. Enabling one does not enable the others.
 *
 * It is a separate entry from `cdt-refresh` on purpose: the contract requires
 * that rendering and ordinary refresh can never reach a cloud write, and that
 * automated stop/start uses a different trigger cadence (a 5-minute attempt
 * cycle) than the 15-minute collection cycle, so the 10-minute schedule
 * compensation window is not silently missed.
 *
 * Even when enabled, cloud actions remain gated on the same proven-capability
 * requirement as manual control. Until a device test establishes cross-execution
 * atomic claiming and same-target serialisation, this entry evaluates policy,
 * sends any notifications, and records why it withheld each action.
 */

import type { EgernScriptContext } from "../host/types.ts";
import { evaluateAutomation } from "../domain/policy.ts";
import { createTimeZoneProvider } from "../domain/timezone.ts";
import { collectSnapshot } from "../services/collect.ts";
import {
  capabilityFromConfig,
  controlFingerprint,
  executeControlIntent,
} from "../services/control.ts";
import { dispatchNotification } from "../services/notifications.ts";
import type { Cache } from "../services/cache.ts";
import { writeRunLog } from "../services/runlog.ts";
import type { RunLogWrite } from "../services/runlog.ts";
import type { NotificationEvent } from "../services/notifications.ts";
import { formatPercent } from "../domain/format.ts";
import {
  REFRESH_BUDGET_MS,
  createProvider,
  createRpcDependencies,
  prepareRuntime,
} from "./runtime.ts";
import { DirectControlProvider } from "../providers/aliyun/control.ts";

export default async function main(ctx: EgernScriptContext): Promise<void> {
  const prepared = prepareRuntime(ctx, REFRESH_BUDGET_MS);
  if (!prepared.ok) return;

  const runtime = prepared.runtime;
  const { config, cache, clock, http, notifier } = runtime;
  const now = clock.now();

  // Master switch. Absent or disabled configuration means this entry does
  // nothing at all — no evaluation, no notification, no write.
  if (!config.control.enabled) return;

  const provider = createProvider(runtime);
  const { snapshot } = await collectSnapshot({
    config,
    cache,
    provider,
    clock,
    deadlineMs: runtime.deadlineMs,
    // Core CDT/ECS collection wins the budget; billing is a refresh concern.
    skipBilling: true,
  });

  const timeZone = createTimeZoneProvider(config.timezone);
  const result = evaluateAutomation(snapshot, config, now, timeZone);

  const notificationDeps = { http, notifier, cache, requestTimeoutMs: 6000 };

  // Notifications are independent of the write capability gate.
  for (const decision of result.decisions) {
    if (decision.kind !== "notify_threshold") continue;
    const scope = snapshot.trafficScopes.find((item) => item.id === decision.scopeId);
    if (scope === undefined) continue;
    const event: NotificationEvent = {
      id: decision.idempotencyKey,
      type: "threshold",
      title: `CDT 流量告警（${formatPercent(scope.usagePercent)}）`,
      summary: decision.reason,
      fields: {
        "使用率": formatPercent(scope.usagePercent),
        "阈值": `${scope.thresholdPercent}%`,
      },
      at: now.toISOString(),
    };
    await dispatchNotification(notificationDeps, event, config.notifications, now);
  }

  const capability = capabilityFromConfig(config);
  const actionsProven = capability.crossExecutionIntentClaim && capability.hostSerializesSameTarget;

  // Every attempted action is recorded and, when a channel is enabled, pushed as
  // a notification. Without this the schedule entry would be a black box: the
  // user could not tell a silent failure from "iOS has not woken it yet".
  const writes: RunLogWrite[] = [];

  for (const decision of result.decisions) {
    if (decision.kind !== "start_instance" && decision.kind !== "stop_instance") continue;
    if (decision.instanceId === null) continue;

    // Idempotency: the same decision key must not be executed twice within the
    // cooldown. This is a best-effort guard, not a claim of global mutual
    // exclusion — which is precisely why the capability gate exists.
    if (!claimDecision(cache, decision.idempotencyKey, config.control.actionCooldownSeconds, now)) {
      continue;
    }

    if (!actionsProven) {
      // Withhold and record. No cloud write is issued.
      //
      // A notification is still sent: without it, a dry run is invisible on the
      // phone and the user cannot tell a withheld action from a script that
      // never ran. Repeats are bounded by the action cooldown.
      const withheld = `未执行：${decision.reason}（本地控制能力未验证，未声明真机验证）`;
      cache.write(`blocked:${decision.idempotencyKey}`, "alert", withheld, now);
      writes.push({
        instanceId: decision.instanceId,
        action: decision.kind === "start_instance" ? "start" : "stop",
        code: "Withheld",
        message: withheld,
      });
      const withheldInstance = snapshot.instances.find((item) => item.id === decision.instanceId);
      await dispatchNotification(
        notificationDeps,
        {
          id: `withheld:${decision.idempotencyKey}`,
          type: "action",
          title: `CDT 保活未执行（${withheldInstance?.name ?? decision.instanceId}）`,
          summary: withheld,
          fields: {
            "实例": withheldInstance?.name ?? decision.instanceId,
            "拟执行": decision.kind === "start_instance" ? "开机" : "关机",
            "原因": "未声明真机验证",
          },
          at: now.toISOString(),
        },
        config.notifications,
        now,
      );
      continue;
    }

    const instance = snapshot.instances.find((item) => item.id === decision.instanceId);
    if (instance === undefined) continue;

    // The write provider is only constructed *after* the capability gate passes,
    // so the read path never instantiates a cloud writer at all. Passing null
    // here instead would make this branch permanently dead and hide the gate.
    const controlProvider = new DirectControlProvider(createRpcDependencies(runtime));

    const outcome = await executeControlIntent({
      intent: {
        schemaVersion: 1,
        nonce: decision.idempotencyKey,
        accountId: instance.accountId,
        regionId: instance.regionId,
        instanceId: instance.instanceId,
        action: decision.kind === "start_instance" ? "start" : "stop",
        shutdownMode: decision.shutdownMode ?? "KeepCharging",
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      },
      snapshot,
      config,
      cache,
      provider: controlProvider,
      capability,
      scope: {
        deadlineMs: runtime.deadlineMs,
        remainingMs: () => Math.max(0, runtime.deadlineMs - clock.now().getTime()),
        now: () => clock.now(),
      },
      now,
    });

    writes.push({
      instanceId: decision.instanceId,
      action: decision.kind === "start_instance" ? "start" : "stop",
      code: outcome.code,
      message: outcome.message,
    });

    // Notify so the result reaches the phone without opening the app. Repeated
    // identical failures are throttled (see shouldNotifyAction); the run log above
    // still records every attempt.
    if (!shouldNotifyAction(cache, decision.instanceId, writes[writes.length - 1]?.action ?? "start", outcome.code, now)) {
      continue;
    }
    await dispatchNotification(
      notificationDeps,
      {
        id: `action:${decision.idempotencyKey}`,
        type: "action",
        title:
          decision.kind === "start_instance"
            ? `CDT 保活：已发送开机指令（${instance.name}）`
            : `CDT 已发送关机指令（${instance.name}）`,
        summary: outcome.message,
        fields: {
          "实例": instance.name,
          "动作": decision.kind === "start_instance" ? "开机" : "关机",
          "结果": outcome.code,
        },
        at: now.toISOString(),
      },
      config.notifications,
      now,
    );
  }

  // Persist why anything was withheld, so the reason is visible rather than
  // silent. Bounded to the first few entries.
  for (const block of result.blocked.slice(0, 5)) {
    cache.write(`blocked:${block.entityId}:${block.code}`, "alert", block.reason, now);
  }

  // Always record the run, even when nothing happened: "ran at 14:05, nothing to
  // do" is exactly what distinguishes a working install from a silent one.
  writeRunLog(
    cache,
    {
      at: now.toISOString(),
      mode: actionsProven ? "live" : "dry-run",
      controlFingerprint: controlFingerprint(config),
      scopeCount: snapshot.trafficScopes.length,
      instanceCount: snapshot.instances.length,
      decisions: result.decisions.map((decision) => ({
        kind: decision.kind,
        instanceId: decision.instanceId,
        scopeId: decision.scopeId,
        reason: decision.reason,
      })),
      blocked: result.blocked.map((block) => ({
        entityId: block.entityId,
        code: block.code,
        reason: block.reason,
      })),
      writes,
    },
    now,
  );
}

/**
 * How long an unchanged action *failure* stays quiet before being repeated.
 *
 * Successes always notify: rescuing a stopped instance is the whole point, and it
 * is rare. Failures repeat on every run otherwise — roughly every 5 minutes —
 * which is exactly how a user learns to ignore the notification that matters.
 */
const FAILURE_RENOTIFY_SECONDS = 3600;

/** Persisted marker of the last outcome we notified about. */
interface ActionNotice {
  code: string;
  at: string;
}

function validateActionNotice(value: unknown): ActionNotice | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record["code"] !== "string" || typeof record["at"] !== "string") return null;
  return { code: record["code"], at: record["at"] };
}

/** Whether this outcome deserves a notification, and records that we sent one. */
export function shouldNotifyAction(
  cache: Cache,
  instanceId: string,
  action: string,
  code: string,
  now: Date,
): boolean {
  const key = `action-notice:${instanceId}:${action}`;
  const previous = cache.read<ActionNotice>(key, "alert", validateActionNotice);
  // The marker records when we last *notified*, not when we last ran. Refreshing
  // it on every run would keep pushing the deadline out and an unchanged failure
  // would stay silent forever instead of every FAILURE_RENOTIFY_SECONDS.
  const notify = (): boolean => {
    cache.write(key, "alert", { code, at: now.toISOString() }, now);
    return true;
  };
  // A successful rescue is always worth reporting.
  if (code === "Accepted") return notify();
  if (previous === null) return notify();
  if (previous.code !== code) return notify();
  const parsed = Date.parse(previous.at);
  if (!Number.isFinite(parsed)) return notify();
  return (now.getTime() - parsed) / 1000 >= FAILURE_RENOTIFY_SECONDS ? notify() : false;
}

/**
 * Best-effort decision claim within the cooldown window.
 *
 * Returns true when the action may proceed. This deliberately does **not**
 * claim atomicity across executions; it narrows duplicate work within the
 * limits Egern documents.
 */
function claimDecision(
  cache: { read: <T>(entityId: string, kind: "alert", validate: (v: unknown) => T | null) => T | null; write: (entityId: string, kind: "alert", data: unknown, now: Date) => number | null },
  key: string,
  cooldownSeconds: number,
  now: Date,
): boolean {
  const previous = cache.read<string>(key, "alert", (value) =>
    typeof value === "string" ? value : null,
  );
  if (previous !== null) {
    const parsed = Date.parse(previous);
    if (Number.isFinite(parsed) && (now.getTime() - parsed) / 1000 < cooldownSeconds) {
      return false;
    }
  }
  cache.write(key, "alert", now.toISOString(), now);
  return true;
}
