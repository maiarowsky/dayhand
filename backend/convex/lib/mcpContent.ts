// MCP resources and prompts. Resources give an agent context without a tool
// call (Today, projects, one task, how to work with Dayhand); prompts start
// day-plan routines. Both read through the same domain queries as the tools.
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Identity } from "./core";
import { addDays, localDate } from "./dates";
import { AGENT_GUIDE, WORKFLOWS } from "./guide";

export const RESOURCES = [
  {
    uri: "dayhand://today",
    name: "today",
    title: "Today",
    description: "The Today screen as list_today returns it: overdue, today, done today and the now task.",
    mimeType: "application/json",
  },
  {
    uri: "dayhand://projects",
    name: "projects",
    title: "Projects",
    description: "The active projects in menu order as list_projects returns them, each with task counts, and counts of tasks without a project.",
    mimeType: "application/json",
  },
  {
    uri: "dayhand://activity",
    name: "activity",
    title: "Activity log",
    description: "The newest task changes as list_events returns them, with the cursor to follow the log from (dayhand://activity?since=<cursor>).",
    mimeType: "application/json",
  },
  {
    uri: "dayhand://guide",
    name: "guide",
    title: "How to work with Dayhand",
    description: "Rules and routines for an agent managing the user's plan: task numbers, the now task, retries, dry runs, limits.",
    mimeType: "text/markdown",
  },
  {
    uri: "dayhand://workflow/intake",
    name: "workflow-intake",
    title: "Intake: writing a task down",
    description: "Phase 1 of a task: find or add it, proposal or not, acceptance criteria, plan and dependencies.",
    mimeType: "text/markdown",
  },
  {
    uri: "dayhand://workflow/execution",
    name: "workflow-execution",
    title: "Execution: working on a task",
    description: "Phase 2: choose ready work, claim it, tick criteria, ask before risky steps, stop with a checkpoint.",
    mimeType: "text/markdown",
  },
  {
    uri: "dayhand://workflow/finalization",
    name: "workflow-finalization",
    title: "Finalization: closing a task",
    description: "Phase 3: check the criteria, complete with proof, ask the owner for the last step, or hand the task back.",
    mimeType: "text/markdown",
  },
];

export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: "dayhand://activity{?since}",
    name: "activity-since",
    title: "Activity log since a cursor",
    description: "Task changes after a cursor (nextCursor of an earlier read) or a time, oldest first, as list_events with since.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "dayhand://tasks/{ref}",
    name: "task",
    title: "Task with history",
    description: "One task by its number, e.g. dayhand://tasks/42, with its change history (as get_task).",
    mimeType: "application/json",
  },
];

export type ResourceContents = { uri: string; mimeType: string; text: string };

