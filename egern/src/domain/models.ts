/**
 * Canonical domain model for the CDT Monitor Egern plugin.
 *
 * These types are this project's own business schema. They are **not** an Egern
 * native format — Egern only defines the script context and the Widget DSL.
 *
 * Identity layering follows the contract: an Aliyun **account**, a
 * **credential** (rotatable AK/STS material), a **traffic scope** (account +
 * mainland/overseas + verified statistical dimension, which owns exactly one
 * quota and cumulative value) and an **instance** (region + exact ECS
 * InstanceId). Several instances may share one scope; usage/quota/balance must
 * therefore be counted once per scope/account, never once per instance.
 */

/* -------------------------------------------------------------------------- */
/* Enumerations                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Which Aliyun CDT aggregation bucket a figure belongs to.
 *
 * Deliberately distinct from {@link SiteType}: "中国站/国际站" selects a BSS
 * endpoint and currency, whereas mainland/overseas selects the CDN traffic
 * classification. `cn-hongkong` is always `overseas`.
 */
export type TrafficClass = "mainland" | "overseas";

/** Aliyun account site. Chooses BSS endpoint and default currency. */
export type SiteType = "china" | "international";

/** Data source mode. */
export type ProviderMode = "direct" | "server";

/** Supported quota units. `GB` is decimal (10^9), `GiB` is binary (2^30). */
export type QuotaUnit = "GB" | "GiB";

/** Where a quota number came from. Shown to the user, never inferred. */
export type QuotaSource = "user" | "legacy";

/**
 * How a byte figure was produced.
 *  - `bytes`: the source reported bytes.
 *  - `legacyGiB`: imported from the Go API's GiB-denominated `flow_used`.
 */
export type SourceUnit = "bytes" | "legacyGiB";

/** ECS instance lifecycle states, plus our own "not observed" value. */
export type InstanceStatus =
  | "Running"
  | "Stopped"
  | "Starting"
  | "Stopping"
  | "Pending"
  | "Unknown";

/** Control intent states. */
export type ActionState =
  | "pending"
  | "accepted"
  | "confirmed"
  | "uncertain"
  | "failed";

/** Describes how much a field can be trusted. */
export type FreshnessQuality = "measured" | "legacy-unverified";

/** Period marker used until the provider's billing period is confirmed. */
export const UNVERIFIED_PERIOD = "unverified";

/* -------------------------------------------------------------------------- */
/* Sanitized errors                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A user-facing error that has already been stripped of request URLs,
 * signatures, access key material and raw response bodies.
 *
 * Never widen this with a raw upstream payload: snapshots are cached and may be
 * surfaced in a widget.
 */
export interface SanitizedError {
  /** Stable machine-readable code, e.g. `AccessDenied`. */
  code: string;
  /** Human-readable Chinese message, safe to render. */
  message: string;
  /** When the failing attempt happened (ISO 8601). */
  at: string;
  /** Whether a retry could plausibly succeed. */
  retryable: boolean;
}

/** An error tied to a specific entity. */
export interface EntityError extends SanitizedError {
  entityId: string;
}

/* -------------------------------------------------------------------------- */
/* Configuration model                                                        */
/* -------------------------------------------------------------------------- */

/** Rotatable authentication material. Never leaves the provider boundary. */
export interface Credential {
  id: string;
  accountId: string;
  accessKeyId: string;
  accessKeySecret: string;
  /** Present only for STS temporary credentials; must then also be signed. */
  securityToken?: string;
  siteType: SiteType;
}

/** An Aliyun account. Several credentials may resolve to one account. */
export interface AccountConfig {
  id: string;
  name: string;
  /** Aliyun UID when known. Unknown identity must not be summed as if grouped. */
  aliyunUid: string | null;
}

/** User-declared quota for one traffic scope. */
export interface QuotaConfig {
  value: number;
  unit: QuotaUnit;
  source: QuotaSource;
}

/** A billing/usage scope: account + traffic class + verified dimension. */
export interface TrafficScopeConfig {
  id: string;
  accountId: string;
  credentialId: string;
  trafficClass: TrafficClass;
  quota: QuotaConfig | null;
  thresholdPercent: number;
  controlTargets: string[];
}

/** Instance-level schedule, disabled unless explicitly enabled. */
export interface InstanceScheduleConfig {
  enabled: boolean;
  /** `HH:mm`, 24-hour. `24:00` normalises to `00:00`. */
  start: string;
  /** `HH:mm`, 24-hour. */
  stop: string;
}

/** An ECS instance. */
export interface InstanceConfig {
  id: string;
  accountId: string;
  credentialId: string;
  trafficScopeId: string;
  regionId: string;
  instanceId: string;
  name: string;
  keepAlive: boolean;
  shutdownMode: ShutdownMode;
  schedule: InstanceScheduleConfig;
}

