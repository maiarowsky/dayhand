// Projects (0.13.0) on the local backend: names unique in any case, archived ones
// included; references by id or name; counts; a project made from a label; deleting
// one moves its tasks with history and webhooks; filters by project; the app layer.
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { admin, appClient, asUser, callTool, createKey, helm, mcpClient, newUserId, rest, utc } from "./helpers";

type Failure = { code: string; message: string; result?: any };

/** The domain error a call failed with (its ConvexError data). */
async function failure(call: Promise<unknown>): Promise<Failure> {
  try {
    await call;
  } catch (error) {
    const data = (error as { data?: Failure }).data;
    if (data) return data;
    throw error;
  }
  throw new Error("expected the call to fail");
}

const titles = (tasks: { title: string }[]) => tasks.map((t) => t.title).sort();

async function historyOf(userId: string, taskId: string) {
  return ((await asUser(userId).query(internal.ops.getTask, { taskId })) as any).history;
}

describe("project names", () => {
  test("a name is unique in any case and spacing, archived projects included", async () => {
    const user = asUser(newUserId());
    const added: any = await user.mutation(internal.ops.addProject, { name: "  Dom  " });
    expect(added.project).toMatchObject({ name: "Dom", archived: false, position: 1024 });
    expect(added.project).not.toHaveProperty("nameKey");
    expect(added).toMatchObject({ moved: [], skipped: [] });
    for (const name of ["dom", "DOM", " dOm "]) {
      expect(await failure(user.mutation(internal.ops.addProject, { name }))).toMatchObject({
        code: "invalid_argument",
        message: 'A project named "Dom" already exists',
      });
    }
    await user.mutation(internal.ops.updateProject, { projectId: "dom", archived: true });
    expect(await failure(user.mutation(internal.ops.addProject, { name: "DOM" }))).toMatchObject({
      code: "invalid_argument",
      message: 'A project named "Dom" already exists (archived)',
    });
    // The same letters in another Unicode form are the same name.
    await user.mutation(internal.ops.addProject, { name: "Café" });
    expect((await failure(user.mutation(internal.ops.addProject, { name: "café" }))).code).toBe("invalid_argument");
  });

  test('"none" is reserved, and names are 1 to 50 characters on one line', async () => {
    const user = asUser(newUserId());
    for (const name of ["none", "None", "  NONE "]) {
      expect(await failure(user.mutation(internal.ops.addProject, { name }))).toMatchObject({ code: "invalid_argument", message: expect.stringMatching(/"none" is reserved/) });
    }
    for (const name of ["", "   ", "x".repeat(51), "two\nlines"]) {
      expect((await failure(user.mutation(internal.ops.addProject, { name }))).code).toBe("invalid_argument");
    }
    const longest: any = await user.mutation(internal.ops.addProject, { name: "x".repeat(50) });
    expect(longest.project.name).toHaveLength(50);
  });

  test("renaming keeps names unique; changing only the case is allowed", async () => {
    const user = asUser(newUserId());
    await user.mutation(internal.ops.addProject, { name: "Home" });
    const work: any = (await user.mutation(internal.ops.addProject, { name: "Work" })).project;
    expect((await failure(user.mutation(internal.ops.updateProject, { projectId: work.id, name: "HOME" }))).code).toBe("invalid_argument");
    expect(await user.mutation(internal.ops.updateProject, { projectId: work.id, name: "WORK" })).toMatchObject({ id: work.id, name: "WORK" });
    expect(await user.mutation(internal.ops.updateProject, { projectId: "work", name: "Office" })).toMatchObject({ id: work.id, name: "Office" });
    expect((await failure(user.mutation(internal.ops.addProject, { name: "office" }))).code).toBe("invalid_argument");
    await user.mutation(internal.ops.addProject, { name: "Work" });
  });

  test("color is one of 12 tokens, icon one emoji, note up to 2000 characters; null clears", async () => {
    const user = asUser(newUserId());
    const { project }: any = await user.mutation(internal.ops.addProject, { name: "Bakery", color: "amber", icon: "🥐", note: "Website and menu" });
    expect(project).toMatchObject({ color: "amber", icon: "🥐", note: "Website and menu" });
    await expect(user.mutation(internal.ops.addProject, { name: "Bad", color: "#ff0000" })).rejects.toThrow(/color/);
    for (const icon of ["🇵🇱", "👩🏽‍💻", "❤️", "🏴󠁧󠁢󠁷󠁬󠁳󠁿"]) {
      expect(await user.mutation(internal.ops.updateProject, { projectId: project.id, icon })).toMatchObject({ icon });
    }
    for (const icon of ["ab", "🥐 🥐", "🥐".repeat(9), "x"]) {
      expect((await failure(user.mutation(internal.ops.updateProject, { projectId: project.id, icon }))).code).toBe("invalid_argument");
    }
    expect((await failure(user.mutation(internal.ops.updateProject, { projectId: project.id, note: "n".repeat(2001) }))).code).toBe("invalid_argument");
    const cleared: any = await user.mutation(internal.ops.updateProject, { projectId: project.id, color: null, icon: null, note: null });
    expect(cleared).not.toHaveProperty("color");
    expect(cleared).not.toHaveProperty("icon");
    expect(cleared).not.toHaveProperty("note");
  });

  test.each(["abc🥐", "🥐🥐"])("add and update reject an icon that is not one emoji: %s", async (icon) => {
    const user = asUser(newUserId());
    expect(await failure(user.mutation(internal.ops.addProject, { name: "Invalid", icon }))).toMatchObject({ code: "invalid_argument" });
    expect(((await user.query(internal.ops.listProjects, {})) as any).result).toEqual([]);
    const { project }: any = await user.mutation(internal.ops.addProject, { name: "Valid", icon: "🥐" });
    expect(await failure(user.mutation(internal.ops.updateProject, { projectId: project.id, icon }))).toMatchObject({ code: "invalid_argument" });
    expect(((await user.query(internal.ops.listProjects, {})) as any).result[0]).toMatchObject({ id: project.id, icon: "🥐" });
  });

  test("add and update accept keycaps, modifiers and joined emoji as one icon", async () => {
    const user = asUser(newUserId());
    for (const [index, icon] of ["1️⃣", "#️⃣", "👍🏽", "👩‍👩‍👧‍👦"].entries()) {
      const { project }: any = await user.mutation(internal.ops.addProject, { name: `Emoji ${index}`, icon });
      expect(project.icon).toBe(icon);
      expect(await user.mutation(internal.ops.updateProject, { projectId: project.id, icon: "👩🏽‍💻" })).toMatchObject({ icon: "👩🏽‍💻" });
      expect(await user.mutation(internal.ops.updateProject, { projectId: project.id, icon })).toMatchObject({ icon });
    }
  });

  test("new projects go last; position orders the list and archive takes a project out", async () => {
    const user = asUser(newUserId());
    for (const name of ["A", "B", "C"]) await user.mutation(internal.ops.addProject, { name });
    const listed = async (args = {}) => ((await user.query(internal.ops.listProjects, args)) as any).result.map((p: any) => `${p.name}@${p.position}`);
    expect(await listed()).toEqual(["A@1024", "B@2048", "C@3072"]);
    // Moving C between A and B: the middle of its neighbours.
    await user.mutation(internal.ops.updateProject, { projectId: "C", position: 1536 });
    await user.mutation(internal.ops.updateProject, { projectId: "A", archived: true });
    expect(await listed()).toEqual(["C@1536", "B@2048"]);
    expect(await listed({ includeArchived: true })).toEqual(["A@1024", "C@1536", "B@2048"]);
    // A new project goes after the highest position, archived ones included.
    expect((await user.mutation(internal.ops.addProject, { name: "D" }) as any).project.position).toBe(3072);
    expect((await failure(user.mutation(internal.ops.updateProject, { projectId: "B", position: Number.POSITIVE_INFINITY }))).code).toBe("invalid_argument");
    const restored: any = await user.mutation(internal.ops.updateProject, { projectId: "a", archived: false });
    expect(restored).toMatchObject({ name: "A", archived: false });
    expect(restored).not.toHaveProperty("archivedAt");
  });

  test("a user has at most 200 projects, archived ones included", async () => {
    const user = asUser(newUserId());
    for (let i = 1; i <= 200; i++) await user.mutation(internal.ops.addProject, { name: `P${i}` });
    expect(await failure(user.mutation(internal.ops.addProject, { name: "One more" }))).toMatchObject({ code: "invalid_argument", message: expect.stringMatching(/at most 200 projects/) });
  }, 60_000);

  test("changes are idempotent by clientId and recorded in history without a task", async () => {
    const userId = newUserId();
    const user = asUser(userId);
    const first: any = await user.mutation(internal.ops.addProject, { name: "Garden", clientId: "p-1" });
    const again: any = await user.mutation(internal.ops.addProject, { name: "Garden", clientId: "p-1" });
    expect(again.project.id).toBe(first.project.id);
    await user.mutation(internal.ops.updateProject, { projectId: "Garden", color: "green", clientId: "p-2" });
    await user.mutation(internal.ops.updateProject, { projectId: "Garden", color: "red" });
    // A retry of p-2 does not set green again: it answers with the project as it is.
    expect(await user.mutation(internal.ops.updateProject, { projectId: "Garden", color: "green", clientId: "p-2" })).toMatchObject({ color: "red" });
    const { content }: any = await user.query(internal.ops.exportPlan, { format: "json" });
    const actions = content.events.filter((e: any) => e.taskId === undefined).map((e: any) => e.action);
    expect(actions).toEqual(["projectAdd", "projectUpdate", "projectUpdate"]);
    expect(content.events[0]).toMatchObject({ actor: "app", after: { projectId: first.project.id, name: "Garden" } });
    // Project changes are not task changes: they stay out of the activity log.
    expect(((await user.query(internal.ops.listEvents, {})) as any).events).toEqual([]);
    // Once the project is gone, a retry of its creation does not make it again.
    await user.mutation(internal.ops.deleteProject, { projectId: "Garden" });
    expect(await failure(user.mutation(internal.ops.addProject, { name: "Garden", clientId: "p-1" }))).toMatchObject({ code: "not_found" });
  });
});

