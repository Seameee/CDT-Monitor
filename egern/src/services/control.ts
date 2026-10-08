/**
 * Control execution — the only place in this project that can change cloud state.
 *
 * **This module is intentionally not reachable from the read path.** The widget,
 * refresh, history and diagnostics entries never import it, and
 * `scripts/check-bundles.mjs` fails the build if a read bundle starts to.
 *
 * Why control ships disabled by default
 * -------------------------------------
 * The contract requires three things before a one-shot local control intent may
 * be executed (§10.2):
 *   1. the intent's consumption state must be provably persisted **across
 *      executions**;
 *   2. concurrent runs against the same target must be reliably serialised, or
 *      atomically claimed, or the API must be idempotent for that action;
 *   3. both must be demonstrated on a real device.
 *
 * Egern documents no transactions, no compare-and-swap, no lock and no
 * enumeration for `ctx.storage`, and no host-level serialisation guarantee.
 * A "read then write a flag" pair is explicitly **not** sufficient evidence.
 *
 * None of that can be established offline, so the honest engineering answer is
 * the contract's own fallback: local start/stop stays **closed**, and the user
 * is given a working console path instead. The authorization logic below is
 * fully implemented and unit-tested so that (a) it provably yields zero actions
 * when unauthorized, and (b) if the two conditions are ever verified on a
 * device, enabling it is a small, well-tested change rather than a rewrite.
 */

import type {
  ActionState,
  AppConfig,
  ControlIntent,
  Credential,
  InstanceConfig,
  InstanceSnapshot,
  SanitizedError,
  ShutdownMode,
  Snapshot,
} from "../domain/models.ts";
import { validateControlIntent } from "../domain/policy.ts";
import type { RequestScope } from "../providers/types.ts";
import type { Cache } from "./cache.ts";

/**
 * Evidence required before any local write may run.
 *
 * Both flags default to `false` and are only ever set after a recorded device
 * test (see docs/compatibility.md). There is deliberately no env variable that
 * flips them: a user cannot enable an unsafe write path by editing YAML.
 */
export interface ControlCapability {
  /** Consumption state survives across separate script executions. */
  crossExecutionIntentClaim: boolean;
  /** The host reliably serialises runs targeting the same instance. */
  hostSerializesSameTarget: boolean;
}

/** The default, safe capability state: attests nothing. */
export const NO_CONTROL_CAPABILITY: ControlCapability = {
  crossExecutionIntentClaim: false,
  hostSerializesSameTarget: false,
};

/**
 * Derive the capability from the user's explicit attestation.
 *
 * This is the **only** place a write capability can be granted, and it can only
 * ever be granted by configuration the user wrote themselves. Neither the module
 * templates nor any code path pre-fills it. If either precondition is missing,
 * the result is a closed gate.
 */
export function capabilityFromConfig(config: AppConfig): ControlCapability {
  const attestation = config.control.deviceVerification;
  return {
    crossExecutionIntentClaim: attestation.crossExecutionIntentClaim === true,
    hostSerializesSameTarget: attestation.hostSerializesSameTarget === true,
  };
}

/** True when the user has attested both preconditions. */
export function isControlVerified(config: AppConfig): boolean {
  const capability = capabilityFromConfig(config);
  return capability.crossExecutionIntentClaim && capability.hostSerializesSameTarget;
}

/** Describe the capability state for diagnostics and audit output. */
export function describeCapability(config: AppConfig): string {
  const attestation = config.control.deviceVerification;
  const capability = capabilityFromConfig(config);
  if (capability.crossExecutionIntentClaim && capability.hostSerializesSameTarget) {
    return `已声明通过真机验证（${attestation.verifiedAt ?? "未注明时间"}）`;
  }
  const missing: string[] = [];
  if (!capability.crossExecutionIntentClaim) missing.push("跨执行意图持久化");
  if (!capability.hostSerializesSameTarget) missing.push("同目标串行执行");
  return `未验证（缺少：${missing.join("、")}）`;
}

/** Write operations, kept separate from the read-only provider interface. */
export interface ControlProvider {
  startInstance(
    scope: RequestScope,
    instance: InstanceConfig,
    credential: Credential,
  ): Promise<void>;
  stopInstance(
    scope: RequestScope,
    instance: InstanceConfig,
    credential: Credential,
    shutdownMode: ShutdownMode,
  ): Promise<void>;
}

/** Result of an attempted control action. */
export interface ControlOutcome {
  /** Whether a cloud write was actually issued. */
  executed: boolean;
  /** Final action state. */
  state: ActionState;
  /** Stable code describing the result. */
  code: string;
  /** User-facing explanation, always populated. */
  message: string;
  /** True when the outcome is unknown and must be re-queried, not retried. */
  requiresStateCheck: boolean;
  /** Sanitized error, when the action failed. */
  error: SanitizedError | null;
}

/** Everything needed to attempt one intent. */
export interface ExecuteIntentOptions {
  intent: ControlIntent;
  snapshot: Snapshot;
  config: AppConfig;
  cache: Cache;
  provider: ControlProvider | null;
  capability: ControlCapability;
  scope: RequestScope;
  now: Date;
}

