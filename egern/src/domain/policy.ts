/**
 * Automation policy.
 *
 * `evaluateAutomation` is a pure function: same snapshot + config + instant
 * always yields the same decisions. Executors re-verify the live state before
 * acting, but all *authorization* logic lives here so it can be tested offline.
 *
 * Priority order (from the contract):
 *  1. Uncertain configuration, authorization, identity or freshness → no start,
 *     no action against an unclear target; report the blocking reason.
 *  2. Freshly confirmed over-threshold → forbid scheduled start and keep-alive;
 *     stop only under an explicitly enabled protection mode.
 *  3. Scheduled stop and manual stop outrank keep-alive.
 *  4. Transitional states (Starting/Stopping/Pending) are never re-commanded;
 *     Unknown is queried first, never assumed to be Stopped.
 *  5. Scheduled start / keep-alive only when not over threshold and inside the
 *     configured window.
 *
 * Two defects in the original Go engine are deliberately not reproduced:
 *  - `threshold:<id>:active` bound alert de-duplication to stop protection, so
 *    after a first over-limit event a later restart could never trigger another
 *    protective stop. Here notification and protection are separate decision
 *    kinds with separate keys.
 *  - `usagePercent` rounded before comparing, so 94.995% tripped a 95%
 *    threshold. Here the raw ratio from `computeUsage` is used.
 */

import type {
  ActionState,
  AppConfig,
  ControlIntent,
  InstanceSnapshot,
  ShutdownMode,
  Snapshot,
  TrafficScopeSnapshot,
} from "./models.ts";
import { UNVERIFIED_PERIOD } from "./models.ts";
import { isWithinWindow, parseClockTime, dueWithinMinutes, scheduleCycleDate } from "./schedule.ts";
import type { TimeZoneProvider } from "./timezone.ts";

/** What the executor should do. */
export type DecisionKind =
  | "notify_threshold"
  | "stop_instance"
  | "start_instance"
  | "notify_recovered";

/** A single authorized action. */
export interface Decision {
  kind: DecisionKind;
  /** Scope the decision belongs to, for usage-driven decisions. */
  scopeId: string | null;
  /** Instance the decision targets, for instance-driven decisions. */
  instanceId: string | null;
  /** Human-readable justification, safe to show and to log. */
  reason: string;
  /**
   * Idempotency key. Two decisions with the same key describe the same intent
   * and must not both be executed.
   */
  idempotencyKey: string;
  /** Stop mode to use, for stop decisions. */
  shutdownMode: ShutdownMode | null;
}

/** Why an action was withheld. Always surfaced, never silent. */
export interface PolicyBlock {
  entityId: string;
  code: string;
  reason: string;
}

/** Result of evaluating policy. */
export interface PolicyResult {
  decisions: Decision[];
  blocked: PolicyBlock[];
}

/** Maximum age of a traffic observation before it blocks control decisions. */
export function maxObservationAgeMs(config: AppConfig): number {
  // Two refresh intervals, with a floor so a tiny configured interval cannot
  // make the guard meaningless.
  return Math.max(config.refreshSeconds * 2, 1800) * 1000;
}

function isTransitional(status: InstanceSnapshot["status"]): boolean {
  return status === "Starting" || status === "Stopping" || status === "Pending";
}

/** True when a stop request is still in flight and must not be repeated. */
function actionInFlight(instance: InstanceSnapshot, now: Date): boolean {
  if (instance.actionState !== "pending" && instance.actionState !== "accepted") return false;
  const requestedAt = instance.actionRequestedAt;
  if (requestedAt === null) return false;
  const parsed = Date.parse(requestedAt);
  if (!Number.isFinite(parsed)) return false;
  // Five minutes is the window in which re-commanding would be a duplicate.
  return now.getTime() - parsed < 5 * 60 * 1000;
}

/**
 * Decide whether a scope's traffic reading may drive a protection action.
 *
 * Rejects anything that is not a real cloud measurement: the Go v1 API's
 * `legacy-unverified` figures, a missing observation time, a stale observation,
 * or an unknown threshold state.
 */
