// The Backlog.md task format (docs/backlog-md.md): one Markdown file per task
// with a YAML header (id, title, status, labels, dependencies, …) and sections
// (Description, Acceptance Criteria, Implementation Plan, Implementation Notes,
// Final Summary). Backlog.md is by Alex Gavrilescu (MrLesk) and released under
// the MIT License; Dayhand reads and writes its public file format and shares
// no code with it. Reading turns one file into a task as import_backlog
// stores it; writing turns a task into one file. Pure functions.
import { FrontmatterError, parseFrontmatter, splitFrontmatter, writeFrontmatter, yamlScalar, type Front, type FrontValue } from "./frontmatter";
import { zonedInstant } from "./vtimezone";

export const BACKLOG_KIND = "backlog-md";
export const DEFAULT_STATUSES = ["To Do", "In Progress", "Done"];

export type BacklogFile = { path: string; content: string };

/** Where a file sits in the backlog folder, which decides what it is. */
export type Place = "task" | "completed" | "draft" | "archived" | "archived-draft" | "doc" | "decision" | "milestone" | "config";

export type Criterion = { text: string; met: boolean };

/** One task file as read. */
export type BacklogTask = {
  path: string;
  place: Place;
  id: string;
  title: string;
  status?: string;
  labels: string[];
  dependencies: string[];
  references: string[];
  description?: string;
  acceptance: Criterion[];
  plan?: string;
  /** Implementation notes and every other section, with their headings. */
  extra: string[];
  finalSummary?: string;
  updated?: string;
  /** Header keys with a value that Dayhand has no field for. */
  dropped: string[];
};

export class BacklogFormatError extends Error {}

// ---- Places ----

const DIRS: Record<string, Place> = { drafts: "draft", completed: "completed", docs: "doc", decisions: "decision", milestones: "milestone" };

/** The place of a path relative to the backlog folder ("tasks/task-1 - x.md", "archive/tasks/…"). */
export function placeOf(path: string): Place {
  const parts = path.replace(/\\/g, "/").toLowerCase().split("/").filter(Boolean);
  const name = parts[parts.length - 1] ?? "";
  if (name === "config.yml" || name === "backlog.config.yml") return "config";
  const dirs = parts.slice(0, -1);
  for (let i = dirs.length - 1; i >= 0; i--) {
    const dir = dirs[i]!;
    if (dirs[i - 1] === "archive") return dir === "drafts" ? "archived-draft" : dir === "tasks" ? "archived" : "doc";
    if (dir === "tasks") return "task";
    if (DIRS[dir]) return DIRS[dir]!;
  }
  return "task";
}

// ---- Statuses ----

/** The statuses of a project's config.yml, first to last; the defaults when it has none. */
export function statusesOf(config: string): string[] {
  const statuses = parseFrontmatter(config.replace(/\r\n?/g, "\n")).statuses;
  return Array.isArray(statuses) && statuses.length > 0 ? statuses : DEFAULT_STATUSES;
}

/**
 * The nearest Dayhand status: the project's first status is todo, its last
 * (the final one) is done, any between is doing. A status the project does not
 * list is read by its words, and `guessed` says so.
 */
export function statusFor(status: string | undefined, statuses: string[]): { status: "todo" | "doing" | "done"; guessed: boolean } {
  if (status === undefined) return { status: "todo", guessed: false };
  const index = statuses.findIndex((s) => s.trim().toLowerCase() === status.trim().toLowerCase());
  if (index === 0) return { status: "todo", guessed: false };
  if (index === statuses.length - 1) return { status: "done", guessed: false };
  if (index > 0) return { status: "doing", guessed: false };
  if (/done|complete|closed|finished|resolved|shipped/i.test(status)) return { status: "done", guessed: true };
  if (/progress|doing|review|active|wip|started|testing|blocked/i.test(status)) return { status: "doing", guessed: true };
  return { status: "todo", guessed: true };
}

// ---- Reading ----

