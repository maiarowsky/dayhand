// Labels are gone since 0.14.0 (docs/deploy.md#upgrading-to-0140): older clients
// may still send them with a task and are not refused, a labels filter is refused,
// labels stored before are never shown, and the migrations back them up and remove them.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { cliRunner, exportBackup } from "../scripts/labels-backup.mjs";
import { convexCliEnv } from "../scripts/local-backend-lib.mjs";
import { admin, appClient, asUser, callTool, createKey, helm, importRows, mcpClient, newUserId, rest } from "./helpers";

const dir = mkdtempSync(join(process.env.DAYHAND_TEST_TMPDIR ?? tmpdir(), "helm-labels-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Tasks and history as a deployment from before 0.14.0 stored them, with labels. */
async function legacyPlan(userId: string) {
  const now = Date.now();
  const row = (ref: number, title: string, labels: string[]) => ({ userId, ref, title, status: "todo", isNow: false, labels, links: [], createdAt: now, updatedAt: now });
  await importRows("tasks", [row(1, "Call the plumber", ["home", "phone"]), row(2, "Send the invoice", ["work"]), row(3, "Water the plants", [])]);
  const user = asUser(userId);
  const tasks: any[] = await user.query(internal.ops.listAll, {});
  const byTitle = (title: string) => tasks.find((t) => t.title === title);
  const [plumber, invoice] = [byTitle("Call the plumber"), byTitle("Send the invoice")];
  await importRows("taskEvents", [
    { userId, taskId: plumber.id, actor: "app", action: "create", at: 1_000, seq: 1_000_000, after: { title: "Call the plumber", labels: ["home"] } },
    { userId, taskId: plumber.id, actor: "app", action: "update", at: 2_000, seq: 2_000_000, before: { labels: ["home"] }, after: { labels: ["home", "phone"] } },
    { userId, taskId: invoice.id, actor: "agent", action: "update", at: 3_000, seq: 3_000_000, before: { note: "draft", labels: [] }, after: { note: "final", labels: ["work"] } },
    { userId, actor: "app", action: "projectAdd", at: 4_000, after: { projectId: "p-home", name: "Home", fromLabel: "home", removeLabel: true } },
  ]);
  return { user, plumber, invoice, plants: byTitle("Water the plants") };
}

describe("clients from before 0.14.0", () => {
  test("the app's labels and fromLabel are accepted and ignored, a labels filter is refused", async () => {
    const { client } = await appClient();
    const task: any = await client.mutation(api.app.add, { title: "Call the plumber", labels: ["home"] });
    expect(task).not.toHaveProperty("labels");
    const same: any = await client.mutation(api.app.update, { taskId: task.id, labels: ["home", "phone"] });
    expect(same).toEqual(task);
    const { history }: any = await client.query(api.app.getTask, { taskId: task.id });
    expect(history.map((h: any) => h.action)).toEqual(["create"]);
    expect(history[0].after).not.toHaveProperty("labels");
    const added: any = await client.mutation(api.app.addProject, { name: "Home", fromLabel: "home", removeLabel: true });
    expect(added).toEqual({ project: expect.objectContaining({ name: "Home" }) });
    await expect(client.query(api.app.listAll, { labels: ["work"] })).rejects.toThrow(/labels were removed in 0.14.0/);
    expect((await client.query(api.app.listAll, { labels: [] })).map((t: any) => t.title)).toEqual(["Call the plumber"]);
  });

  test("REST and MCP take labels in a body, refuse them as a filter and never answer with them", async () => {
    const userId = newUserId();
    const key = await createKey(userId, "old agent", "agent");
    const created = await rest(key, "POST", "/tasks", { body: { title: "Send the invoice", labels: ["work"] } });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("labels");
    const patched = await rest(key, "PATCH", `/tasks/${created.body.ref}`, { body: { labels: ["work", "q4"], note: "final" } });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ note: "final" });
    expect(patched.body).not.toHaveProperty("labels");
    const listed = await rest(key, "GET", "/tasks?labels=home");
    expect(listed.status).toBe(422);
    expect(listed.body).toMatchObject({ code: "invalid_argument", detail: "labels were removed in 0.14.0" });
    const project = await rest(key, "POST", "/projects", { body: { name: "Office", fromLabel: "work" } });
    expect(project.status).toBe(201);
    expect(project.body).toEqual({ project: expect.objectContaining({ name: "Office" }) });

    const agent = await mcpClient(key);
    const added = await callTool(agent, "add_task", { title: "Book the venue", labels: ["party"] });
    expect(added).not.toHaveProperty("labels");
    const updated = await callTool(agent, "update_task", { taskId: added.id, labels: ["party"], title: "Book a venue" });
    expect(updated).toMatchObject({ title: "Book a venue" });
    expect(updated).not.toHaveProperty("labels");
    const found = await agent.callTool({ name: "list_all", arguments: { labels: ["party"] } });
    expect(found.structuredContent).toMatchObject({ error: { code: "invalid_argument", message: "labels were removed in 0.14.0" } });
    await agent.close();
  });

  test("labels stored before 0.14.0 show neither on tasks nor in history", async () => {
    const userId = newUserId();
    const { user, plumber, invoice } = await legacyPlan(userId);
    expect(plumber).not.toHaveProperty("labels");
    const detail: any = await user.query(internal.ops.getTask, { taskId: invoice.id });
    expect(detail.task).not.toHaveProperty("labels");
    expect(detail.history.map((h: any) => [h.before, h.after])).toEqual([[{ note: "draft" }, { note: "final" }]]);
    const { content }: any = await user.query(internal.ops.exportPlan, { format: "json" });
    expect(JSON.stringify(content)).not.toMatch(/labels|fromLabel|removeLabel/);
    expect(content.events.find((e: any) => e.action === "projectAdd").after).toEqual({ projectId: "p-home", name: "Home" });
    const key = await createKey(userId, "reader", "agent");
    const events = await rest(key, "GET", "/events?since=0");
    expect(JSON.stringify(events.body)).not.toMatch(/labels|fromLabel|removeLabel/);
  });
});

