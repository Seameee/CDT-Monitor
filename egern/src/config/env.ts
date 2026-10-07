/**
 * Raw environment access and strict coercion helpers.
 *
 * `ctx.env` values are always strings, and the contract calls out the classic
 * trap explicitly: `Boolean("false")` is `true`. Every switch and number here is
 * therefore parsed strictly, and an unparseable value becomes a reported issue
 * instead of a silent default. Silently defaulting is how a user turns a
 * protection *off*, believes it is on, and finds out at the wrong moment.
 */

/** Severity of a configuration problem. */
export type IssueSeverity = "error" | "warning";

/** A single configuration problem, scoped to an entity when applicable. */
export interface ConfigIssue {
  /** Entity the issue belongs to, or null for global configuration. */
  entityId: string | null;
  /** Configuration key or field name. */
  field: string;
  message: string;
  severity: IssueSeverity;
}

/** Collector for issues raised while parsing. */
export class IssueCollector {
  readonly issues: ConfigIssue[] = [];

  add(
    severity: IssueSeverity,
    field: string,
    message: string,
    entityId: string | null = null,
  ): void {
    this.issues.push({ entityId, field, message, severity });
  }

  error(field: string, message: string, entityId: string | null = null): void {
    this.add("error", field, message, entityId);
  }

  warn(field: string, message: string, entityId: string | null = null): void {
    this.add("warning", field, message, entityId);
  }

  /** Issues that should block the whole configuration. */
  globalErrors(): ConfigIssue[] {
    return this.issues.filter((issue) => issue.severity === "error" && issue.entityId === null);
  }

  /** Whether any error (global or scoped) was recorded. */
  hasErrors(): boolean {
    return this.issues.some((issue) => issue.severity === "error");
  }
}

/** Read a trimmed string, treating blank as absent. */
export function readString(
  env: Record<string, string | undefined>,
  key: string,
): string | null {
  const raw = env[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Parse a boolean switch strictly.
 *
 * Accepts exactly `true`/`false` (case-insensitive, trimmed). Anything else —
 * including `"0"`, `"no"`, `"yes"`, `""` — is reported and the default is used,
 * so a typo can never flip a protection silently.
 */
export function readBoolean(
  env: Record<string, string | undefined>,
  key: string,
  fallback: boolean,
  issues: IssueCollector,
): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  issues.warn(key, `${key} 只接受 true/false，已按默认值 ${String(fallback)} 处理`);
  return fallback;
}

/**
 * Parse a finite number strictly.
 *
 * Rejects hex, `Infinity`, `NaN`, exponent forms and partially numeric strings.
 */
export function readNumber(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
  issues: IssueCollector,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const trimmed = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    issues.warn(key, `${key} 不是合法数字，已按默认值 ${fallback} 处理`);
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    issues.warn(key, `${key} 不是有限数字，已按默认值 ${fallback} 处理`);
    return fallback;
  }
  return parsed;
}

/** Parse a non-negative integer strictly. */
export function readNonNegativeInteger(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
  issues: IssueCollector,
): number {
  const value = readNumber(env, key, fallback, issues);
  if (!Number.isInteger(value) || value < 0) {
    issues.warn(key, `${key} 必须是非负整数，已按默认值 ${fallback} 处理`);
    return fallback;
  }
  return value;
}

/** Parse a value against an allow-list of literal options. */
export function readEnum<T extends string>(
  env: Record<string, string | undefined>,
  key: string,
  allowed: readonly T[],
  fallback: T,
  issues: IssueCollector,
): T {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim() as T;
  if (allowed.includes(normalized)) return normalized;
  issues.warn(
    key,
    `${key} 只能是 ${allowed.join(" / ")}，已按默认值 ${fallback} 处理`,
  );
  return fallback;
}

/**
 * Parse an optional JSON document.
 *
 * Returns `undefined` when absent, `null` when present but unusable (the caller
 * must then surface an error rather than falling back to another account model).
 */
export function readJson(
  env: Record<string, string | undefined>,
  key: string,
  issues: IssueCollector,
): unknown | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    issues.error(key, `${key} 不是合法的 JSON`);
    return null;
  }
}

/** Split a comma-separated list, trimming and dropping blanks. */
export function readList(
  env: Record<string, string | undefined>,
  key: string,
): string[] | null {
  const raw = readString(env, key);
  if (raw === null) return null;
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return parts.length === 0 ? null : parts;
}