/** Read the recorded consumption state of an intent nonce. */
export function isIntentConsumed(cache: Cache, nonce: string): boolean {
  return cache.read<boolean>(nonce, "intent-consumed", (value) => value === true) === true;
}

/**
 * Attempt a one-shot manual control intent.
 *
 * Returns an outcome for every path, including refusals, so the caller can
 * always show the user *why* nothing happened. Never throws.
 */
export async function executeControlIntent(
  options: ExecuteIntentOptions,
): Promise<ControlOutcome> {
  const { intent, snapshot, config, cache, provider, capability, scope, now } = options;

  // 1. Capability gate. Without device-verified atomicity and serialisation,
  //    local writes stay closed and we degrade to console navigation.
  if (!capability.crossExecutionIntentClaim || !capability.hostSerializesSameTarget) {
    if (provider === null) {
      return {
        executed: false,
        state: "failed",
        code: "ControlUnavailable",
        message: "本机未验证可安全执行本地控制，请使用云控制台或后端确认页面",
        requiresStateCheck: false,
        error: null,
      };
    }
    return {
      executed: false,
      state: "failed",
      code: "CapabilityUnproven",
      message:
        "尚未在真机验证“一次性意图跨执行持久化”与“同目标串行执行”，按契约本地控制保持关闭",
      requiresStateCheck: false,
      error: null,
    };
  }

  // 2. Authorization. Every refusal is explicit.
  const validation = validateControlIntent(
    intent,
    snapshot,
    config,
    now,
    isIntentConsumed(cache, intent.nonce),
  );
  if (!validation.ok || validation.instance === null) {
    return {
      executed: false,
      state: "failed",
      code: validation.code,
      message: validation.reason,
      requiresStateCheck: false,
      error: null,
    };
  }

  const instanceSnapshot: InstanceSnapshot = validation.instance;
  const instanceConfig = config.instances.find((item) => item.id === instanceSnapshot.id);
  if (instanceConfig === undefined) {
    return {
      executed: false,
      state: "failed",
      code: "TargetMismatch",
      message: "控制目标与当前配置不匹配",
      requiresStateCheck: false,
      error: null,
    };
  }
  const credential = config.credentials.find((item) => item.id === instanceConfig.credentialId);
  if (credential === undefined || provider === null) {
    return {
      executed: false,
      state: "failed",
      code: "MissingCredential",
      message: "缺少可用的控制凭据",
      requiresStateCheck: false,
      error: null,
    };
  }

  // 3. Claim the nonce BEFORE the write, so an interrupted run leaves an
  //    `uncertain` marker rather than a repeatable intent.
  cache.write(intent.nonce, "intent-consumed", true, now);

  try {
    if (intent.action === "start") {
      await provider.startInstance(scope, instanceConfig, credential);
    } else {
      await provider.stopInstance(scope, instanceConfig, credential, intent.shutdownMode);
    }
    // Acceptance is not completion: the instance is only confirmed once a later
    // status query observes the final state.
    return {
      executed: true,
      state: "accepted",
      code: "Accepted",
      message:
        intent.action === "start"
          ? "启动指令已被云接口受理，正在启动中"
          : "停止指令已被云接口受理，正在停止中",
      requiresStateCheck: true,
      error: null,
    };
  } catch (caught) {
    const sanitized = toControlError(caught, now);
    // A timeout or transport failure leaves the true state unknown. Do not
    // retry: query the instance instead.
    const uncertain = sanitized.retryable || sanitized.code === "NetworkError";
    return {
      executed: true,
      state: uncertain ? "uncertain" : "failed",
      code: sanitized.code,
      message: uncertain
        ? "控制请求结果不确定，请稍后查询实例状态后再决定"
        : sanitized.message,
      requiresStateCheck: true,
      error: sanitized,
    };
  }
}

function toControlError(caught: unknown, now: Date): SanitizedError {
  if (caught !== null && typeof caught === "object" && "sanitized" in caught) {
    return (caught as { sanitized: SanitizedError }).sanitized;
  }
  return {
    code: "UnexpectedError",
    message: "控制请求发生了未预期的错误",
    at: now.toISOString(),
    retryable: false,
  };
}

/** A console entry the user can act on when local control is unavailable. */
export interface ConsoleGuidance {
  url: string;
  title: string;
  steps: string[];
}

/**
 * The working fallback required when local control is closed.
 *
 * The URL is a plain console page: GET-only, no key, no action, so opening it
 * can never itself change an instance's state.
 */
export function buildConsoleGuidance(config: AppConfig): ConsoleGuidance {
  const steps = [
    "打开阿里云 ECS 控制台，进入「实例」列表",
    "找到目标实例，确认当前状态与流量情况",
    "在控制台完成启动或停止，并按需选择普通停机/节省停机",
  ];
  if (config.mode === "server" && config.server !== null) {
    steps.push(`也可使用自建控制台：${config.server.baseUrl}`);
  } else {
    steps.push("停止模式说明：普通停机继续计费；节省停机可能释放计算资源与公网 IP");
  }
  return {
    url: "https://ecs.console.aliyun.com/",
    title: "通过云控制台执行实例操作",
    steps,
  };
}
