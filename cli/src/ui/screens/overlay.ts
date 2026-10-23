// What opens over a view: the help (?) and the edit form (e). Text fields
// draw their cursor as an inverse cell.
import { KEY_GROUPS } from "../keys.js";
import type { Line } from "../line.js";
import type { EditField } from "../state.js";
import { columns, cut, seg, toHeight, widthOf, type Row } from "../text.js";
import type { Screen } from "./screen.js";

/** A text field: the text with the cursor cell inverted, scrolled so the cursor stays visible. */
export function fieldSegs(current: Line, width: number, focused: boolean): Row {
  const chars = [...current.text];
  const start = Math.max(0, current.cursor - Math.max(1, width - 1));
  const visible = chars.slice(start);
  const at = current.cursor - start;
  if (!focused) return [seg(cut(chars.join(""), width))];
  return [
    seg(visible.slice(0, at).join("")),
    seg(visible[at] ?? " ", { inverse: true }),
    seg(visible.slice(at + 1).join("")),
  ];
}

/** The key map in rows: two columns of groups on wide terminals. */
export function helpRows(width: number): Row[] {
  const group = (index: number) => {
    const g = KEY_GROUPS[index]!;
    const keyWidth = Math.max(...g.bindings.map((b) => widthOf(b.keys))) + 2;
    return [[seg(g.title, { bold: true, color: "cyan" })], ...g.bindings.map((b) => [seg(`  ${b.keys.padEnd(keyWidth)}`, { color: "yellow" }), seg(b.does)]), []] as Row[];
  };
  const all = KEY_GROUPS.map((_, i) => group(i));
  const intro: Row[] = [[seg("Keys", { bold: true }), seg("  (any other key closes; j/k scroll)", { dim: true })], []];
  if (width < 96) return [...intro, ...all.flat()];
  const left = [...all[0]!, ...all[1]!, ...all[4]!];
  const right = [...all[2]!, ...all[3]!];
  const half = Math.floor((width - 3) / 2);
  return [...intro, ...columns([{ rows: left, width: half }, { rows: right, width: half }], Math.max(left.length, right.length), [seg(" │ ", { dim: true })])];
}

export function helpScreen(scroll: number, width: number, height: number): Screen {
  const rows = helpRows(width);
  const top = Math.max(0, Math.min(scroll, rows.length - height));
  return { rows: toHeight(rows.slice(top, top + height), height), hits: [] };
}

export function editScreen(title: string, fields: EditField[], focus: number, preview: (field: EditField) => Row, width: number, height: number): Screen {
  const labelWidth = Math.max(...fields.map((f) => widthOf(f.label))) + 2;
  const valueWidth = Math.max(10, Math.floor((width - labelWidth - 4) * 0.6));
  const rows: Row[] = [[seg("Edit ", { bold: true }), seg(title, { bold: true })], []];
  fields.forEach((field, i) => {
    const focused = i === focus;
    rows.push([
      seg(focused ? "› " : "  ", { color: "cyan", bold: true }),
      seg(field.label.padEnd(labelWidth), { bold: focused, dim: !focused }),
      ...fieldSegs(field.line, valueWidth, focused),
      seg("  "),
      ...preview(field),
    ]);
  });
  rows.push([], [seg("Due: a phrase like fri 2pm, empty for no day · Labels: home, work", { dim: true })]);
  rows.push([seg("The note: Esc, then E opens $VISUAL / $EDITOR", { dim: true })]);
  return { rows: toHeight(rows, height), hits: [] };
}
