/**
 * Aliyun traditional RPC signature (SignatureVersion=1.0, HMAC-SHA1).
 *
 * This mirrors the behaviour of the original Go implementation
 * (`internal/aliyun/client.go`, `sign`/`percentEncode`) and is validated
 * against Aliyun's published fixed vector in tests/signing.test.ts.
 *
 * Reference: https://www.alibabacloud.com/help/en/sdk/product-overview/rpc-mechanism
 *
 * Notes on deliberately explicit choices:
 *  - The HTTP method is a parameter of the signature, not a constant. The
 *    official vector is a GET; this project's live requests are POST form
 *    bodies. Both are exercised in tests.
 *  - Percent-encoding is implemented from UTF-8 bytes in host/crypto.ts rather
 *    than via `encodeURIComponent`, so `!'()*` handling and `%7E` vs `~` are
 *    unambiguous and host-independent.
 */

import {
  base64Encode,
  hmacSha1,
  percentEncode,
  utf8Bytes,
} from "../../host/crypto.ts";

/** Parameters participating in the signature. All values must be strings. */
export type SignableParams = Record<string, string>;

/** The `Signature` parameter name, excluded from its own canonical input. */
export const SIGNATURE_PARAM = "Signature";

/**
 * Build `CanonicalizedQueryString`: parameters other than `Signature`, sorted by
 * key in ASCII order, each key and value RFC 3986 percent-encoded, joined by `&`.
 */
export function canonicalizedQueryString(params: SignableParams): string {
  const keys = Object.keys(params)
    .filter((key) => key !== SIGNATURE_PARAM)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const parts: string[] = [];
  for (const key of keys) {
    parts.push(`${percentEncode(key)}=${percentEncode(params[key] as string)}`);
  }
  return parts.join("&");
}

/**
 * Build the `StringToSign` value: `METHOD&%2F&percentEncode(canonicalQuery)`.
 *
 * `%2F` is the percent-encoded `/` path, which is what this class of API uses.
 */
export function stringToSign(httpMethod: string, canonicalQuery: string): string {
  return `${httpMethod.toUpperCase()}&${percentEncode("/")}&${percentEncode(canonicalQuery)}`;
}

/**
 * Compute a Base64 HMAC-SHA1 signature.
 *
 * @param params  Parameters to sign, excluding `Signature`.
 * @param secret  AccessKeySecret (a SecurityToken, when used, is a *signed
 *                parameter*, not part of the key).
 * @param httpMethod Method actually used for the request.
 */
export function signParams(
  params: SignableParams,
  secret: string,
  httpMethod = "POST",
): string {
  const canonicalQuery = canonicalizedQueryString(params);
  const toSign = stringToSign(httpMethod, canonicalQuery);
  // The signing key is `AccessKeySecret + "&"`, per the traditional spec.
  const keyBytes = utf8Bytes(`${secret}&`);
  const digest = hmacSha1(keyBytes, utf8Bytes(toSign));
  return base64Encode(digest);
}

/**
 * Format an instant as the UTC timestamp Aliyun expects: `YYYY-MM-DDTHH:mm:ssZ`
 * (second precision, literal `Z`, no milliseconds).
 */
export function formatRpcTimestamp(instant: Date): string {
  const iso = instant.toISOString();
  return `${iso.slice(0, 19)}Z`;
}

/** Common (public) parameters every traditional RPC request must carry. */
export interface CommonParamsInput {
  accessKeyId: string;
  action: string;
  version: string;
  regionId: string;
  timestamp: Date;
  nonce: string;
  /** Present only when using STS temporary credentials. */
  securityToken?: string;
}

/**
 * Assemble the public parameters for a traditional RPC call.
 *
 * `RegionId` is included for every service because the original Go client does
 * so; see docs/aliyun-api-contract.md for the per-action requirement.
 */
export function buildCommonParams(input: CommonParamsInput): SignableParams {
  const params: SignableParams = {
    AccessKeyId: input.accessKeyId,
    Action: input.action,
    Format: "JSON",
    RegionId: input.regionId,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: input.nonce,
    SignatureVersion: "1.0",
    Timestamp: formatRpcTimestamp(input.timestamp),
    Version: input.version,
  };
  if (input.securityToken !== undefined && input.securityToken !== "") {
    params.SecurityToken = input.securityToken;
  }
  return params;
}

/**
 * Produce the final signed parameter set, ready to be form-encoded.
 *
 * A fresh nonce and timestamp must be supplied per attempt by the caller: the
 * original Go client regenerates both on every retry, and replaying a stale
 * timestamp produces `InvalidTimeStamp.Expired`.
 */
export function buildSignedParams(
  common: CommonParamsInput,
  actionParams: SignableParams,
  secret: string,
  httpMethod = "POST",
): SignableParams {
  const merged: SignableParams = { ...buildCommonParams(common), ...actionParams };
  return { ...merged, [SIGNATURE_PARAM]: signParams(merged, secret, httpMethod) };
}