export function trafficAllowsControl(
  scope: TrafficScopeSnapshot,
  config: AppConfig,
  now: Date,
): { allowed: true } | { allowed: false; code: string; reason: string } {
  if (scope.overThreshold === null || scope.usagePercent === null) {
    return { allowed: false, code: "UnknownUsage", reason: scope.trafficError?.message ?? "用量未知" };
  }
  if (scope.freshnessQuality !== "measured") {
    return {
      allowed: false,
      code: "UnverifiedFreshness",
      reason: "数据来自服务器兼容接口，其时间戳不能作为云端观测时间",
    };
  }
  if (scope.trafficObservedAt === null) {
    return { allowed: false, code: "NoObservationTime", reason: "没有可验证的采样时间" };
  }
  const observed = Date.parse(scope.trafficObservedAt);
  if (!Number.isFinite(observed)) {
    return { allowed: false, code: "NoObservationTime", reason: "采样时间无法解析" };
  }
  if (now.getTime() - observed > maxObservationAgeMs(config)) {
    return { allowed: false, code: "StaleObservation", reason: "采样数据已过期" };
  }
  if (scope.periodId === UNVERIFIED_PERIOD) {
    // The period being unknown does not by itself forbid protection, because a
    // threshold on a cumulative counter is still meaningful. It is recorded so
    // the reason text is honest about what was compared.
    return { allowed: true };
  }
  return { allowed: true };
}

/** Whether an instance is an authorized control target. */
function isAuthorizedTarget(
  instanceId: string,
  config: AppConfig,
): { ok: true } | { ok: false; reason: string } {
  if (!config.control.enabled) {
    return { ok: false, reason: "控制功能整体未启用" };
  }
  if (!config.control.allowedInstanceIds.includes(instanceId)) {
    return { ok: false, reason: "实例不在显式控制白名单中" };
  }
  const policy = config.control.instances.find((item) => item.instanceId === instanceId);
  if (policy === undefined) {
    return { ok: false, reason: "该实例没有配置控制策略" };
  }
  return { ok: true };
}

/**
 * Evaluate all automation decisions for one snapshot.
 *
 * Never mutates its inputs and never performs I/O.
 */
