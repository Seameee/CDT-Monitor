/**
 * Defensive parsing helpers for Aliyun RPC responses.
 *
 * The original Go client's `number()` silently returned `0` for anything it
 * could not parse and `parseFloat` accepted inputs like `"123bad"`. Both turn a
 * malformed response into a plausible-looking number, which is exactly how a
 * wrong traffic figure ends up driving a threshold action. These helpers never
 * coerce: they return `null` and let the caller decide.
 */

/** Narrow an unknown value to a plain object. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Read a nested property path, e.g. `getPath(body, "Data", "Items")`.
 *
 * Returns undefined as soon as the path breaks. Callers must distinguish
 * "absent" from "present but empty" — that difference is load-bearing for the
 * CDT traffic response.
 */
export function getPath(value: unknown, ...path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const record = asRecord(current);
    if (record === null) return undefined;
    current = record[key];
  }
  return current;
}

/**
 * Normalise the several array shapes Aliyun uses.
 *
 * Depending on service and item count the payload may be a plain array, an
 * object wrapping `Item`, or a single object where a list was expected. The Go
 * `asSlice` handled the first two; the single-object case is added here because
 * a one-element list is a normal occurrence, not an error.
 */
export function asArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (record === null) return null;
  if (Array.isArray(record["Item"])) return record["Item"] as unknown[];
  if (record["Item"] !== undefined && record["Item"] !== null) return [record["Item"]];
  return null;
}

/** Result of a strict numeric read. */
export type StrictNumberResult =
  | { ok: true; value: number }
  | { ok: false; reason: "missing" | "not-a-number" | "negative" | "not-finite" | "unsafe-precision" };

/**
 * Parse a numeric field without guessing.
 *
 * Accepts a finite JSON number or a decimal string. Rejects booleans, arrays,
 * objects, whitespace-padded garbage, `NaN`, `Infinity`, negatives (when a
 * non-negative value is expected) and magnitudes beyond
 * `Number.MAX_SAFE_INTEGER`.
 */
export function strictNonNegativeNumber(value: unknown): StrictNumberResult {
  if (value === undefined || value === null || value === "") {
    return { ok: false, reason: "missing" };
  }

  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    // Deliberately stricter than parseFloat/Number(): the whole string must be
    // a decimal literal, so "123bad", "1e5x" and "12,3" are all rejected.
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return { ok: false, reason: "not-a-number" };
    }
    parsed = Number(trimmed);
  } else {
    return { ok: false, reason: "not-a-number" };
  }

  if (!Number.isFinite(parsed)) return { ok: false, reason: "not-finite" };
  if (parsed < 0) return { ok: false, reason: "negative" };
  if (parsed > Number.MAX_SAFE_INTEGER) return { ok: false, reason: "unsafe-precision" };
  return { ok: true, value: parsed };
}

/** Read a non-empty string, or null. */
export function strictString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Read a boolean from a real boolean or the strings "true"/"false". */
export function strictBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}
