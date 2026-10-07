/**
 * Local SVG generation for progress rings, bars and sparklines.
 *
 * Constraints from the contract and the official docs:
 *  - an SVG must carry `xmlns` and a `viewBox`;
 *  - the source must stay far below the documented 512 KB limit;
 *  - it is emitted as an **inline** `data:image/svg+xml,...` URI, where a bare
 *    `#` would end the URI — so every colour goes through `rgb()`/`rgba()`;
 *  - no user-supplied text is ever interpolated into markup. Labels are drawn by
 *    DSL `text` nodes instead, which removes the injection surface entirely
 *    rather than relying on escaping.
 */

import { hexToRgbFunction } from "./theme.ts";

/** Hard cap on generated SVG size. Far below the 512 KB platform limit. */
export const MAX_SVG_BYTES = 64 * 1024;

/** Escape text for XML. Kept for any future need; labels currently use text nodes. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Round to two decimals to keep the markup short. */
function num(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 100) / 100);
}

/** Clamp a fraction to `[0, 1]`; graphics never overshoot. */
function fraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Wrap SVG body markup into a `data:` URI.
 *
 * Returns null when the result would exceed {@link MAX_SVG_BYTES}, in which case
 * callers must omit the image rather than emit a truncated document.
 */
export function toSvgDataUri(viewBox: string, body: string): string | null {
  const markup = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}'>${body}</svg>`;
  if (markup.length > MAX_SVG_BYTES) return null;
  return `data:image/svg+xml,${markup}`;
}

/**
 * Circular progress ring.
 *
 * `size` is the square edge in points. Both the track and the progress arc are
 * emitted so the ring still reads when progress is zero.
 */
export function progressRing(options: {
  fraction: number;
  size: number;
  strokeWidth: number;
  trackColor: string;
  progressColor: string;
}): string | null {
  const { size, strokeWidth } = options;
  const radius = (size - strokeWidth) / 2;
  if (!(radius > 0)) return null;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = fraction(options.fraction);
  const dash = circumference * filled;

  const track = hexToRgbFunction(options.trackColor);
  const progress = hexToRgbFunction(options.progressColor);

  const body =
    `<circle cx='${num(center)}' cy='${num(center)}' r='${num(radius)}' fill='none' ` +
    `stroke='${track}' stroke-opacity='0.25' stroke-width='${num(strokeWidth)}'/>` +
    `<circle cx='${num(center)}' cy='${num(center)}' r='${num(radius)}' fill='none' ` +
    `stroke='${progress}' stroke-width='${num(strokeWidth)}' stroke-linecap='round' ` +
    `stroke-dasharray='${num(circumference)}' stroke-dashoffset='${num(circumference - dash)}' ` +
    `transform='rotate(-90 ${num(center)} ${num(center)})'/>`;

  return toSvgDataUri(`0 0 ${num(size)} ${num(size)}`, body);
}

/** Horizontal progress bar. */
export function progressBar(options: {
  fraction: number;
  width: number;
  height: number;
  trackColor: string;
  progressColor: string;
  radius?: number;
}): string | null {
  const { width, height } = options;
  if (!(width > 0) || !(height > 0)) return null;
  const radius = options.radius ?? height / 2;
  const filled = fraction(options.fraction);
  const track = hexToRgbFunction(options.trackColor);
  const progress = hexToRgbFunction(options.progressColor);

  const body =
    `<rect x='0' y='0' width='${num(width)}' height='${num(height)}' rx='${num(radius)}' ` +
    `fill='${track}' fill-opacity='0.25'/>` +
    `<rect x='0' y='0' width='${num(width * filled)}' height='${num(height)}' rx='${num(radius)}' ` +
    `fill='${progress}'/>`;

  return toSvgDataUri(`0 0 ${num(width)} ${num(height)}`, body);
}

/**
 * Sparkline over a numeric series.
 *
 * Fewer than two usable points returns null: a one-point "trend" is not a trend,
 * and drawing it would imply history that does not exist.
 */
export function sparkline(options: {
  values: readonly number[];
  width: number;
  height: number;
  color: string;
  fill?: boolean;
}): string | null {
  const usable = options.values.filter((value) => Number.isFinite(value));
  if (usable.length < 2) return null;
  const { width, height } = options;
  if (!(width > 0) || !(height > 0)) return null;

  const minimum = Math.min(...usable);
  const maximum = Math.max(...usable);
  const span = maximum - minimum;
  const stepX = width / (usable.length - 1);
  // A flat series is drawn mid-height rather than as a zero-height line.
  const scaleY = (value: number): number =>
    span === 0 ? height / 2 : height - ((value - minimum) / span) * height;

  const points = usable
    .map((value, index) => `${num(index * stepX)},${num(scaleY(value))}`)
    .join(" ");

  const color = hexToRgbFunction(options.color);
  const fillBody =
    options.fill === true
      ? `<polygon points='0,${num(height)} ${points} ${num(width)},${num(height)}' fill='${color}' fill-opacity='0.18'/>`
      : "";

  const body =
    fillBody +
    `<polyline points='${points}' fill='none' stroke='${color}' stroke-width='2' ` +
    `stroke-linejoin='round' stroke-linecap='round'/>`;

  return toSvgDataUri(`0 0 ${num(width)} ${num(height)}`, body);
}
