// Aligned columns measured by display width (string-width), so wide and
// combining characters line up. One flexible column is shortened with "…"
// when a terminal width is given; without one (a pipe) nothing is cut.
import stringWidth from "string-width";

export type Cell = { text: string; paint?: (text: string) => string };
export type TableOptions = { width?: number; flex?: number; indent?: number; gap?: number; minFlex?: number };

const segmenter = new Intl.Segmenter();

/** Shortens text to at most `width` columns, ending in "…" when cut. */
export function truncate(text: string, width: number): string {
  if (stringWidth(text) <= width) return text;
  let result = "";
  let used = 0;
  for (const { segment } of segmenter.segment(text)) {
    const w = stringWidth(segment);
    if (used + w > width - 1) break;
    result += segment;
    used += w;
  }
  return result + "…";
}

export const cellOf = (text: string, paint?: (text: string) => string): Cell => ({ text, paint });

export function table(rows: Cell[][], options: TableOptions = {}): string[] {
  const { indent = 2, gap = 2, minFlex = 12 } = options;
  const count = Math.max(0, ...rows.map((r) => r.length));
  const widths = Array.from({ length: count }, (_, i) => Math.max(0, ...rows.map((r) => stringWidth(r[i]?.text ?? ""))));
  // Empty columns take no space at all.
  const used = widths.map((w) => w > 0);
  if (options.width !== undefined && options.flex !== undefined && widths[options.flex] !== undefined) {
    const others = widths.reduce((sum, w, i) => (i === options.flex || !used[i] ? sum : sum + w + gap), 0);
    widths[options.flex] = Math.max(minFlex, Math.min(widths[options.flex]!, options.width - indent - others));
  }
  return rows.map((row) => {
    const last = row.reduce((at, cell, i) => (cell.text !== "" && used[i] ? i : at), -1);
    const parts: string[] = [];
    row.forEach((cell, i) => {
      if (!used[i] || i > last) return;
      const text = i === options.flex && options.width !== undefined ? truncate(cell.text, widths[i]!) : cell.text;
      const painted = cell.paint ? cell.paint(text) : text;
      parts.push(i === last ? painted : painted + " ".repeat(Math.max(0, widths[i]! - stringWidth(text))));
    });
    return " ".repeat(indent) + parts.join(" ".repeat(gap));
  });
}

/** Pads possibly colored text to a display width. */
export const padTo = (text: string, width: number) => text + " ".repeat(Math.max(0, width - stringWidth(text)));
