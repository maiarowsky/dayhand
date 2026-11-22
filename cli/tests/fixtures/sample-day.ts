// A sample Sunday for Today's agenda in dayhand ui: the day the macOS screenshots
// show (docs/design.md), so the terminal and the Mac can be compared side by side.
import type { Project } from "../../src/projects.js";
import type { Task, TodayView } from "../../src/render/model.js";
import type { Health } from "../../src/ui/agents.js";

/** Sunday 22 November 2026, 09:12 in London. */
export const SAMPLE_NOW = Date.parse("2026-11-22T09:12:00Z");
export const SAMPLE_TODAY = "2026-11-22";
export const SAMPLE_ZONE = "Europe/London";

export const SAMPLE_PROJECTS: Project[] = ["Dayhand", "Home", "Health", "Bakery website"].map((name, i) => ({
  id: `p${i + 1}`,
  name,
  position: (i + 1) * 1024,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
}));

const project = (name: string) => SAMPLE_PROJECTS.find((p) => p.name === name)!.id;
const items = (done: number, total: number) => Array.from({ length: total }, (_, i) => ({ id: `i${i}`, title: `Step ${i + 1}`, done: i < done }));

function task(ref: number, title: string, fields: Partial<Task> = {}): Task {
  return { id: `t${ref}`, ref, title, status: "todo", isNow: false, links: [], createdAt: ref, updatedAt: ref, ...fields };
}

const today = SAMPLE_TODAY;
export const SAMPLE_TASKS = {
  brief: task(1, "Write the project brief", { status: "doing", isNow: true, resumeNote: "Section 3: the budget", dueDate: today, projectId: project("Dayhand") }),
  review: task(2, "Review pull request #42", { dueDate: today, dueTime: "09:30", projectId: project("Dayhand"), checklist: items(1, 3) }),
  accountant: task(3, "Call the accountant", { dueDate: today, dueTime: "14:00", projectId: project("Home") }),
  plants: task(4, "Water the plants", { dueDate: today, projectId: project("Home"), repeat: { every: "day", interval: 1 } }),
  notes: task(5, "Ship the release notes", { status: "doing", dueDate: today, projectId: project("Dayhand") }),
  milk: task(6, "Buy milk", { dueDate: today }),
  bill: task(7, "Pay the electricity bill", { status: "done", dueDate: today, completedAt: SAMPLE_NOW - 3_600_000 }),
  haircut: task(8, "Book a haircut", { status: "done", dueDate: today, completedAt: SAMPLE_NOW - 1_800_000 }),
  invoice: task(9, "Send the invoice to Anna", { dueDate: "2026-11-20", overdue: true, projectId: project("Bakery website") }),
  blog: task(10, "Idea for a blog post"),
  photos: task(11, "Photos for the gallery", { projectId: project("Bakery website"), checklist: items(1, 2) }),
  dentist: task(12, "Dentist", { dueDate: "2026-11-23", dueTime: "10:00", projectId: project("Health") }),
  passport: task(13, "Renew the passport", { dueDate: "2026-11-26" }),
};

const s = SAMPLE_TASKS;
export const SAMPLE_VIEW: TodayView = {
  date: today,
  timezone: SAMPLE_ZONE,
  now: s.brief,
  overdue: [s.invoice],
  today: [s.brief, s.review, s.accountant, s.plants, s.notes, s.milk],
  doneToday: [s.bill, s.haircut],
};

/** Open tasks due from today on, as `list_all` gives them: by day, timed before untimed. */
export const SAMPLE_UPCOMING: Task[] = [s.review, s.accountant, s.brief, s.plants, s.notes, s.milk, s.dentist, s.passport];
export const SAMPLE_NO_DAY: Task[] = [s.blog, s.photos];

export function sampleHealth(): Health {
  const count = (n: number) => ({ count: n, tasks: [] });
  return {
    agentsPaused: false,
    overdue: count(1),
    dueToday: count(6),
    inProgress: count(2),
    expiredClaims: count(0),
    blocked: count(1),
    awaitingApproval: { ...count(0), pendingApprovals: 1 },
    proposals: { count: 0 },
    completedToday: { ...count(2), withProof: 0, withoutProof: 0 },
    oldestOpen: null,
  };
}
