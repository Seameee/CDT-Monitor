/**
 * Pure-ECMAScript cryptographic primitives required by the Aliyun RPC
 * signature, plus RFC 3986 percent-encoding.
 *
 * Why this file exists instead of using host or platform helpers:
 *
 * Egern's documented script surface (`ctx.http` / `ctx.storage` / `ctx.notify`
 * / `ctx.app` / `ctx.script` / `ctx.cron` / `ctx.widgetFamily`) does **not**
 * document `crypto`, `crypto.subtle`, `TextEncoder`, `btoa`/`atob`, `Buffer`
 * or Node builtins. Those are therefore *unverified* host capabilities in this
 * project (see docs/compatibility.md) and must not be load-bearing.
 *
 * Everything here is implemented from the published algorithm definitions using
 * only guarantees of the ECMAScript language itself (numbers, typed arrays,
 * bitwise operators, `String.prototype.charCodeAt`). That keeps the published
 * bundle self-contained and identical on any host that runs the script at all.
 *
 * This is original code written for this project; no third-party crypto library
 * is bundled, so no additional license obligations apply.
 *
 * Scope note: SHA-1/HMAC-SHA1 are used **only** because Aliyun's traditional
 * RPC signature (SignatureVersion=1.0) is defined in terms of HMAC-SHA1. This
 * is message authentication against a shared secret for a legacy API, not a
 * password hash. See docs/aliyun-api-contract.md.
 */

const SHA1_BLOCK_BYTES = 64;
const SHA1_DIGEST_BYTES = 20;

