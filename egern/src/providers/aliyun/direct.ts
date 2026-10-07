/**
 * `DirectAliyunProvider` — talks to Aliyun directly with no server in between.
 *
 * Design notes:
 *
 *  - **One CDT request per credential per run.** `ListCdtInternetTraffic`
 *    returns every region's detail in a single response, so the mainland and
 *    overseas scopes of one account are served from one call rather than one
 *    call each. The memo lives on the instance, and the instance is built per
 *    collection run, so it can never serve stale data across runs.
 *  - **Observation time is real.** A successful call here genuinely observed the
 *    cloud just now, so `freshnessQuality` is `measured` — unlike the Go v1
 *    server API, whose timestamps are unverified. What is *not* verified is the
 *    accumulation **period**, which is why `periodId` stays `unverified`.
 *  - **Exact instance matching.** Status is resolved by `InstanceId`, never by
 *    response position.
 *  - **Bill pagination.** Every `NextToken` page is followed up to a cap; hitting
 *    the cap marks the total `partial` instead of claiming completeness.
 */

import type { ProviderMode } from "../../domain/models.ts";
import { UNVERIFIED_PERIOD } from "../../domain/models.ts";
import type { RpcDependencies, RpcResult } from "./rpc.ts";
import { callRpc } from "./rpc.ts";
import { aggregateTraffic, parseTrafficResponse, TRAFFIC_UNIT_ASSUMPTION } from "./traffic.ts";
import type { TrafficParseResult } from "./traffic.ts";
import { parseInstanceStatus } from "./ecs.ts";
import { parseBalance, parseBillPage, sumBillItems } from "./billing.ts";
import type {
  AccountQuery,
  BalanceReading,
  BillReading,
  InstanceQuery,
  InstanceStatusReading,
  ProviderCapabilities,
  ReadonlyCloudProvider,
  RequestScope,
  TrafficQuery,
  TrafficReading,
} from "../types.ts";
import { bssEndpointFor, ProviderError } from "../types.ts";

/** CDT service coordinates, confirmed from the official SDK. */
export const CDT_ENDPOINT = {
  host: "cdt.aliyuncs.com",
  regionId: "cn-hongkong",
  version: "2021-08-13",
  action: "ListCdtInternetTraffic",
} as const;

/** ECS service version. */
export const ECS_VERSION = "2014-05-26";

/** BSS service version. */
export const BSS_VERSION = "2017-12-14";

/** Default cap on bill pages per instance, to bound the time budget. */
export const DEFAULT_MAX_BILL_PAGES = 5;

export interface DirectProviderOptions extends RpcDependencies {
  /** Maximum `DescribeInstanceBill` pages to follow. */
  maxBillPages?: number;
}

export class DirectAliyunProvider implements ReadonlyCloudProvider {
  readonly mode: ProviderMode = "direct";
  readonly capabilities: ProviderCapabilities = {
    instanceStatus: true,
    billing: true,
    verifiedObservationTimes: true,
  };

  private readonly maxBillPages: number;
  /** Per-run memo of the parsed CDT response, keyed by credential. */
  private readonly trafficMemo = new Map<string, Promise<TrafficParseResult>>();

  private readonly deps: DirectProviderOptions;

  constructor(deps: DirectProviderOptions) {
    this.deps = deps;
    this.maxBillPages = Math.max(1, deps.maxBillPages ?? DEFAULT_MAX_BILL_PAGES);
  }

  /** Unwrap an RPC result or raise a sanitized provider error. */
  private static unwrap(result: RpcResult): Record<string, unknown> {
    if (result.ok) return result.body;
    throw new ProviderError(result.error);
  }

  /** Fetch (and memoize) the raw CDT traffic detail for one credential. */
  private getTrafficDetail(query: TrafficQuery): Promise<TrafficParseResult> {
    const key = query.credential.id;
    const existing = this.trafficMemo.get(key);
    if (existing !== undefined) return existing;

    const pending = (async (): Promise<TrafficParseResult> => {
      const result = await callRpc(this.deps, {
        credential: query.credential,
        host: CDT_ENDPOINT.host,
        version: CDT_ENDPOINT.version,
        action: CDT_ENDPOINT.action,
        regionId: CDT_ENDPOINT.regionId,
        // No period parameter exists for this action; none is invented.
        // `BusinessRegionId` is left unset, matching the original client.
        params: {},
        idempotent: true,
      });
      return parseTrafficResponse(DirectAliyunProvider.unwrap(result));
    })();

    this.trafficMemo.set(key, pending);
    return pending;
  }

