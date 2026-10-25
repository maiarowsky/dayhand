// Task lifecycle on the local backend: now task, trash, history, idempotency, views.
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import { admin, asUser, newUserId } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const titles = (tasks: { title: string }[]) => tasks.map((t) => t.title);

describe("one now task per user", () => {
  test("setting a new now task clears the previous one and moves it to doing", async () => {
    const user = asUser(newUserId());
    const a: any = await user.mutation(internal.ops.add, { title: "A" });
    const b: any = await user.mutation(internal.ops.add, { title: "B" });
    await user.mutation(internal.ops.setNow, { taskId: a.id, resumeNote: "stopped at step 2" });
    const nowB: any = await user.mutation(internal.ops.setNow, { taskId: b.id });
    expect(nowB).toMatchObject({ isNow: true, status: "doing" });

    const all: any[] = await user.query(internal.ops.listAll, {});
    expect(all.filter((t) => t.isNow).map((t) => t.title)).toEqual(["B"]);
    const taskA = all.find((t) => t.title === "A");
    expect(taskA).toMatchObject({ isNow: false, status: "doing", resumeNote: "stopped at step 2" });
    const today: any = await user.query(internal.ops.listToday, {});
    expect(today.now.title).toBe("B");
  });

  test("leaving doing, completing, archiving or deleting clears now; null clears explicitly", async () => {
    const user = asUser(newUserId());
    const t: any = await user.mutation(internal.ops.add, { title: "T" });
    for (const op of [
      () => user.mutation(internal.ops.setStatus, { taskId: t.id, status: "todo" }),
      () => user.mutation(internal.ops.complete, { taskId: t.id }),
      () => user.mutation(internal.ops.archive, { taskId: t.id }),
      () => user.mutation(internal.ops.softDelete, { taskId: t.id }),
      () => user.mutation(internal.ops.setNow, { taskId: null }),
    ]) {
      await user.mutation(internal.ops.restore, { taskId: t.id });
      await user.mutation(internal.ops.restore, { taskId: t.id });
      await user.mutation(internal.ops.setNow, { taskId: t.id });
      await op();
      const all: any[] = await user.query(internal.ops.listAll, { includeArchived: true });
      expect(all.filter((x) => x.isNow)).toEqual([]);
    }
  });

  test("users do not affect each other's now task", async () => {
    const alice = asUser(newUserId());
    const bob = asUser(newUserId());
    const a: any = await alice.mutation(internal.ops.add, { title: "alice" });
    const b: any = await bob.mutation(internal.ops.add, { title: "bob" });
    await alice.mutation(internal.ops.setNow, { taskId: a.id });
    await bob.mutation(internal.ops.setNow, { taskId: b.id });
    expect(((await alice.query(internal.ops.listToday, {})) as any).now.title).toBe("alice");
    await expect(bob.mutation(internal.ops.setNow, { taskId: a.id })).rejects.toThrow(/not found/);
  });
});

describe("trash", () => {
  test("deleted tasks leave every view and come back with restore", async () => {
    const user = asUser(newUserId());
    const keep: any = await user.mutation(internal.ops.add, { title: "keep", dueDate: "today" });
    const gone: any = await user.mutation(internal.ops.add, { title: "gone", dueDate: "today" });
    await user.mutation(internal.ops.softDelete, { taskId: gone.id });
    await user.mutation(internal.ops.softDelete, { taskId: keep.id });

    expect(await user.query(internal.ops.listToday, {})).toMatchObject({ today: [] });
    expect(await user.query(internal.ops.listAll, {})).toEqual([]);
    const board: any = await user.query(internal.ops.board, {});
    expect([...board.todo, ...board.doing, ...board.done]).toEqual([]);
    expect(titles((await user.query(internal.ops.listTrash, {})) as any)).toEqual(["keep", "gone"]);
    await expect(user.mutation(internal.ops.update, { taskId: gone.id, title: "x" })).rejects.toThrow(/trash/);

    const restored: any = await user.mutation(internal.ops.restore, { taskId: keep.id });
    expect(restored.deletedAt).toBeUndefined();
    expect(titles(((await user.query(internal.ops.listToday, {})) as any).today)).toEqual(["keep"]);
  });

  test("the purge removes only tasks deleted more than 30 days ago, with their history", async () => {
    const user = asUser(newUserId());
    const gone: any = await user.mutation(internal.ops.add, { title: "gone" });
    await user.mutation(internal.ops.softDelete, { taskId: gone.id });
    const inTrash = async () => ((await user.query(internal.ops.listTrash, {})) as any[]).map((t) => t.id);

    await admin().mutation(internal.ops.purgeTrash, { now: Date.now() + 29 * DAY });
    expect(await inTrash()).toEqual([gone.id]);

    await admin().mutation(internal.ops.purgeTrash, { now: Date.now() + 31 * DAY });
    expect(await inTrash()).toEqual([]);
    await expect(user.query(internal.ops.getTask, { taskId: gone.id })).rejects.toThrow(/not found/);
    const exported: any = await user.query(internal.ops.exportPlan, { format: "json" });
    expect(exported.content.events.filter((e: any) => e.taskId === gone.id)).toEqual([]);
  });
});

