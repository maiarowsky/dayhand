// Stable task numbers (`ref`, written "#42"): given once per user, never reused,
// accepted wherever a taskId is, and backfilled for tasks from older versions.
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import { admin, asUser, callTool, createKey, importRows, mcpClient, newUserId } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("task numbers", () => {
  test("each user's tasks are numbered 1, 2, 3 in creation order", async () => {
    const alice = asUser(newUserId());
    const bob = asUser(newUserId());
    const a1: any = await alice.mutation(internal.ops.add, { title: "first" });
    const a2: any = await alice.mutation(internal.ops.add, { title: "second" });
    const b1: any = await bob.mutation(internal.ops.add, { title: "bob's first" });
    expect([a1.ref, a2.ref, b1.ref]).toEqual([1, 2, 1]);
    // An idempotent retry returns the same task and does not use up a number.
    await alice.mutation(internal.ops.add, { title: "third", clientId: "ref-1" });
    const retried: any = await alice.mutation(internal.ops.add, { title: "third", clientId: "ref-1" });
    expect(retried.ref).toBe(3);
    expect(((await alice.mutation(internal.ops.add, { title: "fourth" })) as any).ref).toBe(4);
  });

  test("every tool that takes a taskId accepts #n", async () => {
    const userId = newUserId();
    const client = await mcpClient(await createKey(userId));
    const task = await callTool(client, "add_task", { title: "Pay the invoice" });
    const ref = `#${task.ref}`;
    expect(await callTool(client, "update_task", { taskId: ref, note: "bank transfer" })).toMatchObject({ id: task.id });
    expect(await callTool(client, "reschedule_task", { taskId: ref, dueDate: "tomorrow" })).toMatchObject({ id: task.id });
    expect(await callTool(client, "set_now", { taskId: ref })).toMatchObject({ id: task.id, isNow: true });
    expect(await callTool(client, "set_status", { taskId: ref, status: "todo" })).toMatchObject({ status: "todo" });
    expect((await callTool(client, "complete_task", { taskId: ref })).task).toMatchObject({ id: task.id, status: "done" });
    expect(await callTool(client, "archive_task", { taskId: ref })).toMatchObject({ archivedAt: expect.any(Number) });
    expect(await callTool(client, "restore_task", { taskId: ref })).not.toHaveProperty("archivedAt");
    expect(await callTool(client, "delete_task", { taskId: ref })).toMatchObject({ deletedAt: expect.any(Number) });
    expect((await callTool(client, "get_task", { taskId: ref })).task).toMatchObject({ id: task.id, ref: task.ref });
    await client.close();
  });

  test("the number survives the trash and a restore, and a purged number is never given again", async () => {
    const user = asUser(newUserId());
    const first: any = await user.mutation(internal.ops.add, { title: "keep me" });
    const second: any = await user.mutation(internal.ops.add, { title: "purge me" });
    await user.mutation(internal.ops.softDelete, { taskId: `#${first.ref}` });
    expect(((await user.query(internal.ops.listTrash)) as any[])[0].ref).toBe(first.ref);
    const restored: any = await user.mutation(internal.ops.restore, { taskId: `#${first.ref}` });
    expect(restored).toMatchObject({ id: first.id, ref: first.ref });

    await user.mutation(internal.ops.softDelete, { taskId: second.id });
    await admin().mutation(internal.ops.purgeTrash, { now: Date.now() + 31 * DAY_MS });
    await expect(user.query(internal.ops.getTask, { taskId: `#${second.ref}` })).rejects.toThrow(/not found/);
    const third: any = await user.mutation(internal.ops.add, { title: "after the purge" });
    expect(third.ref).toBe(second.ref + 1);
  });

  test("the next occurrence of a repeating task gets its own number", async () => {
    const user = asUser(newUserId());
    const task: any = await user.mutation(internal.ops.add, {
      title: "Water plants",
      dueDate: "today",
      repeat: { every: "day", interval: 1 },
    });
    const { next }: any = await user.mutation(internal.ops.complete, { taskId: `#${task.ref}` });
    expect(next.ref).toBe(task.ref + 1);
  });

  test("an unknown or foreign #n is not_found, a malformed taskId is invalid_argument", async () => {
    const owner = newUserId();
    await asUser(owner).mutation(internal.ops.add, { title: "private" });
    const client = await mcpClient(await createKey(newUserId()));
    for (const taskId of ["#1", "#999"]) {
      const result = await client.callTool({ name: "complete_task", arguments: { taskId } });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ error: { code: "not_found", message: `Task ${taskId} not found` } });
    }
    for (const taskId of ["#", "#x1", "42", "nope"]) {
      const result = await client.callTool({ name: "get_task", arguments: { taskId } });
      expect(result.structuredContent).toMatchObject({ error: { code: "invalid_argument" } });
    }
    await client.close();
  });

  test("migration numbers tasks from older versions without touching numbered ones", async () => {
    const userId = newUserId();
    const user = asUser(userId);
    const legacy = (title: string, createdAt: number) => ({
      userId,
      title,
      status: "todo",
      isNow: false,
      links: [],
      createdAt,
      updatedAt: createdAt,
    });
    await importRows("tasks", [legacy("old one", 1_000), legacy("old two", 2_000)]);
    const before = (await user.query(internal.ops.listAll)) as any[];
    expect(before.map((t) => t.ref)).toEqual([undefined, undefined]);
    // A task added before the migration runs keeps its number.
    const fresh: any = await user.mutation(internal.ops.add, { title: "new" });
    expect(fresh.ref).toBe(1);

    await admin().mutation(internal.migrations.backfillTaskRefs, {});
    await expect.poll(() => admin().query(internal.migrations.status, {}), { timeout: 15_000 }).toMatchObject({
      tasksWithoutRef: 0,
    });
    const after = (await user.query(internal.ops.listAll)) as any[];
    expect(Object.fromEntries(after.map((t) => [t.title, t.ref]))).toEqual({ "old one": 2, "old two": 3, new: 1 });
    const found: any = await user.query(internal.ops.getTask, { taskId: "#2" });
    expect(found.task.title).toBe("old one");

    // Running it again changes nothing.
    await admin().mutation(internal.migrations.backfillTaskRefs, {});
    expect(((await user.query(internal.ops.listAll)) as any[]).map((t) => t.ref).sort()).toEqual([1, 2, 3]);
    expect(((await user.mutation(internal.ops.add, { title: "next" })) as any).ref).toBe(4);
  });
});