  async getTraffic(scope: RequestScope, query: TrafficQuery): Promise<TrafficReading> {
    const detail = await this.getTrafficDetail(query);

    if (detail.unrecognized) {
      throw new ProviderError({
        code: "UnrecognizedTrafficResponse",
        message: detail.reason ?? "CDT 用量响应无法识别",
        at: scope.now().toISOString(),
        retryable: false,
      });
    }

    const aggregate = aggregateTraffic(
      detail.entries,
      query.scope.trafficClass,
      detail.rejectedEntries > 0,
    );

    const warnings = [...detail.warnings];
    // The unit of `Traffic` is not documented. Say so rather than implying a
    // verified byte figure.
    warnings.push("接口未声明 Traffic 单位，当前按字节处理（待核实）");

    return {
      usedBytes: aggregate.rawTotal,
      regions: aggregate.regions,
      partial: aggregate.partial,
      observedAt: scope.now().toISOString(),
      legacyUpdatedAt: null,
      periodId: UNVERIFIED_PERIOD,
      periodTimezone: null,
      sourceUnit: "bytes",
      freshnessQuality: "measured",
      // The CDT endpoint has no concept of a user quota, so nothing is offered.
      suggestedQuotaBytes: null,
      suggestedQuotaSource: null,
      warnings,
    };
  }

  async getInstanceStatus(
    scope: RequestScope,
    query: InstanceQuery,
  ): Promise<InstanceStatusReading> {
    const { instance, credential } = query;
    const result = await callRpc(this.deps, {
      credential,
      host: `ecs.${instance.regionId}.aliyuncs.com`,
      version: ECS_VERSION,
      action: "DescribeInstanceStatus",
      regionId: instance.regionId,
      params: {
        RegionId: instance.regionId,
        // Sent as the scalar form the original client uses in production; the
        // official SDK's repeat-list form (`InstanceId.1`) is an open item.
        // Either way the response is matched exactly by id below.
        InstanceId: instance.instanceId,
      },
      idempotent: true,
    });

    const parsed = parseInstanceStatus(
      DirectAliyunProvider.unwrap(result),
      instance.instanceId,
    );
    if (!parsed.matched) {
      throw new ProviderError({
        code: "InstanceNotMatched",
        message: parsed.reason ?? "响应中未找到目标实例",
        at: scope.now().toISOString(),
        retryable: false,
      });
    }
    if (parsed.status === "Unknown") {
      throw new ProviderError({
        code: "UnknownInstanceStatus",
        message: parsed.reason ?? "实例状态未知",
        at: scope.now().toISOString(),
        retryable: false,
      });
    }

    return {
      instanceId: instance.instanceId,
      status: parsed.status,
      observedAt: scope.now().toISOString(),
      legacyUpdatedAt: null,
    };
  }

  async getBalance(scope: RequestScope, query: AccountQuery): Promise<BalanceReading> {
    const endpoint = bssEndpointFor(query.credential.siteType);
    const result = await callRpc(this.deps, {
      credential: query.credential,
      host: endpoint.host,
      version: BSS_VERSION,
      action: "QueryAccountBalance",
      regionId: endpoint.regionId,
      params: {},
      idempotent: true,
    });

    const parsed = parseBalance(DirectAliyunProvider.unwrap(result));
    if (!parsed.ok) {
      throw new ProviderError({
        code: "BalanceParseError",
        message: parsed.reason,
        at: scope.now().toISOString(),
        retryable: false,
      });
    }
    return {
      amount: parsed.amount,
      currency: parsed.currency,
      observedAt: scope.now().toISOString(),
    };
  }

  async getInstanceBill(
    scope: RequestScope,
    query: InstanceQuery,
    cycle: string,
  ): Promise<BillReading> {
    const endpoint = bssEndpointFor(query.credential.siteType);
    const collected: Record<string, unknown>[] = [];
    let nextToken: string | null = null;
    let pages = 0;
    let stoppedEarly = false;
    let rejectedItems = 0;

    do {
      const params: Record<string, string> = {
        BillingCycle: cycle,
        // The contract spells this parameter `InstanceID` (capital ID).
        InstanceID: query.instance.instanceId,
        Granularity: "MONTHLY",
      };
      if (nextToken !== null) params["NextToken"] = nextToken;

      const result = await callRpc(this.deps, {
        credential: query.credential,
        host: endpoint.host,
        version: BSS_VERSION,
        action: "DescribeInstanceBill",
        regionId: endpoint.regionId,
        params,
        idempotent: true,
      });
      const page = parseBillPage(DirectAliyunProvider.unwrap(result));
      collected.push(...page.items);
      rejectedItems += page.rejectedItems;
      nextToken = page.nextToken;
      pages++;

      if (nextToken !== null && pages >= this.maxBillPages) {
        // Out of page budget: report what we have, but never as a full total.
        stoppedEarly = true;
        break;
      }
    } while (nextToken !== null);

    const total = sumBillItems(collected, { partial: stoppedEarly || rejectedItems > 0 });
    return {
      totalCost: total.total,
      currency: total.currencies.length === 1 ? (total.currencies[0] as string) : null,
      cycle,
      partial: total.partial,
      observedAt: scope.now().toISOString(),
    };
  }

  /** Expose the unit caveat for diagnostics. */
  get trafficUnitAssumption(): string {
    return TRAFFIC_UNIT_ASSUMPTION;
  }
}
