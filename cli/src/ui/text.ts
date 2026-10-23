// The screens are rows of styled segments, laid out here to an exact width
// (measured by display width, so wide characters and emoji line up) and painted
// by Ink. Only the 16 ANSI colors are used, so the terminal's theme (Omarchy's
// included) decides what they look like.
import stringWidth from "string-width";

export type Color = "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "gray";

export type Seg = {
  text: string;
  color?: Color;
  bold?: boolean;
  dim?: boolean;
  inverse?: boolean;
  strike?: boolean;
  underline?: boolean;
};
export type Row = Seg[];

export const seg = (text: string, style: Omit<Seg, "text"> = {}): Seg => ({ text, ...style });
export const widthOf = (text: string) => stringWidth(text);
export const rowWidth = (row: Row) => row.reduce((sum, s) => sum + widthOf(s.text), 0);

/** Text cut to `width` columns, with "…" when something was cut. */
export function cut(text: string, width: number): string {
  if (width <= 0) return "";
  if (widthOf(text) <= width) return text;
  let out = "";
  for (const char of text) {
    if (widthOf(out + char) > width - 1) break;
    out += char;
  }
  return out + "…";
}

/** Text cut or padded with spaces to exactly `width` columns. */
export function fit(text: string, width: number): string {
  const cutText = cut(text, width);
  return cutText + " ".repeat(Math.max(0, width - widthOf(cutText)));
}

/** A row cut to `width` columns (the last visible segment gets the "…"), then padded with `fill`. */
export function fitRow(row: Row, width: number, fill: Omit<Seg, "text"> = {}): Row {
  const out: Row = [];
  let used = 0;
  for (const s of row) {
    if (used >= width) break;
    const w = widthOf(s.text);
    if (used + w <= width) {
      out.push(s);
      used += w;
    } else {
      out.push({ ...s, text: cut(s.text, width - used) });
      used = width;
    }
  }
  if (used < width) out.push({ ...fill, text: " ".repeat(width - used) });
  return out;
}

/** Applies a style to every segment of a row (e.g. inverse for the cursor). */
export const styled = (row: Row, style: Omit<Seg, "text">): Row => row.map((s) => ({ ...s, ...style }));

/** Rows side by side, each cut to its column width, joined by `gap`. */
export function columns(blocks: { rows: Row[]; width: number }[], height: number, gap: Row = [seg(" ")]): Row[] {
  return Array.from({ length: height }, (_, y) =>
    blocks.flatMap((block, i) => [...(i > 0 ? gap : []), ...fitRow(block.rows[y] ?? [], block.width)]),
  );
}

/** Exactly `height` rows: cut, or filled with empty ones. */
export const toHeight = (rows: Row[], height: number): Row[] => [...rows.slice(0, height), ...Array.from({ length: Math.max(0, height - rows.length) }, () => [])];

/** Plain text of rows, for tests and text screenshots. */
export const rowsText = (rows: Row[]) => rows.map((row) => row.map((s) => s.text).join("").trimEnd()).join("\n");

/**
 * The first visible row of a window of `height` rows over `count` rows that
 * keeps row `at` in view, centred where possible. Stateless, so painting and
 * mouse hit-testing always agree on what is where.
 */
export function windowStart(count: number, at: number, height: number): number {
  if (count <= height || height <= 0) return 0;
  return Math.max(0, Math.min(at - Math.floor(height / 2), count - height));
}
