// Import: the readers on sample files (Dayhand JSON, iCalendar, Todoist CSV), and
// POST /api/v1/import against the local backend: a Dayhand export brought into an
// empty account gives the same plan, a repeated import skips everything, a dry
// run stores nothing, and a task that fails its checks does not stop the rest.
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import { detectFormat, parseCsv, readPlan, type ReadContext } from "../convex/lib/importFormats";
import { admin, asUser, createKey, newUserId, openApiChecker, rest } from "./helpers";

const CONTEXT: ReadContext = { timezone: "Europe/London", today: "2026-11-02" }; // a Monday

const TODOIST = [
  "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE",
  'task,Buy milk @shop @home,"2 litres, skimmed",4,1,Ann (1),,tomorrow at 9am,en,Europe/London',
  "task,Oat milk,,1,2,Ann (1),,,en,Europe/London",
  "note,Ask about the discount,,,,Ann (1),,,,",
  ",,,,,,,,,",
  "section,Work,,,,,,,,",
  "task,Weekly report,,1,1,Ann (1),,every monday,en,Europe/London",
  "task,Plan Q1,,1,1,Ann (1),,Nov 20 15:30,en,Europe/London",
  "task,Someday,,1,1,Ann (1),,when the moon is full,en,Europe/London",
].join("\r\n");

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Example//Tasks//EN",
  "BEGIN:VTODO",
  "UID:todo-1@example.com",
  "SUMMARY:Call the bank\\, about the card",
  "DESCRIPTION:Line one\\nLine two",
  "DUE;TZID=Europe/Warsaw:20261105T100000",
  "CATEGORIES:money,calls",
  "URL:https://bank.example/help",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT30M",
  "END:VALARM",
  "END:VTODO",
  "BEGIN:VTODO",
  "UID:todo-2@example.com",
  "SUMMARY:Water the plants and also the very long title that is folded over",
  "  two lines",
  "DTSTART;VALUE=DATE:20261103",
  "RRULE:FREQ=WEEKLY;BYDAY=TU",
  "END:VTODO",
  "BEGIN:VTODO",
  "UID:todo-3@example.com",
  "SUMMARY:Filed taxes",
  "STATUS:COMPLETED",
  "COMPLETED:20261020T120000Z",
  "END:VTODO",
  "BEGIN:VTODO",
  "UID:todo-4@example.com",
  "SUMMARY:Cancelled thing",
  "STATUS:CANCELLED",
  "END:VTODO",
  "BEGIN:VEVENT",
  "UID:event-1@example.com",
  "SUMMARY:Dentist",
  "DTSTART:20261110T143000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("import readers", () => {
  test("formats are recognised from the content", () => {
    expect(detectFormat('{"version":1,"tasks":[]}')).toBe("dayhand-json");
    expect(detectFormat("﻿BEGIN:VCALENDAR\r\n")).toBe("ics");
    expect(detectFormat("TYPE,CONTENT,DESCRIPTION\n")).toBe("todoist-csv");
    expect(() => detectFormat("hello")).toThrow(/Unknown format/);
  });

  test("CSV records keep quoted commas, quotes and line breaks", () => {
    expect(parseCsv('a,"b, c","say ""hi""","two\nlines"\r\nx,y,,z\n')).toEqual([
      ["a", "b, c", 'say "hi"', "two\nlines"],
      ["x", "y", "", "z"],
    ]);
  });

  test("Todoist CSV: labels, sections, notes, sub-tasks as checklist, dates and repeats", () => {
    const { items, warnings } = readPlan("todoist-csv", TODOIST, CONTEXT);
    expect(items.map(({ source, ...rest }) => rest)).toEqual([
      {
        title: "Buy milk",
        note: "2 litres, skimmed\n\nAsk about the discount",
        dueDate: "2026-11-03",
        dueTime: "09:00",
        labels: ["shop", "home"],
        checklist: [{ title: "Oat milk" }],
      },
      { title: "Weekly report", repeat: { every: "week", interval: 1, weekdays: [1] }, dueDate: "2026-11-02", labels: ["Work"] },
      { title: "Plan Q1", dueDate: "2026-11-20", dueTime: "15:30", labels: ["Work"] },
      { title: "Someday", note: "Todoist date: when the moon is full", labels: ["Work"] },
    ]);
    expect(warnings).toEqual([
      '"Someday": the date "when the moon is full" was not understood; it is kept in the note',
      "1 sub-task(s) became checklist items of their parent task",
      "Todoist priorities are not imported (Dayhand has none)",
    ]);
  });

  test("iCalendar: VTODO and VEVENT, time zones, escapes, folding, repeats, alarms, done and cancelled", () => {
    const { items, warnings } = readPlan("ics", ICS, CONTEXT);
    expect(items.map(({ source, ...rest }) => rest)).toEqual([
      {
        title: "Call the bank, about the card",
        note: "Line one\nLine two",
        dueDate: "2026-11-05",
        dueTime: "09:00",
        status: "todo",
        labels: ["money", "calls"],
        links: [{ url: "https://bank.example/help" }],
        reminders: [{ minutesBefore: 30 }],
      },
      { title: "Water the plants and also the very long title that is folded over two lines", dueDate: "2026-11-03", status: "todo", repeat: "FREQ=WEEKLY;BYDAY=TU" },
      { title: "Filed taxes", status: "done", completedAt: Date.UTC(2026, 9, 20, 12, 0) },
      { title: "Dentist", dueDate: "2026-11-10", dueTime: "14:30", status: "todo" },
    ]);
    expect(warnings).toEqual(["1 cancelled entr(ies), changed occurrence(s) of a series or duplicate(s) were skipped"]);
  });

  test("Dayhand's own calendar feed, also from before the rename: ✓ means done, the task number leaves the note", () => {
    for (const name of ["Dayhand", "Helm"]) {
      const feed = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        `PRODID:-//${name}//${name} planner//EN`,
        "BEGIN:VEVENT",
        "UID:abc@helm",
        "SUMMARY:✓ Filed taxes",
        `DESCRIPTION:${name} #12\\n\\nreceipts in the drawer`,
        "DTSTART;VALUE=DATE:20261030",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
      const { items } = readPlan("ics", feed, CONTEXT);
      expect(items.map(({ source, ...rest }) => rest), name).toEqual([
        { title: "Filed taxes", note: "receipts in the drawer", dueDate: "2026-10-30", status: "done" },
      ]);
    }
  });
});

