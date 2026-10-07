/**
 * CDT `ListCdtInternetTraffic` response parsing.
 *
 * Contract summary (see docs/aliyun-api-contract.md §B):
 *  - request takes only an optional `BusinessRegionId`; there is **no** period
 *    parameter and **no** pagination, so the accumulation window is chosen by
 *    the service and is unconfirmed;
 *  - `TrafficDetails` sits at the response **root** (the Go client also probes
 *    `Data.TrafficDetails`, which is kept for compatibility);
 *  - each entry has `BusinessRegionId` and an untyped numeric `Traffic`.
 *
 * The unit of `Traffic` is **not documented** (highest-priority open item), so
 * this module reports the raw value and labels the assumption rather than
 * quietly converting and calling it "GB".
 *
 * The Go client treated an empty `TrafficDetails` as an error and retried it.
 * That conflates "this account genuinely used no traffic" with "the response is
 * broken" — and a retry loop on a legitimate zero is wasted budget. Here the
 * two cases are distinct: `confirmedEmpty` vs `unrecognized`.
 */

import type { TrafficClass } from "../../domain/models.ts";
import { trafficClassOfRegion } from "../../domain/usage.ts";
import { asArray, asRecord, getPath, strictNonNegativeNumber, strictString } from "./parse.ts";

/** One `BusinessRegionId` → raw `Traffic` pair. */
export interface TrafficEntry {
  regionId: string;
  /** Raw `Traffic` value as reported by the API. */
  rawValue: number;
}

/** Result of parsing a CDT traffic response. */
export interface TrafficParseResult {
  entries: TrafficEntry[];
  /** `TrafficDetails` was present and empty: a genuine, confirmed zero. */
  confirmedEmpty: boolean;
  /** `TrafficDetails` was absent or structurally unreadable: value unknown. */
  unrecognized: boolean;
  /** Entries dropped because a field was missing or untrustworthy. */
  rejectedEntries: number;
  warnings: string[];
  /** Why the response was unrecognized, when it was. */
  reason: string | null;
}

/**
 * Parse a CDT traffic response.
 *
 * Never throws and never fabricates a total. An empty-but-present array is a
 * confirmed zero; a missing array is unknown.
 */
export function parseTrafficResponse(body: unknown): TrafficParseResult {
  const warnings: string[] = [];

  let raw = getPath(body, "TrafficDetails");
  if (raw === undefined) {
    // Compatibility with a `Data`-wrapped variant seen in the Go client.
    raw = getPath(body, "Data", "TrafficDetails");
  }

  if (raw === undefined) {
    return {
      entries: [],
      confirmedEmpty: false,
      unrecognized: true,
      rejectedEntries: 0,
      warnings,
      reason: "响应中缺少 TrafficDetails 字段，无法确认用量",
    };
  }

  const list = asArray(raw);
  if (list === null) {
    return {
      entries: [],
      confirmedEmpty: false,
      unrecognized: true,
      rejectedEntries: 0,
      warnings,
      reason: "TrafficDetails 的结构无法识别",
    };
  }

  if (list.length === 0) {
    // Present and empty. Per the contract this is the *confirmed zero* case,
    // but because §B5 is unverified the caller must not use it to lift a
    // protection latch.
    return {
      entries: [],
      confirmedEmpty: true,
      unrecognized: false,
      rejectedEntries: 0,
      warnings,
      reason: null,
    };
  }

  const entries: TrafficEntry[] = [];
  let rejectedEntries = 0;

  for (let index = 0; index < list.length; index++) {
    const item = asRecord(list[index]);
    if (item === null) {
      rejectedEntries++;
      warnings.push(`第 ${index + 1} 条流量明细不是对象，已忽略`);
      continue;
    }

    const regionId = strictString(item["BusinessRegionId"]);
    if (regionId === null) {
      // Without a region we cannot classify the entry as mainland/overseas.
      // Dropping it silently would understate usage, so it is counted as a
      // rejection and surfaced.
      rejectedEntries++;
      warnings.push(`第 ${index + 1} 条流量明细缺少 BusinessRegionId，已忽略`);
      continue;
    }

    const traffic = strictNonNegativeNumber(item["Traffic"]);
    if (!traffic.ok) {
      rejectedEntries++;
      warnings.push(
        `地区 ${regionId} 的 Traffic 字段无效（${traffic.reason}），已忽略`,
      );
      continue;
    }

    entries.push({ regionId, rawValue: traffic.value });
  }

  if (rejectedEntries > 0) {
    warnings.push(
      `共 ${rejectedEntries} 条明细无法解析；其用量未计入，因此结果可能偏低`,
    );
  }

  return {
    entries,
    confirmedEmpty: false,
    unrecognized: false,
    rejectedEntries,
    warnings,
    reason: null,
  };
}

/** Aggregated traffic for one traffic class. */
export interface TrafficAggregate {
  /** Sum of raw `Traffic` values across matching regions. */
  rawTotal: number;
  /** Regions that contributed. */
  regions: string[];
  /**
   * True when the source response contained entries that could not be parsed,
   * so `rawTotal` may understate usage.
   */
  partial: boolean;
}

/**
 * Sum raw values whose region maps to `trafficClass`.
 *
 * Regions are matched by the same rule as the Go client — `cn-*` except
 * `cn-hongkong` is mainland, everything else is overseas — and `siteType` is
 * deliberately not consulted, because account site and traffic class are
 * independent.
 */
export function aggregateTraffic(
  entries: readonly TrafficEntry[],
  trafficClass: TrafficClass,
  partial = false,
): TrafficAggregate {
  let rawTotal = 0;
  const regions: string[] = [];
  for (const entry of entries) {
    if (trafficClassOfRegion(entry.regionId) !== trafficClass) continue;
    rawTotal += entry.rawValue;
    regions.push(entry.regionId);
  }
  regions.sort();
  return { rawTotal, regions, partial };
}

/**
 * Unit assumption applied to the raw `Traffic` value.
 *
 * Recorded in the snapshot so the UI and history can say "接口累计" instead of
 * implying a verified GB figure.
 */
export const TRAFFIC_UNIT_ASSUMPTION = "bytes-unverified" as const;
