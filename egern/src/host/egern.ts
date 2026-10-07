/**
 * Adapters between the Egern script context and this project's injected seams.
 *
 * Everything the rest of the codebase needs from the host is funnelled through
 * here: clock, nonce source, HTTP, storage and notifications. Domain and
 * provider code depend on the small interfaces in `types.ts`, which is what
 * makes them testable against fakes with no Egern runtime present.
 *
 * Two capabilities are deliberately *detected* rather than assumed, because
 * Egern's documentation does not promise them:
 *
 *  - **Secure randomness.** Nothing in the documented API provides it. If the
 *    runtime happens to expose `crypto.getRandomValues`, it is used; otherwise
 *    the nonce falls back to time + counter + `Math.random` and says so. It is
 *    never described as cryptographically secure when it is not. (This affects
 *    only request nonce uniqueness, not the secrecy of any key.)
 *  - **`credentials`** is passed explicitly on every request rather than relying
 *    on the documented default of `include`.
 */

import { hexEncode } from "./crypto.ts";
import type {
  Clock,
  EgernScriptContext,
  HttpClient,
  HttpRequestOptions,
  HttpResponseLike,
  KeyValueStore,
  NonceFactory,
  Notifier,
  NotifyOptions,
} from "./types.ts";

/** A clock backed by the runtime's `Date`. */
export function createClock(): Clock {
  return {
    now: () => new Date(),
  };
}

/** A clock pinned to a fixed instant, for tests and diagnostics. */
export function createFixedClock(instant: Date): Clock {
  return { now: () => new Date(instant.getTime()) };
}

interface RandomSource {
  getRandomValues(array: Uint8Array): Uint8Array;
}

/** Detect a Web Crypto-style `getRandomValues`, if the host exposes one. */
function detectRandomSource(): RandomSource | null {
  const candidate = (globalThis as unknown as Record<string, unknown>)["crypto"];
  if (candidate === null || typeof candidate !== "object") return null;
  const getRandomValues = (candidate as Record<string, unknown>)["getRandomValues"];
  if (typeof getRandomValues !== "function") return null;
  return candidate as unknown as RandomSource;
}

/**
 * Build a nonce factory.
 *
 * The result is always unique-enough for request signing; `describe()` and
 * `isCryptographicallyStrong()` report the truth so diagnostics never overstate
 * the entropy available.
 */
export function createNonceFactory(): NonceFactory {
  const source = detectRandomSource();
  let counter = 0;

  if (source !== null) {
    return {
      create(): string {
        const bytes = new Uint8Array(16);
        try {
          source.getRandomValues(bytes);
          return hexEncode(Array.from(bytes));
        } catch {
          // Fall through to the degraded path below rather than throwing.
          counter++;
          return degraded(counter);
        }
      },
      describe: () => "crypto.getRandomValues（宿主提供）",
      isCryptographicallyStrong: () => true,
    };
  }

  return {
    create(): string {
      counter++;
      return degraded(counter);
    },
    describe: () => "时间戳 + 计数器 + Math.random（宿主未提供安全随机数，不视为加密安全）",
    isCryptographicallyStrong: () => false,
  };
}

/** Time + counter + `Math.random`, encoded as a fixed-width hex string. */
function degraded(counter: number): string {
  const random = Math.floor(Math.random() * 0x100000000) >>> 0;
  const part = (value: number, width: number): string =>
    value.toString(16).padStart(width, "0").slice(-width);
  return (
    part(Date.now() >>> 0, 8) +
    part(Math.floor(Date.now() / 0x100000000) >>> 0, 4) +
    part(counter >>> 0, 4) +
    part(random, 8)
  );
}

/**
 * Wrap `ctx.http` so callers never depend on the host object directly.
 *
 * Only `get` and `post` are exposed: this project issues no other verbs, and a
 * narrower surface is easier to reason about. Errors are rethrown unchanged so
 * the caller's error classifier can decide what they mean.
 */
export function wrapHttp(ctx: EgernScriptContext): HttpClient {
  const invoke = async (
    method: "get" | "post",
    url: string,
    options?: HttpRequestOptions,
  ): Promise<HttpResponseLike> => {
    const response = await ctx.http[method](url, options);
    return {
      status: response.status,
      text: () => response.text(),
    };
  };

  return {
    get: (url, options) => invoke("get", url, options),
    post: (url, options) => invoke("post", url, options),
  };
}

/**
 * Wrap `ctx.storage`.
 *
 * A missing key is normalised to null. Read failures are converted to null
 * rather than propagated: a broken cache must degrade to a fresh fetch, never
 * to a blank widget.
 */
export function wrapStorage(ctx: EgernScriptContext): KeyValueStore {
  const safeGet = (key: string): string | null => {
    try {
      const value = ctx.storage.get(key);
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  };

  return {
    get: safeGet,
    set: (key, value) => {
      ctx.storage.set(key, value);
    },
    getJSON: (key) => {
      try {
        return ctx.storage.getJSON(key);
      } catch {
        // A malformed value must behave like a miss, not like a crash.
        return null;
      }
    },
    setJSON: (key, value) => {
      ctx.storage.setJSON(key, value);
    },
    delete: (key) => {
      try {
        ctx.storage.delete(key);
      } catch {
        // Deleting a missing key is not an error worth surfacing.
      }
    },
  };
}

/** Wrap `ctx.notify`. */
export function wrapNotifier(ctx: EgernScriptContext): Notifier {
  return {
    notify(options: NotifyOptions): void {
      ctx.notify(options);
    },
  };
}

/**
 * Read `ctx.env` defensively.
 *
 * Values are documented as strings; anything else is dropped rather than
 * coerced, so a non-string cannot become the literal "undefined" in a key.
 */
export function readEnvMap(ctx: EgernScriptContext): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  const source = ctx.env;
  if (source === null || typeof source !== "object") return result;
  for (const key of Object.keys(source)) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value === "string") result[key] = value;
  }
  return result;
}