async function account() {
  const userId = newUserId();
  return { userId, user: asUser(userId, "agent"), key: await createKey(userId, "importer", "cli") };
}

const comparable = (task: Record<string, unknown>) => {
  const { id, createdAt, updatedAt, clientId, isNow, completedAt, archivedAt, ...rest } = task;
  return { ...rest, completed: completedAt !== undefined, archived: archivedAt !== undefined };
};

describe("POST /api/v1/import", () => {
  test("a Dayhand JSON export rebuilds the plan in an empty account, numbers included; importing again skips everything", async () => {
    const source = await account();
    const add = (args: Record<string, unknown>) => source.user.mutation(internal.ops.add, args) as Promise<any>;
    await add({ title: "Report", dueDate: "2026-11-03", dueTime: "09:30", labels: ["work"], note: "draft", reminders: [{ minutesBefore: 15 }] });
    const bins = await add({ title: "Bins", dueDate: "2026-11-02", repeat: "FREQ=WEEKLY;BYDAY=MO", checklist: [{ title: "Glass" }] });
    const gone = await add({ title: "Gone" });
    await add({ title: "Links", links: [{ url: "https://example.com", title: "ex" }], status: "doing" });
    const old = await add({ title: "Old" });
    await source.user.mutation(internal.ops.complete, { taskId: bins.id });
    await source.user.mutation(internal.ops.softDelete, { taskId: gone.id });
    await source.user.mutation(internal.ops.archive, { taskId: old.id });
    const exported: any = await source.user.query(internal.ops.exportPlan, { format: "json" });
    const before: any[] = exported.content.tasks.filter((t: any) => t.deletedAt === undefined);

    const target = await account();
    const content = JSON.stringify(exported.content);
    const preview = await rest(target.key, "POST", "/import?dryRun=true", { body: { content } });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ format: "dayhand-json", dryRun: true, total: before.length, created: before.length });
    expect((await rest(target.key, "GET", "/tasks?includeArchived=true")).body.total).toBe(0);

    const imported = await rest(target.key, "POST", "/import", { body: { content, format: "auto" } });
    expect(imported.status).toBe(200);
    expect(imported.body).toMatchObject({ dryRun: false, total: before.length, created: before.length, skipped: [], failed: [] });
    expect(imported.body.warnings).toEqual(["1 task(s) in the trash were not imported", "Settings and history are not imported; set the time zone with dayhand settings set if needed"]);
    const { conforms } = await openApiChecker();
    expect(conforms("POST", "/import", imported)).toEqual([]);

    const after: any[] = ((await target.user.query(internal.ops.exportPlan, { format: "json" })) as any).content.tasks;
    const byRef = (list: any[]) => [...list].sort((a, b) => a.ref - b.ref).map(comparable);
    expect(byRef(after)).toEqual(byRef(before));
    // The numbers came along (3 was in the trash); a new task gets the next number after the highest (6, Bins' next occurrence).
    expect((await rest(target.key, "POST", "/tasks", { body: { title: "New" } })).body.ref).toBe(7);

    const again = await rest(target.key, "POST", "/import", { body: { content } });
    expect(again.body).toMatchObject({ created: 0, failed: [] });
    expect(again.body.skipped).toHaveLength(before.length);
    expect(again.body.skipped[0].reason).toBe("imported before");
    // helm-json, the format's name before the rename, is the same format with the same import keys.
    const legacy = await rest(target.key, "POST", "/import", { body: { content, format: "helm-json" } });
    expect(legacy.body).toMatchObject({ format: "dayhand-json", created: 0, failed: [] });
    expect(legacy.body.skipped).toHaveLength(before.length);
    // Into the account it came from: the tasks themselves are there.
    const home = await rest(source.key, "POST", "/import", { body: { content } });
    expect(home.body.created).toBe(0);
    expect(home.body.skipped.every((s: { reason: string }) => s.reason.startsWith("the task itself"))).toBe(true);
  });

  test("Todoist CSV and iCalendar through the API; a task that fails its checks is reported, the rest imported", async () => {
    const { key } = await account();
    const todoist = await rest(key, "POST", "/import", { body: { content: TODOIST } });
    expect(todoist.body).toMatchObject({ format: "todoist-csv", total: 4, created: 4 });
    const bad = ICS.replace("RRULE:FREQ=WEEKLY;BYDAY=TU", "RRULE:FREQ=HOURLY");
    const ics = await rest(key, "POST", "/import", { body: { content: bad, format: "ics" } });
    expect(ics.body).toMatchObject({ format: "ics", total: 4, created: 3 });
    expect(ics.body.failed).toEqual([{ title: expect.stringMatching(/^Water the plants/), message: expect.stringMatching(/FREQ must be/) }]);
    const all = (await rest(key, "GET", "/tasks?includeArchived=true")).body.result.map((t: { title: string }) => t.title);
    expect(all).toContain("Dentist");
    expect(all).toContain("Weekly report");
  });

  test("bad input is 422; a write key cannot import", async () => {
    const { userId, key } = await account();
    expect((await rest(key, "POST", "/import", { body: { content: "hello" } })).status).toBe(422);
    expect((await rest(key, "POST", "/import", { body: { content: '{"version":9,"tasks":[]}' } })).body.detail).toMatch(/version 1/);
    expect((await rest(key, "POST", "/import", { body: { content: "x", colour: 1 } })).status).toBe(422);
    const write = (await admin().action(internal.apiKeys.create, { userId, actor: "app", name: "w", scope: "write" })) as { key: string };
    expect((await rest(write.key, "POST", "/import", { body: { content: TODOIST } })).status).toBe(403);
  });
});