/** Rotate a 32-bit word left by `count` bits, staying unsigned. */
function rotateLeft32(value: number, count: number): number {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

/**
 * Encode a JavaScript string to UTF-8 bytes.
 *
 * Handles the full BMP plus surrogate pairs, and emits U+FFFD for lone
 * surrogates, mirroring the WHATWG UTF-8 encoder. Implemented by hand rather
 * than via `TextEncoder` because that global is unverified on Egern.
 */
export function utf8Bytes(input: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let codePoint = input.charCodeAt(i);

    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      // High surrogate: try to pair with the following low surrogate.
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = ((codePoint - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        i++;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      // Lone low surrogate.
      codePoint = 0xfffd;
    }

    if (codePoint < 0x80) {
      out.push(codePoint);
    } else if (codePoint < 0x800) {
      out.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      out.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      out.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return out;
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard Base64 encoding with `=` padding. */
export function base64Encode(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] as number) : undefined;
    const b2 = i + 2 < bytes.length ? (bytes[i + 2] as number) : undefined;

    out += BASE64_ALPHABET[b0 >> 2];
    if (b1 === undefined) {
      out += BASE64_ALPHABET[(b0 & 0x03) << 4];
      out += "==";
      break;
    }
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (b2 === undefined) {
      out += BASE64_ALPHABET[(b1 & 0x0f) << 2];
      out += "=";
      break;
    }
    out += BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    out += BASE64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

const BASE64_LOOKUP: Record<string, number> = (() => {
  const table: Record<string, number> = {};
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    table[BASE64_ALPHABET[i] as string] = i;
  }
  return table;
})();

/** Standard Base64 decoding. Returns null for structurally invalid input. */
export function base64Decode(input: string): number[] | null {
  const cleaned = input.replace(/[\r\n\t ]/g, "");
  if (cleaned.length % 4 !== 0) return null;
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i += 4) {
    const chunk = cleaned.slice(i, i + 4);
    const pad = chunk.endsWith("==") ? 2 : chunk.endsWith("=") ? 1 : 0;
    const body = chunk.slice(0, 4 - pad);
    let buffer = 0;
    for (const ch of body) {
      const value = BASE64_LOOKUP[ch];
      if (value === undefined) return null;
      buffer = (buffer << 6) | value;
    }
    buffer <<= 6 * pad;
    const byteCount = 3 - pad;
    for (let j = 0; j < byteCount; j++) {
      out.push((buffer >> (16 - j * 8)) & 0xff);
    }
  }
  return out;
}

/** Lower-case hex encoding. */
export function hexEncode(bytes: readonly number[]): string {
  let out = "";
  for (const byte of bytes) {
    out += (byte < 16 ? "0" : "") + byte.toString(16);
  }
  return out;
}

/** SHA-1 over raw bytes, returning 20 bytes. */
export function sha1(message: readonly number[]): number[] {
  const messageLength = message.length;

  // Pad: 0x80, then zeros, then the 64-bit big-endian bit length.
  const paddedLength = (() => {
    const afterOne = messageLength + 1;
    const remainder = afterOne % SHA1_BLOCK_BYTES;
    const zeroPad =
      remainder <= 56 ? 56 - remainder : 56 + (SHA1_BLOCK_BYTES - remainder);
    return afterOne + zeroPad + 8;
  })();

  const buffer = new Uint8Array(paddedLength);
  buffer.set(message as number[], 0);
  buffer[messageLength] = 0x80;

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const bitLengthHigh = Math.floor(messageLength / 0x20000000);
  const bitLengthLow = (messageLength % 0x20000000) * 8;
  view.setUint32(paddedLength - 8, bitLengthHigh, false);
  view.setUint32(paddedLength - 4, bitLengthLow >>> 0, false);

  const h0Init = 0x67452301;
  const h1Init = 0xefcdab89;
  const h2Init = 0x98badcfe;
  const h3Init = 0x10325476;
  const h4Init = 0xc3d2e1f0;

  let h0 = h0Init;
  let h1 = h1Init;
  let h2 = h2Init;
  let h3 = h3Init;
  let h4 = h4Init;

  const words = new Uint32Array(80);

  for (let offset = 0; offset < paddedLength; offset += SHA1_BLOCK_BYTES) {
    for (let i = 0; i < 16; i++) {
      words[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      words[i] = rotateLeft32(
        (words[i - 3] as number) ^
          (words[i - 8] as number) ^
          (words[i - 14] as number) ^
          (words[i - 16] as number),
        1,
      );
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp =
        (rotateLeft32(a, 5) + f + e + k + (words[i] as number)) >>> 0;
      e = d;
      d = c;
      c = rotateLeft32(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const digest = new Uint8Array(SHA1_DIGEST_BYTES);
  const digestView = new DataView(
    digest.buffer,
    digest.byteOffset,
    digest.byteLength,
  );
  digestView.setUint32(0, h0, false);
  digestView.setUint32(4, h1, false);
  digestView.setUint32(8, h2, false);
  digestView.setUint32(12, h3, false);
  digestView.setUint32(16, h4, false);
  return Array.from(digest);
}

/** HMAC-SHA1 as specified by RFC 2104. */
export function hmacSha1(
  key: readonly number[],
  message: readonly number[],
): number[] {
  let normalizedKey: readonly number[] = key;
  if (normalizedKey.length > SHA1_BLOCK_BYTES) {
    normalizedKey = sha1(normalizedKey);
  }

  const block = new Array<number>(SHA1_BLOCK_BYTES).fill(0);
  for (let i = 0; i < normalizedKey.length; i++) {
    block[i] = normalizedKey[i] as number;
  }

  const innerPad = block.map((byte) => byte ^ 0x36);
  const outerPad = block.map((byte) => byte ^ 0x5c);

  const innerDigest = sha1(innerPad.concat(message as number[]));
  return sha1(outerPad.concat(innerDigest));
}

const UNRESERVED = (() => {
  const table = new Uint8Array(128);
  const marks = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~";
  for (const ch of marks) {
    table[ch.charCodeAt(0)] = 1;
  }
  return table;
})();

const HEX_UPPER = "0123456789ABCDEF";

/**
 * RFC 3986 percent-encoding over the UTF-8 bytes of `value`.
 *
 * Unreserved characters (`A-Z a-z 0-9 - _ . ~`) pass through; everything else
 * becomes `%XX` with **upper-case** hex. This yields `%20` for space, `%2A` for
 * `*`, and leaves `~` unencoded, which is what Aliyun's signature spec requires.
 * `!`, `'`, `(`, `)` and `*` are encoded even though `encodeURIComponent` would
 * leave them alone — a classic source of signature mismatches.
 */
export function percentEncode(value: string): string {
  const bytes = utf8Bytes(value);
  let out = "";
  for (const byte of bytes) {
    if (byte < 0x80 && UNRESERVED[byte] === 1) {
      out += String.fromCharCode(byte);
    } else {
      out +=
        "%" +
        HEX_UPPER[(byte >> 4) & 0x0f] +
        HEX_UPPER[byte & 0x0f];
    }
  }
  return out;
}

/** True when the given string is a non-negative finite integer literal. */
export function isDecimalInteger(value: string): boolean {
  return /^\d+$/.test(value);
}
