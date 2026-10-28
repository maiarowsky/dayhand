// Reading other plans into Dayhand (docs/api.md#import): Dayhand's own JSON export,
// iCalendar (VTODO and VEVENT) and Todoist's CSV export. Each reader turns a
// file into tasks as add_task would take them, plus warnings for what it could
// not carry over. Only the reading is here; every task is then checked and
// stored by the domain (lib/importOps.ts). Pure functions.
import { addDays, isValidTimezone, localDate, resolveDate, weekday } from "./dates";
import { EXPORT_VERSION } from "./exportPlan";
import { zonedInstant } from "./vtimezone";
import { PROJECT_COLORS, type ChecklistInput, type Link, type ProjectColor, type Reminder, type RepeatInput } from "./validators";

export const IMPORT_FORMATS = ["dayhand-json", "ics", "todoist-csv"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];
/** The name of dayhand-json before the rename, still accepted. */
export const DEPRECATED_FORMATS: Record<string, ImportFormat> = { "helm-json": "dayhand-json" };
/** The name a format had when import keys were first made: a file imported again keeps its keys. */
export const KEY_NAME: Record<ImportFormat, string> = { "dayhand-json": "helm-json", ics: "ics", "todoist-csv": "todoist-csv" };

/** One task to import. `source` identifies it within the file, so importing the file again skips it. */
export type ImportItem = {
  source: string;
  /** The task's id in the Dayhand export it comes from, if any: a task still here is skipped. */
  originalId?: string;
  ref?: number;
  title: string;
  note?: string;
  dueDate?: string;
  dueTime?: string;
  status?: "todo" | "doing" | "done";
  resumeNote?: string;
  repeat?: RepeatInput;
  links?: Link[];
  checklist?: ChecklistInput[];
  reminders?: Reminder[];
  completedAt?: number;
  archivedAt?: number;
  /** Since 0.13.0: the name of the task's project in the file (Dayhand JSON). */
  project?: string;
};

/** A project of a Dayhand JSON export (since 0.13.0): matched by name on import, made when missing. */
export type ImportProject = { name: string; color?: ProjectColor; icon?: string; note?: string; archived?: boolean };

export type Parsed = { items: ImportItem[]; warnings: string[]; projects?: ImportProject[] };
export type ReadContext = { timezone: string; today: string };

export class ImportFormatError extends Error {}

/** The format of a file: by its start, as the file name may be missing or wrong. */
export function detectFormat(content: string): ImportFormat {
  const start = content.replace(/^﻿/, "").trimStart();
  if (start.startsWith("{")) return "dayhand-json";
  if (/^BEGIN:VCALENDAR/i.test(start)) return "ics";
  if (/^"?TYPE"?\s*,/i.test(start)) return "todoist-csv";
  throw new ImportFormatError("Unknown format: expected Dayhand's JSON export, an iCalendar (.ics) file or a Todoist CSV export");
}

export function readPlan(format: ImportFormat, content: string, context: ReadContext): Parsed {
  const text = content.replace(/^﻿/, "");
  if (format === "dayhand-json") return readDayhandJson(text);
  if (format === "ics") return readIcs(text, context);
  return readTodoistCsv(text, context);
}

// ---- Dayhand's JSON export ----

const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const arr = <T>(value: unknown) => (Array.isArray(value) ? (value as T[]) : undefined);

/** The export's projects by id, in its order; a color that is not a token is left out. */
function readProjects(value: unknown): Map<string, ImportProject> {
  const projects = new Map<string, ImportProject>();
  for (const project of arr<Record<string, unknown>>(value) ?? []) {
    const id = str(project?.id);
    const name = str(project?.name);
    if (id === undefined || name === undefined) continue;
    const color = PROJECT_COLORS.find((token) => token === project.color);
    const archived = project.archived === true || num(project.archivedAt) !== undefined;
    projects.set(id, { name, color, icon: str(project.icon), note: str(project.note), archived });
  }
  return projects;
}

