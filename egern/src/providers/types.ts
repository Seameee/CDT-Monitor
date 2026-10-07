/**
 * Read-only cloud provider abstraction.
 *
 * The collector depends on this interface, never on a concrete provider, so the
 * whole data path can be exercised offline against recorded fixtures. Writes are
 * deliberately **absent** from this interface: instance start/stop lives behind
 * a separate control provider that the widget and refresh entry points cannot
 * import (enforced by tests/bundle-boundary checks).
 */

import type {
  AccountConfig,
  Credential,
  FreshnessQuality,
  InstanceConfig,
  InstanceStatus,
  ProviderMode,
  SanitizedError,
  SourceUnit,
  TrafficScopeConfig,
} from "../domain/models.ts";

/** Per-collection budget shared by every provider call. */
export interface RequestScope {
  /** Absolute epoch-ms deadline for the current entry point. */
  deadlineMs: number;
  /** Milliseconds left before the deadline (never negative). */
  remainingMs(): number;
  /** Clock, so providers never call `Date.now()` directly. */
  now(): Date;
}

/** A provider failure carrying only sanitized information. */
export class ProviderError extends Error {
  readonly sanitized: SanitizedError;

  constructor(sanitized: SanitizedError) {
    super(sanitized.message);
    this.sanitized = sanitized;
    this.name = "ProviderError";
  }

  get code(): string {
    return this.sanitized.code;
  }

  get retryable(): boolean {
    return this.sanitized.retryable;
  }
}

/** Traffic reading for one scope. */
export interface TrafficReading {
  /**
   * Usage in bytes. For the direct provider this is the raw `Traffic` value
   * under an explicitly unverified unit assumption; for the server provider it
   * is converted from the legacy GiB figures and tagged `legacyGiB`.
   */
  usedBytes: number;
  /** Region ids that contributed, for diagnostics. */
  regions: string[];
  /** True when part of the response could not be parsed. */
  partial: boolean;
  /**
   * Real cloud observation time, or null when the source cannot provide one.
   * The Go v1 server API cannot; its `updated_at` goes to `legacyUpdatedAt`.
   */
  observedAt: string | null;
  /** Untrusted legacy timestamp from the Go v1 API, when applicable. */
  legacyUpdatedAt: string | null;
  periodId: string;
  periodTimezone: string | null;
  sourceUnit: SourceUnit;
  freshnessQuality: FreshnessQuality;
  /**
   * Quota the provider itself can supply, in bytes, when the user has not
   * configured one. The Go v1 API returns `flow_total`, so server mode can
   * offer it; the direct CDT endpoint has no notion of a user quota, so it is
   * always null there.
   */
  suggestedQuotaBytes: number | null;
  /** Provenance of {@link suggestedQuotaBytes}. */
  suggestedQuotaSource: "user" | "legacy" | null;
  warnings: string[];
}

/** Status reading for one instance. */
export interface InstanceStatusReading {
  instanceId: string;
  status: InstanceStatus;
  /** Real cloud observation time, or null for the Go v1 API. */
  observedAt: string | null;
  /** Untrusted legacy timestamp from the Go v1 API, when applicable. */
  legacyUpdatedAt: string | null;
}

/** Balance reading for one account. */
export interface BalanceReading {
  amount: number;
  currency: string;
  observedAt: string;
}

/** Instance bill reading for one instance and cycle. */
export interface BillReading {
  totalCost: number;
  currency: string | null;
  cycle: string;
  /** True when pagination stopped early or some items were unreadable. */
  partial: boolean;
  observedAt: string;
}

/** What a provider can actually do, so the UI can hide absent features. */
export interface ProviderCapabilities {
  instanceStatus: boolean;
  billing: boolean;
  /**
   * True when the provider can report a real cloud observation time.
   * The Go v1 server API cannot; see docs/compatibility.md.
   */
  verifiedObservationTimes: boolean;
}

/** Read-only data source. */
export interface ReadonlyCloudProvider {
  readonly mode: ProviderMode;
  readonly capabilities: ProviderCapabilities;
  getTraffic(scope: RequestScope, query: TrafficQuery): Promise<TrafficReading>;
  getInstanceStatus(
    scope: RequestScope,
    query: InstanceQuery,
  ): Promise<InstanceStatusReading>;
  getBalance(scope: RequestScope, account: AccountQuery): Promise<BalanceReading>;
  getInstanceBill(
    scope: RequestScope,
    query: InstanceQuery,
    cycle: string,
  ): Promise<BillReading>;
}

/** Traffic query inputs. */
export interface TrafficQuery {
  scope: TrafficScopeConfig;
  credential: Credential;
}

/** Instance query inputs. */
export interface InstanceQuery {
  instance: InstanceConfig;
  credential: Credential;
}

/** Account query inputs. */
export interface AccountQuery {
  account: AccountConfig;
  credential: Credential;
}

/** Base URL for the BSS service, by account site. */
export function bssEndpointFor(siteType: "china" | "international"): {
  host: string;
  regionId: string;
} {
  if (siteType === "international") {
    return { host: "business.ap-southeast-1.aliyuncs.com", regionId: "ap-southeast-1" };
  }
  return { host: "business.aliyuncs.com", regionId: "cn-hangzhou" };
}
