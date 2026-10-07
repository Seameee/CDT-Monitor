/**
 * Schedule arithmetic: clock parsing, overnight windows and due-window checks.
 *
 * Ported from the original Go engine (`internal/engine/engine.go`:
 * `parseClockTime`, `overnightSchedule`, `scheduleCycleDate`, `dueWithin`,
 * `inTimeRange`) with three deliberate differences:
 *
 *  1. **Strict parsing.** The Go version accepted anything `time.Parse("15:04")`
 *     tolerated and silently returned `false` for everything else. Here an
 *     unparseable time is `null`, which callers must surface as a configuration
 *     error instead of quietly never firing. Full-width `：` is normalised.
 *  2. **`24:00` compatibility.** The Go version maps `24:00` to `00:00`. That is
 *     preserved, but new configurations should use `00:00`.
 *  3. **`start === stop` is rejected by validation**, not treated as a 24-hour
 *     window. Expressing an all-day window requires an explicit future field.
 *
 * All comparisons use integer minutes-of-day. String comparison of `HH:mm` is
 * only correct while the format stays zero-padded and zero-left; one full-width
 * or unpadded value silently inverts a comparison, so it is never used here.
 */

import type { ZonedParts } from "./timezone.ts";

/** Minutes in one day. */
export const MINUTES_PER_DAY = 24 * 60;

/** Parsed clock time. */
export interface ClockTime {
  hour: number;
  minute: number;
  /** Minutes since midnight, 0–1439. */
  minutes: number;
}

/**
 * Normalise a clock string.
 *
 * Accepts `H:mm`, `HH:mm` and the full-width colon `：`. `24:00` normalises to
 * `00:00` for backward compatibility with existing Go configuration. Returns
 * null for anything else — including out-of-range values such as `25:00` or
 * `08:60`, which the Go version also rejected.
 */
export function normalizeClockTime(value: string): string | null {
  const parsed = parseClockTime(value);
  if (parsed === null) return null;
  return `${parsed.hour < 10 ? "0" : ""}${parsed.hour}:${parsed.minute < 10 ? "0" : ""}${parsed.minute}`;
}

/**
 * Parse a clock string into integer hour/minute/minutes-of-day.
 *
 * Returns null when the input is empty, non-string, not `H:mm`/`HH:mm`, or out
 * of range.
 */
export function parseClockTime(value: unknown): ClockTime | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/：/g, ":");
  if (normalized === "24:00") {
    return { hour: 0, minute: 0, minutes: 0 };
  }
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(normalized);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return { hour, minute, minutes: hour * 60 + minute };
}

/** Render minutes-of-day as canonical `HH:mm`. */
export function formatMinuteOfDay(minutes: number): string {
  const safe = ((Math.floor(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${hour < 10 ? "0" : ""}${hour}:${minute < 10 ? "0" : ""}${minute}`;
}

/**
 * Whether a window crosses midnight.
 *
 * `start === stop` is NOT treated as overnight; validation rejects it first.
 */
export function isOvernightWindow(startMinutes: number, stopMinutes: number): boolean {
  return startMinutes > stopMinutes;
}

/**
 * Whether `nowMinutes` falls inside `[start, stop)`.
 *
 * The end is exclusive, matching the Go `inTimeRange`. An overnight window
 * wraps, so `23:00–07:00` contains both `23:30` and `02:00`.
 */
export function isWithinWindow(
  nowMinutes: number,
  startMinutes: number,
  stopMinutes: number,
): boolean {
  if (isOvernightWindow(startMinutes, stopMinutes)) {
    return nowMinutes >= startMinutes || nowMinutes < stopMinutes;
  }
  return nowMinutes >= startMinutes && nowMinutes < stopMinutes;
}

/**
 * Whether `nowMinutes` is inside the short catch-up window that begins at
 * `targetMinutes`.
 *
 * Preserves the original "fire within N minutes after the scheduled moment"
 * semantics. It intentionally does **not** wrap past midnight: a task scheduled
 * for 23:55 is not considered due at 00:02, because that would silently cross
 * into the next cycle's date key and defeat the once-per-cycle claim.
 */
export function dueWithinMinutes(
  nowMinutes: number,
  targetMinutes: number,
  windowMinutes: number,
): boolean {
  const delta = nowMinutes - targetMinutes;
  return delta >= 0 && delta <= windowMinutes;
}

/** Shift a `YYYY-MM-DD` calendar date by whole days. */
export function shiftCalendarDate(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return date;
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const shifted = new Date(base + days * 86400000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return `${year}-${month < 10 ? "0" : ""}${month}-${day < 10 ? "0" : ""}${day}`;
}

/**
 * Identify the date on which the current schedule window started.
 *
 * For an overnight window such as `08:00 → 00:34`, times before the start
 * belong to the previous day's cycle, so both the start and the stop land on
 * the same cycle date. This is what keeps one start/stop pair per cycle.
 */
export function scheduleCycleDate(
  parts: Pick<ZonedParts, "date" | "minuteOfDay">,
  startMinutes: number,
  stopMinutes: number,
): string {
  if (isOvernightWindow(startMinutes, stopMinutes) && parts.minuteOfDay < startMinutes) {
    return shiftCalendarDate(parts.date, -1);
  }
  return parts.date;
}

/** A parsed, validated instance schedule. */
export interface NormalizedSchedule {
  enabled: boolean;
  startMinutes: number;
  stopMinutes: number;
  /** True when the window crosses midnight. */
  overnight: boolean;
}

/** Result of normalising a configured schedule. */
export type ScheduleNormalization =
  | { ok: true; schedule: NormalizedSchedule }
  | { ok: false; reason: string };

/**
 * Validate and normalise a schedule.
 *
 * Rejected cases are reported rather than silently disabled, and a rejected
 * schedule never blocks read-only monitoring of the same scope.
 */
export function normalizeSchedule(
  start: string,
  stop: string,
  enabled: boolean,
): ScheduleNormalization {
  const startTime = parseClockTime(start);
  const stopTime = parseClockTime(stop);
  if (startTime === null) {
    return { ok: false, reason: `开始时间不是合法的 HH:mm：${JSON.stringify(start)}` };
  }
  if (stopTime === null) {
    return { ok: false, reason: `停止时间不是合法的 HH:mm：${JSON.stringify(stop)}` };
  }
  if (enabled && startTime.minutes === stopTime.minutes) {
    return {
      ok: false,
      reason: "开始时间与停止时间相同；如需全天窗口，请等待显式的全天配置项",
    };
  }
  return {
    ok: true,
    schedule: {
      enabled,
      startMinutes: startTime.minutes,
      stopMinutes: stopTime.minutes,
      overnight: isOvernightWindow(startTime.minutes, stopTime.minutes),
    },
  };
}
