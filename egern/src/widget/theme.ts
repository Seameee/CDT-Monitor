/**
 * Widget theme.
 *
 * Colors are adaptive pairs so light and dark mode are both readable, and the
 * choices target at least 4.5:1 contrast against their intended background —
 * the widget must not rely on a coloured dot alone to convey state, but what
 * text it does show has to be legible.
 *
 * The theme name comes from `CDT_THEME` in the *widget* env. It only selects a
 * palette: it can never execute code or select a control target.
 */

import type { DslColor } from "../host/types.ts";

/** A resolved palette. */
export interface Theme {
  name: string;
  /** Root background. */
  background: DslColor;
  /** Nested card background. */
  card: DslColor;
  textPrimary: DslColor;
  textSecondary: DslColor;
  /** Neutral progress fill. */
  accent: DslColor;
  /** Approaching the threshold. */
  warning: DslColor;
  /** At or over the threshold. */
  danger: DslColor;
  /** Running / healthy. */
  ok: DslColor;
  /** Stopped or unknown. */
  muted: DslColor;
  /** Hairline separator. */
  separator: DslColor;
}

/** Contrast-checked adaptive palette used by the default theme. */
const DEFAULT_PALETTE: Omit<Theme, "name"> = {
  background: { light: "#FFFFFF", dark: "#1C1C1E" },
  card: { light: "#F2F2F7", dark: "#2C2C2E" },
  textPrimary: { light: "#111114", dark: "#FFFFFF" },
  textSecondary: { light: "#55555B", dark: "#B4B4BB" },
  accent: { light: "#0A54C4", dark: "#4C9AFF" },
  warning: { light: "#8A5200", dark: "#FFD60A" },
  danger: { light: "#C0271D", dark: "#FF6B60" },
  ok: { light: "#1B7A3A", dark: "#4CD964" },
  muted: { light: "#6C6C72", dark: "#9A9AA0" },
  separator: { light: "#D8D8DE", dark: "#3A3A3C" },
};

/** Fixed dark palette. */
const DARK_PALETTE: Omit<Theme, "name"> = {
  background: "#000000",
  card: "#1C1C1E",
  textPrimary: "#FFFFFF",
  textSecondary: "#B4B4BB",
  accent: "#4C9AFF",
  warning: "#FFD60A",
  danger: "#FF6B60",
  ok: "#4CD964",
  muted: "#9A9AA0",
  separator: "#3A3A3C",
};

/** Fixed light palette. */
const LIGHT_PALETTE: Omit<Theme, "name"> = {
  background: "#FFFFFF",
  card: "#F2F2F7",
  textPrimary: "#111114",
  textSecondary: "#55555B",
  accent: "#0A54C4",
  warning: "#8A5200",
  danger: "#C0271D",
  ok: "#1B7A3A",
  muted: "#6C6C72",
  separator: "#D8D8DE",
};

/** Theme names accepted from `CDT_THEME`. */
export const THEME_NAMES = ["auto", "dark", "light"] as const;

/** A theme name. */
export type ThemeName = (typeof THEME_NAMES)[number];

/**
 * Resolve a theme.
 *
 * An unknown name falls back to `auto` rather than failing: a typo in a
 * cosmetic variable must not blank the widget.
 */
export function resolveTheme(name: string | null | undefined): Theme {
  switch (name) {
    case "dark":
      return { name: "dark", ...DARK_PALETTE };
    case "light":
      return { name: "light", ...LIGHT_PALETTE };
    default:
      return { name: "auto", ...DEFAULT_PALETTE };
  }
}

/** Pick the color for a usage state. */
export function usageColor(
  theme: Theme,
  state: "ok" | "warning" | "danger" | "muted",
): DslColor {
  switch (state) {
    case "ok":
      return theme.ok;
    case "warning":
      return theme.warning;
    case "danger":
      return theme.danger;
    default:
      return theme.muted;
  }
}

/**
 * Convert an adaptive color to a concrete `rgb()` string for use inside an SVG.
 *
 * SVG lives in a data URI where a bare `#` would terminate the URI, so hex is
 * never emitted verbatim — this mirrors the official inline-SVG example, which
 * uses `rgb(...)` for exactly this reason.
 */
export function svgColor(color: DslColor, dark: boolean): string {
  const hex = typeof color === "string" ? color : dark ? color.dark : color.light;
  return hexToRgbFunction(hex);
}

/** Convert `#RGB`/`#RRGGBB`/`#RRGGBBAA` to `rgb()`/`rgba()`; pass through otherwise. */
export function hexToRgbFunction(value: string): string {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(value.trim());
  if (match === null) {
    // Already an rgb()/rgba()/named color, or something we do not understand.
    // Returning it unchanged keeps the SVG valid and avoids injecting '#'
    // speculation into the data URI.
    return value.replace(/#/g, "");
  }
  let hex = match[1] as string;
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((character) => character + character)
      .join("");
  }
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  if (hex.length === 8) {
    const alpha = parseInt(hex.slice(6, 8), 16) / 255;
    return `rgba(${red},${green},${blue},${alpha.toFixed(3)})`;
  }
  return `rgb(${red},${green},${blue})`;
}
