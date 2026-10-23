// Shapes of the backend results the renderers read. The JSON contract itself
// is docs/schemas; these types only name the fields the text output uses.

export type Repeat = {
  every: "day" | "week" | "month" | "year";
  interval: number;
  weekdays?: number[];
  from?: "due" | "completion";
  monthDay?: number;
  weekdayOfMonth?: { nth: number; weekday: number };
  until?: string;
  count?: number;
};
export type Link = { url: string; title?: string };
export type ChecklistItem = { id: string; title: string; done: boolean };
export type Reminder = { minutesBefore: number } | { time: string; daysBefore?: number };

export type Task = {
  id: string;
  ref?: number;
  title: string;
  status: "todo" | "doing" | "done";
  isNow: boolean;
  note?: string;
  dueDate?: string;
  dueTime?: string;
  resumeNote?: string;
  repeat?: Repeat;
  rrule?: string;
  labels: string[];
  links: Link[];
  checklist?: ChecklistItem[];
  reminders?: Reminder[];
  completedAt?: number;
  archivedAt?: number;
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
  overdue?: boolean;
  [field: string]: unknown;
};

export type HistoryEntry = {
  at: number;
  actor: string;
  actorName: string | null;
  by: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type TodayView = { date: string; timezone: string; now: Task | null; overdue: Task[]; today: Task[]; doneToday: Task[] };
export type Board = { todo: Task[]; doing: Task[]; done: Task[] };
export type Detail = { task: Task; history: HistoryEntry[] };
export type Device = { id: string; name: string; pairedBy: string; createdAt: number; lastUsedAt: number | null; revokedAt: number | null };
/** An agent connection (OAuth), as GET /connections returns it. */
export type Connection = {
  id: string;
  clientName: string;
  clientType: "cimd" | "dcr";
  clientHost: string | null;
  redirectHost: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number;
  revokedAt: number | null;
  active: boolean;
};

/** Fields a task can have; `--fields` accepts these. Mirrors docs/schemas/task.schema.json. */
export const TASK_FIELDS = [
  "id",
  "ref",
  "title",
  "status",
  "isNow",
  "note",
  "dueDate",
  "dueTime",
  "resumeNote",
  "repeat",
  "rrule",
  "labels",
  "links",
  "checklist",
  "reminders",
  "completedAt",
  "archivedAt",
  "deletedAt",
  "createdAt",
  "updatedAt",
  "clientId",
  "overdue",
] as const;

export const SETTINGS_FIELDS = ["timezone", "summaryTime", "defaultReminderMinutes"] as const;

export const isTask = (value: unknown): value is Task =>
  typeof value === "object" && value !== null && !Array.isArray(value) && "id" in value && "title" in value && "status" in value;
