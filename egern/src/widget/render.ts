/**
 * Widget view model.
 *
 * Turns a snapshot plus configuration into everything the layouts need, with
 * every user-visible string already decided. Layout code never touches raw
 * snapshots, so there is exactly one place where "unknown" becomes a label and
 * nowhere for `NaN` to leak into a text node.
 *
 * All twelve required states are represented: unconfigured, first wait, normal,
 * near threshold, over threshold, transitional instance, stale cache, invalid
 * credential, insufficient permission, no history, partial success and a
 * selected target that has disappeared.
 */

import type {
  AppConfig,
  InstanceSnapshot,
  Snapshot,
  TrafficScopeSnapshot,
} from "../domain/models.ts";
import {
  EM_DASH,
  formatBytes,
  formatMoney,
  formatNumber,
  formatPercent,
  formatSampleAge,
  instanceStatusLabel,
  trafficClassLabel,
  truncateName,
} from "../domain/format.ts";
import { clampFraction } from "../domain/usage.ts";
import { computeConsumption, hasVerifiedPeriod } from "../domain/history.ts";
import type { ScopeHistory } from "../domain/models.ts";
import type { Theme } from "./theme.ts";

/** Overall widget state. */
export type ViewStatus =
  | "unconfigured"
  | "waiting"
  | "normal"
  | "near-threshold"
  | "over-threshold"
  | "stale"
  | "auth-error"
  | "permission-error"
  | "no-history"
  | "partial"
  | "target-missing";

/** Per-scope visual state. */
export type ScopeState = "ok" | "warning" | "danger" | "muted";

/** One scope, ready to render. */
export interface ScopeView {
  scopeId: string;
  /** e.g. "账号海外 CDT". */
  label: string;
  /** e.g. "12.50 / 200.00 GB". */
  usageText: string;
  /** e.g. "6.25%" or "—". */
  percentText: string;
  /** Remaining text, or "未配置". */
  remainingText: string;
  /** Clamped fraction for graphics; never the raw ratio. */
  fraction: number;
  state: ScopeState;
  /** Short state label, always textual. */
  statusText: string;
  /** Sampling age, e.g. "12 分钟前". */
  ageText: string;
  /** Real observation time, or null. */
  observedAtIso: string | null;
  /** Consumption over the requested window, or null. */
  consumptionText: string | null;
  /** Instance rows belonging to this scope. */
  instances: InstanceRowView[];
  /** Scope-level error text, if any. */
  errorText: string | null;
  /** Quality caveat, e.g. the unverified period. */
  qualityNote: string | null;
}

/** One instance row. */
export interface InstanceRowView {
  id: string;
  name: string;
  statusText: string;
  status: InstanceSnapshot["status"];
  state: ScopeState;
  costText: string | null;
}

/** The full view model. */
export interface WidgetViewModel {
  title: string;
  status: ViewStatus;
  stateColor: ScopeState;
  /** Headline message when there is nothing to chart. */
  message: string | null;
  /** Detail line shown under the message. */
  detail: string | null;
  scopes: ScopeView[];
  /** Global error lines, deduplicated and bounded. */
  errors: string[];
  /** Newest observation across scopes, for the `date` node. */
  updatedAtIso: string | null;
  /** Whether any history was available. */
  hasHistory: boolean;
}

/** Options for building the view model. */
export interface ViewModelOptions {
  snapshot: Snapshot;
  config: AppConfig;
  now: Date;
  histories: ReadonlyMap<string, ScopeHistory>;
  theme: Theme;
}

/** Choose the scope to feature, honouring the widget-level selection. */
export function selectPrimaryScope(
  snapshot: Snapshot,
  config: AppConfig,
): TrafficScopeSnapshot | null {
  const selected = config.view.scopeId;
  if (selected !== null) {
    const match = snapshot.trafficScopes.find((scope) => scope.id === selected);
    if (match !== undefined) return match;
  }
  return snapshot.trafficScopes[0] ?? null;
}

/** Classify a scope's usage into a color state. */
function classify(scope: TrafficScopeSnapshot): ScopeState {
  if (scope.overThreshold === true) return "danger";
  if (scope.usagePercent === null) return "muted";
  if (scope.usagePercent >= scope.thresholdPercent - 5) return "warning";
  return "ok";
}

/** Short textual state, so colour is never the only signal. */
function statusTextFor(scope: TrafficScopeSnapshot, stale: boolean): string {
  if (scope.trafficError !== null) return "查询失败";
  if (scope.overThreshold === true) return "已超阈值";
  if (scope.usagePercent === null) return "用量未知";
  if (stale) return "数据陈旧";
  if (scope.usagePercent >= scope.thresholdPercent - 5) return "接近阈值";
  return "正常";
}