describe("tasks in projects", () => {
  test("add_task and update_task take a project by id or name; none or null takes it out", async () => {
    const user = asUser(newUserId());
    const { project }: any = await user.mutation(internal.ops.addProject, { name: "Strona piekarni" });
    const byName: any = await user.mutation(internal.ops.add, { title: "Menu", projectId: "strona PIEKARNI" });
    const byId: any = await user.mutation(internal.ops.add, { title: "Photos", projectId: project.id });
    const loose: any = await user.mutation(internal.ops.add, { title: "Loose", projectId: "none" });
    expect([byName.projectId, byId.projectId]).toEqual([project.id, project.id]);
    expect(loose).not.toHaveProperty("projectId");

    expect(await failure(user.mutation(internal.ops.add, { title: "x", projectId: "Ogród" }))).toEqual({ code: "not_found", message: 'Project "Ogród" not found' });
    const moved: any = await user.mutation(internal.ops.update, { taskId: loose.id, projectId: "Strona piekarni" });
    expect(moved.projectId).toBe(project.id);
    const out: any = await user.mutation(internal.ops.update, { taskId: byName.id, projectId: null });
    expect(out).not.toHaveProperty("projectId");
    const none: any = await user.mutation(internal.ops.update, { taskId: byId.id, projectId: "none" });
    expect(none).not.toHaveProperty("projectId");
  });

  test("history keeps the project before and after a move", async () => {
    const userId = newUserId();
    const user = asUser(userId);
    const a: any = (await user.mutation(internal.ops.addProject, { name: "A" })).project;
    const b: any = (await user.mutation(internal.ops.addProject, { name: "B" })).project;
    const task: any = await user.mutation(internal.ops.add, { title: "T", projectId: "A" });
    await user.mutation(internal.ops.update, { taskId: task.id, projectId: "B" });
    await user.mutation(internal.ops.update, { taskId: task.id, projectId: null });
    const history = await historyOf(userId, task.id);
    expect(history.map((h: any) => [h.action, h.before?.projectId ?? null, h.after?.projectId ?? null])).toEqual([
      ["create", null, a.id],
      ["update", a.id, b.id],
      ["update", b.id, null],
    ]);
  });

  test("an archived project takes no new task, but its tasks stay and keep it", async () => {
    const user = asUser(newUserId());
    await user.mutation(internal.ops.addProject, { name: "Web" });
    const kept: any = await user.mutation(internal.ops.add, { title: "Kept", projectId: "Web" });
    const other: any = await user.mutation(internal.ops.add, { title: "Other" });
    await user.mutation(internal.ops.updateProject, { projectId: "Web", archived: true });
    const archived = { code: "invalid_argument", message: 'Project "Web" is archived; restore it first' };
    expect(await failure(user.mutation(internal.ops.add, { title: "New", projectId: "web" }))).toEqual(archived);
    expect(await failure(user.mutation(internal.ops.update, { taskId: other.id, projectId: "Web" }))).toEqual(archived);
    // The task already there can be changed, and naming its own project again is no move.
    expect(await user.mutation(internal.ops.update, { taskId: kept.id, title: "Kept, renamed", projectId: "Web" })).toMatchObject({ projectId: kept.projectId });
    const found: any = await user.query(internal.ops.findTasks, {});
    expect(titles(found.result)).toEqual(["Kept, renamed", "Other"]);
  });

  test("the app layer adds, lists, updates and deletes projects; app add and update take projectId", async () => {
    const { client } = await appClient();
    const added: any = await client.mutation(api.app.addProject, { name: "Health", color: "teal" });
    await client.mutation(api.app.addProject, { name: "Old" });
    await client.mutation(api.app.updateProject, { projectId: "Old", archived: true });
    const task: any = await client.mutation(api.app.add, { title: "Run", projectId: added.project.id });
    expect(task.projectId).toBe(added.project.id);
    // An old app's update sends only what changed and leaves the project alone.
    expect(await client.mutation(api.app.update, { taskId: task.id, title: "Run 5k" })).toMatchObject({ projectId: added.project.id });
    const listed: any[] = await client.query(api.app.listProjects, {});
    expect(listed.map((p) => [p.name, p.archived])).toEqual([
      ["Health", false],
      ["Old", true],
    ]);
    expect(listed[0]).not.toHaveProperty("counts");
    const deleted: any = await client.mutation(api.app.deleteProject, { projectId: "Health", moveTasksTo: "none" });
    expect(deleted).toMatchObject({ project: { name: "Health" }, moved: [{ id: task.id, ref: task.ref }] });
    expect((await client.query(api.app.listAll, {}))[0]).not.toHaveProperty("projectId");
  });
});

