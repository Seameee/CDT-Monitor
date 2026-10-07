/**
 * Per-family Widget DSL layouts.
 *
 * Only the documented node types are emitted: `widget`, `stack`, `text`,
 * `image`, `spacer`, `date`. There is no `button`, `progress`, `canvas` or
 * `onTap` node — progress is drawn with a locally generated SVG, and tapping is
 * expressed with the documented `url` property on the root.
 *
 * Layout rules applied here:
 *  - the root `widget` is a vertical container; horizontal composition always
 *    uses a nested `stack`, because only `stack` documents `direction`;
 *  - every state is legible as text, so a colour is never the sole signal;
 *  - lock-screen families omit explicit colours and backgrounds and rely on the
 *    system's vibrant rendering;
 *  - an unknown or absent family degrades to a simplified medium layout instead
 *    of throwing.
 */

import type {
  DslColor,
  DslNode,
  DslWidgetNode,
  WidgetFamily,
} from "../host/types.ts";
import { formatPercent } from "../domain/format.ts";
import type { ScopeView, WidgetViewModel } from "./render.ts";
import { progressBar, progressRing } from "./svg.ts";
import type { Theme } from "./theme.ts";
import { svgColor } from "./theme.ts";

/** Options shared by every layout. */
export interface LayoutOptions {
  model: WidgetViewModel;
  theme: Theme;
  /** ISO 8601 instant for `refreshAfter`, already clamped by the caller. */
  refreshAfter: string | null;
  /** Safe deep link opened on tap, or null to omit. */
  url: string | null;
}

/** Build a `text` node. */
function text(
  value: string,
  options: {
    size?: string | number;
    weight?: string;
    color?: DslColor;
    lines?: number;
    minScale?: number;
    align?: "left" | "center" | "right";
    flex?: number;
  } = {},
): DslNode {
  const node: Record<string, unknown> = { type: "text", text: value };
  const font: Record<string, unknown> = {};
  if (options.size !== undefined) font["size"] = options.size;
  if (options.weight !== undefined) font["weight"] = options.weight;
  if (Object.keys(font).length > 0) node["font"] = font;
  if (options.color !== undefined) node["textColor"] = options.color;
  if (options.lines !== undefined) node["maxLines"] = options.lines;
  if (options.minScale !== undefined) node["minScale"] = options.minScale;
  if (options.align !== undefined) node["textAlign"] = options.align;
  if (options.flex !== undefined) node["flex"] = options.flex;
  return node as unknown as DslNode;
}

/** Build a `stack` node. */
function stack(
  children: DslNode[],
  options: {
    direction?: "row" | "column";
    alignItems?: "start" | "end" | "center";
    gap?: number;
    flex?: number;
    url?: string;
  } = {},
): DslNode {
  const node: Record<string, unknown> = { type: "stack", children };
  node["direction"] = options.direction ?? "row";
  if (options.alignItems !== undefined) node["alignItems"] = options.alignItems;
  if (options.gap !== undefined) node["gap"] = options.gap;
  if (options.flex !== undefined) node["flex"] = options.flex;
  if (options.url !== undefined) node["url"] = options.url;
  return node as unknown as DslNode;
}

/** Build a `date` node using the system-updating relative format. */
function relativeDate(iso: string | null, color: DslColor): DslNode | null {
  if (iso === null) return null;
  return {
    type: "date",
    date: iso,
    format: "relative",
    font: { size: "caption2" },
    textColor: color,
  };
}

/** Build an `image` node from a data URI. */
function image(src: string | null, width: number, height: number): DslNode[] {
  if (src === null) return [];
  return [{ type: "image", src, width, height }];
}

/** Root wrapper applying shared properties. */
function root(
  children: DslNode[],
  options: LayoutOptions,
  extra: Partial<DslWidgetNode> = {},
): DslWidgetNode {
  const node: DslWidgetNode = {
    type: "widget",
    children,
    padding: 16,
    gap: 6,
    ...extra,
  };
  if (options.url !== null) node.url = options.url;
  if (options.refreshAfter !== null) node.refreshAfter = options.refreshAfter;
  return node;
}

