/**
 * Aliyun write operations for ECS instances.
 *
 * Kept in its own module, separate from `direct.ts`, so that a read-only bundle
 * physically cannot contain a cloud write executor. `scripts/check-bundles.mjs`
 * asserts that `cdt-widget.js`, `cdt-refresh.js` and `cdt-diagnostics.js` do not
 * reference the action names below.
 *
 * Both operations are marked **non-idempotent**, so `callRpc` will not retry
 * them. Externally the contract documents start/stop as asynchronous: acceptance
 * means the instance is *transitioning*, not that it has reached the requested
 * state. Confirmation comes from a later `DescribeInstanceStatus` read.
 */

import type { Credential, InstanceConfig, ShutdownMode } from "../../domain/models.ts";
import type { RequestScope } from "../types.ts";
import { ProviderError } from "../types.ts";
import type { ControlProvider } from "../../services/control.ts";
import { callRpc } from "./rpc.ts";
import type { RpcDependencies } from "./rpc.ts";
import { ECS_VERSION } from "./direct.ts";

/** Actions this module can issue. Used by the bundle boundary check. */
export const CONTROL_ACTIONS = ["StartInstance", "StopInstance"] as const;

export class DirectControlProvider implements ControlProvider {
  private readonly deps: RpcDependencies;

  constructor(deps: RpcDependencies) {
    this.deps = deps;
  }

  /** Issue a start. Never retried automatically. */
  async startInstance(
    scope: RequestScope,
    instance: InstanceConfig,
    credential: Credential,
  ): Promise<void> {
    const result = await callRpc(this.deps, {
      credential,
      host: `ecs.${instance.regionId}.aliyuncs.com`,
      version: ECS_VERSION,
      action: "StartInstance",
      regionId: instance.regionId,
      params: {
        RegionId: instance.regionId,
        InstanceId: instance.instanceId,
      },
      // A non-idempotent action must not be replayed by the transport.
      idempotent: false,
    });
    if (!result.ok) {
      void scope;
      throw new ProviderError(result.error);
    }
  }

  /**
   * Issue a stop.
   *
   * `StoppedMode` is only sent when a mode was explicitly chosen; the contract
   * documents that requesting `StopCharging` does not guarantee the instance
   * actually entered economical mode, so the outcome is never reported as
   * "economical stop" without a confirming read.
   */
  async stopInstance(
    scope: RequestScope,
    instance: InstanceConfig,
    credential: Credential,
    shutdownMode: ShutdownMode,
  ): Promise<void> {
    const params: Record<string, string> = {
      RegionId: instance.regionId,
      InstanceId: instance.instanceId,
      StoppedMode: shutdownMode,
    };
    const result = await callRpc(this.deps, {
      credential,
      host: `ecs.${instance.regionId}.aliyuncs.com`,
      version: ECS_VERSION,
      action: "StopInstance",
      regionId: instance.regionId,
      params,
      idempotent: false,
    });
    if (!result.ok) {
      void scope;
      throw new ProviderError(result.error);
    }
  }
}
