// Task model options shared by `add` and `edit`: the repeat rule, the
// reminders of one task and its checklist, turned into update_task fields.
import { usageError } from "../core/exit.js";
import type { ChecklistItem, Reminder, Repeat } from "../render/model.js";
import { parseRepeat } from "./parse.js";
import type { OptSpec, Opts, RunContext } from "./types.js";

export const REPEAT_OPTIONS: OptSpec[] = [
  { flags: "--every <unit>", description: "Repeat every day, week, month or year", choices: ["day", "week", "month", "year"] },
  { flags: "--interval <n>", description: "Repeat interval (2 = every other)", kind: "int" },
  { flags: "--on <days>", description: "Weekly repeat days, e.g. mon,thu" },
  { flags: "--month-day <day>", description: "Monthly repeat on day 1-31 (a shorter month: its last day) or last" },
  { flags: "--month-weekday <day>", description: 'Monthly repeat on a weekday: "2 tue", "last fri"' },
  { flags: "--from-completion", description: "Count the next date from the day the task is done, not its due date" },
  { flags: "--until <date>", description: "Last date the repeat may fall on (dayhand help dates)" },
  { flags: "--count <n>", description: "How many times it repeats, this one included", kind: "int" },
  { flags: "--rrule <rule>", description: 'The rule as RFC 5545 RRULE instead, e.g. "FREQ=MONTHLY;BYDAY=-1FR"' },
];

export const REMINDER_OPTIONS: OptSpec[] = [
  { flags: "--remind <when>", description: 'This task\'s reminder instead of the defaults: 0, 15m, 2h, 1d (before the due time), 09:00 or "18:00 -1d" (repeatable)', kind: "list" },
  { flags: "--no-reminders", description: "No reminders for this task" },
];

const RULE_FLAGS = ["every", "interval", "on", "monthDay", "monthWeekday", "fromCompletion", "until", "count"];

/** The repeat options as add_task/update_task's `repeat`: a rule, an RRULE string, or undefined when none is given. */
export async function repeatInput(ctx: RunContext, opts: Opts): Promise<Repeat | string | undefined> {
  if (opts.rrule !== undefined) {
    if (RULE_FLAGS.some((flag) => opts[flag] !== undefined)) throw usageError("--rrule cannot be combined with the other repeat options");
    return opts.rrule as string;
  }
  const rule = parseRepeat(opts as never);
  if (rule && opts.until !== undefined) rule.until = (await ctx.when(opts.until as string)).date;
  return rule;
}

/** --remind / --no-reminders (and --default-reminders in edit) as `reminders`: a list, [] or null. */
export function remindersInput(opts: Opts): Reminder[] | null | undefined {
  const given = opts.remind as string[];
  const none = opts.reminders === false;
  if ([given.length > 0, none, Boolean(opts.defaultReminders)].filter(Boolean).length > 1) {
    throw usageError("Use one of --remind, --no-reminders or --default-reminders");
  }
  if (none) return [];
  if (opts.defaultReminders) return null;
  return given.length ? given.map(parseReminder) : undefined;
}

const BEFORE = /^(\d{1,5})\s*(m|min|h|d)?(?:\s+before)?$/i;
const AT_TIME = /^(\d{1,2}):(\d{2})(?:\s*(?:-\s*(\d{1,2})\s*d|,?\s+(\d{1,2})\s*d(?:ays?)?\s+before))?$/i;
const UNIT_MINUTES: Record<string, number> = { m: 1, min: 1, h: 60, d: 24 * 60 };

/** "0", "15m", "2h", "1d before" → minutes before the due time; "09:00", "18:00 -1d" → a time on (or before) the due day. */
export function parseReminder(text: string): Reminder {
  const value = text.trim();
  if (/^(at|due)$/i.test(value)) return { minutesBefore: 0 };
  const before = BEFORE.exec(value);
  if (before) return { minutesBefore: Number(before[1]) * UNIT_MINUTES[(before[2] ?? "m").toLowerCase()]! };
  const at = AT_TIME.exec(value);
  if (at && Number(at[1]) < 24 && Number(at[2]) < 60) {
    const time = `${at[1]!.padStart(2, "0")}:${at[2]}`;
    const days = Number(at[3] ?? at[4] ?? 0);
    return days ? { time, daysBefore: days } : { time };
  }
  throw usageError(`Not a reminder: "${text}"`, { valid: ["0", "15m", "2h", "1d", "09:00", "18:00 -1d"] });
}

/** --item titles as a new checklist. */
export const checklistOf = (titles: string[]): ChecklistItem[] => titles.map((title) => ({ title }) as ChecklistItem);

/** 1-based item numbers ("2", "1,3", "all") → 0-based indexes into a checklist of `size` items. */
export function itemIndexes(texts: string[], size: number, what = "checklist"): number[] {
  const indexes = texts.flatMap((text) =>
    text.split(",").map((part) => {
      const word = part.trim().toLowerCase();
      if (word === "all") return [...Array(size).keys()];
      if (!/^\d{1,3}$/.test(word) || Number(word) < 1 || Number(word) > size) {
        throw usageError(size === 0 ? `The task has no ${what}` : `Not an item number: "${part.trim()}" (1 to ${size})`);
      }
      return [Number(word) - 1];
    }),
  );
  return [...new Set(indexes.flat())];
}

/**
 * Applies `dayhand checklist` options to the current items, in a fixed order:
 * tick, untick, move, remove, then add. Ids of existing items are kept.
 */
export function editChecklist(items: ChecklistItem[], opts: Opts): ChecklistItem[] {
  const tick = (texts: unknown, done: boolean, list: ChecklistItem[]) => {
    const picked = new Set(itemIndexes(texts as string[], list.length));
    return list.map((item, i) => (picked.has(i) ? { ...item, done } : item));
  };
  let result = tick(opts.uncheck, false, tick(opts.check, true, items));
  for (const move of opts.move as string[]) {
    const match = /^(\d{1,3}):(\d{1,3})$/.exec(move.trim());
    if (!match) throw usageError(`--move takes <from>:<to>, e.g. 3:1, got "${move}"`);
    const [from, to] = [Number(match[1]) - 1, Number(match[2]) - 1];
    if (from < 0 || from >= result.length || to < 0 || to >= result.length) throw usageError(`--move ${move}: items are 1 to ${result.length}`);
    const moved = [...result];
    moved.splice(to, 0, ...moved.splice(from, 1));
    result = moved;
  }
  const removed = new Set(itemIndexes(opts.rm as string[], result.length));
  result = result.filter((_, i) => !removed.has(i));
  return [...result, ...checklistOf(opts.add as string[])];
}
