/**
 * A user-visible record of the most recent automation run.
 *
 * Why this exists: the automation entry is a *schedule* script, so it has no UI.
 * Without this record, enabling keep-alive gives the user nothing to look at —
 * they cannot tell whether the script ran at all, what it decided, or why it
 * declined to act. That makes the feature effectively untestable, and makes a
 * silent failure indistinguishable from "iOS simply has not woken it yet".
 *
 * The record is deliberately small and contains no secrets: instance ids are
 * identifiers the user already configured, and every message is one this project
 * generated.
 *
 * Caveat: reading this back from *another* script (the diagnostics entry)
 * depends on cross-context storage sharing, which Egern does not document. The
 * notification sent alongside each action is the reliable signal; this record is
 * the convenient one.
 */

import type { Cache } from "./cache.ts";

/** One policy decision taken during a run. */
export interface RunLogDecision {
  kind: string;
  instanceId: string | null;
  scopeId: string | null;
  reason: string;
}

/** One action that was withheld, with the reason. */
export interface RunLogBlock {
  entityId: string;
  code: string;
  reason: string;
}

/** One action that was attempted (or withheld by the capability gate). */
export interface RunLogWrite {
  instanceId: string | null;
  action: string;
  /** Stable outcome code, e.g. `Accepted`, `Withheld`, `NetworkError`. */
  code: string;
  message: string;
}

/** Summary of one automation run. */
export interface RunLogEntry {
  /** ISO 8601 instant the run started. */
  at: string;
  /**
   * `dry-run` when both device-verification preconditions are absent, meaning
   * nothing was written to the cloud no matter what the policy decided.
   */
  mode: "dry-run" | "live";
  scopeCount: number;
  instanceCount: number;
  decisions: RunLogDecision[];
  blocked: RunLogBlock[];
  writes: RunLogWrite[];
}

/** Entity id the run log is stored under. */
export const RUN_LOG_ENTITY = "automation";

/** Bounds so a pathological configuration cannot grow the record without limit. */
const MAX_DECISIONS = 4;
const MAX_BLOCKS = 4;
const MAX_WRITES = 4;

/** Persist a run summary, trimming the lists to their bounds. */
export function writeRunLog(cache: Cache, entry: RunLogEntry, now: Date): void {
  cache.write(
    RUN_LOG_ENTITY,
    "run-log",
    {
      at: entry.at,
      mode: entry.mode,
      scopeCount: entry.scopeCount,
      instanceCount: entry.instanceCount,
      decisions: entry.decisions.slice(0, MAX_DECISIONS),
      blocked: entry.blocked.slice(0, MAX_BLOCKS),
      writes: entry.writes.slice(0, MAX_WRITES),
    },
    now,
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Validate a stored run log; returns null when unusable. */
export function validateRunLog(value: unknown): RunLogEntry | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record["at"] !== "string") return null;
  const mode = record["mode"];
  if (mode !== "dry-run" && mode !== "live") return null;
  if (typeof record["scopeCount"] !== "number" || typeof record["instanceCount"] !== "number") {
    return null;
  }

  const decisions: RunLogDecision[] = [];
  if (Array.isArray(record["decisions"])) {
    for (const item of record["decisions"] as unknown[]) {
      if (item === null || typeof item !== "object") return null;
      const entry = item as Record<string, unknown>;
      if (typeof entry["kind"] !== "string" || typeof entry["reason"] !== "string") return null;
      decisions.push({
        kind: entry["kind"],
        instanceId: typeof entry["instanceId"] === "string" ? entry["instanceId"] : null,
        scopeId: typeof entry["scopeId"] === "string" ? entry["scopeId"] : null,
        reason: entry["reason"],
      });
    }
  }

  const blocked: RunLogBlock[] = [];
  if (Array.isArray(record["blocked"])) {
    for (const item of record["blocked"] as unknown[]) {
      if (item === null || typeof item !== "object") return null;
      const entry = item as Record<string, unknown>;
      if (
        typeof entry["entityId"] !== "string" ||
        typeof entry["code"] !== "string" ||
        typeof entry["reason"] !== "string"
      ) {
        return null;
      }
      blocked.push({
        entityId: entry["entityId"],
        code: entry["code"],
        reason: entry["reason"],
      });
    }
  }

  const writes: RunLogWrite[] = [];
  if (Array.isArray(record["writes"])) {
    for (const item of record["writes"] as unknown[]) {
      if (item === null || typeof item !== "object") return null;
      const entry = item as Record<string, unknown>;
      if (typeof entry["action"] !== "string" || typeof entry["code"] !== "string") return null;
      if (typeof entry["message"] !== "string") return null;
      writes.push({
        instanceId: typeof entry["instanceId"] === "string" ? entry["instanceId"] : null,
        action: entry["action"],
        code: entry["code"],
        message: entry["message"],
      });
    }
  }

  void isStringArray;
  return {
    at: record["at"],
    mode,
    scopeCount: record["scopeCount"],
    instanceCount: record["instanceCount"],
    decisions,
    blocked,
    writes,
  };
}

/** Read the last run summary, or null when none is visible. */
export function readRunLog(cache: Cache): RunLogEntry | null {
  return cache.read(RUN_LOG_ENTITY, "run-log", validateRunLog);
}
