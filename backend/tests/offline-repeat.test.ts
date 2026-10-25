import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { RepeatRule } from "../convex/lib/validators";
import { appClient } from "./helpers";

const day = "2026-10-20";

async function parent(rule: RepeatRule = { every: "day", interval: 1, count: 3 }) {
  const { client } = await appClient();
  const { project } = await client.mutation(api.app.addProject, { name: "Archived" });
  const task = await client.mutation(api.app.add, { title: "Repeat", projectId: project.id, dueDate: day, repeat: rule });
  const archived = await client.mutation(api.app.updateProject, { projectId: project.id, archived: true });
  await client.mutation(api.app.update, { taskId: task.id, repeat: null, clientId: randomUUID() });
  const completedBy = randomUUID();
  expect((await client.mutation(api.app.complete, { taskId: task.id, clientId: completedBy })).next).toBeNull();
  return { client, task, project, archived, completedBy, input: {
    title: "Repeat", projectId: project.id, dueDate: "2026-10-21", repeat: { ...rule, ...(rule.count ? { count: rule.count - 1 } : {}) },
    clientId: randomUUID(), repeatedFrom: { taskId: task.id, completedBy, completedOn: day },
  } };
}

async function code(call: Promise<unknown>) {
  try { await call; } catch (error) { return (error as { data?: { code: string; message: string } }).data; }
  throw new Error("expected a refusal");
}

test("the app restores one confirmed local occurrence without opening the archived project", async () => {
  const f = await parent();
  const next = await f.client.mutation(api.app.add, f.input);
  expect(next).toMatchObject({ projectId: f.project.id, dueDate: "2026-10-21", repeat: { count: 2 }, clientId: f.input.clientId });
  expect(await f.client.query(api.app.listProjects, {})).toEqual([f.archived]);
  expect(await f.client.mutation(api.app.add, f.input)).toEqual(next);
  expect(await code(f.client.mutation(api.app.add, { ...f.input, clientId: randomUUID() }))).toMatchObject({ code: "invalid_argument" });
  expect(await f.client.query(api.app.listAll, { includeDone: true })).toHaveLength(2);
  // The completion replay has the same next link as a server-generated recurrence.
  expect((await f.client.mutation(api.app.complete, { taskId: f.task.id, clientId: f.completedBy })).next?.id).toBe(next.id);
});

test("ordinary app adds to an archived project still get the original refusal", async () => {
  const f = await parent();
  const { repeatedFrom: _, ...ordinary } = f.input;
  expect(await code(f.client.mutation(api.app.add, ordinary))).toEqual({
    code: "invalid_argument", message: 'Project "Archived" is archived; restore it first',
  });
});

test("foreign parents, another completion, another project and forged recurrence fields cannot enable the exception", async () => {
  const f = await parent();
  const other = await appClient();
  expect(await code(other.client.mutation(api.app.add, f.input))).toMatchObject({ code: "not_found" });
  const { project } = await f.client.mutation(api.app.addProject, { name: "Other" });
  for (const input of [
    { ...f.input, repeatedFrom: { ...f.input.repeatedFrom, completedBy: randomUUID() } },
    { ...f.input, projectId: project.id },
    { ...f.input, dueDate: "2026-10-22" },
    { ...f.input, repeat: { every: "day" as const, interval: 1, count: 99 } },
    { ...f.input, clientId: undefined },
  ]) expect(await code(f.client.mutation(api.app.add, input))).toMatchObject({ code: "invalid_argument" });
  expect(await f.client.query(api.app.listProjects, {})).toContainEqual(f.archived);
});

test("a completed non-repeating parent is not a local repeat proof", async () => {
  const f = await parent();
  await f.client.mutation(api.app.updateProject, { projectId: f.project.id, archived: false });
  const ordinary = await f.client.mutation(api.app.add, { title: "Ordinary", projectId: f.project.id });
  const completedBy = randomUUID();
  await f.client.mutation(api.app.complete, { taskId: ordinary.id, clientId: completedBy });
  await f.client.mutation(api.app.updateProject, { projectId: f.project.id, archived: true });
  expect(await code(f.client.mutation(api.app.add, { ...f.input,
    repeatedFrom: { taskId: ordinary.id, completedBy, completedOn: day } }))).toMatchObject({ code: "invalid_argument" });
});

test("a long-disconnected phone restores the occurrence calculated before until, not one recalculated at sync time", async () => {
  const f = await parent({ every: "day", interval: 1, from: "completion", until: "2026-10-22" });
  const next = await f.client.mutation(api.app.add, f.input);
  expect(next).toMatchObject({ projectId: f.project.id, dueDate: "2026-10-21", repeat: { until: "2026-10-22" } });
  expect(await f.client.query(api.app.listProjects, {})).toEqual([f.archived]);
});