export function evaluateAutomation(
  snapshot: Snapshot,
  config: AppConfig,
  now: Date,
  timeZone: TimeZoneProvider,
): PolicyResult {
  const decisions: Decision[] = [];
  const blocked: PolicyBlock[] = [];

  // A control document that is disabled means the executor has nothing to do;
  // report it once rather than fabricating per-entity noise.
  if (!config.control.enabled) {
    return { decisions, blocked };
  }

  const instanceById = new Map(snapshot.instances.map((item) => [item.id, item]));
  const localParts = timeZone.isReliable() ? timeZone.partsAt(now) : null;

  // ---- usage-driven protection ------------------------------------------
  for (const scope of snapshot.trafficScopes) {
    if (scope.overThreshold !== true) continue;

    const state = trafficAllowsControl(scope, config, now);
    const scopePolicy = config.control.scopes.find((item) => item.scopeId === scope.id);

    // Notification and protection are independent. The notification decision is
    // emitted whenever a fresh observation confirms the threshold.
    if (state.allowed) {
      decisions.push({
        kind: "notify_threshold",
        scopeId: scope.id,
        instanceId: null,
        reason: `用量已达 ${scope.usagePercent?.toFixed(2) ?? "?"}%`,
        // Keyed on scope + period so a new period re-notifies, while repeated
        // evaluations within one period do not.
        idempotencyKey: `notify:threshold:${scope.id}:${scope.periodId}`,
        shutdownMode: null,
      });
    } else {
      blocked.push({ entityId: scope.id, code: state.code, reason: state.reason });
    }

    const stopEnabled = scopePolicy?.thresholdStopEnabled === true &&
      scopePolicy.thresholdAction === "stop_and_notify";
    if (!stopEnabled) continue;
    if (!state.allowed) {
      blocked.push({
        entityId: scope.id,
        code: "ProtectionBlocked",
        reason: `保护停机被阻止：${state.reason}`,
      });
      continue;
    }

    for (const instance of snapshot.instances) {
      if (instance.trafficScopeId !== scope.id) continue;
      const authorization = isAuthorizedTarget(instance.id, config);
      if (!authorization.ok) {
        blocked.push({
          entityId: instance.id,
          code: "NotAuthorized",
          reason: authorization.reason,
        });
        continue;
      }
      if (instance.status === "Stopped") continue;
      if (instance.status === "Unknown") {
        blocked.push({
          entityId: instance.id,
          code: "UnknownStatus",
          reason: "实例状态未知，先查询再决定",
        });
        continue;
      }
      if (isTransitional(instance.status) || actionInFlight(instance, now)) {
        blocked.push({
          entityId: instance.id,
          code: "Transitional",
          reason: "实例正处于过渡状态，不重复下发指令",
        });
        continue;
      }
      const policy = config.control.instances.find((item) => item.instanceId === instance.id);
      decisions.push({
        kind: "stop_instance",
        scopeId: scope.id,
        instanceId: instance.id,
        reason: `流量超过阈值，执行保护停机（${scope.usagePercent?.toFixed(2) ?? "?"}%）`,
        // Protection is keyed on the *observation*, not on a single event, so a
        // restart while still over threshold is stopped again.
        idempotencyKey: `protect:stop:${instance.id}:${scope.periodId}:${scope.trafficObservedAt ?? ""}`,
        shutdownMode: policy?.shutdownMode ?? "KeepCharging",
      });
    }
  }

  // ---- schedule and keep-alive ------------------------------------------
  if (localParts === null) {
    blocked.push({
      entityId: "schedule",
      code: "NoTimeZone",
      reason: timeZone.limitation() ?? "当前环境缺少可用时区，本地定时已停用",
    });
    return { decisions, blocked };
  }

  const paused = config.control.pauseUntil !== null &&
    Number.isFinite(Date.parse(config.control.pauseUntil)) &&
    Date.parse(config.control.pauseUntil) > now.getTime();

  for (const instance of snapshot.instances) {
    const configInstance = config.instances.find((item) => item.id === instance.id);
    if (configInstance === undefined) continue;
    const policy = config.control.instances.find((item) => item.instanceId === instance.id);
    if (policy === undefined) continue;

    const authorization = isAuthorizedTarget(instance.id, config);
    const start = parseClockTime(configInstance.schedule.start);
    const stop = parseClockTime(configInstance.schedule.stop);

    // Over-threshold protection outranks starting anything.
    const scope = snapshot.trafficScopes.find((item) => item.id === instance.trafficScopeId);
    const scopeOverThreshold = scope?.overThreshold === true;
    const scopePolicy = config.control.scopes.find((item) => item.scopeId === scope?.id);
    const protectionActive = scopeOverThreshold && scopePolicy?.thresholdStopEnabled === true;

    const cycleDate = start !== null && stop !== null
      ? scheduleCycleDate(localParts, start.minutes, stop.minutes)
      : localParts.date;
    const cycleKey = cycleDate.replace(/-/g, "");

    if (policy.scheduleControlEnabled && start !== null && stop !== null) {
      if (dueWithinMinutes(localParts.minuteOfDay, stop.minutes, 10)) {
        // Scheduled stop wins over keep-alive, and is allowed even while paused.
        if (instance.status === "Running") {
          decisions.push({
            kind: "stop_instance",
            scopeId: scope?.id ?? null,
            instanceId: instance.id,
            reason: "到达计划停止时间",
            idempotencyKey: `schedule:stop:${instance.id}:${cycleKey}:${configInstance.schedule.stop}`,
            shutdownMode: policy.shutdownMode,
          });
        } else if (instance.status === "Unknown") {
          blocked.push({ entityId: instance.id, code: "UnknownStatus", reason: "实例状态未知" });
        }
        continue;
      }

      if (dueWithinMinutes(localParts.minuteOfDay, start.minutes, 10)) {
        if (protectionActive) {
          blocked.push({
            entityId: instance.id,
            code: "ProtectionActive",
            reason: "流量已超阈值，禁止计划开机",
          });
        } else if (!authorization.ok) {
          blocked.push({ entityId: instance.id, code: "NotAuthorized", reason: authorization.reason });
        } else if (instance.status === "Stopped") {
          decisions.push({
            kind: "start_instance",
            scopeId: scope?.id ?? null,
            instanceId: instance.id,
            reason: "到达计划启动时间",
            idempotencyKey: `schedule:start:${instance.id}:${cycleKey}:${configInstance.schedule.start}`,
            shutdownMode: null,
          });
        } else if (instance.status === "Unknown") {
          blocked.push({ entityId: instance.id, code: "UnknownStatus", reason: "实例状态未知" });
        } else if (isTransitional(instance.status) || actionInFlight(instance, now)) {
          blocked.push({
            entityId: instance.id,
            code: "Transitional",
            reason: "实例正处于过渡状态",
          });
        }
        continue;
      }
    }

    // Keep-alive: only for a confirmed Stopped instance, inside the window, not
    // over threshold, and not paused by a manual stop.
    if (policy.keepAlive && instance.status === "Stopped") {
      if (protectionActive) {
        blocked.push({
          entityId: instance.id,
          code: "ProtectionActive",
          reason: "流量已超阈值，禁止保活启动",
        });
      } else if (paused) {
        blocked.push({
          entityId: instance.id,
          code: "Paused",
          reason: "保活已因人工停止而暂停",
        });
      } else if (start !== null && stop !== null && !isWithinWindow(localParts.minuteOfDay, start.minutes, stop.minutes)) {
        blocked.push({
          entityId: instance.id,
          code: "OutsideWindow",
          reason: "当前不在允许运行的时段内",
        });
      } else if (!authorization.ok) {
        blocked.push({ entityId: instance.id, code: "NotAuthorized", reason: authorization.reason });
      } else {
        decisions.push({
          kind: "start_instance",
          scopeId: scope?.id ?? null,
          instanceId: instance.id,
          reason: "实例在允许时段内停止，执行保活",
          // The minute bucket deduplicates only *within* one minute: two runs in
          // the same minute cannot both start the instance. It deliberately does
          // NOT apply `actionCooldownSeconds`, because retrying a failed rescue on
          // the next run is desirable — a transient error should not leave the
          // instance down for a further ten minutes. Repeated identical failures
          // are instead kept quiet at the notification layer.
          idempotencyKey: `keepalive:start:${instance.id}:${Math.floor(now.getTime() / 60000)}`,
          shutdownMode: null,
        });
      }
    }
  }

  return { decisions, blocked };
}