const MARKER = /^\s*<!--\s*(SECTION:[A-Z_]+|AC|DOD):(BEGIN|END)\s*-->\s*$/;
const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(?:#\d+\s+)?(.*\S)\s*$/;
const HEADING = /^##\s+(.+?)\s*#*\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

function fenceOf(line: string, current: string | null): string | null {
  const match = FENCE.exec(line);
  if (!match) return current;
  const run = match[1]!;
  if (current) return run[0] === current[0] && run.length >= current.length && !match[2]!.trim() ? null : current;
  return run[0] === "`" && match[2]!.includes("`") ? null : run;
}

type Section = { title: string; text: string };

/** The text before the first "## " heading and each "## " section, without Backlog.md's markers. */
function sectionsOf(body: string): { preamble: string; sections: Section[] } {
  const sections: Section[] = [];
  let current: { title: string; lines: string[] } | null = null;
  const preamble: string[] = [];
  let fence: string | null = null;
  let scope: string | null = null;
  for (const line of body.split("\n")) {
    const wasFenced = fence !== null;
    fence = fenceOf(line, fence);
    const marker = wasFenced || fence ? null : MARKER.exec(line);
    if (marker && scope === null && marker[2] === "BEGIN") {
      scope = marker[1]!;
      continue;
    }
    if (marker && marker[1] === scope && marker[2] === "END") {
      scope = null;
      continue;
    }
    const heading = wasFenced || fence || scope ? null : HEADING.exec(line);
    if (heading) {
      if (current) sections.push({ title: current.title, text: current.lines.join("\n").trim() });
      current = { title: heading[1]!, lines: [] };
      continue;
    }
    (current ? current.lines : preamble).push(line);
  }
  if (current) sections.push({ title: current.title, text: current.lines.join("\n").trim() });
  return { preamble: preamble.join("\n").trim(), sections };
}

const sectionKey = (title: string) => title.replace(/\(optional\)/i, "").trim().toLowerCase();

function checkboxes(text: string): { items: Criterion[]; rest: string } {
  const items: Criterion[] = [];
  const rest: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const wasFenced = fence !== null;
    fence = fenceOf(line, fence);
    const match = wasFenced || fence ? null : CHECKBOX.exec(line);
    if (match) items.push({ text: match[2]!, met: match[1] !== " " });
    else if (line.trim() !== "") rest.push(line);
  }
  return { items, rest: rest.join("\n").trim() };
}

const text = (value: FrontValue | undefined): string | undefined => (typeof value === "string" ? value : Array.isArray(value) ? value.join(", ") : undefined);
const list = (value: FrontValue | undefined): string[] => (Array.isArray(value) ? value : typeof value === "string" && value.trim() !== "" ? [value] : []);

/** Header keys Dayhand reads; any other key with a value is reported as left out. */
const READ_KEYS = new Set(["id", "title", "status", "labels", "dependencies", "references", "created_date", "updated_date", "ordinal"]);

/** One task file, or a BacklogFormatError saying why it is not one. */
export function readTask(file: BacklogFile): BacklogTask {
  let front: Front;
  let body: string;
  try {
    const split = splitFrontmatter(file.content);
    if (split.front === null) throw new BacklogFormatError("no YAML header (--- … ---), so not a task file");
    front = parseFrontmatter(split.front);
    body = split.body;
  } catch (error) {
    if (error instanceof FrontmatterError) throw new BacklogFormatError(error.message);
    throw error;
  }
  const id = text(front.id)?.trim();
  const title = text(front.title)?.trim();
  if (!title) throw new BacklogFormatError("the header has no title");
  if (!id) throw new BacklogFormatError("the header has no id");
  const { preamble, sections } = sectionsOf(body);
  const task: BacklogTask = {
    path: file.path,
    place: placeOf(file.path),
    id,
    title,
    status: text(front.status)?.trim() || undefined,
    labels: list(front.labels),
    dependencies: list(front.dependencies).map((d) => d.trim()).filter(Boolean),
    references: list(front.references),
    acceptance: [],
    extra: [],
    updated: text(front.updated_date) ?? text(front.created_date),
    dropped: Object.keys(front).filter((key) => !READ_KEYS.has(key) && list(front[key]).length > 0),
  };
  if (preamble) task.description = preamble;
  for (const section of sections) {
    const key = sectionKey(section.title);
    if (key === "description") task.description = [task.description, section.text].filter(Boolean).join("\n\n") || undefined;
    else if (key === "acceptance criteria" || key === "definition of done") {
      const { items, rest } = checkboxes(section.text);
      task.acceptance.push(...items);
      if (rest) task.extra.push(`## ${section.title}\n\n${rest}`);
    } else if (key === "implementation plan") task.plan = section.text || undefined;
    else if (key === "final summary") task.finalSummary = section.text || undefined;
    else if (section.text) task.extra.push(`## ${section.title}\n\n${section.text}`);
  }
  return task;
}

