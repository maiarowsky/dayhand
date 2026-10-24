// The board: todo, doing and done side by side, each column scrolling on its
// own; below 60 columns one column at a time with the others named on top.
import { t } from "../../i18n/index.js";
import type { Column } from "../lists.js";
import { refWidthOf, taskRow } from "../rows.js";
import { columns, fitRow, seg, toHeight, windowStart, type Row } from "../text.js";
import { hitRow, type Hit, type Screen } from "./screen.js";

const WIDE = 60;

function columnBlock(column: Column, cursor: number, focused: boolean, today: string, width: number, height: number, x0: number, columnIndex: number) {
  const heading = fitRow([seg(` ${column.label} (${column.tasks.length})`, { bold: true, underline: focused })], width, {});
  const start = windowStart(column.tasks.length, cursor, height - 1);
  const shown = column.tasks.slice(start, start + height - 1);
  const refWidth = refWidthOf(column.tasks);
  const rows: Row[] = [focused ? heading.map((s) => ({ ...s, inverse: true })) : heading];
  const hits: Hit[] = [];
  if (column.tasks.length === 0) rows.push([seg(`  ${t("column.empty")}`, { dim: true })]);
  shown.forEach((task, i) => {
    const index = start + i;
    rows.push(taskRow(task, { width, today, selected: focused && index === cursor, refWidth, due: "day" }));
    hits.push(hitRow(rows.length - 1, width, { kind: "task", index, column: columnIndex }, x0));
  });
  return { rows, hits };
}

export function boardScreen(board: Column[], focus: number, cursors: number[], today: string, width: number, height: number): Screen {
  if (width >= WIDE) {
    const colWidth = Math.floor((width - 2) / 3);
    const blocks = board.map((column, i) => columnBlock(column, cursors[i] ?? 0, i === focus, today, colWidth, height, i * (colWidth + 1), i));
    const separator = [seg("│", { dim: true })];
    return { rows: columns(blocks.map((b) => ({ rows: b.rows, width: colWidth })), height, separator), hits: blocks.flatMap((b) => b.hits) };
  }
  // One column at a time: "‹ TODO 3 │ DOING 1 │ DONE 5 ›" names them all.
  const tabs: Row = [seg("‹ ", { dim: true })];
  board.forEach((column, i) => {
    if (i) tabs.push(seg(" │ ", { dim: true }));
    tabs.push(seg(`${column.label} ${column.tasks.length}`, { bold: i === focus, inverse: i === focus }));
  });
  tabs.push(seg(" ›", { dim: true }));
  const block = columnBlock(board[focus]!, cursors[focus] ?? 0, true, today, width, height, 0, focus);
  return { rows: toHeight([tabs, ...block.rows.slice(1)], height), hits: block.hits };
}
