// The task model of 0.5.0 on the local backend: checklists, per-task reminders,
// richer repeat rules given as objects or RRULE text, the end of a series, and
// tasks stored by older versions.
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import { addDays, localDate } from "../convex/lib/dates";
import { asUser, callTool, createKey, importRows, mcpClient, newUserId } from "./helpers";

const today = () => localDate(Date.now(), "Europe/London");

describe("checklist", () => {
  test("items keep their order, get ids and are replaced as a whole", async () => {
    const user = asUser(newUserId());
    const task: any = await user.mutation(internal.ops.add, {
      title: "Pack",
      checklist: [{ title: " passport " }, { title: "charger", done: true }, { id: "mine", title: "tickets" }],
    });
    expect(task.checklist).toEqual([
      { id: "c1", title: "passport", done: false },
      { id: "c2", title: "charger", done: true },
      { id: "mine", title: "tickets", done: false },
    ]);

    const reordered: any = await user.mutation(internal.ops.update, {
      taskId: task.id,
      checklist: [
        { id: "mine", title: "tickets", done: true },
        { id: "c1", title: "passport", done: false },
        { title: "snacks" },
      ],
    });
    expect(reordered.checklist.map((i: any) => [i.id, i.title, i.done])).toEqual([
      ["mine", "tickets", true],
      ["c1", "passport", false],
      ["c2", "snacks", false],
    ]);

    const cleared: any = await user.mutation(internal.ops.update, { taskId: task.id, checklist: null });
    expect(cleared).not.toHaveProperty("checklist");
    const empty: any = await user.mutation(internal.ops.update, { taskId: task.id, checklist: [] });
    expect(empty).not.toHaveProperty("checklist");
  });

  test("every change is in the history with the list before and after", async () => {
    const user = asUser(newUserId());
    const task: any = await user.mutation(internal.ops.add, { title: "Shop", checklist: [{ title: "milk" }] });
    await user.mutation(internal.ops.update, { taskId: task.id, checklist: [{ id: "c1", title: "milk", done: true }] });
    const { history }: any = await user.query(internal.ops.getTask, { taskId: task.id });
    expect(history[0]).toMatchObject({ action: "create", after: { checklist: [{ id: "c1", title: "milk", done: false }] } });
    expect(history[1]).toMatchObject({
      action: "update",
      before: { checklist: [{ id: "c1", title: "milk", done: false }] },
      after: { checklist: [{ id: "c1", title: "milk", done: true }] },
    });
  });

  test("bad lists are refused", async () => {
    const user = asUser(newUserId());
    const add = (checklist: unknown[]) => user.mutation(internal.ops.add, { title: "x", checklist });
    await expect(add([{ title: "  " }])).rejects.toThrow(/need a title/);
    await expect(add([{ id: "a", title: "1" }, { id: "a", title: "2" }])).rejects.toThrow(/distinct/);
    await expect(add(Array.from({ length: 101 }, (_, i) => ({ title: `${i}` })))).rejects.toThrow(/at most 100/);
    await expect(add([{ title: "x".repeat(501) }])).rejects.toThrow(/at most 500/);
  });
});

describe("reminders", () => {
  test("own reminders replace the defaults; [] silences; null goes back to the defaults", async () => {
    const user = asUser(newUserId());
    const task: any = await user.mutation(internal.ops.add, {
      title: "Dentist",
      dueDate: "tomorrow",
      dueTime: "10:00",
      reminders: [{ minutesBefore: 30 }, { time: "18:00", daysBefore: 1 }, { minutesBefore: 30 }, { time: "08:00", daysBefore: 0 }],
    });
    expect(task.reminders).toEqual([{ minutesBefore: 30 }, { time: "18:00", daysBefore: 1 }, { time: "08:00" }]);
    const silenced: any = await user.mutation(internal.ops.update, { taskId: task.id, reminders: [] });
    expect(silenced.reminders).toEqual([]);
    const defaults: any = await user.mutation(internal.ops.update, { taskId: task.id, reminders: null });
    expect(defaults).not.toHaveProperty("reminders");
  });

  test("bad reminders are refused", async () => {
    const user = asUser(newUserId());
    const add = (reminders: unknown[]) => user.mutation(internal.ops.add, { title: "x", reminders });
    await expect(add([{ minutesBefore: -1 }])).rejects.toThrow(/minutesBefore/);
    await expect(add([{ minutesBefore: 10081 }])).rejects.toThrow(/minutesBefore/);
    await expect(add([{ time: "25:00" }])).rejects.toThrow(/HH:MM/);
    await expect(add([{ time: "09:00", daysBefore: 31 }])).rejects.toThrow(/daysBefore/);
    await expect(add(Array.from({ length: 6 }, (_, i) => ({ minutesBefore: i })))).rejects.toThrow(/at most 5/);
  });
});

