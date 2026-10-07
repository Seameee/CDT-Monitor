/**
 * Traditional RPC transport for Aliyun APIs.
 *
 * Responsibilities:
 *  - assemble and sign a POST form request (via `signing.ts`);
 *  - classify failures into stable, *sanitized* codes;
 *  - retry only what is safe and useful, inside an explicit time budget;
 *  - bound the size and nesting depth of anything parsed from the network.
 *
 * Deliberate differences from the original Go client (`internal/aliyun/client.go`):
 *  - The Go version retries up to 3 times unconditionally and treats a *missing*
 *    `TrafficDetails` as retryable. Here retries are bounded, budget-aware and
 *    only applied to requests the caller marked idempotent.
 *  - Raw response bodies, request URLs, signatures and key material never reach
 *    an error value: everything surfaced is a `SanitizedError`, because errors
 *    are cached and can be rendered by a widget.
 */

import type {
  Credential,
  SanitizedError,
} from "../../domain/models.ts";
import type { Clock, HttpClient, NonceFactory } from "../../host/types.ts";
import { percentEncode } from "../../host/crypto.ts";
import { buildCommonParams, signParams } from "./signing.ts";

/** Largest response body that will be parsed. Anything bigger is rejected. */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Deepest JSON nesting accepted from an upstream response. */
export const MAX_JSON_DEPTH = 24;

/** Business codes that mean success across CDT/ECS/BSS. */
const SUCCESS_CODES = new Set(["ok", "200", "success", "true"]);

export interface RpcDependencies {
  http: HttpClient;
  clock: Clock;
  nonce: NonceFactory;
  /** Timeout applied to a single HTTP attempt, in milliseconds. */
  requestTimeoutMs: number;
  /** Maximum attempts including the first. 1 disables retry. */
  maxAttempts: number;
  /** Absolute epoch-ms deadline; retries stop once exceeded. */
  deadlineMs?: number;
}

export interface RpcRequest {
  credential: Credential;
  /** API host, e.g. `cdt.aliyuncs.com`. */
  host: string;
  /** API version, e.g. `2021-08-13`. */
  version: string;
  /** Action name, e.g. `ListCdtInternetTraffic`. */
  action: string;
  /** RegionId sent as a common parameter. */
  regionId: string;
  /** Action-specific parameters. */
  params: Record<string, string>;
  /**
   * Whether replaying this request is safe. Read-only queries are idempotent;
   * instance start/stop are not, and must never be auto-replayed.
   */
  idempotent: boolean;
}

/** Outcome of an RPC call. */
export type RpcResult =
  | { ok: true; body: Record<string, unknown>; attempts: number }
  | { ok: false; error: SanitizedError; attempts: number };

/** Build a `application/x-www-form-urlencoded` body from signed parameters. */
export function encodeFormBody(params: Record<string, string>): string {
  const parts: string[] = [];
  for (const key of Object.keys(params)) {
    parts.push(`${percentEncode(key)}=${percentEncode(params[key] as string)}`);
  }
  return parts.join("&");
}

/** Maximum nesting depth of a parsed JSON value. */
export function jsonDepth(value: unknown, limit = MAX_JSON_DEPTH): number {
  // Iterative traversal with an explicit stack: a hostile deeply-nested body
  // must not blow the recursion limit before we can reject it.
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 1 }];
  let maxDepth = 0;
  while (stack.length > 0) {
    const current = stack.pop() as { node: unknown; depth: number };
    if (current.depth > maxDepth) maxDepth = current.depth;
    if (maxDepth > limit) return maxDepth;
    const node = current.node;
    if (Array.isArray(node)) {
      for (const child of node) stack.push({ node: child, depth: current.depth + 1 });
    } else if (node !== null && typeof node === "object") {
      for (const child of Object.values(node as Record<string, unknown>)) {
        stack.push({ node: child, depth: current.depth + 1 });
      }
    }
  }
  return maxDepth;
}

function sanitized(
  code: string,
  message: string,
  at: Date,
  retryable: boolean,
): SanitizedError {
  return { code, message, at: at.toISOString(), retryable };
}

/** True when a business `Code` value denotes success. */
export function isSuccessCode(code: string): boolean {
  return SUCCESS_CODES.has(code.trim().toLowerCase());
}

/** Detect the timestamp-family errors that a fresh request can fix. */
export function isTimestampError(code: string, message: string): boolean {
  const text = `${code} ${message}`.toLowerCase().replace(/\s+/g, "");
  return text.includes("timestamp") &&
    (text.includes("expired") || text.includes("notsupplied") || text.includes("missing"));
}

/** Detect throttling, which is worth a bounded retry. */
export function isThrottleError(code: string): boolean {
  return code.toLowerCase().includes("throttl");
}

/**
 * Read the response body with a hard size bound.
 *
 * `ctx.http` exposes `text()` rather than a length-limited stream, so the bound
 * is enforced immediately after reading. The body is still never logged.
 */