describe("history", () => {
  test("every change is recorded with actor, action, before and after", async () => {
    const userId = newUserId();
    const app = asUser(userId, "app");
    const agent = asUser(userId, "agent");
    const task: any = await app.mutation(internal.ops.add, { title: "Write report", dueDate: "2026-10-22" });
    await agent.mutation(internal.ops.reschedule, { taskId: task.id, dueDate: "2026-10-24", dueTime: "09:30" });
    await agent.mutation(internal.ops.update, { taskId: task.id, title: "Write the report", labels: ["work"] });
    await app.mutation(internal.ops.update, { taskId: task.id, title: "Write the report" }); // no change
    await app.mutation(internal.ops.complete, { taskId: task.id });

    const { history }: any = await app.query(internal.ops.getTask, { taskId: task.id });
    expect(history.map((h: any) => [h.actor, h.action])).toEqual([
      ["app", "create"],
      ["agent", "update"],
      ["agent", "update"],
      ["app", "complete"],
    ]);
    expect(history[1].before).toEqual({ dueDate: "2026-10-22", dueTime: null });
    expect(history[1].after).toEqual({ dueDate: "2026-10-24", dueTime: "09:30" });
    expect(history[2].before).toEqual({ title: "Write report", labels: [] });
    expect(history[2].after).toEqual({ title: "Write the report", labels: ["work"] });
    expect(history[3].after).toMatchObject({ status: "done", completedAt: expect.any(Number) });
    expect(history.every((h: any) => typeof h.at === "number")).toBe(true);
  });

  test("settings changes are recorded too", async () => {
    const user = asUser(newUserId(), "agent");
    await user.mutation(internal.ops.updateSettings, { summaryTime: "06:30" });
    const exported: any = await user.query(internal.ops.exportPlan, { format: "json" });
    expect(exported.content.events).toEqual([
      expect.objectContaining({
        actor: "agent",
        action: "settings.update",
        before: { summaryTime: "05:00" },
        after: { summaryTime: "06:30" },
      }),
    ]);
  });
});

describe("idempotency by clientId", () => {
  test("adding twice with the same clientId creates one task and one history entry", async () => {
    const user = asUser(newUserId());
    const first: any = await user.mutation(internal.ops.add, { title: "once", clientId: "op-1" });
    const second: any = await user.mutation(internal.ops.add, { title: "once", clientId: "op-1" });
    expect(second.id).toBe(first.id);
    expect(await user.query(internal.ops.listAll, {})).toHaveLength(1);
    const { history }: any = await user.query(internal.ops.getTask, { taskId: first.id });
    expect(history).toHaveLength(1);
  });

  test("the same clientId in another user's account is independent", async () => {
    const a: any = await asUser(newUserId()).mutation(internal.ops.add, { title: "a", clientId: "shared" });
    const b: any = await asUser(newUserId()).mutation(internal.ops.add, { title: "b", clientId: "shared" });
    expect(a.id).not.toBe(b.id);
  });

  test("a replayed update is not applied again", async () => {
    const user = asUser(newUserId());
    const task: any = await user.mutation(internal.ops.add, { title: "v1" });
    await user.mutation(internal.ops.update, { taskId: task.id, title: "v2", clientId: "u-1" });
    await user.mutation(internal.ops.update, { taskId: task.id, title: "v3", clientId: "u-2" });
    const replay: any = await user.mutation(internal.ops.update, { taskId: task.id, title: "v2", clientId: "u-1" });
    expect(replay.title).toBe("v3");
    const { history }: any = await user.query(internal.ops.getTask, { taskId: task.id });
    expect(history).toHaveLength(3);
  });

  test("completing a repeating task twice with one clientId spawns one next occurrence", async () => {
    const user = asUser(newUserId());
    const task: any = await user.mutation(internal.ops.add, {
      title: "water plants",
      dueDate: "today",
      repeat: { every: "day", interval: 1 },
    });
    const first: any = await user.mutation(internal.ops.complete, { taskId: task.id, clientId: "c-1" });
    const second: any = await user.mutation(internal.ops.complete, { taskId: task.id, clientId: "c-1" });
    expect(first.next.id).toBe(second.next.id);
    const open = ((await user.query(internal.ops.listAll, { includeDone: false })) as any[]).map((t) => t.title);
    expect(open).toEqual(["water plants"]);
    const today: any = await user.query(internal.ops.listToday, {});
    expect(first.next.dueDate > today.date).toBe(true);
  });
});

