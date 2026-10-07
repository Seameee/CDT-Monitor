/**
 * Timezone handling with honest capability detection.
 *
 * The business timezone (default `Asia/Shanghai`) governs schedule windows,
 * daily-report timing and how a month is named. Egern's documentation does not
 * promise that `Intl.DateTimeFormat` supports arbitrary IANA zones, so this
 * module detects what is actually available and reports it rather than guessing
 * an offset. Guessing is how a DST region silently fires a shutdown an hour
 * early.
 *
 * Three support levels:
 *  - `intl`         — `Intl.DateTimeFormat` accepted the zone; DST is correct.
 *  - `fixed-offset` — no Intl, but the zone is `Asia/Shanghai`, which has had a
 *                     constant +08:00 offset with no DST since 1991. Exact for
 *                     all modern dates, and labelled as a fallback.
 *  - `unsupported`  — neither path works. Local scheduling and daily reports
 *                     must then be disabled rather than run on a wrong clock.
 */

/** Timezone resolution strategy actually in use. */
export type TimeZoneSupport = "intl" | "fixed-offset" | "unsupported";

/** Calendar fields in a specific zone. */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Minutes elapsed since local midnight (0–1439). */
  minuteOfDay: number;
  /** Local calendar date as `YYYY-MM-DD`. */
  date: string;
}

/** Zone-aware clock used by schedule and reporting logic. */
export interface TimeZoneProvider {
  readonly timeZone: string;
  readonly support: TimeZoneSupport;
  /** True only when local-time decisions on this provider are trustworthy. */
  isReliable(): boolean;
  /** Human-readable reason the provider is not reliable, else null. */
  limitation(): string | null;
  partsAt(instant: Date): ZonedParts;
  /** Offset east of UTC, in minutes, at the given instant. */
  offsetMinutesAt(instant: Date): number;
}

/** Asia/Shanghai has used a constant +08:00 with no DST since 1991-09-15. */
const ASIA_SHANGHAI_OFFSET_MINUTES = 8 * 60;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function buildParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): ZonedParts {
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    minuteOfDay: hour * 60 + minute,
    date: `${year}-${pad2(month)}-${pad2(day)}`,
  };
}

/** Create a `Intl.DateTimeFormat` for the zone, or null when unavailable. */
function createIntlFormatter(timeZone: string): Intl.DateTimeFormat | null {
  if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") {
    return null;
  }
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    // Some engines accept the constructor but throw on first use, or silently
    // ignore an unknown zone. Formatting a probe instant forces the failure.
    formatter.formatToParts(new Date(0));
    return formatter;
  } catch {
    return null;
  }
}

class IntlTimeZoneProvider implements TimeZoneProvider {
  readonly support = "intl" as const;
  readonly timeZone: string;
  private readonly formatter: Intl.DateTimeFormat;

  constructor(timeZone: string, formatter: Intl.DateTimeFormat) {
    this.timeZone = timeZone;
    this.formatter = formatter;
  }

  isReliable(): boolean {
    return true;
  }

  limitation(): string | null {
    return null;
  }

  partsAt(instant: Date): ZonedParts {
    const collected: Record<string, string> = {};
    for (const part of this.formatter.formatToParts(instant)) {
      if (part.type !== "literal") collected[part.type] = part.value;
    }
    let hour = Number(collected.hour);
    // `hour12: false` renders midnight as "24" in some CLDR versions.
    if (hour === 24) hour = 0;
    return buildParts(
      Number(collected.year),
      Number(collected.month),
      Number(collected.day),
      hour,
      Number(collected.minute),
      Number(collected.second),
    );
  }

  offsetMinutesAt(instant: Date): number {
    const parts = this.partsAt(instant);
    const asIfUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    // Compare at whole-second precision so milliseconds do not leak in.
    const instantSeconds = Math.floor(instant.getTime() / 1000) * 1000;
    return Math.round((asIfUtc - instantSeconds) / 60000);
  }
}

class FixedOffsetTimeZoneProvider implements TimeZoneProvider {
  readonly support = "fixed-offset" as const;
  readonly timeZone: string;
  private readonly offsetMinutes: number;

  constructor(timeZone: string, offsetMinutes: number) {
    this.timeZone = timeZone;
    this.offsetMinutes = offsetMinutes;
  }

  isReliable(): boolean {
    return true;
  }

  limitation(): string | null {
    return "未检测到 Intl 时区支持，已按固定的 UTC+08:00 处理 Asia/Shanghai（该时区自 1991 年起无夏令时，因此结果仍然准确）";
  }

  partsAt(instant: Date): ZonedParts {
    const shifted = new Date(instant.getTime() + this.offsetMinutes * 60000);
    return buildParts(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth() + 1,
      shifted.getUTCDate(),
      shifted.getUTCHours(),
      shifted.getUTCMinutes(),
      shifted.getUTCSeconds(),
    );
  }

  offsetMinutesAt(): number {
    return this.offsetMinutes;
  }
}

class UnsupportedTimeZoneProvider implements TimeZoneProvider {
  readonly support = "unsupported" as const;
  readonly timeZone: string;
  private readonly reason: string;

  constructor(timeZone: string, reason: string) {
    this.timeZone = timeZone;
    this.reason = reason;
  }

  isReliable(): boolean {
    return false;
  }

  limitation(): string | null {
    return this.reason;
  }

  partsAt(): ZonedParts {
    throw new Error(`timezone ${this.timeZone} is not supported on this host`);
  }

  offsetMinutesAt(): number {
    throw new Error(`timezone ${this.timeZone} is not supported on this host`);
  }
}

/**
 * Resolve a usable timezone provider.
 *
 * Never throws: an unusable zone produces an `unsupported` provider whose
 * `isReliable()` is false, so callers can degrade (disable local schedules)
 * instead of crashing a widget render.
 */
export function createTimeZoneProvider(timeZone: string): TimeZoneProvider {
  const formatter = createIntlFormatter(timeZone);
  if (formatter !== null) {
    return new IntlTimeZoneProvider(timeZone, formatter);
  }
  if (timeZone === "Asia/Shanghai" || timeZone === "UTC+8" || timeZone === "+08:00") {
    return new FixedOffsetTimeZoneProvider(timeZone, ASIA_SHANGHAI_OFFSET_MINUTES);
  }
  return new UnsupportedTimeZoneProvider(
    timeZone,
    `当前运行环境缺少可用的时区数据，无法正确处理 ${timeZone}；本地定时与日报已停用`,
  );
}

/** Render an instant as an ISO 8601 string, or null when not a valid date. */
export function toIsoOrNull(instant: Date | null): string | null {
  if (instant === null) return null;
  const time = instant.getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

/** Parse an ISO 8601 string into a Date, or null when invalid. */
export function parseIso(value: string | null | undefined): Date | null {
  if (typeof value !== "string" || value === "") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time);
}

/** Whole minutes elapsed since the given instant; null when unparseable. */
export function minutesSince(instantIso: string | null, now: Date): number | null {
  const parsed = parseIso(instantIso);
  if (parsed === null) return null;
  return (now.getTime() - parsed.getTime()) / 60000;
}
