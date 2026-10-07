/**
 * Notification dispatch.
 *
 * Rules enforced here:
 *  - **No secret ever leaves.** Titles, bodies, webhook payloads and URLs are
 *    built from snapshot data and static text only; no credential, token or
 *    signature can reach a channel.
 *  - **HTTP 200 is not success.** Telegram returns `ok:false` inside a 200
 *    response, and DingTalk-style webhooks return a non-zero `errcode`. Both are
 *    checked.
 *  - **Notify and protect are separate.** A notification is de-duplicated by
 *    event key, while threshold *protection* deliberately is not (see
 *    `domain/policy.ts`). That split fixes the original bug where the first
 *    alert permanently suppressed later protective stops.
 *  - **Templates are generated, not concatenated.** A `{{{field}}}` placeholder
 *    is filled with a JSON-escaped value, so quotes, backslashes, newlines and
 *    Unicode cannot break the payload.
 */

import type {
  AppConfig,
  NotificationConfig,
  Snapshot,
  TrafficScopeSnapshot,
} from "../domain/models.ts";
import { formatBytes, formatPercent, instanceStatusLabel } from "../domain/format.ts";
import type { HttpClient } from "../host/types.ts";
import type { Notifier } from "../host/types.ts";
import type { Cache } from "./cache.ts";

/** Notification event types. */
export type NotificationType =
  | "threshold"
  | "recovered"
  | "daily_report"
  | "action"
  | "test";

/** A notification payload, already free of secrets. */
export interface NotificationEvent {
  /** Stable id used for de-duplication. */
  id: string;
  type: NotificationType;
  title: string;
  summary: string;
  fields: Record<string, string>;
  /** ISO 8601. */
  at: string;
}

/** Per-channel delivery outcome. */
export interface DeliveryResult {
  channel: "local" | "telegram" | "webhook";
  ok: boolean;
  /** Sanitized failure reason. */
  error: string | null;
}

/** Deduplication window for alert-style events, in seconds. */
export const ALERT_DEDUPE_SECONDS = 30 * 24 * 3600;

/**
 * Whether an alert-style event should be delivered.
 *
 * Only alerts are de-duplicated. Daily reports carry a window-bound key and
 * actions always notify, so neither is suppressed by this.
 */
export function shouldNotify(cache: Cache, event: NotificationEvent, now: Date): boolean {
  if (event.type !== "threshold" && event.type !== "recovered") return true;
  const key = `alert:${event.id}`;
  const previous = cache.read<string>(event.id, "alert", (value) =>
    typeof value === "string" ? value : null,
  );
  if (previous !== null) {
    const parsed = Date.parse(previous);
    if (Number.isFinite(parsed) && (now.getTime() - parsed) / 1000 < ALERT_DEDUPE_SECONDS) {
      return false;
    }
  }
  cache.write(event.id, "alert", now.toISOString(), now);
  void key;
  return true;
}

/** Build a threshold event for a scope. */
export function buildThresholdEvent(
  scope: TrafficScopeSnapshot,
  now: Date,
): NotificationEvent {
  const percent = formatPercent(scope.usagePercent);
  return {
    id: `threshold:${scope.id}:${scope.periodId}`,
    type: "threshold",
    title: `CDT 流量告警（${percent}）`,
    summary: `${scope.trafficClass === "mainland" ? "国内" : "海外"} CDT 用量已达 ${percent}，超过 ${scope.thresholdPercent}% 阈值。`,
    fields: {
      "流量范围": scope.trafficClass === "mainland" ? "国内" : "海外",
      "已用流量": scope.usedBytes === null ? "—" : formatBytes(scope.usedBytes, "GB"),
      "流量上限": scope.quotaBytes === null ? "未配置" : formatBytes(scope.quotaBytes, "GB"),
      "使用率": percent,
      "阈值": `${scope.thresholdPercent}%`,
      "统计周期": scope.periodId === "unverified" ? "接口累计（待确认）" : scope.periodId,
    },
    at: now.toISOString(),
  };
}