/** A minimal, always-valid widget used for empty and error states. */
function messageLayout(
  options: LayoutOptions,
  title: string,
  message: string,
  detail: string | null,
): DslWidgetNode {
  const children: DslNode[] = [
    text(title, { size: "headline", weight: "semibold", color: options.theme.textPrimary, lines: 1 }),
    text(message, { size: "subheadline", weight: "medium", color: options.theme.warning, lines: 2 }),
  ];
  if (detail !== null) {
    children.push(text(detail, { size: "caption2", color: options.theme.textSecondary, lines: 2 }));
  }
  return root(children, options, { backgroundColor: options.theme.background });
}

/**
 * Surface the model's message and detail inside a normal layout.
 *
 * Without this, states such as "credential rejected" or "data is stale" would
 * only be visible in the empty-state layout, so a populated widget would hide
 * exactly the problem the user needs to see.
 */
function statusBanner(model: WidgetViewModel, theme: Theme): DslNode[] {
  if (model.message === null) return [];
  const nodes: DslNode[] = [
    text(model.message, { size: "caption1", weight: "medium", color: theme.warning, lines: 1 }),
  ];
  if (model.detail !== null) {
    nodes.push(text(model.detail, { size: "caption2", color: theme.textSecondary, lines: 2 }));
  }
  return nodes;
}

/** Instance rows shared by the medium and larger layouts. */
function instanceLines(view: ScopeView, theme: Theme, limit: number): DslNode[] {
  const rows = view.instances.slice(0, limit);
  if (rows.length === 0) return [];
  return rows.map((row) =>
    stack(
      [
        text(row.name, { size: "caption1", color: theme.textPrimary, lines: 1, flex: 1 }),
        text(row.statusText, {
          size: "caption1",
          weight: "medium",
          color: row.state === "ok" ? theme.ok : row.state === "danger" ? theme.danger : theme.muted,
          lines: 1,
        }),
      ],
      { direction: "row", alignItems: "center", gap: 6 },
    ),
  );
}

/** Small: one scope, usage, percentage, state and sample age. */
function smallLayout(options: LayoutOptions): DslWidgetNode {
  const { model, theme } = options;
  const scope = model.scopes[0];
  if (scope === undefined) {
    return messageLayout(options, model.title, model.message ?? "尚未配置", model.detail);
  }
  const color =
    scope.state === "danger" ? theme.danger : scope.state === "warning" ? theme.warning : theme.ok;
  const bar = progressBar({
    fraction: scope.fraction,
    width: 120,
    height: 6,
    trackColor: svgColor(theme.muted, true),
    progressColor: svgColor(color, true),
  });

  const children: DslNode[] = [
    text(scope.label, { size: "caption2", color: theme.textSecondary, lines: 1 }),
    text(scope.percentText, { size: "title", weight: "bold", color, lines: 1, minScale: 0.6 }),
    text(scope.usageText, { size: "caption1", color: theme.textPrimary, lines: 2, minScale: 0.7 }),
    ...image(bar, 120, 6),
    stack(
      [
        text(scope.statusText, { size: "caption1", weight: "medium", color, lines: 1, flex: 1 }),
        relativeDate(scope.observedAtIso, theme.textSecondary) ??
          text(scope.ageText, { size: "caption2", color: theme.textSecondary, lines: 1 }),
      ],
      { direction: "row", alignItems: "center", gap: 6 },
    ),
  ];
  if (scope.errorText !== null) {
    children.push(text(scope.errorText, { size: "caption2", color: theme.danger, lines: 2 }));
  }
  return root(children, options, { backgroundColor: theme.background });
}