/** Stop mode. `KeepCharging` is the default. */
export type ShutdownMode = "KeepCharging" | "StopCharging";

/** Which action a scope's threshold triggers. */
export type ThresholdAction = "notify_only" | "stop_and_notify";

/** Per-scope control policy. Everything here is opt-in. */
export interface ScopeControlPolicy {
  scopeId: string;
  thresholdAction: ThresholdAction;
  thresholdStopEnabled: boolean;
}

/** Per-instance control policy. Everything here is opt-in. */
export interface InstanceControlPolicy {
  instanceId: string;
  scheduleControlEnabled: boolean;
  keepAlive: boolean;
  shutdownMode: ShutdownMode;
}

/**
 * A user's explicit, self-attested record that the two preconditions for local
 * instance control were verified **on a real device**.
 *
 * This is an attestation, not proof: nothing offline can verify it. It is
 * therefore its own named field, so that enabling a cloud write is always a
 * conscious act with a recorded date — never an incidental side effect of
 * flipping something unrelated. Both flags default to `false`, and neither the
 * module nor the code ever sets them.
 */
export interface DeviceVerificationAttestation {
  /**
   * The user verified that a one-shot intent's "consumed" marker survives
   * across separate script executions.
   */
  crossExecutionIntentClaim: boolean;
  /**
   * The user verified that the host reliably serialises runs targeting the same
   * instance (or that the cloud action is genuinely idempotent).
   */
  hostSerializesSameTarget: boolean;
  /** When the verification was performed. Required once either flag is true. */
  verifiedAt: string | null;
  /** What was observed (device, Egern version, result). For the audit trail. */
  note: string | null;
}

/** A device-verification record that asserts nothing. */
export function unverifiedDevice(): DeviceVerificationAttestation {
  return {
    crossExecutionIntentClaim: false,
    hostSerializesSameTarget: false,
    verifiedAt: null,
    note: null,
  };
}

/**
 * Separate control configuration. Only the control/automation entries read
 * this; widget and refresh must ignore it entirely.
 */
export interface ControlConfig {
  schemaVersion: number;
  /** Master switch. Absent configuration means disabled. */
  enabled: boolean;
  /** Self-attested device verification. Both flags required before any write. */
  deviceVerification: DeviceVerificationAttestation;
  /** Credential explicitly chosen for write operations. */
  credentialId: string | null;
  /** Explicit instance allow-list. Empty means "no target". */
  allowedInstanceIds: string[];
  scopes: ScopeControlPolicy[];
  instances: InstanceControlPolicy[];
  actionCooldownSeconds: number;
  /** While set, keep-alive is suppressed so a manual stop is not undone. */
  pauseUntil: string | null;
}

/** A one-shot, human-authored control intent. */
export interface ControlIntent {
  schemaVersion: number;
  /** Unique per authored intent; not re-usable. */
  nonce: string;
  accountId: string;
  regionId: string;
  instanceId: string;
  action: "start" | "stop";
  shutdownMode: ShutdownMode;
  issuedAt: string;
  expiresAt: string;
  /** Free-text note for the audit trail. */
  note?: string;
}

/** Notification channel selection. Secrets never appear here. */
export interface NotificationChannelConfig {
  enabled: boolean;
}

export interface TelegramChannelConfig extends NotificationChannelConfig {
  /** Injected from env only; never stored in a snapshot. */
  botToken: string;
  chatId: string;
}

export interface WebhookChannelConfig extends NotificationChannelConfig {
  url: string;
  method: "POST" | "PUT";
  /** JSON template with `{{{event.field}}}` placeholders. */
  bodyTemplate: string;
}

export interface DailyReportConfig {
  enabled: boolean;
  /** `HH:mm` in the business timezone. */
  time: string;
  /** Window (minutes) after `time` during which a missed run may still fire. */
  compensationWindowMinutes: number;
}

export interface NotificationConfig {
  schemaVersion: number;
  local: boolean;
  telegram: TelegramChannelConfig;
  webhook: WebhookChannelConfig;
  dailyReport: DailyReportConfig;
}

/** Fully validated runtime configuration. */
export interface AppConfig {
  mode: ProviderMode;
  namespace: string;
  accountLabel: string;
  displayName: string;
  timezone: string;
  debug: boolean;
  refreshSeconds: number;
  /**
   * Minimum spacing between automation checks, enforced in-script before any
   * network call. See DEFAULT_AUTOMATION_INTERVAL_SECONDS.
   */
  automationIntervalSeconds: number;
  billingEnabled: boolean;
  localNotify: boolean;
  credentials: Credential[];
  accounts: AccountConfig[];
  trafficScopes: TrafficScopeConfig[];
  instances: InstanceConfig[];
  control: ControlConfig;
  notifications: NotificationConfig;
  server: ServerEndpoint | null;
  /** View selection, from widget env only. Never a control target selector. */
  view: ViewSelection;
  /** Stable fingerprint of identity-affecting configuration. */
  configFingerprint: string;
}

