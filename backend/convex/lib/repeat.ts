import { addDays, addMonths, dayOfMonth, weekday } from "./dates";
import type { RepeatRule } from "./validators";

const MAX_INTERVAL = 366;

/** Returns an error message, or null when the rule is valid. */
export function validateRepeat(rule: RepeatRule): string | null {
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > MAX_INTERVAL) {
    return `repeat.interval must be an integer from 1 to ${MAX_INTERVAL}`;
  }
  if (rule.weekdays !== undefined) {
    if (rule.every !== "week") return "repeat.weekdays is allowed only with every = week";
    const unique = new Set(rule.weekdays);
    if (
      rule.weekdays.length === 0 ||
      unique.size !== rule.weekdays.length ||
      rule.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)
    ) {
      return "repeat.weekdays must be distinct integers 1 (Monday) to 7 (Sunday)";
    }
  }
  return null;
}

function step(rule: RepeatRule, date: string, anchorDay: number): string {
  switch (rule.every) {
    case "day":
      return addDays(date, rule.interval);
    case "month":
      return addMonths(date, rule.interval, anchorDay);
    case "year":
      return addMonths(date, 12 * rule.interval, anchorDay);
    case "week": {
      if (!rule.weekdays) return addDays(date, 7 * rule.interval);
      const days = [...rule.weekdays].sort((a, b) => a - b);
      const current = weekday(date);
      const laterThisWeek = days.find((d) => d > current);
      if (laterThisWeek !== undefined) return addDays(date, laterThisWeek - current);
      const mondayOfWeek = addDays(date, 1 - current);
      return addDays(mondayOfWeek, 7 * rule.interval + days[0] - 1);
    }
  }
}

/**
 * Next due date after completing a repeating task: the first occurrence
 * after its due date that is also after today, so a late completion does
 * not create an occurrence that is already overdue.
 */
export function nextOccurrence(rule: RepeatRule, dueDate: string | undefined, today: string): string {
  const base = dueDate ?? today;
  const anchorDay = dayOfMonth(base);
  let next = step(rule, base, anchorDay);
  while (next <= today) next = step(rule, next, anchorDay);
  return next;
}