/** Build a recovered event for a scope. */
export function buildRecoveredEvent(
  scope: TrafficScopeSnapshot,
  now: Date,
): NotificationEvent {
  return {
    id: `recovered:${scope.id}:${scope.periodId}`,
    type: "recovered",
    title: "CDT 流量已回落",
    summary: `用量已回落到 ${formatPercent(scope.usagePercent)}，低于 ${scope.thresholdPercent}% 阈值。`,
    fields: {
      "已用流量": scope.usedBytes === null ? "—" : formatBytes(scope.usedBytes, "GB"),
      "使用率": formatPercent(scope.usagePercent),
    },
    at: now.toISOString(),
  };
}

/** Build a daily report event covering every scope and instance. */
export function buildDailyReportEvent(
  snapshot: Snapshot,
  config: AppConfig,
  reportDate: string,
  windowNote: string,
  now: Date,
): NotificationEvent {
  const fields: Record<string, string> = { "统计日期": reportDate, "运行窗口": windowNote };

  // Per scope: usage and state. Reported per scope, never per instance, because
  // there is no real per-instance traffic interface.
  for (const scope of snapshot.trafficScopes) {
    const label = `${config.displayName} ${scope.trafficClass === "mainland" ? "国内" : "海外"}`;
    fields[label] = `${scope.usedBytes === null ? "—" : formatBytes(scope.usedBytes, "GB")} / ${
      scope.quotaBytes === null ? "未配置" : formatBytes(scope.quotaBytes, "GB")
    }（${formatPercent(scope.usagePercent)}）`;
  }

  // Per instance: status and, when billing is on, cost.
  for (const instance of snapshot.instances) {
    const cost = instance.monthlyCost === null
      ? "账单未启用"
      : `${instance.currency ?? ""} ${instance.monthlyCost.toFixed(2)}`.trim();
    fields[`实例 ${instance.name}`] = `${instanceStatusLabel(instance.status)} · ${cost}`;
  }

  const summaryLines = ["CDT Monitor 日报", `日期：${reportDate}`, windowNote];
  for (const scope of snapshot.trafficScopes) {
    summaryLines.push(
      `${scope.trafficClass === "mainland" ? "国内" : "海外"}：${formatPercent(scope.usagePercent)}`,
    );
  }

  return {
    // Bound to the report window so one window is delivered once.
    id: `daily_report:${config.namespace}:${reportDate}:${windowNote}`,
    type: "daily_report",
    title: `CDT Monitor 日报（${reportDate}）`,
    summary: summaryLines.join("\n"),
    fields,
    at: now.toISOString(),
  };
}

/**
 * Replace `{{{key}}}` placeholders with JSON-escaped field values.
 *
 * The key pattern deliberately allows non-ASCII characters: every field name
 * this project emits is Chinese (for example `已用流量`), so restricting the
 * pattern to `[A-Za-z0-9_.-]` would silently leave the most natural templates
 * unsubstituted. Any run of characters other than `{`, `}` and whitespace is
 * treated as a key, and `fields.` prefixes are accepted.
 */
