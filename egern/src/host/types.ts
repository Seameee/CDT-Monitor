/**
 * Type declarations for the **verified** Egern host surface and the Widget DSL.
 *
 * Every member here is traceable to Egern's official documentation
 * (https://egernapp.com/docs/javascript-api/ and
 * https://egernapp.com/docs/configuration/widgets/). Capabilities that the
 * documentation does **not** promise — `fetch`, `crypto`, `TextEncoder`,
 * `btoa`/`atob`, `Buffer`, `require`, DOM, timers, `ctx.source`, `ctx.confirm`,
 * cross-file `import` at runtime, other proxy clients' `$httpClient`/`$done`
 * APIs — are deliberately absent so TypeScript rejects them at build time.
 *
 * Anything this project wants to use that is not declared here must first be
 * capability-detected at runtime and recorded in docs/compatibility.md.
 *
 * See docs/compatibility.md for the per-item verification status.
 */

/* -------------------------------------------------------------------------- */
/* Injection seams                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Injectable time source. Domain and provider code must never call `Date.now()`
 * directly, so that business rules can be tested against a fixed clock.
 */
export interface Clock {
  /** Current instant, in UTC terms. */
  now(): Date;
}

/** Injectable source of request nonces. */
export interface NonceFactory {
  /** A value unique across concurrent and retried requests. */
  create(): string;
  /**
   * Human-readable description of the entropy actually available, surfaced in
   * diagnostics so a weak source is never mistaken for a secure one.
   */
  describe(): string;
  /** Whether the source is cryptographically strong. */
  isCryptographicallyStrong(): boolean;
}

/** Minimal outbound HTTP interface, matching `ctx.http` semantics. */
export interface HttpResponseLike {
  readonly status: number;
  text(): Promise<string>;
}

/** Per-request options, restricted to the documented `ctx.http` fields. */
export interface HttpRequestOptions {
  headers?: Record<string, string>;
  /** Request body. A string is sent verbatim; never rely on JSON auto-typing. */
  body?: string;
  /** Timeout in milliseconds. */
  timeout?: number;
  /** Proxy policy name, when the user or module explicitly selects one. */
  policy?: string;
  policyDescriptor?: string;
  redirect?: "follow" | "manual" | "error";
  credentials?: "omit" | "include";
  insecureTls?: boolean;
}

/** Minimal outbound HTTP client, matching the documented `ctx.http` methods. */
export interface HttpClient {
  get(url: string, options?: HttpRequestOptions): Promise<HttpResponseLike>;
  post(url: string, options?: HttpRequestOptions): Promise<HttpResponseLike>;
}

/** Persistent key-value storage, matching `ctx.storage`. */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  getJSON(key: string): unknown;
  setJSON(key: string, value: unknown): void;
  delete(key: string): void;
}

/** Tap action accepted by `ctx.notify`. */
export interface NotifyAction {
  type: "openUrl" | "clipboard";
  url?: string;
  text?: string;
}

/** Notification payload accepted by `ctx.notify`. */
export interface NotifyOptions {
  title: string;
  subtitle?: string;
  body?: string;
  sound?: boolean;
  duration?: number;
  action?: NotifyAction;
}

/** Notification sink, matching `ctx.notify`. */
export interface Notifier {
  notify(options: NotifyOptions): void;
}

/* -------------------------------------------------------------------------- */
/* Egern script context (documented subset)                                   */
/* -------------------------------------------------------------------------- */

/** The documented Egern script context. */
export interface EgernScriptContext {
  /** `string | undefined` — present in schedule scripts only. */
  readonly cron?: string;
  /** `string | undefined` — widget size family, present in generic scripts. */
  readonly widgetFamily?: string;
  /** Environment variables. Always strings; never parse with `Boolean()`. */
  readonly env: Record<string, string | undefined>;
  readonly app?: { readonly version?: string; readonly language?: string };
  readonly script?: { readonly name?: string };
  readonly http: HttpClient;
  readonly storage: KeyValueStore;
  notify(options: NotifyOptions): void;
}

/* -------------------------------------------------------------------------- */
/* Widget DSL (documented nodes only)                                         */
/* -------------------------------------------------------------------------- */

/** Hex (`#RGB`/`#RRGGBB`/`#RRGGBBAA`), `rgba(...)`, or an adaptive pair. */
export type DslColor = string | { light: string; dark: string };

/** Padding accepts a number, `[vertical, horizontal]`, or CSS clockwise order. */
export type DslPadding = number | [number, number] | [number, number, number, number];