async function readBoundedText(
  response: { text(): Promise<string> },
): Promise<{ ok: true; text: string } | { ok: false }> {
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    return { ok: false };
  }
  return { ok: true, text };
}

/**
 * Perform an RPC call with classification and bounded retry.
 *
 * A fresh nonce and timestamp are generated for **every** attempt: replaying a
 * consumed `SignatureNonce` or an expired `Timestamp` is itself an error.
 */
export async function callRpc(
  deps: RpcDependencies,
  request: RpcRequest,
): Promise<RpcResult> {
  const maxAttempts = Math.max(1, request.idempotent ? deps.maxAttempts : 1);
  let attempts = 0;
  let lastError: SanitizedError | null = null;

  while (attempts < maxAttempts) {
    if (deps.deadlineMs !== undefined && deps.clock.now().getTime() >= deps.deadlineMs) {
      break;
    }
    attempts++;

    const now = deps.clock.now();
    const signed = {
      ...buildCommonParams({
        accessKeyId: request.credential.accessKeyId,
        action: request.action,
        version: request.version,
        regionId: request.regionId,
        timestamp: now,
        nonce: deps.nonce.create(),
        ...(request.credential.securityToken !== undefined
          ? { securityToken: request.credential.securityToken }
          : {}),
      }),
      ...request.params,
    };
    const signature = signParams(signed, request.credential.accessKeySecret, "POST");
    const body = encodeFormBody({ ...signed, Signature: signature });

    let response: { status: number; text(): Promise<string> };
    try {
      response = await deps.http.post(`https://${request.host}/`, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        timeout: deps.requestTimeoutMs,
        credentials: "omit",
        // A signed request must never be silently re-sent to another origin.
        redirect: "error",
      });
    } catch {
      // Do not surface the transport exception: it can embed the URL or body.
      lastError = sanitized("NetworkError", "网络请求失败或超时", now, true);
      continue;
    }

    const status = response.status;
    let text: string;
    try {
      const read = await readBoundedText(response);
      if (!read.ok) {
        return {
          ok: false,
          error: sanitized("ResponseTooLarge", "云接口响应过大，已拒绝解析", now, false),
          attempts,
        };
      }
      text = read.text;
    } catch {
      lastError = sanitized("NetworkError", "读取云接口响应失败", now, true);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      lastError = sanitized(
        "MalformedResponse",
        `云接口返回了无法解析的内容（HTTP ${status}）`,
        now,
        status >= 500,
      );
      continue;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: sanitized("MalformedResponse", "云接口返回了非预期的 JSON 结构", now, false),
        attempts,
      };
    }
    if (jsonDepth(parsed) > MAX_JSON_DEPTH) {
      return {
        ok: false,
        error: sanitized("MalformedResponse", "云接口响应嵌套过深，已拒绝解析", now, false),
        attempts,
      };
    }

    const record = parsed as Record<string, unknown>;
    const code = typeof record["Code"] === "string" ? (record["Code"] as string) : "";
    const message = typeof record["Message"] === "string" ? (record["Message"] as string) : "";
    const success = record["Success"];

    // Credentials and permissions never succeed on retry.
    if (status === 401 || status === 403) {
      return {
        ok: false,
        error: sanitized(
          "AccessDenied",
          status === 401 ? "凭据无效或已被撤销" : "凭据缺少所需权限",
          now,
          false,
        ),
        attempts,
      };
    }

    if (status >= 400) {
      // A stale timestamp is recoverable by rebuilding the request.
      if (isTimestampError(code, message)) {
        lastError = sanitized("TimestampError", "请求时间戳过期，已重新签名", now, true);
        continue;
      }
      const retryable = status >= 500 || status === 429 || isThrottleError(code);
      lastError = sanitized(
        isThrottleError(code) ? "Throttled" : "HttpError",
        `云接口返回 HTTP ${status}`,
        now,
        retryable,
      );
      continue;
    }

    // HTTP 2xx is not automatically a business success.
    if (code !== "" && !isSuccessCode(code)) {
      if (isTimestampError(code, message)) {
        lastError = sanitized("TimestampError", "请求时间戳过期，已重新签名", now, true);
        continue;
      }
      if (isThrottleError(code)) {
        lastError = sanitized("Throttled", "云接口限流，请稍后重试", now, true);
        continue;
      }
      return {
        ok: false,
        error: sanitized("ServiceError", `云接口返回业务错误：${code}`, now, false),
        attempts,
      };
    }
    if (success === false) {
      return {
        ok: false,
        error: sanitized("ServiceError", "云接口返回 Success=false", now, false),
        attempts,
      };
    }

    return { ok: true, body: record, attempts };
  }

  return {
    ok: false,
    error:
      lastError ??
      sanitized("BudgetExhausted", "本次执行的时间预算已用尽", deps.clock.now(), true),
    attempts,
  };
}
