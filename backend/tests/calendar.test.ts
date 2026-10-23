// The calendar feed against the local backend: turning it on with an API key
// or from the app, reading /cal/<token>.ics, a new address making the old one
// 404, turning it off, and the .ics export through MCP and the app.
import ICAL from "ical.js";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { appClient, asUser, callTool, createKey, helm, mcpClient, newUserId } from "./helpers";

type Feed = { url: string; webcalUrl: string; googleCalendarUrl: string; createdAt: number };

async function request(key: string | null, method: "GET" | "POST", path: string) {
  const response = await fetch(`${helm().siteUrl}${path}`, {
    method,
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function getIcs(url: string) {
  const response = await fetch(url);
  return { status: response.status, headers: response.headers, text: await response.text() };
}

async function owner() {
  const userId = newUserId();
  return { userId, user: asUser(userId), key: await createKey(userId, "cli", "cli") };
}

describe("calendar feed", () => {
  test("off by default; turning it on gives https, webcal and Google Calendar addresses", async () => {
    const { key } = await owner();
    expect((await request(key, "GET", "/calendar/feed")).body).toEqual({ feed: null });

    const created = await request(key, "POST", "/calendar/feed");
    expect(created.status).toBe(200);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const feed: Feed = created.body.feed;
    expect(feed.url).toMatch(new RegExp(`^${helm().siteUrl}/cal/[A-Za-z0-9_-]{44}\\.ics$`));
    expect(feed.webcalUrl).toBe(feed.url.replace(/^https?:/, "webcal:"));
    expect(feed.googleCalendarUrl).toBe(`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feed.webcalUrl)}`);

    // Turning it on again keeps the address; reading it shows the same one.
    expect((await request(key, "POST", "/calendar/feed")).body.feed).toEqual(feed);
    expect((await request(key, "GET", "/calendar/feed")).body.feed).toEqual(feed);
  });

  test("the feed serves the plan as iCalendar that a parser reads", async () => {
    const { key, user } = await owner();
    await user.mutation(internal.ops.add, { title: "Dentist", dueDate: "2026-11-03", dueTime: "15:30" });
    await user.mutation(internal.ops.add, { title: "Bins", dueDate: "2026-11-02", repeat: "FREQ=WEEKLY;BYDAY=MO" });
    await user.mutation(internal.ops.add, { title: "No date" });
    const { feed } = (await request(key, "POST", "/calendar/feed")).body;

    const served = await getIcs(feed.url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(served.headers.get("cache-control")).toBe("private, max-age=300");
    expect(served.headers.get("referrer-policy")).toBe("no-referrer");
    const calendar = new ICAL.Component(ICAL.parse(served.text));
    const summaries = calendar.getAllSubcomponents("vevent").map((e) => e.getFirstPropertyValue("summary"));
    expect(summaries.sort()).toEqual(["Bins", "Dentist"]);
    expect(served.text).toContain("DTSTART;TZID=Europe/London:20261103T153000\r\n");
    expect(served.text).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO\r\n");
    expect(served.text).toContain("BEGIN:VTIMEZONE\r\nTZID:Europe/London\r\n");
  });

  test("the time zone comes from the settings", async () => {
    const { key, user } = await owner();
    await user.mutation(internal.ops.updateSettings, { timezone: "Europe/Warsaw" });
    await user.mutation(internal.ops.add, { title: "Call", dueDate: "2026-11-03", dueTime: "08:00" });
    const { feed } = (await request(key, "POST", "/calendar/feed")).body;
    const { text } = await getIcs(feed.url);
    expect(text).toContain("DTSTART;TZID=Europe/Warsaw:20261103T080000\r\n");
    expect(text).toContain("X-WR-TIMEZONE:Europe/Warsaw\r\n");
  });

  test("a new address replaces the old one, which answers 404; turning it off makes both 404", async () => {
    const { key } = await owner();
    const first: Feed = (await request(key, "POST", "/calendar/feed")).body.feed;
    const rotated = await request(key, "POST", "/calendar/feed/rotate");
    expect(rotated.status).toBe(200);
    const second: Feed = rotated.body.feed;
    expect(second.url).not.toBe(first.url);
    expect((await getIcs(first.url)).status).toBe(404);
    expect((await getIcs(second.url)).status).toBe(200);

    expect((await request(key, "POST", "/calendar/feed/revoke")).body).toEqual({ revoked: true });
    expect((await getIcs(second.url)).status).toBe(404);
    expect((await request(key, "GET", "/calendar/feed")).body).toEqual({ feed: null });
    expect((await request(key, "POST", "/calendar/feed/revoke")).body).toEqual({ revoked: false });
  });

  test("wrong, malformed and other users' addresses are a plain 404 that says nothing more", async () => {
    const { key } = await owner();
    const { feed } = (await request(key, "POST", "/calendar/feed")).body;
    const token = /\/cal\/([^/]+)\.ics$/.exec(feed.url)![1];
    const wrongSecret = `${token.slice(0, 12)}${"A".repeat(32)}`;
    for (const path of [`/cal/${wrongSecret}.ics`, "/cal/short.ics", `/cal/${token}`, `/cal/${token}.ics/x`, "/cal/"]) {
      const response = await fetch(`${helm().siteUrl}${path}`);
      expect(response.status, path).toBe(404);
      expect(await response.text()).toBe("Not found\n");
    }
  });

  test("managing the feed needs a valid API key, and each user only sees their own", async () => {
    expect((await request(null, "GET", "/calendar/feed")).status).toBe(401);
    expect((await request("helm_wrong", "POST", "/calendar/feed/rotate")).status).toBe(401);
    const a = await owner();
    const b = await owner();
    const feedA: Feed = (await request(a.key, "POST", "/calendar/feed")).body.feed;
    expect((await request(b.key, "GET", "/calendar/feed")).body).toEqual({ feed: null });
    await request(b.key, "POST", "/calendar/feed/revoke");
    expect((await getIcs(feedA.url)).status).toBe(200);
  });

  test("the history records the changes without the address", async () => {
    const { user, key } = await owner();
    const { feed } = (await request(key, "POST", "/calendar/feed")).body;
    const { feed: rotated } = (await request(key, "POST", "/calendar/feed/rotate")).body;
    await request(key, "POST", "/calendar/feed/revoke");
    const { content }: any = await user.query(internal.ops.exportPlan, { format: "json" });
    const feedEvents = content.events.filter((e: any) => e.action.startsWith("calendarFeed."));
    expect(feedEvents.map((e: any) => [e.action, e.actor, e.actorName])).toEqual([
      ["calendarFeed.create", "cli", "cli"],
      ["calendarFeed.rotate", "cli", "cli"],
      ["calendarFeed.revoke", "cli", "cli"],
    ]);
    const history = JSON.stringify(content.events);
    for (const url of [feed.url, rotated.url]) expect(history).not.toContain(/\/cal\/([^/]+)\.ics$/.exec(url)![1].slice(12));
  });

  test("the app turns the feed on, reads it, replaces and revokes it", async () => {
    const { client } = await appClient();
    expect(await client.query(api.app.getCalendarFeed, {})).toBeNull();
    const feed = await client.action(api.app.createCalendarFeed, {});
    expect(await client.query(api.app.getCalendarFeed, {})).toEqual(feed);
    const replaced = await client.action(api.app.createCalendarFeed, { replace: true });
    expect(replaced.url).not.toBe(feed.url);
    expect((await getIcs(feed.url)).status).toBe(404);
    expect(await client.mutation(api.app.revokeCalendarFeed, {})).toEqual({ revoked: true });
    expect((await getIcs(replaced.url)).status).toBe(404);
  });
});

describe("iCalendar export", () => {
  test("export_plan with format ics returns the same calendar as text", async () => {
    const userId = newUserId();
    await asUser(userId).mutation(internal.ops.add, { title: "Review", dueDate: "2026-11-05", dueTime: "10:00" });
    const client = await mcpClient(await createKey(userId));
    const result = await client.callTool({ name: "export_plan", arguments: { format: "ics" } });
    const text = (result.content as { text: string }[])[0].text;
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(result.structuredContent).toEqual({ format: "ics", content: text });
    expect(text).toContain("SUMMARY:Review\r\n");
    const viaHelper = await callTool(client, "export_plan", { format: "ics" });
    expect(viaHelper).toBe(text);
  });

  test("the app exports .ics too", async () => {
    const { client } = await appClient();
    await client.mutation(api.app.add, { title: "Gym", dueDate: "2026-11-06" });
    const exported = await client.query(api.app.exportPlan, { format: "ics" });
    expect(exported.format).toBe("ics");
    expect(exported.content).toContain("DTSTART;VALUE=DATE:20261106\r\n");
  });
});
