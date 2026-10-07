/**
 * Display formatting.
 *
 * Every function here is total: given `null`, `NaN`, `Infinity`, `-0` or an
 * absurd magnitude it returns a readable string and never the text "NaN",
 * "Infinity", "undefined" or a bare "-". The contract requires that no widget
 * state — missing quota, no history, zero balance, over 100% — can leak a
 * broken value onto the screen.
 *
 * Conversion and comparison happen in `usage.ts` on raw bytes; this module is
 * the *only* place where rounding for display occurs.
 */

import type { QuotaUnit } from "./models.ts";
import { BYTES_PER_GB, BYTES_PER_GIB } from "./usage.ts";

/** Placeholder shown wherever a value is genuinely unknown. */
export const EM_DASH = "—";

/** True when a number is safe to format. */
function usable(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Format a number with fixed decimals, guarding non-finite input. */
export function formatNumber(
  value: number | null | undefined,
  digits = 2,
): string {
  if (!usable(value)) return EM_DASH;
  // Collapse -0 to 0 so it never renders as "-0.00".
  const normalized = Object.is(value, -0) ? 0 : value;
  if (Math.abs(normalized) >= 1e15) {
    // Beyond this, fixed notation is unreadable; use exponent form.
    return normalized.toExponential(2);
  }
  return normalized.toFixed(digits);
}

/**
 * Format a byte count in the requested unit.
 *
 * The unit suffix is always explicit so `GB` and `GiB` are never conflated.
 */
export function formatBytes(
  bytes: number | null | undefined,
  unit: QuotaUnit,
  digits = 2,
): string {
  if (!usable(bytes) || bytes < 0) return EM_DASH;
  const divisor = unit === "GB" ? BYTES_PER_GB : BYTES_PER_GIB;
  return `${formatNumber(bytes / divisor, digits)} ${unit}`;
}

/**
 * Format a percentage.
 *
 * Values above 100 are shown truthfully (e.g. "137.42%"); only graphics clamp.
 */
export function formatPercent(
  percent: number | null | undefined,
  digits = 2,
): string {
  if (!usable(percent) || percent < 0) return EM_DASH;
  return `${formatNumber(percent, digits)}%`;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  JPY: "JP¥",
  EUR: "€",
  GBP: "£",
  HKD: "HK$",
};

/**
 * Format a money amount.
 *
 * Unknown currency codes fall back to a code prefix rather than a wrong symbol,
 * and amounts are never converted between currencies.
 */
export function formatMoney(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (!usable(amount)) return EM_DASH;
  const code = typeof currency === "string" && currency !== "" ? currency : null;
  if (code === null) return formatNumber(amount, 2);
  const symbol = CURRENCY_SYMBOLS[code];
  return symbol ? `${symbol}${formatNumber(amount, 2)}` : `${code} ${formatNumber(amount, 2)}`;
}

/**
 * Describe how old a sample is, in compact Chinese.
 *
 * Returns "刚刚" for a fresh sample, a minute/hour/day count otherwise, and the
 * placeholder when there is no usable timestamp. This is for the *text* case;
 * lockscreen and desktop layouts prefer the DSL `date` node with
 * `format: "relative"`, which the system keeps updating on its own.
 */
export function formatSampleAge(
  observedAt: string | null | undefined,
  now: Date,
): string {
  if (typeof observedAt !== "string" || observedAt === "") return EM_DASH;
  const time = Date.parse(observedAt);
  if (!Number.isFinite(time)) return EM_DASH;
  const minutes = Math.floor((now.getTime() - time) / 60000);
  if (minutes < 0) return "刚刚";
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

/**
 * Shorten a display name to fit a widget without cutting a surrogate pair in
 * half, which would render as a replacement glyph.
 */
export function truncateName(name: string, maxLength: number): string {
  if (typeof name !== "string") return "";
  const characters = Array.from(name);
  if (characters.length <= maxLength) return name;
  return `${characters.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}

/**
 * Map an instance status to a Chinese label.
 *
 * Unknown and unobserved values are always rendered as text, never implied by
 * colour alone.
 */
export function instanceStatusLabel(status: string): string {
  switch (status) {
    case "Running":
      return "运行中";
    case "Stopped":
      return "已停止";
    case "Starting":
      return "启动中";
    case "Stopping":
      return "停止中";
    case "Pending":
      return "创建中";
    default:
      return "未知";
  }
}

/** Map a traffic class to a Chinese label. */
export function trafficClassLabel(trafficClass: string): string {
  return trafficClass === "mainland" ? "国内" : "海外";
}