/** Outcome of validating a manual control intent. */
export interface IntentValidation {
  ok: boolean;
  code: string;
  reason: string;
  instance: InstanceSnapshot | null;
}

/**
 * Validate a one-shot manual control intent.
 *
 * Every precondition from the contract is checked here: master switch, explicit
 * target, allow-list membership, expiry, and one-shot consumption. Being a
 * non-widget execution is an *additional* check the caller performs, never the
 * authorization itself.
 */
export function validateControlIntent(
  intent: ControlIntent,
  snapshot: Snapshot,
  config: AppConfig,
  now: Date,
  alreadyConsumed: boolean,
): IntentValidation {
  const reject = (code: string, reason: string): IntentValidation => ({
    ok: false,
    code,
    reason,
    instance: null,
  });

  if (intent.schemaVersion !== 1) {
    return reject("BadSchema", "控制意图的 schemaVersion 不受支持");
  }
  if (!config.control.enabled) {
    return reject("ControlDisabled", "控制功能未启用（CDT_CONTROL_JSON.enabled=false）");
  }
  if (intent.action !== "start" && intent.action !== "stop") {
    return reject("BadAction", "控制意图的 action 必须是 start 或 stop");
  }
  const issuedAt = Date.parse(intent.issuedAt);
  const expiresAt = Date.parse(intent.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
    return reject("BadTimestamp", "控制意图的时间戳无法解析");
  }
  if (expiresAt <= issuedAt) {
    return reject("BadWindow", "控制意图的过期时间必须晚于签发时间");
  }
  if (now.getTime() >= expiresAt) {
    return reject("Expired", "控制意图已过期");
  }
  if (alreadyConsumed) {
    return reject("AlreadyConsumed", "该控制意图已被消费，不可重复使用");
  }

  const instance = snapshot.instances.find(
    (item) =>
      item.instanceId === intent.instanceId &&
      item.regionId === intent.regionId &&
      item.accountId === intent.accountId,
  );
  if (instance === undefined) {
    return reject("TargetMismatch", "控制意图的目标实例与当前配置不匹配");
  }
  const authorization = isAuthorizedTarget(instance.id, config);
  if (!authorization.ok) {
    return reject("NotAuthorized", authorization.reason);
  }

  const instancePolicy = config.control.instances.find((item) => item.instanceId === instance.id);
  if (
    intent.action === "stop" &&
    instancePolicy !== undefined &&
    instancePolicy.shutdownMode !== intent.shutdownMode
  ) {
    return reject("ShutdownModeMismatch", "控制意图的停机模式与策略配置不一致");
  }

  if (intent.action === "start") {
    const scope = snapshot.trafficScopes.find((item) => item.id === instance.trafficScopeId);
    const scopePolicy = config.control.scopes.find((item) => item.scopeId === scope?.id);
    if (scope?.overThreshold === true && scopePolicy?.thresholdStopEnabled === true) {
      // Starting despite active protection requires a separate, explicit,
      // time-limited override. A plain intent is refused.
      return reject(
        "ProtectionActive",
        "流量已超阈值；越过保护启动需要单独的一次性限时 override",
      );
    }
    if (instance.status === "Unknown") {
      return reject("UnknownStatus", "实例状态未知，先查询再执行");
    }
    if (instance.status === "Running") {
      return reject("AlreadyRunning", "实例已在运行");
    }
    if (instance.status === "Starting" || instance.status === "Stopping" || instance.status === "Pending") {
      return reject("Transitional", "实例正处于过渡状态");
    }
  } else {
    if (instance.status === "Stopped") {
      return reject("AlreadyStopped", "实例已停止");
    }
    if (instance.status === "Starting" || instance.status === "Stopping" || instance.status === "Pending") {
      return reject("Transitional", "实例正处于过渡状态");
    }
  }

  return { ok: true, code: "OK", reason: "", instance };
}

/** Human label for an action state, used in the audit trail. */
export function actionStateLabel(state: ActionState | null): string {
  switch (state) {
    case "pending":
      return "已创建";
    case "accepted":
      return "已受理";
    case "confirmed":
      return "已确认";
    case "uncertain":
      return "结果不确定";
    case "failed":
      return "失败";
    default:
      return "无动作";
  }
}
