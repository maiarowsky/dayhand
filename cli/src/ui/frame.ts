// The whole screen from a snapshot: the views bar, a heading, the content, the
// status line (messages, prompts, the connection) and the keys. Pure, so the
// tests and the text screenshots render exactly what the terminal shows.
import { dayText } from "../i18n/dates.js";
import { t } from "../i18n/index.js";
import { formatTimestamp } from "../render/format.js";
import { addDays } from "../when/calendar.js";
import { whenText } from "./effects.js";
import { derive, contentHeight, type Snapshot } from "./model.js";
import { healthRow } from "./health.js";
import { agentsScreen, approvalRows, approvalScreen } from "./screens/agents.js";
import { parseMove, parseQuickAdd } from "./quickadd.js";
import { boardScreen } from "./screens/board.js";
import { detailRows, detailScreen } from "./screens/detail.js";
import { editScreen, fieldSegs, helpRows, helpScreen } from "./screens/overlay.js";
import { hitRow, offsetHits, type Hit, type Screen } from "./screens/screen.js";
import { messageScreen, todayScreen, trashScreen } from "./screens/today.js";
import { weekScreen } from "./screens/week.js";
import { viewLabel, VIEWS, type EditField, type Mode } from "./state.js";
import { cut, fitRow, rowWidth, seg, widthOf, type Row } from "./text.js";

export const MIN_COLUMNS = 40;
export const MIN_ROWS = 10;

const clock = (at: number, timezone?: string) => formatTimestamp(at, timezone).slice(11, 16);

function tabBar(s: Snapshot): Screen {
  const row: Row = [seg(" Dayhand ", { bold: true, color: "cyan" })];
  const hits: Hit[] = [];
  for (const [i, view] of VIEWS.entries()) {
    const label = ` ${i + 1} ${viewLabel(view)} `;
    hits.push(hitRow(0, widthOf(label), { kind: "tab", view }, rowWidth(row) + 1));
    row.push(seg(" "), seg(label, { inverse: s.ui.view === view && !s.ui.detail, bold: s.ui.view === view }));
  }
  const status = connection(s);
  const room = s.columns - rowWidth(row) - rowWidth(status);
  return { rows: [room > 0 ? [...row, seg(" ".repeat(room)), ...status] : row], hits };
}

function connection(s: Snapshot): Row {
  if (s.busy) return [seg(t("conn.saving"), { color: "yellow" })];
  switch (s.conn.state) {
    case "connecting":
      return [seg(t("conn.connecting"), { dim: true })];
    case "online":
      return [seg("● ", { color: "green" }), seg(`${clock(s.conn.at, s.timezone)} `, { dim: true })];
    case "throttled":
      return [seg(t("conn.waiting"), { color: "yellow" })];
    case "offline":
      return [seg(t("conn.offline"), { color: "red", bold: true })];
    case "rejected":
      return [seg(t("conn.rejected"), { color: "red", bold: true })];
  }
}

function heading(s: Snapshot): Row {
  const filter: Row = s.ui.filter ? [seg(`  ${t("heading.filter", { filter: s.ui.filter })}`, { color: "yellow" }), seg(t("heading.filterClears"), { dim: true })] : [];
  const text = (() => {
    if (s.ui.detail) return t("heading.details");
    switch (s.ui.view) {
      case "today":
        return s.data.today ? t("heading.today", { date: dayText(s.data.today.date), timezone: s.data.today.timezone }) : viewLabel("today");
      case "board":
        return s.data.board ? t("heading.board", { todo: s.data.board.todo.length, doing: s.data.board.doing.length, done: s.data.board.done.length }) : viewLabel("board");
      case "week":
        return t("heading.week", { from: dayText(s.ui.weekStart), to: dayText(addDays(s.ui.weekStart, 6)) });
      case "trash":
        return t("heading.trash", { count: s.data.trash?.length ?? 0 });
      case "agents":
        return viewLabel("agents");
    }
  })();
  return [seg(` ${text}`, { bold: true }), ...filter];
}

