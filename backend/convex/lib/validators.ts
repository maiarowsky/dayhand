import { v, type Infer } from "convex/values";

export const statusValidator = v.union(v.literal("todo"), v.literal("doing"), v.literal("done"));
export type Status = Infer<typeof statusValidator>;

// Who made a change: the app, the user at the CLI, or an agent. API keys
// have a kind (cli or agent) that becomes the actor of their changes.
export const actorValidator = v.union(v.literal("app"), v.literal("agent"), v.literal("cli"));
export type Actor = Infer<typeof actorValidator>;

export const keyKindValidator = v.union(v.literal("cli"), v.literal("agent"));
export type KeyKind = Infer<typeof keyKindValidator>;

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
export const repeatValidator = v.object({
  every: v.union(v.literal("day"), v.literal("week"), v.literal("month"), v.literal("year")),
  interval: v.number(),
  weekdays: v.optional(v.array(v.number())),
});
export type RepeatRule = Infer<typeof repeatValidator>;

/** Optional field in an update: omitted = keep, null = clear. */
export const clearable = <T extends Parameters<typeof v.union>[0]>(validator: T) =>
  v.optional(v.union(validator, v.null()));
