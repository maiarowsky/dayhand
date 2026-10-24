// One line from the same plan_health counts as `dayhand health`, urgent first.
import { t, type Key } from "../i18n/index.js";
import type { Health } from "./agents.js";
import { seg, type Row } from "./text.js";

export function healthRow(health: Health): Row {
  const issues: [Key, number][] = [
    ["health.overdue", health.overdue.count],
    ["health.blocked", health.blocked.count],
    ["health.expiredClaims", health.expiredClaims.count],
    ["health.approvals", health.awaitingApproval.pendingApprovals],
    ["health.proposals", health.proposals.count],
    ["health.withoutProof", health.completedToday.withoutProof],
  ];
  const parts = issues.filter(([, count]) => count > 0).map(([key, count]) => t(key, { count }));
  if (health.agentsPaused) parts.unshift(t("health.paused"));
  if (parts.length === 0) {
    parts.push(t("health.dueToday", { count: health.dueToday.count }), t("health.inProgress", { count: health.inProgress.count }), t("health.completedToday", { count: health.completedToday.count }));
  }
  const urgent = health.overdue.count + health.blocked.count + health.expiredClaims.count > 0;
  const attention = health.agentsPaused || issues.some(([, count]) => count > 0);
  return [seg(` ● ${parts.join(" · ")}`, { color: urgent ? "red" : attention ? "yellow" : "green" })];
}
