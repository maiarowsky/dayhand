// Agent data used only by the terminal UI; MCP fields and JSON output stay unchanged.
import type { Approval, Controls, Health } from "../registry/owner.js";
import type { Link, Task } from "../render/model.js";
import type { Project } from "../projects.js";
import { matches } from "./lists.js";

export type { Approval, Controls, Health };

export type WorkTask = Task & {
  claimedBy?: { name: string };
  claimExpiresAt?: number;
  acceptance?: { id: string; text: string; met: boolean }[];
  plan?: string;
  proof?: { summary?: string; links: Link[]; checks: { name: string; result: "pass" | "fail"; url?: string }[] };
  dependsOn?: string[];
  blockedReason?: string;
  proposedAt?: number;
  requestedBy?: string;
};

export type Agents = { controls: Controls; approvals: Approval[]; proposals: Task[] };
export type AgentItem = { kind: "approval"; approval: Approval } | { kind: "proposal"; task: Task };
export const agentId = (item: AgentItem): string => item.kind === "approval" ? item.approval.id : item.task.id;

/** Pending requests first, then proposals, in the same order the screen paints them. */
export function agentItems(data: Agents | undefined, filter: string, projects: Project[] = []): AgentItem[] {
  const query = filter.toLocaleLowerCase();
  return [
    ...(data?.approvals ?? [])
      .filter((a) => [a.action, a.detail, a.taskTitle, a.requestedBy.name, a.ref === null ? "" : `#${a.ref}`].join(" ").toLocaleLowerCase().includes(query))
      .map((approval): AgentItem => ({ kind: "approval", approval })),
    ...(data?.proposals ?? []).filter((task) => matches(task, filter, projects)).map((task): AgentItem => ({ kind: "proposal", task })),
  ];
}
