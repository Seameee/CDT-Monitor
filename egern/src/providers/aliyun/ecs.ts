/**
 * ECS `DescribeInstanceStatus` parsing.
 *
 * The single most important property here: **never trust position**.
 *
 * The original Go client read `InstanceStatuses.InstanceStatus[0].Status`
 * (`internal/aliyun/client.go:106-118`). `DescribeInstanceStatus` returns the
 * region's instances and pages at 10 by default, so that code can report a
 * completely different instance's state as the target's — including reporting
 * "Running" for an instance that is actually stopped, which would silently
 * defeat keep-alive and threshold protection.
 *
 * Here the target is located by exact `InstanceId` match. If it is absent, the
 * result is `Unknown` with a reason, never a guess. `Unknown` is kept strictly
 * distinct from `Stopped`, because "we could not look" must never be treated as
 * "it is off".
 */

import type { InstanceStatus } from "../../domain/models.ts";
import { asArray, asRecord, getPath, strictString } from "./parse.ts";

/** Recognised ECS lifecycle states. */
const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  "Pending",
  "Starting",
  "Running",
  "Stopping",
  "Stopped",
]);

/** Result of locating one instance in a status response. */
export interface InstanceStatusParseResult {
  status: InstanceStatus;
  /** True when the exact target instance was present in the response. */
  matched: boolean;
  /** How many entries the response contained, for diagnostics. */
  inspectedCount: number;
  /** Why the status is not trustworthy, when applicable. */
  reason: string | null;
}

/** Normalise an arbitrary status string to the known enum. */
export function normalizeInstanceStatus(value: string | null): InstanceStatus {
  if (value !== null && KNOWN_STATUSES.has(value)) {
    return value as InstanceStatus;
  }
  return "Unknown";
}

/**
 * Find the exact target instance and return its status.
 *
 * Matching is exact after trimming. A response that omits the instance — for
 * example because a region-wide page did not reach it — yields `Unknown`, so
 * the caller keeps the previous known state and surfaces an error instead of
 * acting on someone else's instance.
 */
export function parseInstanceStatus(
  body: unknown,
  targetInstanceId: string,
): InstanceStatusParseResult {
  const list = asArray(getPath(body, "InstanceStatuses", "InstanceStatus"));
  if (list === null) {
    return {
      status: "Unknown",
      matched: false,
      inspectedCount: 0,
      reason: "响应中未包含实例状态列表",
    };
  }
  if (list.length === 0) {
    return {
      status: "Unknown",
      matched: false,
      inspectedCount: 0,
      reason: "响应中的实例状态列表为空",
    };
  }

  const target = targetInstanceId.trim();
  for (const item of list) {
    const record = asRecord(item);
    if (record === null) continue;
    const instanceId = strictString(record["InstanceId"]);
    if (instanceId === null || instanceId !== target) continue;

    const rawStatus = strictString(record["Status"]);
    const status = normalizeInstanceStatus(rawStatus);
    if (rawStatus !== null && status === "Unknown") {
      return {
        status: "Unknown",
        matched: true,
        inspectedCount: list.length,
        reason: `接口返回了无法识别的实例状态：${rawStatus}`,
      };
    }
    if (rawStatus === null) {
      return {
        status: "Unknown",
        matched: true,
        inspectedCount: list.length,
        reason: "接口未返回实例状态字段",
      };
    }
    return { status, matched: true, inspectedCount: list.length, reason: null };
  }

  return {
    status: "Unknown",
    matched: false,
    inspectedCount: list.length,
    // Returning the first entry here would be the original bug. Refuse instead.
    reason: `响应中的 ${list.length} 条记录均不等于目标实例 ${target}`,
  };
}