function readDayhandJson(text: string): Parsed {
  let value: any;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ImportFormatError("The file is not valid JSON");
  }
  // dayhand export --format json gives the content; export_plan's result wraps it as { format, content }.
  const plan = value?.format === "json" && value.content ? value.content : value;
  if (plan?.version !== EXPORT_VERSION || !Array.isArray(plan.tasks)) {
    throw new ImportFormatError(`Not a Dayhand JSON export of version ${EXPORT_VERSION} (expected { "version": ${EXPORT_VERSION}, "tasks": [...] })`);
  }
  const warnings: string[] = [];
  const items: ImportItem[] = [];
  const projects = readProjects(plan.projects);
  let trashed = 0;
  let unknownProject = 0;
  let labeled = 0;
  for (const task of plan.tasks as Record<string, unknown>[]) {
    if (task.deletedAt !== undefined) {
      trashed++;
      continue;
    }
    const status = str(task.status);
    const projectId = str(task.projectId);
    const project = projectId === undefined ? undefined : projects.get(projectId)?.name;
    if (projectId !== undefined && project === undefined) unknownProject++;
    if (arr<string>(task.labels)?.length) labeled++;
    items.push({
      source: `helm:${str(task.id) ?? JSON.stringify([task.title, task.createdAt])}`,
      originalId: str(task.id),
      ref: num(task.ref),
      title: str(task.title) ?? "",
      note: str(task.note),
      dueDate: str(task.dueDate),
      dueTime: str(task.dueTime),
      status: status === "doing" || status === "done" ? status : "todo",
      resumeNote: str(task.resumeNote),
      repeat: task.repeat as RepeatInput | undefined,
      links: arr<Link>(task.links),
      checklist: arr<ChecklistInput>(task.checklist),
      reminders: arr<Reminder>(task.reminders),
      completedAt: num(task.completedAt),
      archivedAt: num(task.archivedAt),
      project,
    });
  }
  if (trashed) warnings.push(`${trashed} task(s) in the trash were not imported`);
  if (unknownProject) warnings.push(`${unknownProject} task(s) name a project that is not in the file; they are imported without a project`);
  if (labeled) warnings.push(`The labels of ${labeled} task(s) were not imported: Dayhand has projects, not labels (since 0.14.0)`);
  if (plan.settings) warnings.push("Settings and history are not imported; set the time zone with dayhand settings set if needed");
  return { items, warnings, projects: [...projects.values()] };
}

// ---- iCalendar ----

type Property = { name: string; params: Record<string, string>; value: string };
type Component = { name: string; props: Property[]; children: Component[] };

/** Lines unfolded (RFC 5545 3.1) and split into components. */
function parseComponents(text: string): Component[] {
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const root: Component = { name: "ROOT", props: [], children: [] };
  const stack = [root];
  for (const line of lines) {
    if (line.trim() === "") continue;
    const colon = indexOutsideQuotes(line, ":");
    if (colon < 0) continue;
    const [name, ...rawParams] = splitOutsideQuotes(line.slice(0, colon), ";");
    const value = line.slice(colon + 1);
    const upper = name!.toUpperCase();
    if (upper === "BEGIN") {
      const child: Component = { name: value.toUpperCase(), props: [], children: [] };
      stack[stack.length - 1]!.children.push(child);
      stack.push(child);
    } else if (upper === "END") {
      if (stack.length > 1) stack.pop();
    } else {
      const params = Object.fromEntries(
        rawParams.map((p) => {
          const eq = p.indexOf("=");
          return [p.slice(0, eq).toUpperCase(), p.slice(eq + 1).replace(/^"|"$/g, "")];
        }),
      );
      stack[stack.length - 1]!.props.push({ name: upper, params, value });
    }
  }
  return root.children;
}

function indexOutsideQuotes(text: string, char: string): number {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    else if (text[i] === char && !quoted) return i;
  }
  return -1;
}

function splitOutsideQuotes(text: string, char: string): string[] {
  const parts: string[] = [];
  let rest = text;
  for (let at = indexOutsideQuotes(rest, char); at >= 0; at = indexOutsideQuotes(rest, char)) {
    parts.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
  return [...parts, rest];
}

const unescapeText = (value: string) => value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

/** A list value (CATEGORIES): split at commas that are not escaped. */
const textList = (value: string) => value.split(/(?<!\\),/).map(unescapeText).map((v) => v.trim()).filter(Boolean);

const prop = (c: Component, name: string) => c.props.find((p) => p.name === name);

const timeOfDay = (instant: number, timezone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));

