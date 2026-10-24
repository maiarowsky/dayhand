// The owner's agents inbox, and a request's numbered choices with a separate confirmation.
import { t } from "../../i18n/index.js";
import { formatTimestamp } from "../../render/format.js";
import type { AgentItem, Controls, WorkTask } from "../agents.js";
import { refWidthOf, taskRow } from "../rows.js";
import { clamp, type Mode } from "../state.js";
import { seg, styled, toHeight, windowStart, type Row } from "../text.js";
import { wrap } from "./detail.js";
import { hitRow, offsetHits, type Screen } from "./screen.js";

type Line = { row: Row; index?: number };

export function agentsScreen(controls: Controls, items: AgentItem[], cursor: number, today: string, width: number, height: number): Screen {
  cursor = clamp(cursor, items.length);
  const pause: Row[] = [
    [seg(t("section.pause"), { bold: true })],
    [seg(`  ${t(controls.paused ? "agents.paused" : "agents.running")}${controls.reason ? ` (${controls.reason})` : ""}`, { color: controls.paused ? "yellow" : "green" })],
    [],
  ];
  const approvals = items.filter((item) => item.kind === "approval");
  const proposals = items.filter((item) => item.kind === "proposal");
  const lines: Line[] = [{ row: [seg(`${t("section.approvals")} (${approvals.length})`, { bold: true, color: "yellow" })] }];
  if (!approvals.length) lines.push({ row: [seg(`  ${t("agents.noApprovals")}`, { dim: true })] });
  let index = 0;
  for (const { approval } of approvals) {
    const row = [seg(index === cursor ? "› " : "  ", { color: "cyan" }), seg(approval.action), seg(` · ${approval.requestedBy.name}`, { dim: true })];
    lines.push({ row: index === cursor ? styled(row, { inverse: true }) : row, index: index++ });
  }
  lines.push({ row: [] }, { row: [seg(`${t("section.proposals")} (${proposals.length})`, { bold: true, color: "cyan" })] });
  if (!proposals.length) lines.push({ row: [seg(`  ${t("agents.noProposals")}`, { dim: true })] });
  const refWidth = refWidthOf(proposals.map((item) => item.task));
  for (const { task } of proposals) {
    lines.push({ row: taskRow(task, { width, today, selected: index === cursor, refWidth, note: (task as WorkTask).requestedBy }), index: index++ });
  }
  const room = Math.max(1, height - pause.length);
  const at = Math.max(0, lines.findIndex((line) => line.index === cursor));
  const start = windowStart(lines.length, at, room);
  const shown = lines.slice(start, start + room);
  const hits = shown.flatMap((line, y) => line.index === undefined ? [] : [hitRow(y, width, { kind: "agent", index: line.index })]);
  return { rows: toHeight([...pause, ...shown.map((line) => line.row)], height), hits: offsetHits(hits, pause.length) };
}

export type ApprovalMode = Extract<Mode, { kind: "approval" }>;

export function approvalRows(mode: ApprovalMode, timezone: string | undefined, width: number): Row[] {
  const { approval, optionId } = mode;
  const text = (value: string, style: Parameters<typeof seg>[1] = {}): Row[] => wrap(value, width - 2).map((line) => [seg(`  ${line}`, style)]);
  const rows: Row[] = [[seg(t("agents.requestTitle"), { bold: true, color: "cyan" })], ...text(approval.action, { bold: true })];
  const options = approval.options.flatMap((option, i) => optionId && option.id !== optionId ? [] : [
    ...text(`${i + 1}. ${option.label}`, { bold: true, color: optionId ? "yellow" : "cyan" }),
    ...(option.consequence ? text(option.consequence) : []),
    [],
  ]);
  // Confirmation starts with the captured choice, even when the request's detail is long.
  if (optionId) rows.push([], ...options);
  if (approval.ref !== null) rows.push(...text(`#${approval.ref} ${approval.taskTitle ?? ""}`));
  if (approval.detail) rows.push([], ...text(approval.detail));
  rows.push([], ...text(t("agents.requestedBy", { name: approval.requestedBy.name })), ...text(t("agents.expires", { time: formatTimestamp(approval.expiresAt, timezone) })), ...text(t(approval.reversible ? "agents.reversible" : "agents.irreversible"), { color: approval.reversible ? undefined : "yellow" }), []);
  if (!optionId) rows.push(...options);
  return rows;
}

export function approvalScreen(mode: ApprovalMode, timezone: string | undefined, width: number, height: number): Screen {
  const rows = approvalRows(mode, timezone, width);
  const top = Math.max(0, Math.min(mode.scroll, rows.length - height));
  return { rows: toHeight(rows.slice(top, top + height), height), hits: [] };
}
