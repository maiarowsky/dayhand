// The whole screen from a snapshot: the views bar, a heading, the content, the
// status line (messages, prompts, the connection) and the keys. Pure, so the
// tests and the text screenshots render exactly what the terminal shows.
import { formatDay, formatTimestamp } from "../render/format.js";
import { addDays } from "../when/calendar.js";
import { whenText } from "./effects.js";
import { derive, contentHeight, type Snapshot } from "./model.js";
import { parseMove, parseQuickAdd } from "./quickadd.js";
import { boardScreen } from "./screens/board.js";
import { detailRows, detailScreen } from "./screens/detail.js";
import { editScreen, fieldSegs, helpRows, helpScreen } from "./screens/overlay.js";
import { hitRow, offsetHits, type Hit, type Screen } from "./screens/screen.js";
import { messageScreen, todayScreen, trashScreen } from "./screens/today.js";
import { weekScreen } from "./screens/week.js";
import { VIEW_LABELS, VIEWS, type EditField, type Mode } from "./state.js";
import { cut, fitRow, rowWidth, seg, type Row } from "./text.js";

export const MIN_COLUMNS = 40;
export const MIN_ROWS = 10;

const clock = (at: number, timezone?: string) => formatTimestamp(at, timezone).slice(11, 16);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function tabBar(s: Snapshot): Screen {
  const row: Row = [seg(" Helm ", { bold: true, color: "cyan" })];
  const hits: Hit[] = [];
  for (const [i, view] of VIEWS.entries()) {
    const label = ` ${i + 1} ${VIEW_LABELS[view]} `;
    hits.push(hitRow(0, label.length, { kind: "tab", view }, rowWidth(row) + 1));
    row.push(seg(" "), seg(label, { inverse: s.ui.view === view && !s.ui.detail, bold: s.ui.view === view }));
  }
  const status = connection(s);
  const room = s.columns - rowWidth(row) - rowWidth(status);
  return { rows: [room > 0 ? [...row, seg(" ".repeat(room)), ...status] : row], hits };
}

function connection(s: Snapshot): Row {
  if (s.busy) return [seg("● saving… ", { color: "yellow" })];
  switch (s.conn.state) {
    case "connecting":
      return [seg("○ connecting ", { dim: true })];
    case "online":
      return [seg("● ", { color: "green" }), seg(`${clock(s.conn.at, s.timezone)} `, { dim: true })];
    case "throttled":
      return [seg("● waiting ", { color: "yellow" })];
    case "offline":
      return [seg("● offline ", { color: "red", bold: true })];
    case "rejected":
      return [seg("● key rejected ", { color: "red", bold: true })];
  }
}

function heading(s: Snapshot): Row {
  const filter: Row = s.ui.filter ? [seg(`  filter: ${s.ui.filter}`, { color: "yellow" }), seg(" (Esc clears)", { dim: true })] : [];
  const text = (() => {
    if (s.ui.detail) return "Task details · Esc back";
    switch (s.ui.view) {
      case "today":
        return s.data.today ? `Today, ${formatDay(s.data.today.date)} · ${s.data.today.timezone}` : "Today";
      case "board":
        return s.data.board ? `Board · ${s.data.board.todo.length} todo · ${s.data.board.doing.length} doing · ${s.data.board.done.length} done (latest)` : "Board";
      case "week":
        return `Week of ${formatDay(s.ui.weekStart)} – ${formatDay(addDays(s.ui.weekStart, 6))}`;
      case "trash":
        return `Trash · ${plural(s.data.trash?.length ?? 0, "task")} · purged 30 days after they were deleted`;
    }
  })();
  return [seg(` ${text}`, { bold: true }), ...filter];
}

function content(s: Snapshot, height: number): Screen {
  const { ui, data } = s;
  const width = s.columns;
  const { sections, columns, days, lists } = derive(s);
  if (ui.mode.kind === "help") return helpScreen(ui.mode.scroll, width, height);
  if (ui.mode.kind === "edit") {
    const mode = ui.mode;
    const task = [lists.detail, ...lists.today, ...lists.board.flat(), ...lists.week.flat()].find((t) => t?.id === mode.taskId);
    const title = task ? `${task.ref === undefined ? "" : `#${task.ref} `}${task.title}` : "task";
    return editScreen(title, mode.fields, mode.focus, (f) => fieldPreview(f, s), width, height);
  }
  if (ui.detail) return detailScreen(data.detail?.task.id === ui.detail.taskId ? data.detail : undefined, ui.detail.scroll, s.today, s.timezone, width, height);
  const loaded = { today: data.today, board: data.board, week: data.week?.start === ui.weekStart ? data.week : undefined, trash: data.trash }[ui.view];
  if (!loaded) return messageScreen(waiting(s), height);
  const c = ui.cursor;
  switch (ui.view) {
    case "today":
      return todayScreen(sections, c.today, s.today, width, height);
    case "board":
      return boardScreen(columns, c.boardColumn, c.board, s.today, width, height);
    case "week":
      return weekScreen(days, c.weekDay, c.weekRow, s.today, width, height);
    case "trash":
      return trashScreen(lists.trash, c.trash, s.today, s.timezone, width, height);
  }
}

function waiting(s: Snapshot): Row[] {
  if (s.conn.state === "offline" || s.conn.state === "rejected") {
    return [[seg(`  ${s.conn.message}`, { color: "red", bold: true })], [], [seg(s.conn.state === "rejected" ? "  Run hlm login in another terminal, then press R." : `  Retrying every ${s.interval} s; R retries now, q quits.`, { dim: true })]];
  }
  return [[seg("  Loading…", { dim: true })]];
}