function content(s: Snapshot, height: number): Screen {
  const { ui, data } = s;
  const width = s.columns;
  const { sections, columns, days, lists } = derive(s);
  if (ui.mode.kind === "help") return helpScreen(ui.mode.scroll, width, height);
  if (ui.mode.kind === "approval") return approvalScreen(ui.mode, s.timezone, width, height);
  if (ui.mode.kind === "edit") {
    const mode = ui.mode;
    const task = [lists.detail, ...lists.today, ...lists.board.flat(), ...lists.week.flat()].find((t) => t?.id === mode.taskId);
    const title = task ? `${task.ref === undefined ? "" : `#${task.ref} `}${task.title}` : "task";
    return editScreen(title, mode.fields, mode.focus, (f) => fieldPreview(f, s), width, height);
  }
  if (ui.detail) return detailScreen(data.detail?.task.id === ui.detail.taskId ? data.detail : undefined, ui.detail.scroll, s.today, s.timezone, width, height, s.now);
  const loaded = { today: data.today, board: data.board, week: data.week?.start === ui.weekStart ? data.week : undefined, trash: data.trash, agents: data.agents }[ui.view];
  if (!loaded) return messageScreen(waiting(s), height);
  const c = ui.cursor;
  switch (ui.view) {
    case "today": {
      const body = todayScreen(sections, c.today, s.today, width, height - 1);
      return { rows: [data.health ? healthRow(data.health) : [], ...body.rows], hits: offsetHits(body.hits, 1) };
    }
    case "agents":
      return agentsScreen(data.agents!.controls, lists.agents, c.agents, s.today, width, height);
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
    return [[seg(`  ${s.conn.message}`, { color: "red", bold: true })], [], [seg(`  ${s.conn.state === "rejected" ? t("conn.login") : t("conn.retrying", { seconds: s.interval })}`, { dim: true })]];
  }
  return [[seg(`  ${t("conn.loading")}`, { dim: true })]];
}

function fieldPreview(field: EditField, s: Snapshot): Row {
  if (field.key !== "due" || !s.timezone) return [];
  const text = field.line.text.trim();
  if (!text) return [seg(`→ ${t("day.none")}`, { dim: true })];
  const target = parseMove(text, { now: s.now, timezone: s.timezone });
  return target === undefined ? [seg(t("prompt.notADate"), { color: "red" })] : [seg(`→ ${whenText(target, s.today)}`, { color: "green" })];
}

/** The prompt line: what is being typed, with a preview of how it will be read. */
function promptRow(mode: Extract<Mode, { kind: "prompt" }>, s: Snapshot): Row {
  const lead: Row = [seg(` ${t(`prompt.${mode.prompt}`)}: `, { bold: true, color: "cyan" })];
  const preview = promptPreview(mode, s);
  const room = Math.max(10, s.columns - rowWidth(lead) - rowWidth(preview) - 2);
  return [...lead, ...fieldSegs(mode.line, room, true), seg("  "), ...preview];
}

function promptPreview(mode: Extract<Mode, { kind: "prompt" }>, s: Snapshot): Row {
  const text = mode.line.text.trim();
  if (mode.prompt === "reject") return text ? [] : [seg(t("prompt.reasonRequired"), { color: "red" })];
  if (!s.timezone || mode.prompt === "filter" || mode.prompt === "note") {
    return mode.prompt === "note" ? [seg(t("prompt.makeNow"), { dim: true })] : [];
  }
  const context = { now: s.now, timezone: s.timezone };
  if (mode.prompt === "move") {
    const target = text ? parseMove(text, context) : undefined;
    return target === undefined ? [seg(text ? t("prompt.notADate") : "tomorrow, fri 14:00, none…", { dim: !text, color: text ? "red" : undefined })] : [seg(`→ ${whenText(target, s.today)}`, { color: "green" })];
  }
  if (!text) return [seg(t("prompt.addExample"), { dim: true })];
  const parsed = parseQuickAdd(text, context);
  const due = parsed.due === undefined ? { date: mode.date ?? s.today } : parsed.due;
  const labels = parsed.labels.map((l) => `#${l}`).join(" ");
  return [seg(`→ ${whenText(due, s.today)}${labels ? ` ${labels}` : ""}${mode.status ? t("prompt.doing") : ""}`, { color: parsed.title ? "green" : "red" })];
}

