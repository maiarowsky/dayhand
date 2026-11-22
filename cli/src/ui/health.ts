// What the plan_health report asks of the owner beyond what Today counts on its
// own (overdue, due today, in progress, done today), urgent first, each in its
// colour: the end of Today's sentence about the day.
import { t, type Key } from "../i18n/index.js";
import type { Health } from "./agents.js";
import { seg, type Seg } from "./text.js";

export function healthExtras(health: Health): Seg[] {
  const issues: [Key, number, "red" | "yellow"][] = [
    ["health.blocked", health.blocked.count, "red"],
    ["health.expiredClaims", health.expiredClaims.count, "red"],
    ["health.approvals", health.awaitingApproval.pendingApprovals, "yellow"],
    ["health.proposals", health.proposals.count, "yellow"],
    ["health.withoutProof", health.completedToday.withoutProof, "yellow"],
  ];
  const parts = issues.filter(([, count]) => count > 0).map(([key, count, color]) => seg(t(key, { count }), { color }));
  return health.agentsPaused ? [seg(t("health.paused"), { color: "yellow" }), ...parts] : parts;
}