/** Build the label for a scope, e.g. "账号海外 CDT". */
function scopeLabel(scope: TrafficScopeSnapshot, displayName: string): string {
  return `${displayName} ${trafficClassLabel(scope.trafficClass)} CDT`;
}

/** Build the view model. Pure; performs no I/O. */
export function buildViewModel(options: ViewModelOptions): WidgetViewModel {
  const { snapshot, config, now, histories } = options;
  const errors = dedupeErrors(snapshot.errors.map((error) => error.message));

  if (snapshot.trafficScopes.length === 0) {
    return {
      title: config.displayName,
      status: "unconfigured",
      stateColor: "muted",
      message: "尚未配置监控对象",
      detail: "请在模块 Env 中填写 AccessKey 或服务器地址",
      scopes: [],
      errors,
      updatedAtIso: null,
      hasHistory: false,
    };
  }

  const instanceRows = new Map<string, InstanceRowView[]>();
  for (const instance of snapshot.instances) {
    const rows = instanceRows.get(instance.trafficScopeId) ?? [];
    rows.push({
      id: instance.id,
      // Truncation happens on code points, so an emoji or CJK name is never
      // split into a replacement glyph.
      name: truncateName(instance.name, 18),
      statusText: instanceStatusLabel(instance.status),
      status: instance.status,
      state:
        instance.status === "Running"
          ? "ok"
          : instance.status === "Stopped"
            ? "muted"
            : instance.status === "Unknown"
              ? "warning"
              : "warning",
      costText:
        instance.monthlyCost === null
          ? null
          : formatMoney(instance.monthlyCost, instance.currency),
    });
    instanceRows.set(instance.trafficScopeId, rows);
  }

  const scopes: ScopeView[] = snapshot.trafficScopes.map((scope) => {
    const history = histories.get(scope.id);
    const stale = scope.stale || scope.trafficError !== null;
    const usageText = buildUsageText(scope);
    const consumption = history === undefined
      ? null
      : computeConsumption(history.hourly, {
          periodVerified: history.hourly.some(hasVerifiedPeriod),
          requestedHours: 24,
          now,
        });

    const qualityNotes: string[] = [];
    if (scope.periodId === "unverified") {
      qualityNotes.push("接口累计（周期待确认）");
    }
    if (scope.sourceUnit === "legacyGiB") {
      qualityNotes.push("来自服务器，单位按 GiB 换算");
    }
    if (scope.overThreshold === false && scope.trafficError === null && scope.freshnessQuality !== "measured") {
      qualityNotes.push("服务器时间戳不作为云端采样时间");
    }

    return {
      scopeId: scope.id,
      label: scopeLabel(scope, config.displayName),
      usageText,
      percentText:
        scope.trafficError !== null && scope.usedBytes === null
          ? EM_DASH
          : formatPercent(scope.usagePercent),
      remainingText:
        scope.remainingBytes === null
          ? "未配置"
          : `${formatBytes(scope.remainingBytes, "GB")}`,
      // Graphics clamp; the text above keeps the true value.
      fraction:
        scope.usagePercent === null
          ? 0
          : clampFraction(scope.usagePercent / 100),
      state: classify(scope),
      statusText: statusTextFor(scope, stale),
      ageText: formatSampleAge(scope.trafficObservedAt ?? scope.legacyUpdatedAt, now),
      observedAtIso: scope.trafficObservedAt,
      consumptionText:
        consumption === null || consumption.consumedBytes === null
          ? null
          : `${formatBytes(consumption.consumedBytes, "GB")} · ${consumption.description}`,
      instances: instanceRows.get(scope.id) ?? [],
      errorText: scope.trafficError?.message ?? null,
      qualityNote: qualityNotes.length > 0 ? qualityNotes.join(" · ") : null,
    };
  });

  const primary = selectPrimaryScope(snapshot, config);
  const primaryView = primary === null
    ? null
    : scopes.find((view) => view.scopeId === primary.id) ?? null;

  const updatedAtIso = newestObservation(scopes);
  const hasHistory = histories.size > 0;

  // A selected scope that no longer exists must say so, not silently fall back.
  if (
    config.view.scopeId !== null &&
    snapshot.trafficScopes.every((scope) => scope.id !== config.view.scopeId)
  ) {
    return {
      title: config.displayName,
      status: "target-missing",
      stateColor: "warning",
      message: "选中的监控对象已不存在",
      detail: `CDT_SCOPE_ID=${config.view.scopeId} 不在当前配置中`,
      scopes,
      errors,
      updatedAtIso,
      hasHistory,
    };
  }

  if (primaryView === null || primary === null) {
    return {
      title: config.displayName,
      status: "unconfigured",
      stateColor: "muted",
      message: "尚无可用数据",
      detail: null,
      scopes,
      errors,
      updatedAtIso,
      hasHistory,
    };
  }

  const status = deriveStatus(primaryView, primary, config, hasHistory);
  const authError = snapshot.errors.find(
    (error) => error.code === "TokenRejected" || error.code === "AccessDenied",
  );
  const finalStatus: ViewStatus = authError !== undefined ? "auth-error" : status;

  return {
    title: config.displayName,
    status: finalStatus,
    stateColor: primaryView.state,
    message: messageFor(finalStatus),
    detail: detailFor(finalStatus, primaryView, config),
    scopes,
    errors,
    updatedAtIso,
    hasHistory,
  };
}

