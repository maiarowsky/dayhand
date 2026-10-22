// Parsing and checking of argument values the backend does not see directly:
// task references, weekdays, links, repeat rules, key=value settings.
import { CliError, usageError } from "../core/exit.js";
import type { Link, Repeat } from "../render/model.js";
import type { RunContext } from "./types.js";

// Agents hallucinate: reject control characters instead of sending them.
const CONTROL = /[\u0000-\u001f\u007f]/;

/** "#42" / "42" → "#42"; "now" → the now task's id; anything else is passed on as an id. */
export async function resolveRef(ctx: RunContext, raw: string): Promise<string> {
  const ref = raw.trim();
  if (ref === "" || CONTROL.test(ref)) throw usageError("A task reference must be #<number>, <number>, now or a task id");
  if (/^#?\d+$/.test(ref)) return `#${Number(ref.replace("#", ""))}`;
  if (ref.toLowerCase() === "now") {
    const client = await ctx.client();
    const today = (await client.callTool("list_today")).structured as { now?: { id: string } | null };
    if (!today.now) throw new CliError("not_found", "There is no now task", { hint: "hlm now <ref>" });
    return today.now.id;
  }
  return ref;
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** "mon,thu", "th" or "1,4" → [1, 4] (ISO weekdays, Monday = 1); a prefix must name one day. */
export function parseWeekdays(text: string): number[] {
  const days = text.split(",").map((part) => {
    const word = part.trim().toLowerCase();
    if (/^[1-7]$/.test(word)) return Number(word);
    const matches = word.length >= 2 ? DAYS.filter((d) => d.startsWith(word)) : [];
    if (matches.length !== 1) throw usageError("Not a weekday: use mon…sun or 1…7", { valid: DAYS.map((d) => d.slice(0, 3)) });
    return DAYS.indexOf(matches[0]!) + 1;
  });
  return [...new Set(days)].sort((a, b) => a - b);
}

/** "https://x.y/z Optional title" → { url, title }. */
export function parseLink(text: string): Link {
  const [url, ...title] = text.trim().split(/\s+/);
  if (!url) throw usageError("--link needs a URL");
  return title.length ? { url, title: title.join(" ") } : { url };
}

const UNITS = ["day", "week", "month", "year"] as const;

/** --every / --interval / --on → a repeat rule, or undefined when none of them is given. */
export function parseRepeat(opts: { every?: string; interval?: number; on?: string }): Repeat | undefined {
  if (opts.every === undefined && opts.interval === undefined && opts.on === undefined) return undefined;
  const every = (opts.every ?? "week") as Repeat["every"];
  if (!UNITS.includes(every)) throw usageError("--every must be day, week, month or year", { valid: [...UNITS] });
  if (opts.on !== undefined && every !== "week") throw usageError("--on works only with --every week");
  const rule: Repeat = { every, interval: opts.interval ?? 1 };
  if (opts.on !== undefined) rule.weekdays = parseWeekdays(opts.on);
  return rule;
}

export function parseInt0(text: string): number {
  if (!/^\d{1,9}$/.test(text.trim())) throw usageError(`Not a whole number: use digits only`);
  return Number(text);
}

const SETTINGS_KEYS: Record<string, string> = {
  timezone: "timezone",
  summaryTime: "summaryTime",
  "summary-time": "summaryTime",
  defaultReminderMinutes: "defaultReminderMinutes",
  reminders: "defaultReminderMinutes",
};

/** ["timezone=Europe/London", "reminders=0,15"] → update_settings arguments. */
export function parseSettings(pairs: string[]): Record<string, unknown> {
  if (pairs.length === 0) throw usageError("Give at least one key=value", { valid: Object.keys(SETTINGS_KEYS) });
  const result: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    const key = SETTINGS_KEYS[eq > 0 ? pair.slice(0, eq).trim() : ""];
    if (!key) throw usageError("Settings are key=value with a known key", { valid: Object.keys(SETTINGS_KEYS) });
    const value = pair.slice(eq + 1).trim();
    result[key] =
      key === "defaultReminderMinutes" ? (value === "" ? [] : value.split(",").map((m) => parseInt0(m))) : value;
  }
  return result;
}
