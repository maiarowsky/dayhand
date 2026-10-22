import type { ObjectType } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { args } from "./args";
import { appliedOperation, checkClientId, diff, fail, loadSettings, recordEvent, type Identity } from "./core";
import { isValidTime, isValidTimezone } from "./dates";

const MAX_REMINDER_MINUTES = 7 * 24 * 60;

export async function getSettings(ctx: QueryCtx, identity: Identity) {
  return loadSettings(ctx, identity.userId);
}

export async function updateSettings(
  ctx: MutationCtx,
  identity: Identity,
  input: ObjectType<(typeof args)["updateSettings"]>,
) {
  const clientId = checkClientId(input.clientId);
  if (await appliedOperation(ctx, identity.userId, clientId)) return loadSettings(ctx, identity.userId);
  const current = await loadSettings(ctx, identity.userId);
  const next = { ...current };
  if (input.timezone !== undefined) {
    if (!isValidTimezone(input.timezone)) fail("invalid_argument", `Unknown time zone "${input.timezone}"`);
    next.timezone = input.timezone;
  }
  if (input.summaryTime !== undefined) {
    if (!isValidTime(input.summaryTime)) fail("invalid_argument", "summaryTime must be HH:MM (24h)");
    next.summaryTime = input.summaryTime;
  }
  if (input.defaultReminderMinutes !== undefined) {
    const minutes = [...new Set(input.defaultReminderMinutes)].sort((a, b) => a - b);
    if (minutes.some((m) => !Number.isInteger(m) || m < 0 || m > MAX_REMINDER_MINUTES)) {
      fail("invalid_argument", `defaultReminderMinutes must be whole minutes from 0 to ${MAX_REMINDER_MINUTES}`);
    }
    next.defaultReminderMinutes = minutes;
  }
  const { before, after, changed } = diff(current, next);
  if (!changed) return current;
  const row = await ctx.db
    .query("settings")
    .withIndex("by_user", (q) => q.eq("userId", identity.userId))
    .unique();
  if (row) await ctx.db.patch(row._id, { ...next, updatedAt: Date.now() });
  else await ctx.db.insert("settings", { userId: identity.userId, ...next, updatedAt: Date.now() });
  await recordEvent(ctx, identity, { action: "settings.update", before, after, clientId });
  return next;
}