/** Semantic font size names documented by Egern. */
export type DslFontSize =
  | "largeTitle"
  | "title"
  | "title2"
  | "title3"
  | "headline"
  | "body"
  | "callout"
  | "subheadline"
  | "footnote"
  | "caption1"
  | "caption2"
  | number;

/** Documented font weights. */
export type DslFontWeight =
  | "ultraLight"
  | "thin"
  | "light"
  | "regular"
  | "medium"
  | "semibold"
  | "bold"
  | "heavy"
  | "black";

export interface DslFont {
  size?: DslFontSize;
  weight?: DslFontWeight;
  family?: string;
}

/** Gradient descriptor for `backgroundGradient`. */
export interface DslGradient {
  type?: "linear" | "radial" | "angular";
  colors: DslColor[];
  stops?: number[];
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
  center?: { x: number; y: number };
  startRadius?: number;
  endRadius?: number;
  startAngle?: number;
  endAngle?: number;
}

/** Properties shared by every documented node type. */
interface DslBase {
  /** Deep link or web URL opened on tap. Must never perform a state change. */
  url?: string;
  /** Flex ratio among siblings. */
  flex?: number;
}

export interface DslWidgetNode extends DslBase {
  type: "widget";
  children?: DslNode[];
  gap?: number;
  padding?: DslPadding;
  backgroundColor?: DslColor;
  backgroundGradient?: DslGradient;
  backgroundImage?: string;
  /** ISO 8601 instant describing when the widget would like to refresh. */
  refreshAfter?: string;
}

export interface DslStackNode extends DslBase {
  type: "stack";
  direction?: "row" | "column";
  alignItems?: "start" | "end" | "center";
  children?: DslNode[];
  gap?: number;
  padding?: DslPadding;
  width?: number;
  height?: number;
  backgroundColor?: DslColor;
  backgroundGradient?: DslGradient;
  backgroundImage?: string;
  borderRadius?: number | "auto";
  borderWidth?: number;
  borderColor?: DslColor;
  shadowColor?: DslColor;
  shadowRadius?: number;
  shadowOffset?: { x: number; y: number };
}

export interface DslTextNode extends DslBase {
  type: "text";
  text: string;
  font?: DslFont;
  textColor?: DslColor;
  textAlign?: "left" | "center" | "right";
  maxLines?: number;
  minScale?: number;
  opacity?: number;
  shadowColor?: DslColor;
  shadowRadius?: number;
  shadowOffset?: { x: number; y: number };
}

export interface DslImageNode extends DslBase {
  type: "image";
  src: string;
  color?: DslColor;
  resizeMode?: "contain" | "cover";
  resizable?: boolean;
  width?: number;
  height?: number;
  borderRadius?: number | "auto";
  borderWidth?: number;
  borderColor?: DslColor;
  opacity?: number;
  shadowColor?: DslColor;
  shadowRadius?: number;
  shadowOffset?: { x: number; y: number };
}

export interface DslSpacerNode {
  type: "spacer";
  length?: number;
}

export interface DslDateNode extends DslBase {
  type: "date";
  date: string;
  format?: "date" | "time" | "relative" | "offset" | "timer";
  font?: DslFont;
  textColor?: DslColor;
  textAlign?: "left" | "center" | "right";
  maxLines?: number;
  minScale?: number;
  opacity?: number;
}

/** Every node type this project is allowed to emit. */
export type DslNode =
  | DslWidgetNode
  | DslStackNode
  | DslTextNode
  | DslImageNode
  | DslSpacerNode
  | DslDateNode;

/** The seven documented widget families. */
export type WidgetFamily =
  | "systemSmall"
  | "systemMedium"
  | "systemLarge"
  | "systemExtraLarge"
  | "accessoryCircular"
  | "accessoryRectangular"
  | "accessoryInline";

export const WIDGET_FAMILIES: readonly WidgetFamily[] = [
  "systemSmall",
  "systemMedium",
  "systemLarge",
  "systemExtraLarge",
  "accessoryCircular",
  "accessoryRectangular",
  "accessoryInline",
];

/** Narrow an arbitrary `ctx.widgetFamily` value to a known family. */
export function asWidgetFamily(value: string | undefined): WidgetFamily | undefined {
  if (value === undefined) return undefined;
  return WIDGET_FAMILIES.includes(value as WidgetFamily)
    ? (value as WidgetFamily)
    : undefined;
}