/** DATE or DATE-TIME (UTC, with TZID, or floating) as a day and time in the user's zone. */
function readWhen(p: Property, context: ReadContext, warnings: string[]): { dueDate: string; dueTime?: string } | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(p.value.trim());
  if (!match) return null;
  const [, y, m, d, hh, mm, ss, utc] = match;
  const date = `${y}-${m}-${d}`;
  if (hh === undefined || p.params.VALUE === "DATE") return { dueDate: date };
  const time = `${hh}:${mm}`;
  const zone = p.params.TZID;
  let instant: number | null = null;
  if (utc) instant = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss ?? 0));
  else if (zone && zone !== context.timezone) {
    if (isValidTimezone(zone)) instant = zonedInstant(date, `${time}:${ss ?? "00"}`, zone);
    else warnings.push(`Unknown time zone ${zone}; its times were read as ${context.timezone}`);
  }
  if (instant === null) return { dueDate: date, dueTime: time };
  return { dueDate: localDate(instant, context.timezone), dueTime: timeOfDay(instant, context.timezone) };
}

/** An alarm before or at a timed task's start (TRIGGER:-PT15M) becomes minutesBefore; others are left out. */
function readAlarms(c: Component, timed: boolean): Reminder[] | undefined {
  if (!timed) return undefined;
  const reminders: Reminder[] = [];
  for (const alarm of c.children.filter((child) => child.name === "VALARM")) {
    const trigger = prop(alarm, "TRIGGER");
    if (!trigger || trigger.params.VALUE === "DATE-TIME" || trigger.params.RELATED === "END") continue;
    const match = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/.exec(trigger.value.trim());
    if (!match) continue;
    const [, before, w, d, h, m] = match;
    const minutes = Number(w ?? 0) * 10080 + Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(m ?? 0);
    if (before || minutes === 0) reminders.push({ minutesBefore: minutes });
  }
  return reminders.length ? reminders : undefined;
}