describe("repeat rules", () => {
  test("an RRULE string is read into the rule, and every repeating task carries its RRULE", async () => {
    const user = asUser(newUserId());
    const task: any = await user.mutation(internal.ops.add, { title: "Payday", dueDate: "2026-10-30", repeat: "RRULE:FREQ=MONTHLY;BYDAY=-1FR" });
    expect(task.repeat).toEqual({ every: "month", interval: 1, weekdayOfMonth: { nth: -1, weekday: 5 } });
    expect(task.rrule).toBe("FREQ=MONTHLY;BYDAY=-1FR");
    const plain: any = await user.mutation(internal.ops.add, { title: "No repeat" });
    expect(plain).not.toHaveProperty("rrule");
    await expect(user.mutation(internal.ops.add, { title: "x", repeat: "FREQ=HOURLY" })).rejects.toThrow(/repeat: FREQ must be/);
    await expect(
      user.mutation(internal.ops.update, { taskId: task.id, repeat: { every: "week", interval: 1, monthDay: 3 } }),
    ).rejects.toThrow(/monthDay is allowed only/);
  });

  test("the next occurrence unticks the checklist, keeps the reminders and counts down", async () => {
    const user = asUser(newUserId());
    const due = addDays(today(), 1);
    const task: any = await user.mutation(internal.ops.add, {
      title: "Weekly review",
      dueDate: due,
      repeat: { every: "week", interval: 1, count: 2 },
      checklist: [{ title: "inbox", done: true }, { title: "calendar" }],
      reminders: [{ time: "09:00" }],
    });
    const { next }: any = await user.mutation(internal.ops.complete, { taskId: task.id });
    expect(next).toMatchObject({
      dueDate: addDays(due, 7),
      repeat: { every: "week", interval: 1, count: 1 },
      checklist: [
        { id: "c1", title: "inbox", done: false },
        { id: "c2", title: "calendar", done: false },
      ],
      reminders: [{ time: "09:00" }],
    });
    // The last occurrence ends the series.
    const last: any = await user.mutation(internal.ops.complete, { taskId: next.id });
    expect(last).toMatchObject({ task: { status: "done" }, next: null });
  });

  test("until ends the series", async () => {
    const user = asUser(newUserId());
    const due = today();
    const task: any = await user.mutation(internal.ops.add, { title: "x", dueDate: due, repeat: { every: "day", interval: 1, until: due } });
    expect(((await user.mutation(internal.ops.complete, { taskId: task.id })) as any).next).toBeNull();
  });

  test("counted from completion, an overdue task comes back counted from today", async () => {
    const user = asUser(newUserId());
    const task: any = await user.mutation(internal.ops.add, {
      title: "Water the plants",
      dueDate: "2026-01-01",
      repeat: { every: "day", interval: 3, from: "completion" },
    });
    const { next }: any = await user.mutation(internal.ops.complete, { taskId: task.id });
    expect(next.dueDate).toBe(addDays(today(), 3));
  });

  test("a plain monthly task from the 31st keeps the 31st after a short month", async () => {
    const user = asUser(newUserId());
    // Due long ago: completing it lands on the first date after today, but the rule must stay on the 31st.
    const task: any = await user.mutation(internal.ops.add, { title: "Rent", dueDate: "2025-01-31", repeat: { every: "month", interval: 1 } });
    const { next }: any = await user.mutation(internal.ops.complete, { taskId: task.id });
    expect(next.repeat).toEqual({ every: "month", interval: 1, monthDay: 31 });
    expect(next.rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1");
  });
});

describe("tasks from older versions", () => {
  test("a task stored without the new fields reads, updates and repeats as before", async () => {
    const userId = newUserId();
    const user = asUser(userId);
    const createdAt = Date.now() - 1000;
    await importRows("tasks", [
      {
        userId,
        ref: 1,
        title: "Old repeating task",
        dueDate: "2026-01-05",
        status: "todo",
        isNow: false,
        repeat: { every: "week", interval: 1, weekdays: [1] },
        labels: [],
        links: [],
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    const [old]: any[] = await user.query(internal.ops.listAll, {});
    expect(old).not.toHaveProperty("checklist");
    expect(old).not.toHaveProperty("reminders");
    expect(old.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    const renamed: any = await user.mutation(internal.ops.update, { taskId: "#1", title: "Renamed" });
    expect(renamed.title).toBe("Renamed");
    const { next }: any = await user.mutation(internal.ops.complete, { taskId: "#1" });
    expect(next.repeat).toEqual({ every: "week", interval: 1, weekdays: [1] });
    expect(next).not.toHaveProperty("checklist");
  });
});

describe("through MCP", () => {
  test("the tool schemas offer the new fields and the tools accept them", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    const { tools } = await client.listTools();
    const schema = (name: string) => tools.find((t) => t.name === name)!.inputSchema as any;
    expect(Object.keys(schema("add_task").properties)).toEqual(expect.arrayContaining(["checklist", "reminders", "repeat"]));
    expect(schema("update_task").properties.checklist.description).toMatch(/whole list is replaced/);
    // repeat: the rule object or an RRULE string (and null in update_task).
    expect(JSON.stringify(schema("add_task").properties.repeat)).toContain('"type":"string"');
    expect(JSON.stringify(schema("add_task").properties.repeat)).toContain("weekdayOfMonth");

    const task = await callTool(client, "add_task", {
      title: "Plan the week",
      repeat: "FREQ=WEEKLY;BYDAY=MO;COUNT=4",
      checklist: [{ title: "look back" }, { title: "look ahead" }],
      reminders: [{ minutesBefore: 15 }],
    });
    expect(task).toMatchObject({ rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=4", checklist: [{ id: "c1" }, { id: "c2" }], reminders: [{ minutesBefore: 15 }] });
    const ticked = await callTool(client, "update_task", {
      taskId: `#${task.ref}`,
      checklist: [{ ...task.checklist[0], done: true }, task.checklist[1]],
    });
    expect(ticked.checklist[0].done).toBe(true);

    const bad = await client.callTool({ name: "add_task", arguments: { title: "x", repeat: "FREQ=SECONDLY" } });
    expect(bad).toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_argument" } } });
    await client.close();
  });

  test("exports carry the checklist, the reminders and the RRULE", async () => {
    const user = asUser(newUserId());
    await user.mutation(internal.ops.add, {
      title: "Trip",
      dueDate: "2026-11-02",
      repeat: { every: "month", interval: 1, monthDay: -1, from: "completion" },
      checklist: [{ title: "book", done: true }, { title: "pack" }],
      reminders: [{ minutesBefore: 0 }, { time: "18:00", daysBefore: 1 }],
    });
    const json: any = await user.query(internal.ops.exportPlan, { format: "json" });
    expect(json.content.tasks[0]).toMatchObject({ rrule: "FREQ=MONTHLY;BYMONTHDAY=-1", checklist: [{ title: "book" }, { title: "pack" }] });
    const markdown: any = await user.query(internal.ops.exportPlan, { format: "markdown" });
    expect(markdown.content).toContain("(repeats FREQ=MONTHLY;BYMONTHDAY=-1, counted from completion)");
    expect(markdown.content).toContain("  - [x] book\n  - [ ] pack\n  - Reminders: at the due time, 18:00, 1 day before");
  });
});
