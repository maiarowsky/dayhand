// HTTP endpoints of the calendar feed (docs/calendar.md).
//   GET  /cal/<token>.ics          the plan as iCalendar (the token is the only key)
//   GET  /calendar/feed            the feed's addresses, or null  (personal API key)
//   POST /calendar/feed            turn the feed on               (personal API key)
//   POST /calendar/feed/rotate     a new address; the old one 404 (personal API key)
//   POST /calendar/feed/revoke     turn the feed off              (personal API key)
// The token is never logged; a wrong, old or malformed one is a plain 404.
import { internal } from "./_generated/api";
import type { CalendarFeed } from "./calendarFeeds";
import { httpAction } from "./_generated/server";
import { json } from "./lib/http";
import { parseCalendarToken } from "./lib/secrets";
import { accountOwner, keyIdentity } from "./pairing";

const FEED_PATH = /^\/cal\/([^/]+)\.ics$/;
const noStore = { "Cache-Control": "no-store" };

const notFound = () => new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...noStore } });

export const feed = httpAction(async (ctx, request) => {
  const match = FEED_PATH.exec(new URL(request.url).pathname);
  const token = match ? parseCalendarToken(match[1]) : null;
  if (!token) return notFound();
  const text = await ctx.runQuery(internal.calendarFeeds.render, { ...token, at: Date.now() });
  if (text === null) return notFound();
  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="helm.ics"',
      // Calendar apps poll; a short private cache spares the deployment, and no shared cache keeps the plan.
      "Cache-Control": "private, max-age=300",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
});

export const getFeed = httpAction(async (ctx, request) => {
  const owner = await accountOwner(ctx, request);
  if (owner instanceof Response) return owner;
  return json({ feed: await ctx.runQuery(internal.calendarFeeds.get, keyIdentity(owner)) }, 200, noStore);
});

const create = (replace: boolean) =>
  httpAction(async (ctx, request) => {
    const owner = await accountOwner(ctx, request);
    if (owner instanceof Response) return owner;
    const created: CalendarFeed = await ctx.runAction(internal.calendarFeeds.create, { ...keyIdentity(owner), replace });
    return json({ feed: created }, 200, noStore);
  });

export const enableFeed = create(false);
export const rotateFeed = create(true);

export const revokeFeed = httpAction(async (ctx, request) => {
  const owner = await accountOwner(ctx, request);
  if (owner instanceof Response) return owner;
  return json(await ctx.runMutation(internal.calendarFeeds.revoke, keyIdentity(owner)), 200, noStore);
});