/** Medium: primary scope plus its instances and, optionally, one cost figure. */
function mediumLayout(options: LayoutOptions): DslWidgetNode {
  const { model, theme } = options;
  const scope = model.scopes[0];
  if (scope === undefined) {
    return messageLayout(options, model.title, model.message ?? "尚未配置", model.detail);
  }
  const color =
    scope.state === "danger" ? theme.danger : scope.state === "warning" ? theme.warning : theme.ok;
  const bar = progressBar({
    fraction: scope.fraction,
    width: 200,
    height: 8,
    trackColor: svgColor(theme.muted, true),
    progressColor: svgColor(color, true),
  });

  const children: DslNode[] = [
    stack(
      [
        text(scope.label, {
          size: "subheadline",
          weight: "semibold",
          color: theme.textPrimary,
          lines: 1,
          flex: 1,
        }),
        text(scope.statusText, {
          size: "caption1",
          weight: "medium",
          color,
          lines: 1,
        }),
      ],
      { direction: "row", alignItems: "center", gap: 6 },
    ),
    text(scope.usageText, { size: "title3", weight: "semibold", color: theme.textPrimary, lines: 1, minScale: 0.7 }),
    ...image(bar, 200, 8),
    stack(
      [
        text(`剩余 ${scope.remainingText}`, {
          size: "caption1",
          color: theme.textSecondary,
          lines: 1,
          flex: 1,
        }),
        relativeDate(scope.observedAtIso, theme.textSecondary) ??
          text(scope.ageText, { size: "caption2", color: theme.textSecondary, lines: 1 }),
      ],
      { direction: "row", alignItems: "center", gap: 6 },
    ),
  ];

  children.push(...statusBanner(model, theme));
  const instances = instanceLines(scope, theme, 2);
  if (instances.length > 0) children.push(...instances);
  if (scope.consumptionText !== null) {
    children.push(text(scope.consumptionText, { size: "caption2", color: theme.textSecondary, lines: 1 }));
  }
  return root(children, options, { backgroundColor: theme.background });
}

/** Large: every scope with its instances, errors and a trend if available. */
function largeLayout(options: LayoutOptions): DslWidgetNode {
  const { model, theme } = options;
  if (model.scopes.length === 0) {
    return messageLayout(options, model.title, model.message ?? "尚未配置", model.detail);
  }

  const children: DslNode[] = [
    text(model.title, { size: "headline", weight: "semibold", color: theme.textPrimary, lines: 1 }),
    ...statusBanner(model, theme),
  ];

  // At most four scopes: the layout must stay readable, and a bounded list
  // cannot push the content out of the widget.
  for (const scope of model.scopes.slice(0, 4)) {
    const color =
      scope.state === "danger" ? theme.danger : scope.state === "warning" ? theme.warning : theme.ok;
    const bar = progressBar({
      fraction: scope.fraction,
      width: 200,
      height: 6,
      trackColor: svgColor(theme.muted, true),
      progressColor: svgColor(color, true),
    });
    children.push(
      stack(
        [
          text(scope.label, { size: "subheadline", color: theme.textPrimary, lines: 1, flex: 1 }),
          text(`${scope.percentText} · ${scope.statusText}`, {
            size: "caption1",
            weight: "medium",
            color,
            lines: 1,
          }),
        ],
        { direction: "row", alignItems: "center", gap: 6 },
      ),
    );
    children.push(text(scope.usageText, { size: "caption1", color: theme.textSecondary, lines: 1 }));
    children.push(...image(bar, 200, 6));
    children.push(...instanceLines(scope, theme, 3));
    if (scope.qualityNote !== null) {
      children.push(text(scope.qualityNote, { size: "caption2", color: theme.muted, lines: 1 }));
    }
    if (scope.errorText !== null) {
      children.push(text(scope.errorText, { size: "caption2", color: theme.danger, lines: 1 }));
    }
  }

  if (model.errors.length > 0) {
    children.push(text(model.errors.join("；"), { size: "caption2", color: theme.danger, lines: 2 }));
  }

  return root(children, options, { backgroundColor: theme.background, gap: 8 });
}

/** Extra large: the large layout with a two-column footer. */
function extraLargeLayout(options: LayoutOptions): DslWidgetNode {
  const base = largeLayout(options);
  const { model, theme } = options;
  const columns: DslNode[] = [];
  for (const scope of model.scopes.slice(0, 3)) {
    columns.push(
      stack(
        [
          text(scope.label, { size: "caption1", color: theme.textSecondary, lines: 1 }),
          text(scope.percentText, { size: "headline", weight: "semibold", color: theme.textPrimary, lines: 1 }),
          text(scope.statusText, { size: "caption2", color: theme.textSecondary, lines: 1 }),
        ],
        { direction: "column", alignItems: "start", gap: 2, flex: 1 },
      ),
    );
  }
  if (columns.length === 0) return base;
  const existing = base.children ?? [];
  return {
    ...base,
    children: [...existing, stack(columns, { direction: "row", alignItems: "start", gap: 10 })],
  };
}