describe("list_projects counts", () => {
  test("open, overdue, due today and done per project, and open and overdue without a project", async () => {
    const user = asUser(newUserId());
    await user.mutation(internal.ops.updateSettings, { timezone: "Europe/Warsaw" });
    await user.mutation(internal.ops.addProject, { name: "Dom" });
    await user.mutation(internal.ops.addProject, { name: "Empty" });
    const at = utc("2026-10-25T10:00");
    await user.mutation(internal.ops.add, { title: "late", dueDate: "2026-10-20", projectId: "Dom" });
    await user.mutation(internal.ops.add, { title: "today", dueDate: "2026-10-25", projectId: "Dom" });
    await user.mutation(internal.ops.add, { title: "someday", projectId: "Dom" });
    const done: any = await user.mutation(internal.ops.add, { title: "done", dueDate: "2026-10-20", projectId: "Dom" });
    await user.mutation(internal.ops.complete, { taskId: done.id });
    const archived: any = await user.mutation(internal.ops.add, { title: "archived", projectId: "Dom" });
    await user.mutation(internal.ops.archive, { taskId: archived.id });
    const trashed: any = await user.mutation(internal.ops.add, { title: "trashed", projectId: "Dom" });
    await user.mutation(internal.ops.softDelete, { taskId: trashed.id });
    await user.mutation(internal.ops.add, { title: "proposal", projectId: "Dom", proposal: true });
    await user.mutation(internal.ops.add, { title: "loose late", dueDate: "2026-10-01" });
    await user.mutation(internal.ops.add, { title: "loose" });

    const listed: any = await user.query(internal.ops.listProjects, { at });
    expect(listed.result.map((p: any) => [p.name, p.counts])).toEqual([
      ["Dom", { open: 3, overdue: 1, dueToday: 1, done: 1 }],
      ["Empty", { open: 0, overdue: 0, dueToday: 0, done: 0 }],
    ]);
    expect(listed.noProject).toEqual({ open: 2, overdue: 1 });
  });
});

