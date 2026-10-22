import { v, type Infer } from "convex/values";

export const statusValidator = v.union(v.literal("todo"), v.literal("doing"), v.literal("done"));
export type Status = Infer<typeof statusValidator>;

export const actorValidator = v.union(v.literal("app"), v.literal("agent"));
export type Actor = Infer<typeof actorValidator>;

export const linkValidator = v.object({
  url: v.string(),
  title: v.optional(v.string()),
});
export type Link = Infer<typeof linkValidator>;

// Repeat every `interval` days/weeks/months/years. For weekly rules,
// `weekdays` (1 = Monday ... 7 = Sunday) picks the days of the week.
export const repeatValidator = v.object({
  every: v.union(v.literal("day"), v.literal("week"), v.literal("month"), v.literal("year")),
  interval: v.number(),
  weekdays: v.optional(v.array(v.number())),
});
export type RepeatRule = Infer<typeof repeatValidator>;

/** Optional field in an update: omitted = keep, null = clear. */
export const clearable = <T extends Parameters<typeof v.union>[0]>(validator: T) =>
  v.optional(v.union(validator, v.null()));
