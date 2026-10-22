// Overdue and the Today screen, evaluated on the local backend at chosen instants.
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import { asUser, newUserId, utc } from "./helpers";

const titles = (tasks: { title: string }[]) => tasks.map((t) => t.title);

describe("overdue at the midnight boundary in the user's time zone", () => {
  test("default zone Europe/London (BST): due 22 Oct becomes overdue at 23:00 UTC", async () => {
    const user = asUser(newUserId());
    await user.mutation(internal.ops.add, { title: "due 22", dueDate: "2026-10-22" });

    const before: any = await user.query(internal.ops.listToday, { at: utc("2026-10-22T22:59") });
    expect(before.timezone).toBe("Europe/London");
    expect(before.date).toBe("2026-10-22");
    expect(titles(before.today)).toEqual(["due 22"]);
    expect(before.overdue).toEqual([]);

    const after: any = await user.query(internal.ops.listToday, { at: utc("2026-10-22T23:00") });
    expect(after.date).toBe("2026-10-23");
    expect(titles(after.overdue)).toEqual(["due 22"]);
    expect(after.today).toEqual([]);
  });

  test("after switching to Europe/Warsaw the boundary moves to 22:00 UTC", async () => {
    const user = asUser(newUserId());
    await user.mutation(internal.ops.updateSettings, { timezone: "Europe/Warsaw" });
    await user.mutation(internal.ops.add, { title: "due 22", dueDate: "2026-10-22" });

    const before: any = await user.query(internal.ops.listToday, { at: utc("2026-10-22T21:59") });
    expect(titles(before.today)).toEqual(["due 22"]);
    const after: any = await user.query(internal.ops.listToday, { at: utc("2026-10-22T22:00") });
    expect(titles(after.overdue)).toEqual(["due 22"]);
  });
});

describe("listToday", () => {
  test("overdue first by date, today timed then untimed, done today, nothing else", async () => {
    const user = asUser(newUserId());
    const at = utc("2026-10-22T10:00");
    await user.mutation(internal.ops.add, { title: "old", dueDate: "2026-10-19" });
    await user.mutation(internal.ops.add, { title: "yesterday", dueDate: "2026-10-21", dueTime: "08:00" });
    await user.mutation(internal.ops.add, { title: "untimed", dueDate: "2026-10-22" });
    await user.mutation(internal.ops.add, { title: "13:15", dueDate: "2026-10-22", dueTime: "13:15" });
    await user.mutation(internal.ops.add, { title: "09:00", dueDate: "2026-10-22", dueTime: "09:00" });
    await user.mutation(internal.ops.add, { title: "tomorrow", dueDate: "2026-10-23" });
    await user.mutation(internal.ops.add, { title: "no date" });
    const archived: any = await user.mutation(internal.ops.add, { title: "archived", dueDate: "2026-10-20" });
    await user.mutation(internal.ops.archive, { taskId: archived.id });

    const view: any = await user.query(internal.ops.listToday, { at });
    expect(titles(view.overdue)).toEqual(["old", "yesterday"]);
    expect(titles(view.today)).toEqual(["09:00", "13:15", "untimed"]);
    expect(view.doneToday).toEqual([]);
  });

  test("a task completed now shows under done today, not under overdue", async () => {
    const user = asUser(newUserId());
    const task: any = await user.mutation(internal.ops.add, { title: "late", dueDate: "2020-01-01" });
    await user.mutation(internal.ops.complete, { taskId: task.id });
    const view: any = await user.query(internal.ops.listToday, {});
    expect(view.overdue).toEqual([]);
    expect(titles(view.doneToday)).toEqual(["late"]);
  });

  test("dates accept today/tomorrow and reject garbage", async () => {
    const user = asUser(newUserId());
    const today: any = await user.query(internal.ops.listToday, {});
    const task: any = await user.mutation(internal.ops.add, { title: "t", dueDate: "today" });
    expect(task.dueDate).toBe(today.date);
    await expect(user.mutation(internal.ops.add, { title: "x", dueDate: "2026-13-01" })).rejects.toThrow(/dueDate/);
    await expect(user.mutation(internal.ops.add, { title: "x", dueTime: "09:00" })).rejects.toThrow(/needs a dueDate/);
    await expect(user.mutation(internal.ops.add, { title: "  " })).rejects.toThrow(/title/);
  });
});