describe("a project from a label", () => {
  async function labelled() {
    const userId = newUserId();
    const user = asUser(userId);
    await user.mutation(internal.ops.addProject, { name: "Work" });
    const open: any = await user.mutation(internal.ops.add, { title: "open", labels: ["dom", "phone"] });
    const inWork: any = await user.mutation(internal.ops.add, { title: "in work", labels: ["dom"], projectId: "Work" });
    const done: any = await user.mutation(internal.ops.add, { title: "done", labels: ["dom"] });
    await user.mutation(internal.ops.complete, { taskId: done.id });
    const unlabelled: any = await user.mutation(internal.ops.add, { title: "unlabelled" });
    return { userId, user, open, inWork, done, unlabelled };
  }

  test("tasks with the label and no project move in; those in a project are skipped and listed", async () => {
    const { userId, user, open, inWork, done } = await labelled();
    const work: any = ((await user.query(internal.ops.listProjects, {})) as any).result[0];
    const made: any = await user.mutation(internal.ops.addProject, { name: "Dom", fromLabel: "dom" });
    expect(made.moved).toEqual([
      { id: open.id, ref: open.ref },
      { id: done.id, ref: done.ref },
    ]);
    expect(made.skipped).toEqual([{ id: inWork.id, ref: inWork.ref, projectId: work.id, reason: "already in a project" }]);
    const found: any = await user.query(internal.ops.findTasks, { projectId: "Dom" });
    expect(titles(found.result)).toEqual(["done", "open"]);
    // The label stays unless removeLabel says otherwise.
    expect(found.result.every((t: any) => t.labels.includes("dom"))).toBe(true);
    const history = await historyOf(userId, open.id);
    expect(history.at(-1)).toMatchObject({ action: "update", before: { projectId: null }, after: { projectId: made.project.id } });
  });

  test("removeLabel takes the label off the tasks that moved, only those", async () => {
    const { user, open, inWork } = await labelled();
    await user.mutation(internal.ops.addProject, { name: "Dom", fromLabel: "dom", removeLabel: true });
    const all: any[] = await user.query(internal.ops.listAll, {});
    expect(all.find((t) => t.id === open.id).labels).toEqual(["phone"]);
    expect(all.find((t) => t.id === inWork.id).labels).toEqual(["dom"]);
    expect((await failure(user.mutation(internal.ops.addProject, { name: "X", removeLabel: true }))).code).toBe("invalid_argument");
  });

  test("a dry run shows the outcome and stores nothing, history included", async () => {
    const { userId, user, open } = await labelled();
    const before: any = await user.query(internal.ops.exportPlan, { format: "json" });
    const preview = await failure(user.mutation(internal.ops.addProject, { name: "Dom", fromLabel: "dom", dryRun: true }));
    expect(preview.code).toBe("dry_run");
    expect(preview.result).toMatchObject({ project: { name: "Dom" }, moved: [{ id: open.id }, {}], skipped: [{}] });
    const after: any = await user.query(internal.ops.exportPlan, { format: "json" });
    expect(after.content.projects.map((p: any) => p.name)).toEqual(["Work"]);
    expect(after.content.events).toHaveLength(before.content.events.length);
    expect(after.content.tasks).toEqual(before.content.tasks);
    expect(await historyOf(userId, open.id)).toHaveLength(1);
  });

  test("a retry with the same clientId moves nothing twice and answers with the moved tasks", async () => {
    const { user, open, done } = await labelled();
    const first: any = await user.mutation(internal.ops.addProject, { name: "Dom", fromLabel: "dom", clientId: "from-label-1" });
    const again: any = await user.mutation(internal.ops.addProject, { name: "Dom", fromLabel: "dom", clientId: "from-label-1" });
    expect(again.project.id).toBe(first.project.id);
    expect(again.moved.map((t: any) => t.id).sort()).toEqual([open.id, done.id].sort());
  });

  test("a task another agent holds a claim on is skipped with the reason", async () => {
    const { client, userId } = await appClient();
    const keyA = await createKey(userId, "agent-a", "agent");
    await createKey(userId, "agent-b", "agent");
    const keys: any[] = await admin().query(internal.apiKeys.list, { userId, actor: "app" });
    const idB = keys.find((k) => k.name === "agent-b").id;
    const task: any = await client.mutation(api.app.add, { title: "claimed", labels: ["dom"] });
    await callTool(await mcpClient(keyA), "claim_task", { taskId: task.id });
    const made: any = await admin().mutation(internal.ops.addProject, { userId, actor: "agent", keyId: idB, actorName: "agent-b", name: "Dom", fromLabel: "dom" });
    expect(made.moved).toEqual([]);
    expect(made.skipped).toEqual([{ id: task.id, ref: task.ref, reason: expect.stringMatching(/agent-a/) }]);
  });
});