/** helm://… is what the resources were called before the rename to Dayhand; those addresses still work. */
const canonicalUri = (uri: unknown): string => (typeof uri === "string" ? uri.replace(/^helm:\/\//, "dayhand://") : "");

const isWorkflow = (name: string) => Object.prototype.hasOwnProperty.call(WORKFLOWS, name);

/** The guide and the phase guides: the same for everyone, so they need no user data and may be cached. */
export const isGuide = (uri: unknown) => canonicalUri(uri) === "dayhand://guide" || isWorkflow(canonicalUri(uri));

/** Whether reading the resource looks at the user's data (and counts against the key's reads). */
export const readsUserData = (uri: unknown) => !isGuide(uri);

/** The resource's contents, or null when there is no such resource. */
export async function readResource(ctx: ActionCtx, identity: Identity, uri: string): Promise<ResourceContents | null> {
  const name = canonicalUri(uri);
  if (name === "dayhand://guide") return { uri, mimeType: "text/markdown", text: AGENT_GUIDE };
  if (isWorkflow(name)) return { uri, mimeType: "text/markdown", text: WORKFLOWS[name]! };
  if (name === "dayhand://today") {
    const today = await ctx.runQuery(internal.ops.listToday, { ...identity, at: Date.now() });
    return { uri, mimeType: "application/json", text: JSON.stringify(today, null, 2) };
  }
  if (name === "dayhand://projects") {
    const projects = await ctx.runQuery(internal.ops.listProjects, { ...identity, at: Date.now() });
    return { uri, mimeType: "application/json", text: JSON.stringify(projects, null, 2) };
  }
  const activity = /^dayhand:\/\/activity(?:\?since=([^&#]*))?$/.exec(name);
  if (activity) {
    let since: string | undefined;
    try {
      since = activity[1] === undefined ? undefined : decodeURIComponent(activity[1]);
    } catch {
      return null;
    }
    const log = await ctx.runQuery(internal.ops.listEvents, { ...identity, ...(since ? { since } : {}) });
    return { uri, mimeType: "application/json", text: JSON.stringify(log, null, 2) };
  }
  const task = /^dayhand:\/\/tasks\/(\d{1,15})$/.exec(name);
  if (task) {
    const details = await ctx.runQuery(internal.ops.getTask, { ...identity, taskId: `#${Number(task[1])}`, at: Date.now() });
    return { uri, mimeType: "application/json", text: JSON.stringify(details, null, 2) };
  }
  return null;
}

type PromptArgument = { name: string; description: string; required: boolean };
type Prompt = { name: string; title: string; description: string; arguments: PromptArgument[] };

export const PROMPTS: Prompt[] = [
  {
    name: "plan_day",
    title: "Plan my day",
    description: "Go through overdue and today's tasks with the user, agree on the order and set the now task.",
    arguments: [{ name: "focus", description: "What the user wants to get done today (optional)", required: false }],
  },
  {
    name: "weekly_review",
    title: "Weekly review",
    description: "Look back at the last 7 days and ahead at the next 7, then tidy the plan with the user.",
    arguments: [],
  },
  {
    name: "triage_overdue",
    title: "Sort out overdue tasks",
    description: "Decide with the user, task by task, what happens to everything overdue.",
    arguments: [],
  },
  {
    name: "plan_health",
    title: "Check the plan's health",
    description: "Read the plan health report and go through what needs a look: overdue, blocked, stale claims, waiting approvals, proposals, work done without proof.",
    arguments: [],
  },
];

export class PromptArgumentError extends Error {}

type Message = { role: "user"; content: Record<string, unknown> };

const text = (value: string): Message => ({ role: "user", content: { type: "text", text: value } });
const embedded = (resource: ResourceContents): Message => ({ role: "user", content: { type: "resource", resource } });

const SAFE_CHANGES =
  "Before changing anything, say what you will do and wait for the user's yes. Pass a clientId with every change; for more than three changes, preview them first with dryRun: true.";

/** The prompt's messages, or null when there is no such prompt. */
export async function getPrompt(ctx: ActionCtx, identity: Identity, name: string, args: Record<string, string>) {
  const prompt = PROMPTS.find((p) => p.name === name);
  if (!prompt) return null;
  const unknown = Object.keys(args).filter((key) => !prompt.arguments.some((a) => a.name === key));
  if (unknown.length) throw new PromptArgumentError(`Unknown argument(s) for ${name}: ${unknown.join(", ")}`);
  const now = Date.now();
  if (name === "plan_day") {
    const today = (await readResource(ctx, identity, "dayhand://today"))!;
    const focus = args.focus?.trim() ? `\n\nMy focus today: ${args.focus.trim()}` : "";
    return {
      description: prompt.description,
      messages: [
        text(
          "Help me plan today in Dayhand. My Today screen is attached. First go through the overdue tasks: for each, ask whether to do it today (reschedule_task to today), move it to another day, or drop it (archive_task or delete_task). " +
            "Then propose an order for today's tasks, timed ones at their time, and ask which one I start with; make it the now task with set_now and a short resume note. " +
            `${SAFE_CHANGES}${focus}`,
        ),
        embedded(today),
      ],
    };
  }
  const { timezone } = await ctx.runQuery(internal.ops.getSettings, identity);
  const today = localDate(now, timezone);
  if (name === "weekly_review") {
    return {
      description: prompt.description,
      messages: [
        text(
          `Run my weekly review in Dayhand (today is ${today}, ${timezone}).\n` +
            `1. Done: call board and read its done column for what I finished since ${addDays(today, -7)}; summarise it in a few lines.\n` +
            `2. Open loops: call list_all with overdue: true, then list_all with status ["doing"]; ask what to do with each.\n` +
            `3. Next week: call list_all with dueAfter "${addDays(today, -1)}" and dueBefore "${addDays(today, 8)}"; point out overloaded days and offer to move tasks.\n` +
            `4. Without a day: call list_all with status ["todo"] and offer a day for the tasks that have no dueDate.\n` +
            "5. Projects: call list_projects; for a project with overdue tasks or none open, ask whether to plan its next step or archive it (update_project with archived: true), and offer a project for open tasks without one.\n" +
            SAFE_CHANGES,
        ),
      ],
    };
  }
  if (name === "plan_health") {
    const health = await ctx.runQuery(internal.ops.planHealth, { ...identity, at: now });
    return {
      description: prompt.description,
      messages: [
        text(
          `Check the health of my plan in Dayhand (today is ${today}). The report from plan_health is below. ` +
            "Summarise it in a few lines, most urgent first, then go through what needs a decision: overdue tasks, blocked tasks (is the reason still true?), claims that ran out (release_task or ask the agent), tasks waiting for an approval, proposals in the inbox (I accept or reject them on the phone), and tasks done today without proof. " +
            "If agents are paused, say so first. " +
            SAFE_CHANGES,
        ),
        text(`Plan health (plan_health):\n${JSON.stringify(health, null, 2)}`),
      ],
    };
  }
  const overdue = await ctx.runQuery(internal.ops.findTasks, { ...identity, overdue: true, at: now });
  return {
    description: prompt.description,
    messages: [
      text(
        `Help me sort out my overdue tasks in Dayhand (today is ${today}). ` +
          "Go through them one at a time, oldest first. For each, suggest one of: do it today (reschedule_task to today), move it to a realistic day, mark it done (complete_task), archive it (archive_task) or delete it (delete_task, it stays 30 days in the trash). " +
          SAFE_CHANGES,
      ),
      text(`My overdue tasks (list_all with overdue: true):\n${JSON.stringify(overdue, null, 2)}`),
    ],
  };
}