function readIcs(text: string, context: ReadContext): Parsed {
  const calendars = parseComponents(text).filter((c) => c.name === "VCALENDAR");
  if (calendars.length === 0) throw new ImportFormatError("No VCALENDAR in the file");
  const warnings: string[] = [];
  const items: ImportItem[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let categorized = 0;
  for (const calendar of calendars) {
    const fromDayhand = /dayhand|helm/i.test(prop(calendar, "PRODID")?.value ?? "");
    for (const [index, c] of calendar.children.entries()) {
      if (c.name !== "VTODO" && c.name !== "VEVENT") continue;
      const uid = prop(c, "UID")?.value;
      const recurrence = prop(c, "RECURRENCE-ID")?.value;
      const source = `ics:${uid ?? `#${index}`}${recurrence ? `:${recurrence}` : ""}`;
      // A changed occurrence of a series (RECURRENCE-ID) is not a task of its own.
      if (recurrence || seen.has(source)) {
        skipped++;
        continue;
      }
      seen.add(source);
      let title = unescapeText(prop(c, "SUMMARY")?.value ?? "").trim();
      const state = prop(c, "STATUS")?.value.toUpperCase();
      if (state === "CANCELLED") {
        skipped++;
        continue;
      }
      let status: ImportItem["status"] = state === "COMPLETED" ? "done" : state === "IN-PROCESS" ? "doing" : "todo";
      let note = prop(c, "DESCRIPTION") ? unescapeText(prop(c, "DESCRIPTION")!.value) : undefined;
      if (fromDayhand) {
        // Dayhand's own calendar marks done tasks with ✓ and starts the description with the task number.
        if (title.startsWith("✓ ")) [title, status] = [title.slice(2), "done"];
        note = note?.replace(/^(?:Dayhand|Helm)(?: #\d+)?(?:\n\n)?/, "") || undefined;
      }
      const whenProp = c.name === "VTODO" ? (prop(c, "DUE") ?? prop(c, "DTSTART")) : prop(c, "DTSTART");
      const when = whenProp ? readWhen(whenProp, context, warnings) : null;
      const completed = prop(c, "COMPLETED") ? readWhen(prop(c, "COMPLETED")!, { ...context, timezone: "UTC" }, warnings) : null;
      const url = prop(c, "URL")?.value;
      if (c.props.some((p) => p.name === "CATEGORIES" && textList(p.value).length > 0)) categorized++;
      const rrule = prop(c, "RRULE")?.value;
      items.push({
        source,
        title,
        note,
        ...(when ?? {}),
        status,
        ...(rrule && when ? { repeat: rrule } : {}),
        links: url && /^https?:\/\//.test(url) ? [{ url }] : undefined,
        reminders: readAlarms(c, when?.dueTime !== undefined),
        completedAt: status === "done" && completed ? Date.parse(`${completed.dueDate}T${completed.dueTime ?? "00:00"}:00Z`) : undefined,
      });
    }
  }
  if (skipped) warnings.push(`${skipped} cancelled entr(ies), changed occurrence(s) of a series or duplicate(s) were skipped`);
  if (categorized) warnings.push(`The categories of ${categorized} entr(ies) were not imported: Dayhand has projects, not labels`);
  return { items, warnings };
}

// ---- Todoist CSV ----

/** RFC 4180 records: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') [field, i] = [field + '"', i + 1];
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") [row, field] = [[...row, field], ""];
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      rows.push([...row, field]);
      [row, field] = [[], ""];
    } else field += c;
  }
  if (field !== "" || row.length) rows.push([...row, field]);
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "15:30", "3pm", "3:30 pm" as HH:MM; null when it is not a time. */
function readTime(text: string): string | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const half = match[3]?.toLowerCase();
  if (!half && match[2] === undefined) return null;
  if (half === "pm" && hours < 12) hours += 12;
  if (half === "am" && hours === 12) hours = 0;
  return hours < 24 && minutes < 60 ? `${pad(hours)}:${pad(minutes)}` : null;
}

/** A day written as Todoist writes it in English: ISO, today/tomorrow, "Nov 3", "3 Nov 2026", a weekday. */
function readDay(text: string, today: string): string | null {
  const value = text.trim().toLowerCase();
  const plain = resolveDate(value, today);
  if (plain) return plain;
  const weekdayIndex = WEEKDAYS.findIndex((w) => w === value || w.slice(0, 3) === value);
  if (weekdayIndex >= 0) return addDays(today, (weekdayIndex + 1 - weekday(today) + 7) % 7);
  const named =
    /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?$/.exec(value) ??
    /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?(?:\s+(\d{4}))?$/.exec(value);
  if (!named) return null;
  const [monthText, dayText] = /^\d/.test(named[1]!) ? [named[2]!, named[1]!] : [named[1]!, named[2]!];
  const month = MONTHS.indexOf(monthText);
  if (month < 0) return null;
  const thisYear = Number(today.slice(0, 4));
  const candidate = (year: number) => resolveDate(`${year}-${pad(month + 1)}-${pad(Number(dayText))}`, today);
  if (named[3]) return candidate(Number(named[3]));
  const sameYear = candidate(thisYear);
  return sameYear && sameYear >= today ? sameYear : candidate(thisYear + 1);
}

/** Todoist's "every …" in English, as a repeat rule and the first due day; null when not understood. */
function readRecurring(text: string, today: string): { repeat: RepeatInput; dueDate: string } | null {
  const value = text.trim().toLowerCase().replace(/^every\s+/, "");
  const unit = /^(?:(\d+|other)\s+)?(day|week|month|year)s?$/.exec(value);
  if (unit) {
    const interval = unit[1] === "other" ? 2 : Number(unit[1] ?? 1);
    return { repeat: { every: unit[2] as "day" | "week" | "month" | "year", interval }, dueDate: today };
  }
  if (value === "weekday" || value === "workday") return { repeat: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", dueDate: readDay(weekday(today) > 5 ? "monday" : "today", today)! };
  const days = value.split(/\s*(?:,|and)\s*/).map((d) => WEEKDAYS.findIndex((w) => w === d || w.slice(0, 3) === d));
  if (days.length && days.every((d) => d >= 0)) {
    const weekdays = [...new Set(days.map((d) => d + 1))].sort((a, b) => a - b);
    const next = Math.min(...weekdays.map((d) => (d - weekday(today) + 7) % 7));
    return { repeat: { every: "week", interval: 1, weekdays }, dueDate: addDays(today, next) };
  }
  return null;
}

/** DATE of a Todoist row: a day with an optional time ("Nov 3 15:30", "tomorrow at 9am"), or a simple "every …". */
function readTodoistDate(text: string, today: string): Partial<ImportItem> | null {
  const value = text.trim();
  if (value === "") return {};
  const [dayPart, timePart] = value.split(/\s+at\s+/i);
  const time = timePart !== undefined ? readTime(timePart) : null;
  if (timePart !== undefined && !time) return null;
  if (/^every\b/i.test(dayPart!)) {
    const recurring = readRecurring(dayPart!, today);
    return recurring ? { ...recurring, ...(time ? { dueTime: time } : {}) } : null;
  }
  const day = readDay(dayPart!, today);
  if (day) return { dueDate: day, ...(time ? { dueTime: time } : {}) };
  // "2026-11-03 15:30" or "Nov 3 15:30": a time at the end without "at".
  const tail = /^(.*\S)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i.exec(dayPart!);
  const tailDay = tail && readDay(tail[1]!, today);
  const tailTime = tail && readTime(tail[2]!);
  return tailDay && tailTime && timePart === undefined ? { dueDate: tailDay, dueTime: tailTime } : null;
}

/** Todoist writes labels into the content as @name; Dayhand has none, so they are taken out of the title. */
function splitLabels(content: string): { title: string; labels: number } {
  const labels = [...content.matchAll(/(?:^|\s)@[\p{L}\p{N}_-]+/gu)].length;
  const title = content.replace(/(?:^|\s)@[\p{L}\p{N}_-]+/gu, "").replace(/\s+/g, " ").trim();
  return { title, labels };
}

function readTodoistCsv(text: string, context: ReadContext): Parsed {
  const [header, ...rows] = parseCsv(text);
  const columns = (header ?? []).map((h) => h.trim().toUpperCase());
  const col = (name: string) => columns.indexOf(name);
  if (col("TYPE") < 0 || col("CONTENT") < 0) throw new ImportFormatError("Not a Todoist CSV export: the first row must name the TYPE and CONTENT columns");
  const cell = (row: string[], name: string) => (col(name) >= 0 ? (row[col(name)] ?? "").trim() : "");
  const warnings: string[] = [];
  const items: ImportItem[] = [];
  let section: string | undefined;
  let parent: { item: ImportItem; indent: number } | null = null;
  let subtasks = 0;
  let labeled = 0;
  for (const [index, row] of rows.entries()) {
    const type = cell(row, "TYPE").toLowerCase();
    const content = cell(row, "CONTENT");
    if (type === "section") {
      section = content || undefined;
      parent = null;
      continue;
    }
    if (type === "note" && parent) {
      parent.item.note = [parent.item.note, content].filter(Boolean).join("\n\n");
      continue;
    }
    if (type !== "task" || content === "") continue;
    const indent = Number(cell(row, "INDENT") || 1);
    const { title, labels } = splitLabels(content);
    if (labels > 0 || section !== undefined) labeled++;
    if (indent > 1 && parent && indent > parent.indent) {
      parent.item.checklist = [...(parent.item.checklist ?? []), { title }];
      subtasks++;
      continue;
    }
    const date = cell(row, "DATE");
    const when = readTodoistDate(date, context.today);
    const description = cell(row, "DESCRIPTION");
    const note = [description, when === null ? `Todoist date: ${date}` : ""].filter(Boolean).join("\n\n") || undefined;
    if (when === null) warnings.push(`"${title}": the date "${date}" was not understood; it is kept in the note`);
    const item: ImportItem = {
      source: `todoist:${index}:${content}`,
      title,
      note,
      ...(when ?? {}),
    };
    items.push(item);
    parent = { item, indent };
  }
  if (subtasks) warnings.push(`${subtasks} sub-task(s) became checklist items of their parent task`);
  if (col("PRIORITY") >= 0) warnings.push("Todoist priorities are not imported (Dayhand has none)");
  if (labeled) warnings.push(`The labels and sections of ${labeled} task(s) were not imported: Dayhand has projects, not labels`);
  return { items, warnings };
}

/** The day `today` in `timezone`, for reading relative dates. */
export const readContext = (timezone: string, at: number): ReadContext => ({ timezone, today: localDate(at, timezone) });