function fieldPreview(field: EditField, s: Snapshot): Row {
  if (field.key !== "due" || !s.timezone) return [];
  const text = field.line.text.trim();
  if (!text) return [seg("→ no day", { dim: true })];
  const target = parseMove(text, { now: s.now, timezone: s.timezone });
  return target === undefined ? [seg("not a date yet", { color: "red" })] : [seg(`→ ${whenText(target, s.today)}`, { color: "green" })];
}

/** The prompt line: what is being typed, with a preview of how it will be read. */
function promptRow(mode: Extract<Mode, { kind: "prompt" }>, s: Snapshot): Row {
  const labels = { add: "Add", move: "Move to", note: "Resume note", filter: "Filter" };
  const lead: Row = [seg(` ${labels[mode.prompt]}: `, { bold: true, color: "cyan" })];
  const preview = promptPreview(mode, s);
  const room = Math.max(10, s.columns - rowWidth(lead) - rowWidth(preview) - 2);
  return [...lead, ...fieldSegs(mode.line, room, true), seg("  "), ...preview];
}

function promptPreview(mode: Extract<Mode, { kind: "prompt" }>, s: Snapshot): Row {
  const text = mode.line.text.trim();
  if (!s.timezone || mode.prompt === "filter" || mode.prompt === "note") {
    return mode.prompt === "note" ? [seg("Enter: make it the now task", { dim: true })] : [];
  }
  const context = { now: s.now, timezone: s.timezone };
  if (mode.prompt === "move") {
    const target = text ? parseMove(text, context) : undefined;
    return target === undefined ? [seg(text ? "not a date yet" : "tomorrow, fri 14:00, none…", { dim: !text, color: text ? "red" : undefined })] : [seg(`→ ${whenText(target, s.today)}`, { color: "green" })];
  }
  if (!text) return [seg('e.g. Call the accountant fri 2pm #home', { dim: true })];
  const parsed = parseQuickAdd(text, context);
  const due = parsed.due === undefined ? { date: mode.date ?? s.today } : parsed.due;
  const labels = parsed.labels.map((l) => `#${l}`).join(" ");
  return [seg(`→ ${whenText(due, s.today)}${labels ? ` ${labels}` : ""}${mode.status ? " · doing" : ""}`, { color: parsed.title ? "green" : "red" })];
}

function statusRow(s: Snapshot): Row {
  const mode = s.ui.mode;
  if (mode.kind === "prompt") return promptRow(mode, s);
  if (mode.kind === "confirm") return [seg(` Move ${mode.ref} ${mode.title} to the trash? `, { bold: true, color: "yellow" }), seg("y/N", { bold: true })];
  if (s.flash) return [seg(` ${s.flash.text}`, { color: s.flash.tone === "error" ? "red" : s.flash.tone === "ok" ? "green" : undefined, bold: s.flash.tone === "error" })];
  if (s.conn.state === "offline" || s.conn.state === "throttled" || s.conn.state === "rejected") {
    const since = "at" in s.conn && s.conn.at ? ` · showing data from ${clock(s.conn.at, s.timezone)}` : "";
    return [seg(` ${s.conn.message}${since}`, { color: s.conn.state === "throttled" ? "yellow" : "red" })];
  }
  return [];
}

function keysRow(s: Snapshot): Row {
  const mode = s.ui.mode.kind;
  const hints = (() => {
    if (mode === "help") return "any key closes · j/k scroll";
    if (mode === "prompt" || mode === "edit") return "Enter save · Esc cancel" + (mode === "edit" ? " · Tab next field" : "");
    if (mode === "confirm") return "y moves it to the trash · any other key keeps it";
    if (s.ui.detail) return "Esc back  j/k scroll  ␣ done  s start  n now  e edit  E editor  m move  d trash  ? help";
    if (s.ui.view === "board") return "? help  h/l column  H/L move  a add  ␣ done  e edit  d trash  / filter  Tab views  q quit";
    if (s.ui.view === "week") return "? help  h/l day  H/L move a day  [ ] weeks  t today  a add  ␣ done  Enter open  q quit";
    if (s.ui.view === "trash") return "? help  r restore  Enter open  / filter  Tab views  q quit";
    return "? help  a add  ␣ done  s start  n now  e edit  m move  d trash  / filter  Tab views  q quit";
  })();
  return [seg(` ${cut(hints, s.columns - 2)}`, { dim: true })];
}

/** How far details and help can scroll before their last row leaves the bottom. */
export function scrollLimits(s: Snapshot): { detail: number; help: number } {
  const height = contentHeight(s.rows);
  const detail = s.ui.detail && s.data.detail ? detailRows(s.data.detail, s.today, s.timezone, s.columns).length : 0;
  return { detail: Math.max(0, detail - height), help: Math.max(0, helpRows(s.columns).length - height) };
}

export function frame(s: Snapshot): Screen {
  if (s.columns < MIN_COLUMNS || s.rows < MIN_ROWS) {
    const lines = ["Terminal too small", `now ${s.columns}×${s.rows}, needs ${MIN_COLUMNS}×${MIN_ROWS}`, "q quits"];
    return { rows: lines.map((text, i) => [seg(cut(text, s.columns), { bold: i === 0 })]), hits: [] };
  }
  const height = contentHeight(s.rows);
  const tabs = tabBar(s);
  const body = content(s, height);
  const rows = [tabs.rows[0]!, heading(s), ...body.rows, statusRow(s), keysRow(s)].map((row) => fitRow(row, s.columns));
  return { rows, hits: [...tabs.hits, ...offsetHits(body.hits, 2)] };
}