describe("deleting a project", () => {
  async function withTasks() {
    const userId = newUserId();
    const user = asUser(userId);
    await user.mutation(internal.ops.addProject, { name: "Dom" });
    const open: any = await user.mutation(internal.ops.add, { title: "open", projectId: "Dom" });
    const done: any = await user.mutation(internal.ops.add, { title: "done", projectId: "Dom" });
    await user.mutation(internal.ops.complete, { taskId: done.id });
    const trashed: any = await user.mutation(internal.ops.add, { title: "trashed", projectId: "Dom" });
    await user.mutation(internal.ops.softDelete, { taskId: trashed.id });
    return { userId, user, tasks: [open, done, trashed] };
  }

  test("without moveTasksTo it is refused while any task points at the project, the trash included", async () => {
    const { user } = await withTasks();
    expect(await failure(user.mutation(internal.ops.deleteProject, { projectId: "Dom" }))).toEqual({
      code: "precondition_failed",
      message: 'Project "Dom" has 3 tasks (1 in the trash): pass moveTasksTo, a project or "none"',
    });
    expect((await failure(user.mutation(internal.ops.deleteProject, { projectId: "Dom", moveTasksTo: "dom" }))).code).toBe("invalid_argument");
    expect(await failure(user.mutation(internal.ops.deleteProject, { projectId: "Ogród" }))).toEqual({ code: "not_found", message: 'Project "Ogród" not found' });
    // An empty project goes without moveTasksTo.
    await user.mutation(internal.ops.addProject, { name: "Empty" });
    expect(await user.mutation(internal.ops.deleteProject, { projectId: "Empty" })).toMatchObject({ project: { name: "Empty" }, moved: [] });
  });

  test("with moveTasksTo every task moves, each with a history entry and a task.updated webhook", async () => {
    const { userId, user, tasks } = await withTasks();
    const key = await createKey(userId, "hooks", "cli");
    const hookId = randomUUID();
    expect((await rest(key, "POST", "/webhooks", { body: { url: `${helm().webhookOrigin}/hook/${hookId}/ok`, events: ["task.updated"] } })).status).toBe(201);
    const dom: any = ((await user.query(internal.ops.listProjects, {})) as any).result[0];

    const deleted: any = await user.mutation(internal.ops.deleteProject, { projectId: "Dom", moveTasksTo: "none", clientId: "del-1" });
    expect(deleted.project).toMatchObject({ id: dom.id, name: "Dom" });
    expect(deleted.moved.map((t: any) => t.id)).toEqual(tasks.map((t) => t.id));
    expect(((await user.query(internal.ops.listProjects, { includeArchived: true })) as any).result).toEqual([]);
    for (const task of tasks) {
      const history = await historyOf(userId, task.id);
      expect(history.at(-1)).toMatchObject({ action: "update", before: { projectId: dom.id }, after: { projectId: null } });
    }
    // The task in the trash comes back without a project.
    expect(await user.mutation(internal.ops.restore, { taskId: tasks[2].id })).not.toHaveProperty("projectId");
    // A retry answers the same and changes nothing.
    expect(await user.mutation(internal.ops.deleteProject, { projectId: "Dom", moveTasksTo: "none", clientId: "del-1" })).toEqual(deleted);

    const end = Date.now() + 15_000;
    let bodies: any[] = [];
    while (Date.now() < end) {
      const received: { body: string }[] = await (await fetch(`${helm().webhookOrigin}/received/${hookId}`)).json();
      bodies = received.map((m) => JSON.parse(m.body)).filter((b) => b.type === "task.updated" && b.previous?.projectId === dom.id);
      if (bodies.length >= 3) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    expect(bodies.map((b) => b.data.task.id).sort()).toEqual(tasks.map((t) => t.id).sort());
  });

  test("moveTasksTo another project moves them there; only the owner deletes", async () => {
    const { user, tasks } = await withTasks();
    const home: any = (await user.mutation(internal.ops.addProject, { name: "Home" })).project;
    await user.mutation(internal.ops.deleteProject, { projectId: "Dom", moveTasksTo: "home" });
    const found: any = await user.query(internal.ops.findTasks, { projectId: "Home" });
    expect(found.result.map((t: any) => t.id).sort()).toEqual([tasks[0].id, tasks[1].id].sort());
    expect(found.result.every((t: any) => t.projectId === home.id)).toBe(true);

    const agentUser = newUserId();
    await asUser(agentUser).mutation(internal.ops.addProject, { name: "Mine" });
    expect(await failure(asUser(agentUser, "agent").mutation(internal.ops.deleteProject, { projectId: "Mine" }))).toMatchObject({ code: "forbidden" });
  });
});

describe("filters by project", () => {
  test('list_all, Today and the board take a project or "none"', async () => {
    const user = asUser(newUserId());
    await user.mutation(internal.ops.addProject, { name: "Dom" });
    const at = utc("2026-10-25T10:00");
    await user.mutation(internal.ops.add, { title: "dom today", dueDate: "2026-10-25", projectId: "Dom" });
    const now: any = await user.mutation(internal.ops.add, { title: "dom now", projectId: "Dom" });
    await user.mutation(internal.ops.setNow, { taskId: now.id });
    await user.mutation(internal.ops.add, { title: "loose today", dueDate: "2026-10-25" });
    await user.mutation(internal.ops.add, { title: "loose someday" });

    const find = async (projectId?: string) => titles(((await user.query(internal.ops.findTasks, projectId === undefined ? {} : { projectId })) as any).result);
    expect(await find("none")).toEqual(["loose someday", "loose today"]);
    expect(await find("DOM")).toEqual(["dom now", "dom today"]);
    expect(await find()).toHaveLength(4);

    const today: any = await user.query(internal.ops.listToday, { at, projectId: "none" });
    expect(titles(today.today)).toEqual(["loose today"]);
    expect(today.now).toBeNull();
    const domToday: any = await user.query(internal.ops.listToday, { at, projectId: "Dom" });
    expect(titles(domToday.today)).toEqual(["dom today"]);
    expect(domToday.now.title).toBe("dom now");

    const board: any = await user.query(internal.ops.board, { projectId: "Dom" });
    expect([titles(board.todo), titles(board.doing)]).toEqual([["dom today"], ["dom now"]]);
    expect(await failure(user.query(internal.ops.board, { projectId: "Ogród" }))).toEqual({ code: "not_found", message: 'Project "Ogród" not found' });
  });

  test("the REST list of tasks takes ?projectId= and tasks carry projectId", async () => {
    const userId = newUserId();
    const key = await createKey(userId, "cli", "cli");
    await asUser(userId).mutation(internal.ops.addProject, { name: "Dom" });
    const created = await rest(key, "POST", "/tasks", { body: { title: "in Dom", projectId: "dom" } });
    expect(created.status).toBe(201);
    await rest(key, "POST", "/tasks", { body: { title: "loose" } });
    const listed = await rest(key, "GET", `/tasks?projectId=none`);
    expect(listed.body.result.map((t: any) => t.title)).toEqual(["loose"]);
    expect((await rest(key, "GET", `/tasks?projectId=Dom`)).body.result.map((t: any) => t.projectId)).toEqual([created.body.projectId]);
  });
});

describe("rolling back: projectsToLabels", () => {
  // Runs over every user of the test deployment, so it comes last in this file.
  test("every task in a project gets the project's name as a label and loses projectId; the projects go", async () => {
    const userId = newUserId();
    const user = asUser(userId);
    for (const name of ["Dom", "Full", "Empty"]) await user.mutation(internal.ops.addProject, { name });
    const plain: any = await user.mutation(internal.ops.add, { title: "plain", labels: ["x"], projectId: "Dom" });
    const labelled: any = await user.mutation(internal.ops.add, { title: "labelled", labels: ["Dom"], projectId: "Dom" });
    const full: any = await user.mutation(internal.ops.add, { title: "full", labels: Array.from({ length: 20 }, (_, i) => `l${i}`), projectId: "Full" });
    const trashed: any = await user.mutation(internal.ops.add, { title: "trashed", projectId: "Dom" });
    await user.mutation(internal.ops.softDelete, { taskId: trashed.id });
    const loose: any = await user.mutation(internal.ops.add, { title: "loose", labels: ["y"] });

    await admin().mutation(internal.migrations.projectsToLabels, {});
    await expect.poll(() => admin().query(internal.migrations.status, {}), { timeout: 30_000 }).toMatchObject({ tasksWithProject: 0, projects: 0 });
    const { content }: any = await user.query(internal.ops.exportPlan, { format: "json" });
    const labelsOf = (task: { id: string }) => content.tasks.find((t: any) => t.id === task.id).labels;
    expect([plain, labelled, trashed, loose].map(labelsOf)).toEqual([["x", "Dom"], ["Dom"], ["Dom"], ["y"]]);
    // No room for a 21st label: the task keeps its 20 and loses only the project.
    expect(labelsOf(full)).toHaveLength(20);
    expect(content.tasks.every((t: any) => t.projectId === undefined)).toBe(true);
    expect(content.projects).toEqual([]);
    // Running it again changes nothing.
    expect(await admin().mutation(internal.migrations.projectsToLabels, { projects: true })).toMatchObject({ projectsDeleted: 0, done: true });
  }, 60_000);

  test("the documented rollback completion check terminates with more than 200 tasks", async () => {
    const user = asUser(newUserId());
    await user.mutation(internal.ops.addProject, { name: "Rollback" });
    const items = Array.from({ length: 201 }, (_, i) => ({ key: `rollback-${i}`, title: `Task ${i}`, project: "Rollback", labels: ["keep"] }));
    for (let offset = 0; offset < items.length; offset += 200) {
      const imported: any = await user.mutation(internal.ops.importTasks, { items: items.slice(offset, offset + 200) });
      expect(imported.failed).toEqual([]);
      expect(imported.created).toHaveLength(Math.min(200, items.length - offset));
    }
    const before: any = await user.query(internal.ops.exportPlan, { format: "json" });
    expect(await admin().mutation(internal.migrations.projectsToLabels, {})).toMatchObject({ done: false });
    await expect.poll(() => admin().query(internal.migrations.status, {}), { timeout: 30_000 }).toMatchObject({ tasksWithProject: 0, projects: 0 });
    // A completed full scan still starts with done:false; after the status check,
    // repeating only the deletion phase gives the documented no-op confirmation.
    expect(await admin().mutation(internal.migrations.projectsToLabels, { projects: true })).toEqual({ relabeled: 0, cleared: 0, noRoom: [], projectsDeleted: 0, done: true });
    expect(await admin().query(internal.migrations.status, {})).toMatchObject({ tasksWithProject: 0, projects: 0 });
    const { content }: any = await user.query(internal.ops.exportPlan, { format: "json" });
    expect(content.tasks).toHaveLength(201);
    expect(content.tasks.every((task: any) => task.projectId === undefined)).toBe(true);
    expect(content.tasks.map((task: any) => task.labels)).toEqual(items.map(() => ["keep", "Rollback"]));
    expect(content.projects).toEqual([]);
    expect(content.events).toEqual(before.content.events);
  }, 60_000);
});