describe("views", () => {
  test("listAll filters by labels (all must match) and hides done/archived on request", async () => {
    const user = asUser(newUserId());
    await user.mutation(internal.ops.add, { title: "home", labels: ["home"] });
    await user.mutation(internal.ops.add, { title: "work urgent", labels: ["work", "urgent"] });
    const done: any = await user.mutation(internal.ops.add, { title: "work done", labels: ["work"] });
    await user.mutation(internal.ops.complete, { taskId: done.id });
    const archived: any = await user.mutation(internal.ops.add, { title: "work old", labels: ["work"] });
    await user.mutation(internal.ops.archive, { taskId: archived.id });

    const list = async (args: Record<string, unknown>) =>
      titles((await user.query(internal.ops.listAll, args)) as any).sort();
    expect(await list({ labels: ["work"] })).toEqual(["work done", "work urgent"]);
    expect(await list({ labels: ["work", "urgent"] })).toEqual(["work urgent"]);
    expect(await list({ labels: ["work"], includeDone: false })).toEqual(["work urgent"]);
    expect(await list({ labels: ["work"], includeArchived: true })).toEqual(["work done", "work old", "work urgent"]);
  });

  test("board has three columns and flags the now task", async () => {
    const user = asUser(newUserId());
    await user.mutation(internal.ops.add, { title: "todo" });
    const doing: any = await user.mutation(internal.ops.add, { title: "doing", status: "doing" });
    const done: any = await user.mutation(internal.ops.add, { title: "done" });
    await user.mutation(internal.ops.complete, { taskId: done.id });
    await user.mutation(internal.ops.setNow, { taskId: doing.id });
    const board: any = await user.query(internal.ops.board, {});
    expect(titles(board.todo)).toEqual(["todo"]);
    expect(board.doing).toEqual([expect.objectContaining({ title: "doing", isNow: true })]);
    expect(titles(board.done)).toEqual(["done"]);
  });

  test("restore brings back an archived task; links and notes validate", async () => {
    const user = asUser(newUserId());
    const task: any = await user.mutation(internal.ops.add, {
      title: "read",
      note: "chapter 3",
      links: [{ url: "https://example.com/book", title: "Book" }],
    });
    await user.mutation(internal.ops.archive, { taskId: task.id });
    expect(await user.query(internal.ops.listAll, {})).toEqual([]);
    await user.mutation(internal.ops.restore, { taskId: task.id });
    expect(titles((await user.query(internal.ops.listAll, {})) as any)).toEqual(["read"]);
    await expect(
      user.mutation(internal.ops.update, { taskId: task.id, links: [{ url: "javascript:alert(1)" }] }),
    ).rejects.toThrow(/http/);
    const cleared: any = await user.mutation(internal.ops.update, { taskId: task.id, note: null });
    expect(cleared.note).toBeUndefined();
  });
});

describe("tasks keep their project (0.13.0)", () => {
  test("the trash, a restore, the archive and a status change leave the project as it is", async () => {
    const user = asUser(newUserId());
    const { project }: any = await user.mutation(internal.ops.addProject, { name: "Dom" });
    const task: any = await user.mutation(internal.ops.add, { title: "Paint the door", projectId: "Dom" });
    for (const change of [
      () => user.mutation(internal.ops.softDelete, { taskId: task.id }),
      () => user.mutation(internal.ops.restore, { taskId: task.id }),
      () => user.mutation(internal.ops.archive, { taskId: task.id }),
      () => user.mutation(internal.ops.restore, { taskId: task.id }),
      () => user.mutation(internal.ops.setNow, { taskId: task.id }),
      () => user.mutation(internal.ops.complete, { taskId: task.id }),
    ]) {
      expect(((await change()) as any).projectId ?? ((await user.query(internal.ops.getTask, { taskId: task.id })) as any).task.projectId).toBe(project.id);
    }
  });
});
