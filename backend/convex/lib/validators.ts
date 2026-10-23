import { v, type Infer } from "convex/values";

export const statusValidator = v.union(v.literal("todo"), v.literal("doing"), v.literal("done"));
export type Status = Infer<typeof statusValidator>;

// Who made a change: the app, the user at the CLI, or an agent. API keys
// have a kind (cli or agent) that becomes the actor of their changes.
export const actorValidator = v.union(v.literal("app"), v.literal("agent"), v.literal("cli"));
export type Actor = Infer<typeof actorValidator>;

export const keyKindValidator = v.union(v.literal("cli"), v.literal("agent"));
export type KeyKind = Infer<typeof keyKindValidator>;

// What an API key may do (since 0.8.0): read the plan, also change it, or
// everything including the account (keys, webhooks, devices, calendar feed).
// Keys without a scope (all keys before 0.8.0) are full keys.
export const keyScopeValidator = v.union(v.literal("read"), v.literal("write"), v.literal("full"));
export type KeyScope = Infer<typeof keyScopeValidator>;

/**
 * Acting identity of internal functions. Callers with an API key also pass the key's id and name;
 * callers with an OAuth access token pass the connection's id and the client's name.
 */
export const identityFields = {
  userId: v.string(),
  actor: actorValidator,
  keyId: v.optional(v.id("apiKeys")),
  connectionId: v.optional(v.id("oauthGrants")),
  actorName: v.optional(v.string()),
};

export const linkValidator = v.object({
  url: v.string(),
  title: v.optional(v.string()),
});
export type Link = Infer<typeof linkValidator>;

// Repeat every `interval` days/weeks/months/years. For weekly rules,
// `weekdays` (1 = Monday ... 7 = Sunday) picks the days of the week.
// Since 0.5.0: `from` counts the next date from the due date (default) or
// from the day the task was completed; monthly rules may pin `monthDay`
// (1-31, -1 = last day) or `weekdayOfMonth` (2nd Tuesday, last Friday);
// `until` (last allowed date) or `count` (occurrences left, this one
// included) end the series. Rules map onto RFC 5545 RRULE (lib/rrule.ts).
export const repeatValidator = v.object({
  every: v.union(v.literal("day"), v.literal("week"), v.literal("month"), v.literal("year")),
  interval: v.number(),
  weekdays: v.optional(v.array(v.number())),
  from: v.optional(v.union(v.literal("due"), v.literal("completion"))),
  monthDay: v.optional(v.number()),
  weekdayOfMonth: v.optional(v.object({ nth: v.number(), weekday: v.number() })),
  until: v.optional(v.string()),
  count: v.optional(v.number()),
});
export type RepeatRule = Infer<typeof repeatValidator>;

// A repeat rule as clients send it: the object, or an RFC 5545 RRULE string.
export const repeatInputValidator = v.union(repeatValidator, v.string());
export type RepeatInput = Infer<typeof repeatInputValidator>;

// One checklist item; the list's order is the order shown.
export const checklistItemValidator = v.object({ id: v.string(), title: v.string(), done: v.boolean() });
export type ChecklistItem = Infer<typeof checklistItemValidator>;

// Items as clients send them: a new item may leave out its id (the server gives one) and done.
export const checklistInputValidator = v.object({
  id: v.optional(v.string()),
  title: v.string(),
  done: v.optional(v.boolean()),
});
export type ChecklistInput = Infer<typeof checklistInputValidator>;

// A reminder of one task: minutes before its due time, or a time of day on
// the due day (or `daysBefore` days earlier). A task without reminders uses
// the default reminders from the settings; an empty list means none.
export const reminderValidator = v.union(
  v.object({ minutesBefore: v.number() }),
  v.object({ time: v.string(), daysBefore: v.optional(v.number()) }),
);
export type Reminder = Infer<typeof reminderValidator>;

/** Optional field in an update: omitted = keep, null = clear. */
export const clearable = <T extends Parameters<typeof v.union>[0]>(validator: T) =>
  v.optional(v.union(validator, v.null()));