/** Optional server data source endpoint. */
export interface ServerEndpoint {
  baseUrl: string;
  token: string;
  /** True only for explicit local development over HTTP. */
  allowInsecureHttp: boolean;
}

/** Widget-scoped view selection. */
export interface ViewSelection {
  scopeId: string | null;
  instanceIds: string[] | null;
  theme: string | null;
}

/* -------------------------------------------------------------------------- */
/* Snapshot model                                                             */
/* -------------------------------------------------------------------------- */

/** Account-level figures. */
export interface AccountSnapshot {
  id: string;
  name: string;
  balance: number | null;
  currency: string | null;
  balanceObservedAt: string | null;
  balanceError: SanitizedError | null;
}

/** Traffic-scope figures. All `*Bytes` values are raw bytes. */
export interface TrafficScopeSnapshot {
  id: string;
  accountId: string;
  trafficClass: TrafficClass;
  /** Provider-side identifier of the aggregation dimension, if any. */
  sourceScope: string;
  /** Billing/accumulation period, or {@link UNVERIFIED_PERIOD}. */
  periodId: string;
  periodTimezone: string | null;
  usedBytes: number | null;
  quotaBytes: number | null;
  quotaSource: QuotaSource | null;
  sourceUnit: SourceUnit;
  trafficObservedAt: string | null;
  trafficAttemptedAt: string | null;
  /**
   * The Go v1 API's `updated_at` / `last_updated`.
   *
   * This value is written when a monitor job is *enqueued* and is also touched
   * by control actions and by successful status queries, so it is **not** a
   * cloud sampling time. It is kept here only so the UI can say "服务器记录更新
   * 于…" with an explicit staleness caveat, and it must never justify a local
   * automatic control decision.
   */
  legacyUpdatedAt: string | null;
  trafficError: SanitizedError | null;
  /** True when a definitional uncertainty makes the figure untrustworthy. */
  stale: boolean;
  /**
   * How the traffic figure was obtained. `legacy-unverified` means the value
   * came from the Go v1 API, whose timestamps and period are not real
   * observation times and must not justify an automatic control action.
   */
  freshnessQuality: FreshnessQuality;
  remainingBytes: number | null;
  usagePercent: number | null;
  overThreshold: boolean | null;
  thresholdPercent: number;
}

/** Instance-level figures. */
export interface InstanceSnapshot {
  id: string;
  accountId: string;
  trafficScopeId: string;
  regionId: string;
  instanceId: string;
  name: string;
  status: InstanceStatus;
  statusObservedAt: string | null;
  /** The Go v1 API's shared `updated_at`; see the note on the traffic scope. */
  legacyUpdatedAt: string | null;
  statusError: SanitizedError | null;
  monthlyCost: number | null;
  currency: string | null;
  billingCycle: string | null;
  billingObservedAt: string | null;
  billingError: SanitizedError | null;
  lastAction: string | null;
  actionRequestedAt: string | null;
  actionState: ActionState | null;
}

/**
 * A normalized, cacheable snapshot.
 *
 * Every `*ObservedAt` is only advanced after the corresponding API call
 * succeeded and was confirmed to carry the expected data. A successful render,
 * an accepted control request or a partial API success must never mark
 * unrelated fields fresh.
 */
export interface Snapshot {
  schemaVersion: number;
  namespace: string;
  configFingerprint: string;
  provider: ProviderMode;
  generatedAt: string;
  accounts: AccountSnapshot[];
  trafficScopes: TrafficScopeSnapshot[];
  instances: InstanceSnapshot[];
  errors: EntityError[];
}

/** Current snapshot schema version. */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* History model                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A stored cumulative-usage sample.
 *
 * The stores hold **samples of the provider's cumulative counter**, not
 * per-interval consumption. `observedAt` is the real observation time; `bucket`
 * is the coarse bucket start and is *not* the sample time.
 */
export interface HistorySample {
  /** Bucket start (ISO 8601), used for overwrite-in-place semantics. */
  bucket: string;
  /** Actual time the value was observed (ISO 8601). */
  observedAt: string;
  bytes: number;
  source: ProviderMode;
  periodId: string;
  quality: FreshnessQuality;
}

/** History store for one scope. */
export interface ScopeHistory {
  scopeId: string;
  hourly: HistorySample[];
  daily: HistorySample[];
}

/** Maximum retained samples per scope. Engineering budget, not a platform limit. */
export const MAX_HOURLY_SAMPLES = 48;
export const MAX_DAILY_SAMPLES = 35;