export function renderTemplate(
  template: string,
  event: NotificationEvent,
): string {
  return template.replace(/\{\{\{\s*([^{}\s]+)\s*\}\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.startsWith("fields.") ? rawKey.slice("fields.".length) : rawKey;
    const value =
      key === "title"
        ? event.title
        : key === "summary"
          ? event.summary
          : key === "type"
            ? event.type
            : key === "at"
              ? event.at
              : event.fields[key] ?? "";
    // JSON-escape, then strip the surrounding quotes: the result is safe inside
    // any JSON string context and cannot terminate it early.
    return JSON.stringify(value).slice(1, -1);
  });
}

/** Default webhook body. Always structured, never string-concatenated. */
export function defaultWebhookBody(event: NotificationEvent): string {
  return JSON.stringify({
    title: event.title,
    summary: event.summary,
    fields: event.fields,
    type: event.type,
    at: event.at,
  });
}

/** Dependencies for dispatch. */
export interface DispatchDeps {
  http: HttpClient;
  notifier: Notifier;
  cache: Cache;
  /** Timeout for a single outbound notification request, in milliseconds. */
  requestTimeoutMs: number;
}

/**
 * Deliver one event to every enabled channel.
 *
 * A channel failure never prevents other channels from being attempted, and
 * never throws: notifications must not be able to break a widget render.
 */
export async function dispatchNotification(
  deps: DispatchDeps,
  event: NotificationEvent,
  config: NotificationConfig,
  now: Date,
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];
  if (!shouldNotify(deps.cache, event, now)) {
    return results;
  }

  if (config.local) {
    try {
      deps.notifier.notify({
        title: event.title,
        body: event.summary,
        sound: event.type === "threshold",
        ...(consoleActionUrl() !== null
          ? { action: { type: "openUrl" as const, url: consoleActionUrl() as string } }
          : {}),
      });
      results.push({ channel: "local", ok: true, error: null });
    } catch {
      results.push({ channel: "local", ok: false, error: "本地通知发送失败" });
    }
  }

  if (config.telegram.enabled && config.telegram.botToken !== "" && config.telegram.chatId !== "") {
    results.push(await sendTelegram(deps, event, config.telegram));
  }

  if (config.webhook.enabled && config.webhook.url !== "") {
    results.push(await sendWebhook(deps, event, config.webhook));
  }

  return results;
}

/**
 * The console link used as a notification tap action.
 *
 * GET-only and carries no key or action, so tapping can never change state.
 */
export function consoleActionUrl(): string | null {
  return "https://cdt.console.aliyun.com/";
}

/** Send via the Telegram Bot API, honouring `ok:false` inside HTTP 200. */
async function sendTelegram(
  deps: DispatchDeps,
  event: NotificationEvent,
  config: NotificationConfig["telegram"],
): Promise<DeliveryResult> {
  const text = [event.title, "", event.summary].join("\n");
  try {
    const response = await deps.http.post(
      `https://api.telegram.org/bot${config.botToken}/sendMessage`,
      {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: config.chatId, text }),
        timeout: deps.requestTimeoutMs,
        credentials: "omit",
      },
    );
    if (response.status !== 200) {
      return { channel: "telegram", ok: false, error: `Telegram 返回 HTTP ${response.status}` };
    }
    const parsed = JSON.parse(await response.text()) as Record<string, unknown>;
    if (parsed["ok"] !== true) {
      // A 200 with ok:false is a failure and must not be counted as delivered.
      return { channel: "telegram", ok: false, error: "Telegram 返回 ok=false" };
    }
    return { channel: "telegram", ok: true, error: null };
  } catch {
    return { channel: "telegram", ok: false, error: "Telegram 请求失败" };
  }
}

/** Send via an HTTP webhook, honouring common business error envelopes. */
async function sendWebhook(
  deps: DispatchDeps,
  event: NotificationEvent,
  config: NotificationConfig["webhook"],
): Promise<DeliveryResult> {
  const body =
    config.bodyTemplate.trim() === ""
      ? defaultWebhookBody(event)
      : renderTemplate(config.bodyTemplate, event);
  try {
    const response = await deps.http.post(config.url, {
      headers: { "Content-Type": "application/json" },
      body,
      timeout: deps.requestTimeoutMs,
      credentials: "omit",
    });
    if (response.status < 200 || response.status >= 300) {
      return { channel: "webhook", ok: false, error: `Webhook 返回 HTTP ${response.status}` };
    }
    const text = await response.text();
    // DingTalk/WeCom style envelopes report failure inside a 200 body.
    if (text.trim() !== "") {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const errcode = parsed["errcode"];
        if (typeof errcode === "number" && errcode !== 0) {
          return { channel: "webhook", ok: false, error: `Webhook 业务失败 errcode=${errcode}` };
        }
        if (parsed["success"] === false || parsed["ok"] === false) {
          return { channel: "webhook", ok: false, error: "Webhook 返回业务失败标记" };
        }
      } catch {
        // A non-JSON body is acceptable for generic webhooks.
      }
    }
    return { channel: "webhook", ok: true, error: null };
  } catch {
    return { channel: "webhook", ok: false, error: "Webhook 请求失败" };
  }
}
