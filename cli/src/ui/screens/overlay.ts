// What opens over a view: the help (?) and the edit form (e). Text fields
// draw their cursor as an inverse cell.
import { t } from "../../i18n/index.js";
import { KEY_GROUPS } from "../keys.js";
import type { Line } from "../line.js";
import type { EditField } from "../state.js";
import { columns, cut, padTo, seg, toHeight, widthOf, type Row } from "../text.js";
import { wrap } from "./detail.js";
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

/** The key map in rows, every description wrapped whole: two columns of groups on wide terminals. */
export function helpRows(width: number): Row[] {
  const twoColumns = width >= 96;
  const half = Math.floor((width - 3) / 2);
  const groupWidth = twoColumns ? half : width;
  const group = (index: number) => {
    const g = KEY_GROUPS[index]!;
    const indent = Math.max(...g.bindings.map((b) => widthOf(b.keys))) + 4;
    const binding = (keys: string, does: string): Row[] =>
      wrap(does, groupWidth - indent).map((line, i) => [seg(padTo(i === 0 ? `  ${keys}` : "", indent), { color: "yellow" }), seg(line)]);
    return [[seg(t(g.title), { bold: true, color: "cyan" })], ...g.bindings.flatMap((b) => binding(b.keys, t(b.does))), []] as Row[];
  };
  const all = KEY_GROUPS.map((_, i) => group(i));
  const intro: Row[] = [[seg(t("help.title"), { bold: true }), seg(t("help.closes"), { dim: true })], []];
  if (!twoColumns) return [...intro, ...all.flat()];
  const left = [...all[0]!, ...all[1]!, ...all[4]!];
  const right = [...all[2]!, ...all[3]!, ...all[5]!];
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
  const rows: Row[] = [[seg(t("edit.title"), { bold: true }), seg(title, { bold: true })], []];
  fields.forEach((field, i) => {
    const focused = i === focus;
    rows.push([
      seg(focused ? "› " : "  ", { color: "cyan", bold: true }),
      seg(padTo(field.label, labelWidth), { bold: focused, dim: !focused }),
      ...fieldSegs(field.line, valueWidth, focused),
      seg("  "),
      ...preview(field),
    ]);
  });
  rows.push([], [seg(t("edit.hintDue"), { dim: true })]);
  rows.push([seg(t("edit.hintNote"), { dim: true })]);
  return { rows: toHeight(rows, height), hits: [] };
}
