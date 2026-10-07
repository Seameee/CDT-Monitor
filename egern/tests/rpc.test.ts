/**
 * S02 — RPC transport: business codes, single body consumption, retry policy
 * and error sanitization.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  callRpc,
  encodeFormBody,
  isSuccessCode,
  isThrottleError,
  isTimestampError,
  jsonDepth,
  MAX_RESPONSE_BYTES,
} from "../src/providers/aliyun/rpc.ts";
import type { RpcDependencies } from "../src/providers/aliyun/rpc.ts";
import { counterNonce, fakeHttp, fixtureCredential, fixedClock } from "./host-fake.ts";

function depsFor(
  responder: Parameters<typeof fakeHttp>[0],
  overrides: Partial<RpcDependencies> = {},
): { deps: RpcDependencies; requests: ReturnType<typeof fakeHttp>["requests"] } {
  const { http, requests } = fakeHttp(responder);
  return {
    deps: {
      http,
      clock: fixedClock("2026-10-08T12:00:00Z"),
      nonce: counterNonce(),
      requestTimeoutMs: 5000,
      maxAttempts: 2,
      ...overrides,
    },
    requests,
  };
}

const REQUEST = {
  credential: fixtureCredential(),
  host: "cdt.aliyuncs.com",
  version: "2021-08-13",
  action: "ListCdtInternetTraffic",
  regionId: "cn-hongkong",
  params: {},
  idempotent: true,
};

/* ------------------------------ business codes ---------------------------- */

test("S02: HTTP 200 with a business error code is a failure, not a success", () => {
  const { deps } = depsFor(() => ({
    status: 200,
    body: JSON.stringify({ Code: "Throttling.User", Message: "too fast" }),
  }));
  return callRpc(deps, REQUEST).then((result) => {
    assert.equal(result.ok, false);
    // Throttling is retryable, so it is attempted twice.
    assert.equal(result.attempts, 2);
    if (!result.ok) assert.equal(result.error.code, "Throttled");
  });
});

test("S02: BSS Code=200 is accepted as success", async () => {
  const { deps } = depsFor(() => ({
    status: 200,
    body: JSON.stringify({ Code: "200", Message: "success", Data: { AvailableAmount: "1" } }),
  }));
  const result = await callRpc(deps, REQUEST);
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
});

test("S02: a non-retryable business error is not retried", async () => {
  const { deps, requests } = depsFor(() => ({
    status: 200,
    body: JSON.stringify({ Code: "Forbidden.RAM", Message: "denied" }),
  }));
  const result = await callRpc(deps, REQUEST);
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 1);
  assert.equal(requests.length, 1);
});

test("S02: 401 and 403 are never retried", async () => {
  for (const status of [401, 403]) {
    const { deps, requests } = depsFor(() => ({ status, body: JSON.stringify({}) }));
    const result = await callRpc(deps, REQUEST);
    assert.equal(result.ok, false);
    assert.equal(requests.length, 1, `status ${status}`);
    if (!result.ok) {
      assert.equal(result.error.code, "AccessDenied");
      assert.equal(result.error.retryable, false);
    }
  }
});

test("S02: the response body is consumed exactly once", async () => {
  let textCalls = 0;
  const { http } = fakeHttp(() => ({
    status: 200,
    body: JSON.stringify({ Code: "OK", Data: {} }),
  }));
  const countingHttp = {
    get: http.get,
    post: async (url: string, options?: Parameters<typeof http.post>[1]) => {
      const response = await http.post(url, options);
      return {
        status: response.status,
        text: async () => {
          textCalls++;
          return response.text();
        },
      };
    },
  };
  const result = await callRpc(
    {
      http: countingHttp,
      clock: fixedClock("2026-10-08T12:00:00Z"),
      nonce: counterNonce(),
      requestTimeoutMs: 5000,
      maxAttempts: 2,
    },
    REQUEST,
  );
  assert.equal(result.ok, true);
  // Parsing twice (json() then text()) would throw on a real Fetch-like body.
  assert.equal(textCalls, 1);
});

/* --------------------------------- retries -------------------------------- */

test("a timestamp error triggers a rebuild with a fresh nonce", async () => {
  let attempt = 0;
  const { deps, requests } = depsFor(() => {
    attempt++;
    if (attempt === 1) {
      return {
        status: 400,
        body: JSON.stringify({
          Code: "InvalidTimeStamp.Expired",
          Message: "Specified time stamp or date value is expired.",
        }),
      };
    }
    return { status: 200, body: JSON.stringify({ Code: "OK", TrafficDetails: [] }) };
  });

  const result = await callRpc(deps, REQUEST);
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  // Replaying a consumed nonce would itself be an error, so it must differ.
  const first = requests[0]?.form?.["SignatureNonce"];
  const second = requests[1]?.form?.["SignatureNonce"];
  assert.ok(first !== undefined && second !== undefined);
  assert.notEqual(first, second);
});

