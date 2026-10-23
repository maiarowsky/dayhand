// The read-only calendar feed: one secret address per user that serves the
// plan as iCalendar (lib/ical.ts) to Google Calendar, Apple Calendar and
// anything else that subscribes by URL. A new address replaces the old one,
// which then answers 404. Tokens are drawn in actions (mutations have a
// deterministic random source) and never written to logs or to the history.
// Threat model: docs/calendar.md.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { identityOf, loadSettings, recordEvent, type Identity } from "./lib/core";
import { renderCalendar } from "./lib/ical";
import { newCalendarToken, timingSafeEqual } from "./lib/secrets";
import { identityFields as identityArgs } from "./lib/validators";

export type CalendarFeed = { url: string; webcalUrl: string; googleCalendarUrl: string; createdAt: number };

/** The deployment's HTTP actions URL, which serves /cal/. */
function siteUrl(): string {
  const url = process.env.CONVEX_SITE_URL;
  if (!url) throw new Error("CONVEX_SITE_URL is not set");
  return url.replace(/\/+$/, "");
}

/** The addresses of a feed: https for copying, webcal:// for Apple Calendar, and Google Calendar's "add by URL" link. */
export function feedView(row: { selector: string; secret: string; createdAt: number }): CalendarFeed {
  const url = `${siteUrl()}/cal/${row.selector}${row.secret}.ics`;
  const webcalUrl = url.replace(/^https?:\/\//, "webcal://");
  return {
    url,
    webcalUrl,
    googleCalendarUrl: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl)}`,
    createdAt: row.createdAt,
  };
}

async function feedRow(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query("calendarFeeds")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** The user's feed, or null when it is off. */
export async function getFeed(ctx: QueryCtx, identity: Identity): Promise<CalendarFeed | null> {
  const row = await feedRow(ctx, identity.userId);
  return row ? feedView(row) : null;
}

export const get = internalQuery({ args: identityArgs, handler: (ctx, input) => getFeed(ctx, input) });

/**
 * Turns the feed on and returns it. With `replace`, a new address replaces
 * the current one (which stops working at once); without, an existing feed
 * is returned as it is.
 */
export const create = internalAction({
  args: { ...identityArgs, replace: v.optional(v.boolean()) },
  handler: async (ctx, input): Promise<CalendarFeed> => {
    const { selector, secret } = newCalendarToken();
    return ctx.runMutation(internal.calendarFeeds.store, { ...input, selector, secret });
  },
});

export const store = internalMutation({
  args: { ...identityArgs, replace: v.optional(v.boolean()), selector: v.string(), secret: v.string() },
  handler: async (ctx, input): Promise<CalendarFeed> => {
    const { userId, replace, selector, secret } = input;
    const current = await feedRow(ctx, userId);
    if (current && !replace) return feedView(current);
    const createdAt = Date.now();
    if (current) await ctx.db.patch(current._id, { selector, secret, createdAt });
    else await ctx.db.insert("calendarFeeds", { userId, selector, secret, createdAt });
    await recordEvent(ctx, identityOf(input), { action: current ? "calendarFeed.rotate" : "calendarFeed.create" });
    return feedView({ selector, secret, createdAt });
  },
});

/** Turns the feed off: its address answers 404 from now on. */
export async function revokeFeed(ctx: MutationCtx, identity: Identity): Promise<{ revoked: boolean }> {
  const current = await feedRow(ctx, identity.userId);
  if (!current) return { revoked: false };
  await ctx.db.delete(current._id);
  await recordEvent(ctx, identityOf(identity), { action: "calendarFeed.revoke" });
  return { revoked: true };
}

export const revoke = internalMutation({ args: identityArgs, handler: (ctx, input) => revokeFeed(ctx, input) });

/** The calendar behind a feed token, or null when no feed has it. */
export const render = internalQuery({
  args: { selector: v.string(), secret: v.string(), at: v.number() },
  handler: async (ctx, { selector, secret, at }): Promise<string | null> => {
    const row = await ctx.db
      .query("calendarFeeds")
      .withIndex("by_selector", (q) => q.eq("selector", selector))
      .unique();
    if (!row || !timingSafeEqual(row.secret, secret)) return null;
    const settings = await loadSettings(ctx, row.userId);
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", row.userId))
      .collect();
    return renderCalendar(tasks, { ...settings, at });
  },
});