/**
 * A header date as Unix milliseconds: ISO 8601 with a zone, or "YYYY-MM-DD"
 * and "YYYY-MM-DD HH:MM" in the user's time zone. Null when not understood.
 */
export function readDate(value: string | undefined, timezone: string): number | null {
  if (!value) return null;
  const local = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value.trim());
  if (local) {
    const at = zonedInstant(local[1]!, `${local[2] ?? "00"}:${local[3] ?? "00"}:${local[4] ?? "00"}`, timezone);
    return Number.isFinite(at) ? at : null;
  }
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

// ---- Writing ----

/** A task as one Backlog.md file. */
export type TaskFile = {
  id: string;
  place: "task" | "draft" | "archived" | "archived-draft";
  title: string;
  status: string;
  labels: string[];
  dependencies: string[];
  references: string[];
  created: string;
  updated: string;
  description?: string;
  acceptance: Criterion[];
  plan?: string;
  notes?: string;
  finalSummary?: string;
};

const FOLDERS: Record<TaskFile["place"], string> = { task: "tasks", draft: "drafts", archived: "archive/tasks", "archived-draft": "archive/drafts" };

/** The file name part after the id, as Backlog.md writes it: the title with its words joined by "-". */
export function slugOf(title: string): string {
  const slug = title
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}._]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return slug || "task";
}

export const pathOf = (task: Pick<TaskFile, "id" | "place" | "title">) => `${FOLDERS[task.place]}/${task.id.toLowerCase()} - ${slugOf(task.title)}.md`;

function block(title: string, marker: string | null, body: string | undefined): string[] {
  if (!body?.trim()) return [];
  return marker ? [`## ${title}`, "", `<!-- SECTION:${marker}:BEGIN -->`, body.trim(), `<!-- SECTION:${marker}:END -->`, ""] : [`## ${title}`, "", body.trim(), ""];
}

/** One file: the header in Backlog.md's key order, then the sections that have something in them. */
export function writeTask(task: TaskFile): BacklogFile {
  const header = writeFrontmatter([
    ["id", task.id],
    ["title", task.title],
    ["status", task.status],
    ["assignee", []],
    ["created_date", task.created],
    ["updated_date", task.updated],
    ["labels", task.labels],
    ["dependencies", task.dependencies],
    ["references", task.references.length > 0 ? task.references : undefined],
  ]);
  const criteria = task.acceptance.length
    ? ["## Acceptance Criteria", "<!-- AC:BEGIN -->", ...task.acceptance.map((c, i) => `- [${c.met ? "x" : " "}] #${i + 1} ${c.text.replace(/\s*\n\s*/g, " ")}`), "<!-- AC:END -->", ""]
    : [];
  const body = [
    ...block("Description", "DESCRIPTION", task.description),
    ...criteria,
    ...block("Implementation Plan", "PLAN", task.plan),
    ...block("Implementation Notes", "NOTES", task.notes),
    ...block("Final Summary", "FINAL_SUMMARY", task.finalSummary),
  ];
  return { path: pathOf(task), content: `${[header, "", ...body].join("\n").trimEnd()}\n` };
}

/** The project's config.yml for a folder Dayhand wrote. */
export function writeConfig(prefix: string, labels: string[]): BacklogFile {
  const flow = (items: string[]) => `[${items.map((item) => `'${item.replace(/'/g, "''")}'`).join(", ")}]`;
  const content = [
    `project_name: ${yamlScalar("Dayhand export")}`,
    `default_status: ${yamlScalar(DEFAULT_STATUSES[0]!)}`,
    `statuses: ${flow(DEFAULT_STATUSES)}`,
    `labels: ${flow(labels)}`,
    "date_format: yyyy-mm-dd hh:mm",
    `task_prefix: ${yamlScalar(prefix.toLowerCase())}`,
    "",
  ].join("\n");
  return { path: "config.yml", content };
}