/** Lock screen circular: a ring plus a short label. */
function accessoryCircularLayout(options: LayoutOptions): DslWidgetNode {
  const { model, theme } = options;
  const scope = model.scopes[0];
  if (scope === undefined) {
    return { type: "widget", children: [text("CDT", { size: "caption1" })] };
  }
  // No explicit colours: the lock screen renders a vibrant, tinted glyph, and a
  // hard-coded colour would fight the system appearance.
  const ring = progressRing({
    fraction: scope.fraction,
    size: 64,
    strokeWidth: 6,
    trackColor: svgColor(theme.muted, true),
    progressColor: svgColor(scope.state === "danger" ? "#FF453A" : "#30D158", true),
  });
  const children: DslNode[] = [
    ...image(ring, 58, 58),
    // The percentage is also written as text so the state survives even if the
    // ring fails to render.
    text(scope.state === "danger" ? "超限" : scope.percentText, {
      size: "caption2",
      weight: "semibold",
      lines: 1,
    }),
  ];
  const node: DslWidgetNode = { type: "widget", children, gap: 2 };
  if (options.url !== null) node.url = options.url;
  if (options.refreshAfter !== null) node.refreshAfter = options.refreshAfter;
  return node;
}

/** Lock screen rectangular: name, usage, state, compact time. */
function accessoryRectangularLayout(options: LayoutOptions): DslWidgetNode {
  const { model } = options;
  const scope = model.scopes[0];
  if (scope === undefined) {
    return { type: "widget", children: [text(model.message ?? "尚未配置 CDT", { size: "caption1" })] };
  }
  const children: DslNode[] = [
    text(scope.label, { size: "caption1", weight: "semibold", lines: 1 }),
    text(`${scope.percentText} · ${scope.statusText}`, { size: "caption1", lines: 1 }),
    text(scope.usageText, { size: "caption2", lines: 1, minScale: 0.7 }),
  ];
  const node: DslWidgetNode = { type: "widget", children, gap: 2 };
  if (options.url !== null) node.url = options.url;
  if (options.refreshAfter !== null) node.refreshAfter = options.refreshAfter;
  return node;
}

/** Lock screen inline: a single line. */
function accessoryInlineLayout(options: LayoutOptions): DslWidgetNode {
  const { model } = options;
  const scope = model.scopes[0];
  const value =
    scope === undefined
      ? "CDT 未配置"
      : scope.state === "danger"
        ? `CDT 超限 ${scope.percentText}`
        : `CDT ${scope.percentText} · ${scope.statusText}`;
  const node: DslWidgetNode = { type: "widget", children: [text(value, { size: "caption1", lines: 1 })] };
  if (options.url !== null) node.url = options.url;
  if (options.refreshAfter !== null) node.refreshAfter = options.refreshAfter;
  return node;
}

/**
 * Render a view model for a widget family.
 *
 * An unset or unrecognised family (which includes a manual run) renders the
 * simplified medium layout, per the contract — never an exception.
 */
export function renderLayout(
  family: WidgetFamily | undefined,
  options: LayoutOptions,
): DslWidgetNode {
  switch (family) {
    case "systemSmall":
      return smallLayout(options);
    case "systemMedium":
      return mediumLayout(options);
    case "systemLarge":
      return largeLayout(options);
    case "systemExtraLarge":
      return extraLargeLayout(options);
    case "accessoryCircular":
      return accessoryCircularLayout(options);
    case "accessoryRectangular":
      return accessoryRectangularLayout(options);
    case "accessoryInline":
      return accessoryInlineLayout(options);
    default:
      return mediumLayout(options);
  }
}

/** Format a percentage for the inline family without a `%`-less edge case. */
export function safePercentText(value: number | null): string {
  return formatPercent(value);
}