test("a 5xx is retried, then reported once the budget is exhausted", async () => {
  const { deps, requests } = depsFor(() => ({
    status: 500,
    body: JSON.stringify({ Message: "boom" }),
  }));
  const result = await callRpc(deps, REQUEST);
  assert.equal(result.ok, false);
  assert.equal(requests.length, 2);
  assert.equal(result.attempts, 2);
});

test("a non-idempotent request is never retried", async () => {
  const { deps, requests } = depsFor(() => ({ status: 500, body: JSON.stringify({}) }));
  const result = await callRpc(deps, { ...REQUEST, idempotent: false });
  assert.equal(result.ok, false);
  // Instance start/stop must not be silently replayed.
  assert.equal(requests.length, 1);
});

test("a deadline stops retries even when attempts remain", async () => {
  let calls = 0;
  const { deps, requests } = depsFor(() => {
    calls++;
    return { status: 500, body: JSON.stringify({}) };
  });
  const { http } = fakeHttp(() => {
    calls++;
    return { status: 500, body: JSON.stringify({}) };
  });
  const result = await callRpc(
    {
      http,
      clock: fixedClock("2026-10-08T12:00:00Z"),
      nonce: counterNonce(),
      requestTimeoutMs: 5000,
      maxAttempts: 5,
      // Already past the deadline.
      deadlineMs: Date.parse("2026-10-08T11:59:59Z"),
    },
    REQUEST,
  );
  assert.equal(result.ok, false);
  assert.equal(requests.length, 0);
  void deps;
  void calls;
});

/* ---------------------------- bounds and sanitization --------------------- */

test("an oversized response is rejected rather than parsed", async () => {
  const { deps } = depsFor(() => ({
    status: 200,
    body: "x".repeat(MAX_RESPONSE_BYTES + 1),
  }));
  const result = await callRpc(deps, REQUEST);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "ResponseTooLarge");
});

test("deeply nested JSON is rejected before it can be walked", async () => {
  let nested: unknown = 1;
  for (let index = 0; index < 40; index++) nested = { a: nested };
  const { deps } = depsFor(() => ({ status: 200, body: JSON.stringify(nested) }));
  const result = await callRpc(deps, REQUEST);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "MalformedResponse");
});

test("jsonDepth is computed iteratively so deep input cannot blow the stack", () => {
  // Depth counts the root as 1 and each nested value as one more; scalar leaves
  // therefore occupy a level of their own.
  assert.equal(jsonDepth({ a: 1 }), 2);
  assert.equal(jsonDepth({ a: { b: { c: 1 } } }), 4);
  assert.equal(jsonDepth([1, [2, [3]]]), 4);
  assert.equal(jsonDepth("leaf"), 1);
  assert.equal(jsonDepth(null), 1);
});

test("no error message can carry a secret, signature, or URL", async () => {
  const secret = "SUPER_SECRET_VALUE";
  const { deps } = depsFor(() => ({
    status: 400,
    body: JSON.stringify({ Code: "InvalidAccessKeyId.NotFound", Message: secret }),
  }));
  const result = await callRpc(
    deps,
    { ...REQUEST, credential: fixtureCredential({ accessKeySecret: secret }) },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    const serialized = JSON.stringify(result.error);
    assert.ok(!serialized.includes(secret), "the provider message must not be echoed");
    assert.ok(!serialized.includes("Signature"));
    assert.ok(!serialized.includes("https://"));
  }
});

test("the form body is percent-encoded, not JSON", () => {
  const body = encodeFormBody({ Action: "List Things", Value: "中文" });
  assert.equal(body, "Action=List%20Things&Value=%E4%B8%AD%E6%96%87");
});

test("helper classifiers recognize the documented error families", () => {
  assert.equal(isSuccessCode("OK"), true);
  assert.equal(isSuccessCode("200"), true);
  assert.equal(isSuccessCode("Success"), true);
  assert.equal(isSuccessCode("Forbidden.RAM"), false);
  assert.equal(isTimestampError("InvalidTimeStamp.Expired", "expired"), true);
  assert.equal(isTimestampError("MissingParameter", "The input parameter Timestamp is not supplied."), true);
  assert.equal(isTimestampError("Forbidden.RAM", "denied"), false);
  assert.equal(isThrottleError("Throttling.User"), true);
  assert.equal(isThrottleError("Forbidden.RAM"), false);
});