describe("the migrations of 0.14.0", () => {
  // They run over every user of the test deployment, so they come last in this file.
  test("back up and drop the labels", async () => {
    const userId = newUserId();
    const { user, plumber, invoice, plants } = await legacyPlan(userId);
    const raw = async () => {
      const { content }: any = await admin().query(internal.ops.exportPlan, { userId, actor: "app", format: "json" });
      return content;
    };
    const env = convexCliEnv({ url: helm().url, adminKey: helm().adminKey, home: join(dir, "home") });
    const run = cliRunner([], env);
    const status = () => admin().query(internal.migrations.status, {});

    // 1. The backup, through the Convex CLI as the runbook runs it.
    const file = join(dir, "labels.json");
    await exportBackup(file, run);
    const backup = JSON.parse(readFileSync(file, "utf8"));
    expect(backup.kind).toBe("dayhand-labels-backup");
    const mine = backup.items.filter((item: any) => item.userId === userId);
    expect(mine.map((item: any) => [item.ref, item.labels]).sort()).toEqual([[1, ["home", "phone"]], [2, ["work"]]]);
    // An existing backup is never overwritten.
    await expect(exportBackup(file, run)).rejects.toThrow(/EEXIST/);

    // 2. Drop: tasks lose the field, history loses labels (and a project's entry fromLabel and
    // removeLabel); an entry with only a label change goes.
    expect((await status()).tasksWithLabels).toBeGreaterThan(0);
    await admin().mutation(internal.migrations.dropLabels, {});
    await expect.poll(status, { timeout: 30_000 }).toMatchObject({ tasksWithLabels: 0, taskEventsWithLabels: 0 });
    const plumberHistory: any = await user.query(internal.ops.getTask, { taskId: plumber.id });
    expect(plumberHistory.history.map((h: any) => [h.action, h.after])).toEqual([["create", { title: "Call the plumber" }]]);
    const invoiceHistory: any = await user.query(internal.ops.getTask, { taskId: invoice.id });
    expect(invoiceHistory.history.map((h: any) => [h.before, h.after])).toEqual([[{ note: "draft" }, { note: "final" }]]);
    expect((await raw()).tasks.map((t: any) => t.updatedAt)).toEqual([plumber.updatedAt, invoice.updatedAt, plants.updatedAt]);
    // Running it again changes nothing.
    expect(await admin().mutation(internal.migrations.dropLabels, { events: true, cursor: null })).toMatchObject({ eventsCleared: 0, eventsDeleted: 0 });
  }, 120_000);
});