function buildUsageText(scope: TrafficScopeSnapshot): string {
  const used =
    scope.usedBytes === null
      ? EM_DASH
      : `${formatNumber(scope.usedBytes / 1_000_000_000, 2)} GB`;
  if (scope.quotaBytes === null) {
    // Never invent a quota. Show the real usage against "未配置".
    return `${used} / 未配置上限`;
  }
  return `${used} / ${formatBytes(scope.quotaBytes, "GB")}`;
}

function newestObservation(scopes: readonly ScopeView[]): string | null {
  let newest: string | null = null;
  let newestTime = Number.NEGATIVE_INFINITY;
  for (const scope of scopes) {
    if (scope.observedAtIso === null) continue;
    const parsed = Date.parse(scope.observedAtIso);
    if (!Number.isFinite(parsed)) continue;
    if (parsed > newestTime) {
      newestTime = parsed;
      newest = scope.observedAtIso;
    }
  }
  return newest;
}

function deriveStatus(
  view: ScopeView,
  scope: TrafficScopeSnapshot,
  config: AppConfig,
  hasHistory: boolean,
): ViewStatus {
  // Nothing observed yet and no failure: this is the first-run wait, which is
  // more informative than reporting a missing history.
  if (
    scope.usedBytes === null &&
    scope.trafficObservedAt === null &&
    scope.legacyUpdatedAt === null &&
    scope.trafficError === null
  ) {
    return "waiting";
  }
  if (scope.trafficError !== null && scope.usedBytes === null) return "waiting";
  if (scope.trafficError !== null) return "stale";
  // A confirmed threshold always outranks the cosmetic "no history" state.
  if (scope.overThreshold === true) return "over-threshold";
  if (scope.usagePercent !== null && scope.usagePercent >= scope.thresholdPercent - 5) {
    return "near-threshold";
  }
  if (scope.stale) return "stale";
  if (!hasHistory) return "no-history";
  if (config.billingEnabled && config.mode === "server") return "partial";
  void view;
  return "normal";
}

function messageFor(status: ViewStatus): string | null {
  switch (status) {
    case "waiting":
      return "等待首次采集";
    case "stale":
      return "数据可能已过期";
    case "over-threshold":
      return "流量已超阈值";
    case "near-threshold":
      return "流量接近阈值";
    case "auth-error":
      return "凭据无效或权限不足";
    case "permission-error":
      return "权限不足";
    case "no-history":
      return "暂无历史数据";
    case "partial":
      return "部分数据缺失";
    case "target-missing":
      return "监控对象不存在";
    case "unconfigured":
      return "尚未配置";
    default:
      return null;
  }
}

function detailFor(
  status: ViewStatus,
  view: ScopeView,
  config: AppConfig,
): string | null {
  switch (status) {
    case "auth-error":
      return "请检查只读 RAM 凭据或服务器 Token";
    case "stale":
      return view.errorText ?? "上次采集未成功，显示的是缓存值";
    case "waiting":
      return "尚未取得有效数据";
    case "no-history":
      return "安装后开始采样，历史不会凭空继承";
    case "partial":
      return "账单数据可能缺失，用量仍然有效";
    default:
      void config;
      return null;
  }
}

/** Deduplicate and bound error lines so the widget cannot overflow. */
function dedupeErrors(messages: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const message of messages) {
    if (seen.has(message)) continue;
    seen.add(message);
    result.push(message);
    if (result.length >= 3) break;
  }
  return result;
}