function statusRow(s: Snapshot): Row {
  const mode = s.ui.mode;
  if (mode.kind === "prompt") return promptRow(mode, s);
  if (mode.kind === "confirm") return [seg(t("confirm.trash", { ref: mode.ref, title: mode.title }), { bold: true, color: "yellow" }), seg("y/N", { bold: true })];
  if (mode.kind === "approval") return [seg(` ${t(mode.optionId ? "confirm.approval" : "hints.approval")}`, { bold: true, color: "yellow" })];
  if (s.flash) return [seg(` ${s.flash.text}`, { color: s.flash.tone === "error" ? "red" : s.flash.tone === "ok" ? "green" : undefined, bold: s.flash.tone === "error" })];
  if (s.conn.state === "offline" || s.conn.state === "throttled" || s.conn.state === "rejected") {
    const since = "at" in s.conn && s.conn.at ? t("conn.since", { time: clock(s.conn.at, s.timezone) }) : "";
    return [seg(` ${s.conn.message}${since}`, { color: s.conn.state === "throttled" ? "yellow" : "red" })];
  }
  return [];
}

function keysRow(s: Snapshot): Row {
  const mode = s.ui.mode.kind;
  const hints = (() => {
    if (mode === "help") return t("hints.help");
    if (s.ui.mode.kind === "approval") return t(s.ui.mode.optionId ? "hints.approvalConfirm" : "hints.approval");
    if (mode === "prompt" || mode === "edit") return t("hints.typing") + (mode === "edit" ? t("hints.nextField") : "");
    if (mode === "confirm") return t("hints.confirm");
    if (s.ui.detail) return t(s.data.detail?.task.proposedAt ? "hints.proposal" : "hints.detail");
    if (s.ui.view === "agents") return t("hints.agents");
    if (s.ui.view === "board") return t("hints.board");
    if (s.ui.view === "week") return t("hints.week");
    if (s.ui.view === "trash") return t("hints.trash");
    return t("hints.today");
  })();
  return [seg(` ${cut(hints, s.columns - 2)}`, { dim: true })];
}

/** How far details and help can scroll before their last row leaves the bottom. */
export function scrollLimits(s: Snapshot): { detail: number; help: number; approval: number } {
  const height = contentHeight(s.rows);
  const detail = s.ui.detail && s.data.detail ? detailRows(s.data.detail, s.today, s.timezone, s.columns, s.now).length : 0;
  const approval = s.ui.mode.kind === "approval" ? approvalRows(s.ui.mode, s.timezone, s.columns).length : 0;
  return { detail: Math.max(0, detail - height), help: Math.max(0, helpRows(s.columns).length - height), approval: Math.max(0, approval - height) };
}

export function frame(s: Snapshot): Screen {
  if (s.columns < MIN_COLUMNS || s.rows < MIN_ROWS) {
    const lines = [t("small.title"), t("small.size", { columns: s.columns, rows: s.rows, minColumns: MIN_COLUMNS, minRows: MIN_ROWS }), t("small.quit")];
    return { rows: lines.map((text, i) => [seg(cut(text, s.columns), { bold: i === 0 })]), hits: [] };
  }
  const height = contentHeight(s.rows);
  const tabs = tabBar(s);
  const body = content(s, height);
  const rows = [tabs.rows[0]!, heading(s), ...body.rows, statusRow(s), keysRow(s)].map((row) => fitRow(row, s.columns));
  return { rows, hits: [...tabs.hits, ...offsetHits(body.hits, 2)] };
}
