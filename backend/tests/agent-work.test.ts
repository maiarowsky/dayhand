// Agent work (docs/agent-work.md): the activity log, acceptance criteria and
// proof, dependencies and readiness, and time-boxed claims, through the
// official MCP SDK client, the REST API and the app layer.
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { admin, appClient, callTool, createKey, importRows, mcpClient, newUserId, rest } from "./helpers";

type Client = Awaited<ReturnType<typeof mcpClient>>;

const textOf = (contents: object[]) => (contents[0] as { text: string }).text;

/** The tool error of a failed call: its code and message. */
async function toolError(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, `${name} should fail`).toBe(true);
  return (result.structuredContent as { error: { code: string; message: string } }).error;
}

/** Two agents of one user, each with its own key, and the app of that user. */
async function team() {
  const { client: app, userId } = await appClient();
  const first = await mcpClient(await createKey(userId, "first", "agent"));
  const second = await mcpClient(await createKey(userId, "second", "agent"));
  return { app, userId, first, second };
}

describe("the activity log (list_events)", () => {
  test("an agent back from a pause gets only the changes after its cursor, oldest first", async () => {
    const userId = newUserId();
    const agent = await mcpClient(await createKey(userId, "planner", "agent"));
    await callTool(agent, "add_task", { title: "Draft the offer" });
    const before = await callTool(agent, "list_events");
    expect(before.events.map((e: any) => e.action)).toEqual(["create"]);
    expect(before.nextCursor).toMatch(/^c\d+$/);
    expect(before.hasMore).toBe(false);

    // Meanwhile: the user in the app and another agent change the plan.
    const other = await mcpClient(await createKey(userId, "helper", "agent"));
    await callTool(other, "add_task", { title: "Send the invoice" });
    await callTool(other, "update_task", { taskId: "#1", note: "two pages" });
    await callTool(other, "complete_task", { taskId: "#2" });

    const after = await callTool(agent, "list_events", { since: before.nextCursor });
    expect(after.events.map((e: any) => [e.action, e.ref, e.by])).toEqual([
      ["create", 2, "agent: helper"],
      ["update", 1, "agent: helper"],
      ["complete", 2, "agent: helper"],
    ]);
    expect(after.events[1]).toMatchObject({ title: "Draft the offer", before: { note: null }, after: { note: "two pages" }, actor: "agent", actorName: "helper" });
    expect(after.hasMore).toBe(false);
    const nothing = await callTool(agent, "list_events", { since: after.nextCursor });
    expect(nothing).toEqual({ events: [], nextCursor: after.nextCursor, hasMore: false });
    await Promise.all([agent.close(), other.close()]);
  });

  test("pages with hasMore, and narrows by actor and by task", async () => {
    const userId = newUserId();
    const agent = await mcpClient(await createKey(userId, "planner", "agent"));
    const cli = await mcpClient(await createKey(userId, "laptop", "cli"));
    for (const title of ["one", "two", "three"]) await callTool(agent, "add_task", { title });
    await callTool(cli, "update_task", { taskId: "#2", title: "two!" });

    const first = await callTool(agent, "list_events", { since: "0", limit: 2 });
    expect(first.events.map((e: any) => e.title)).toEqual(["one", "two!"]);
    expect(first.hasMore).toBe(true);
    const rest2 = await callTool(agent, "list_events", { since: first.nextCursor, limit: 2 });
    expect(rest2.events.map((e: any) => [e.action, e.ref])).toEqual([["create", 3], ["update", 2]]);
    expect(rest2.hasMore).toBe(false);

    const byCli = await callTool(agent, "list_events", { since: "0", by: "cli" });
    expect(byCli.events.map((e: any) => e.by)).toEqual(["cli"]);
    const byName = await callTool(agent, "list_events", { since: "0", by: "agent: planner" });
    expect(byName.events).toHaveLength(3);
    const ofTask = await callTool(agent, "list_events", { since: "0", taskId: "#2" });
    expect(ofTask.events.map((e: any) => e.action)).toEqual(["create", "update"]);
    const latest = await callTool(agent, "list_events", { limit: 1 });
    expect(latest.events.map((e: any) => e.action)).toEqual(["update"]);
    expect(latest.nextCursor).toBe(rest2.nextCursor);

    const future = await callTool(agent, "list_events", { since: new Date(Date.now() + 60_000).toISOString() });
    expect(future.events).toEqual([]);
    expect(await toolError(agent, "list_events", { since: "yesterday" })).toMatchObject({ code: "invalid_argument" });
    expect(await toolError(agent, "list_events", { by: "robot" })).toMatchObject({ code: "invalid_argument" });
    await Promise.all([agent.close(), cli.close()]);
  });

  test("leaves out changes that are not about a task, and other users' changes", async () => {
    const userId = newUserId();
    const agent = await mcpClient(await createKey(userId, "planner", "agent"));
    await callTool(agent, "update_settings", { timezone: "Europe/Warsaw" });
    await createKey(userId, "another key");
    const stranger = await mcpClient(await createKey(newUserId(), "stranger", "agent"));
    await callTool(stranger, "add_task", { title: "Not yours" });
    expect((await callTool(agent, "list_events", { since: "0" })).events).toEqual([]);
    await Promise.all([agent.close(), stranger.close()]);
  });

  test("dayhand://activity is the newest changes; ?since= continues from a cursor", async () => {
    const agent = await mcpClient(await createKey(newUserId(), "planner", "agent"));
    await callTool(agent, "add_task", { title: "Book the venue" });
    const newest = JSON.parse(textOf((await agent.readResource({ uri: "dayhand://activity" })).contents));
    expect(newest).toEqual(await callTool(agent, "list_events"));
    await callTool(agent, "add_task", { title: "Order the cake" });
    const since = await agent.readResource({ uri: `dayhand://activity?since=${newest.nextCursor}` });
    expect(JSON.parse(textOf(since.contents)).events.map((e: any) => e.title)).toEqual(["Order the cake"]);
    await agent.close();
  });

  test("history from before 0.10.0 joins the log once migrations:backfillEventSeqs has run", async () => {
    const userId = newUserId();
    const agent = await mcpClient(await createKey(userId, "planner", "agent"));
    const task = await callTool(agent, "add_task", { title: "Old one" });
    await importRows("taskEvents", [
      { userId, taskId: task.id, actor: "app", action: "update", at: 1_000, after: { note: "a" } },
      { userId, taskId: task.id, actor: "app", action: "update", at: 1_000, after: { note: "b" } },
    ]);
    expect((await callTool(agent, "list_events", { since: "0" })).events).toHaveLength(1);
    expect((await admin().query(internal.migrations.status, {})).taskEventsWithoutSeq).toBeGreaterThanOrEqual(2);
    await admin().mutation(internal.migrations.backfillEventSeqs, {});
    await expect.poll(async () => (await admin().query(internal.migrations.status, {})).taskEventsWithoutSeq).toBe(0);
    const log = await callTool(agent, "list_events", { since: "0" });
    expect(log.events.map((e: any) => [e.action, e.after?.note ?? null])).toEqual([["update", "a"], ["update", "b"], ["create", null]]);
    await agent.close();
  });
});

describe("acceptance criteria, plan and proof", () => {
  test("criteria get ids; an agent completes only with every criterion met and a summary", async () => {
    const agent = await mcpClient(await createKey(newUserId(), "builder", "agent"));
    const task = await callTool(agent, "add_task", {
      title: "Ship the export",
      plan: "Write it, then test it",
      acceptance: [{ text: "CSV opens in a spreadsheet" }, { text: "Docs updated", met: true }],
    });
    expect(task.acceptance).toEqual([
      { id: "a1", text: "CSV opens in a spreadsheet", met: false },
      { id: "a2", text: "Docs updated", met: true },
    ]);
    expect(task.plan).toBe("Write it, then test it");

    const unmet = await toolError(agent, "complete_task", { taskId: task.id, proof: { summary: "done" } });
    expect(unmet).toEqual({ code: "precondition_failed", message: expect.stringContaining("a1") });
    await callTool(agent, "update_task", { taskId: task.id, acceptance: [{ id: "a1", text: "CSV opens in a spreadsheet", met: true }, task.acceptance[1]] });
    expect(await toolError(agent, "complete_task", { taskId: task.id })).toMatchObject({ code: "precondition_failed" });
    expect(await toolError(agent, "set_status", { taskId: task.id, status: "done" })).toMatchObject({ code: "precondition_failed" });

    const proof = {
      summary: "  Export shipped  ",
      links: [{ url: "https://example.com/pr/7", title: "PR" }],
      checks: [{ name: "unit tests", result: "pass", url: "https://example.com/ci/1" }, { name: "lint", result: "fail" }],
    };
    const preview = await callTool(agent, "complete_task", { taskId: task.id, proof, dryRun: true });
    expect(preview.dryRun).toBe(true);
    const { task: done } = await callTool(agent, "complete_task", { taskId: task.id, proof });
    expect(done.status).toBe("done");
    expect(done.proof).toEqual({ summary: "Export shipped", links: [{ url: "https://example.com/pr/7", title: "PR" }], checks: proof.checks });
    await agent.close();
  });

  test("people complete as before; a repeating task's next occurrence has its criteria unticked", async () => {
    const { client: app, userId } = await appClient();
    const cli = await mcpClient(await createKey(userId, "laptop", "cli"));
    const first = await app.mutation(api.app.add, { title: "Weekly report", acceptance: [{ text: "Sent", met: false }] });
    const done = await app.mutation(api.app.complete, { taskId: first.id });
    expect(done.task.status).toBe("done");
    const second = await callTool(cli, "add_task", {
      title: "Bins",
      dueDate: "today",
      repeat: { every: "week", interval: 1 },
      plan: "Glass first",
      acceptance: [{ text: "Out by 7", met: true }],
    });
    const { next } = await callTool(cli, "complete_task", { taskId: second.id });
    expect(next).toMatchObject({ plan: "Glass first", acceptance: [{ id: "a1", text: "Out by 7", met: false }] });
    expect(next.proof).toBeUndefined();
    await cli.close();
  });

  test("bad criteria and proof are invalid arguments", async () => {
    const agent = await mcpClient(await createKey(newUserId(), "builder", "agent"));
    expect(await toolError(agent, "add_task", { title: "x", acceptance: [{ text: " " }] })).toMatchObject({ code: "invalid_argument" });
    expect(await toolError(agent, "add_task", { title: "x", acceptance: [{ id: "k", text: "a" }, { id: "k", text: "b" }] })).toMatchObject({ code: "invalid_argument" });
    const task = await callTool(agent, "add_task", { title: "x" });
    const badUrl = { summary: "s", checks: [{ name: "ci", result: "pass", url: "ftp://x" }] };
    expect(await toolError(agent, "complete_task", { taskId: task.id, proof: badUrl })).toMatchObject({ code: "invalid_argument" });
    expect(await toolError(agent, "complete_task", { taskId: task.id, proof: { checks: [{ name: "ci", result: "maybe" }] } })).toMatchObject({
      code: "invalid_argument",
    });
    await agent.close();
  });
});

describe("dependencies, blocked reason and ready", () => {
  test("ready: not done, not blocked, and every dependency done", async () => {
    const agent = await mcpClient(await createKey(newUserId(), "planner", "agent"));
    const design = await callTool(agent, "add_task", { title: "Design" });
    const build = await callTool(agent, "add_task", { title: "Build", dependsOn: ["#1"] });
    const ship = await callTool(agent, "add_task", { title: "Ship", dependsOn: [build.id, "#1", "#2"] });
    const wait = await callTool(agent, "add_task", { title: "Wait for the client", blockedReason: "no brief yet" });
    expect(build.dependsOn).toEqual([design.id]);
    expect(ship.dependsOn).toEqual([build.id, design.id]);
    expect(wait.blockedReason).toBe("no brief yet");

    const ready = async () => (await callTool(agent, "list_all", { ready: true, limit: 50 })).result.map((t: any) => t.title);
    expect(await ready()).toEqual(["Design"]);
    expect((await callTool(agent, "list_all", { ready: false, limit: 50 })).result.map((t: any) => t.title).sort()).toEqual(["Build", "Ship", "Wait for the client"]);
    await callTool(agent, "complete_task", { taskId: "#1" });
    expect(await ready()).toEqual(["Build"]);
    await callTool(agent, "update_task", { taskId: "#4", blockedReason: null });
    await callTool(agent, "delete_task", { taskId: "#2" });
    expect((await ready()).sort()).toEqual(["Ship", "Wait for the client"]);
    await callTool(agent, "update_task", { taskId: "#3", dependsOn: [] });
    expect((await callTool(agent, "get_task", { taskId: "#3" })).task.dependsOn).toBeUndefined();
    await agent.close();
  });

  test("no task waits for itself, directly or through others", async () => {
    const agent = await mcpClient(await createKey(newUserId(), "planner", "agent"));
    await callTool(agent, "add_task", { title: "A" });
    await callTool(agent, "add_task", { title: "B", dependsOn: ["#1"] });
    await callTool(agent, "add_task", { title: "C", dependsOn: ["#2"] });
    expect(await toolError(agent, "update_task", { taskId: "#1", dependsOn: ["#1"] })).toMatchObject({ code: "invalid_argument", message: expect.stringContaining("itself") });
    expect(await toolError(agent, "update_task", { taskId: "#1", dependsOn: ["#3"] })).toMatchObject({ code: "invalid_argument", message: expect.stringContaining("cycle") });
    expect(await toolError(agent, "add_task", { title: "D", dependsOn: ["#404"] })).toMatchObject({ code: "not_found" });
    await agent.close();
  });
});

describe("time-boxed claims", () => {
  test("two agent keys cannot claim the same task; the holder renews and releases with a checkpoint", async () => {
    const { first, second } = await team();
    const task = await callTool(first, "add_task", { title: "Migrate the database" });
    const claimed = await callTool(first, "claim_task", { taskId: task.id });
    expect(claimed.claimedBy).toEqual({ keyId: expect.any(String), name: "first" });
    expect(claimed.claimExpiresAt - Date.now()).toBeGreaterThan(119 * 60_000);
    expect(claimed.claimExpiresAt - Date.now()).toBeLessThanOrEqual(120 * 60_000);

    const refused = await toolError(second, "claim_task", { taskId: task.id });
    expect(refused).toEqual({ code: "conflict", message: expect.stringMatching(/claimed by first until \d{4}-/) });
    expect(await toolError(second, "update_task", { taskId: task.id, note: "mine now" })).toMatchObject({ code: "conflict" });
    expect(await toolError(second, "complete_task", { taskId: task.id })).toMatchObject({ code: "conflict" });
    expect(await toolError(second, "renew_claim", { taskId: task.id })).toMatchObject({ code: "conflict" });
    expect(await toolError(second, "release_task", { taskId: task.id })).toMatchObject({ code: "conflict" });

    const again = await callTool(first, "claim_task", { taskId: task.id, minutes: 5 });
    expect(again.claimExpiresAt - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    const renewed = await callTool(first, "renew_claim", { taskId: task.id, minutes: 30 });
    expect(renewed.claimExpiresAt).toBeGreaterThan(again.claimExpiresAt);
    await callTool(first, "update_task", { taskId: task.id, note: "schema first" });
    const released = await callTool(first, "release_task", { taskId: task.id, note: "tables done; indexes next" });
    expect(released.claimedBy).toBeUndefined();
    expect(released.claimExpiresAt).toBeUndefined();
    expect(released.resumeNote).toBe("tables done; indexes next");
    expect(await toolError(first, "renew_claim", { taskId: task.id })).toMatchObject({ code: "precondition_failed" });

    expect((await callTool(second, "claim_task", { taskId: task.id })).claimedBy.name).toBe("second");
    const history = (await callTool(second, "get_task", { taskId: task.id })).history.map((h: any) => `${h.action} by ${h.by}`);
    expect(history).toEqual(expect.arrayContaining(["claim by agent: first", "renewClaim by agent: first", "release by agent: first", "claim by agent: second"]));
    await Promise.all([first.close(), second.close()]);
  });

  test("after the claim expires, another agent can claim the task", async () => {
    const { userId, first, second } = await team();
    const keys = (await admin().query(internal.apiKeys.list, { userId, actor: "app" })) as { id: string; name: string }[];
    const firstKey = keys.find((k) => k.name === "first")!.id;
    await importRows("tasks", [
      {
        userId, ref: 1, title: "Left behind", status: "doing", isNow: false, links: [],
        claimedBy: { keyId: firstKey, name: "first" }, claimExpiresAt: Date.now() - 1_000, createdAt: 1, updatedAt: 1,
      },
    ]);
    const taken = await callTool(second, "claim_task", { taskId: "#1", minutes: 10 });
    expect(taken.claimedBy.name).toBe("second");
    expect(await toolError(first, "renew_claim", { taskId: "#1" })).toMatchObject({ code: "conflict" });
    await Promise.all([first.close(), second.close()]);
  });

  test("the owner wins: the app and the user's CLI key change a claimed task, and the app takes it over", async () => {
    const { app, userId, first, second } = await team();
    const cli = await mcpClient(await createKey(userId, "laptop", "cli"));
    const task = await callTool(first, "add_task", { title: "Write the newsletter" });
    await callTool(first, "claim_task", { taskId: task.id });
    expect((await app.mutation(api.app.update, { taskId: task.id, title: "Write the October newsletter" })).title).toBe("Write the October newsletter");
    await callTool(cli, "set_status", { taskId: task.id, status: "doing" });
    expect(await toolError(cli, "claim_task", { taskId: task.id })).toMatchObject({ code: "conflict" });

    const taken = await app.mutation(api.app.release, { taskId: task.id, note: "I'll finish it" });
    expect(taken.claimedBy).toBeUndefined();
    expect(taken.resumeNote).toBe("I'll finish it");
    expect(await toolError(first, "renew_claim", { taskId: task.id })).toMatchObject({ code: "precondition_failed" });
    await callTool(second, "update_task", { taskId: task.id, note: "free again" });
    await Promise.all([first.close(), second.close(), cli.close()]);
  });

  test("a retried release that changed nothing does not end a claim taken since", async () => {
    const { app, first, second } = await team();
    const task = await callTool(first, "add_task", { title: "Review the contract" });
    await callTool(first, "claim_task", { taskId: task.id });
    await callTool(first, "release_task", { taskId: task.id });
    // The phone's queued release arrives after the agent's own: nothing to release, and its answer is lost.
    const release = { taskId: task.id, clientId: "phone-release-1" };
    expect((await app.mutation(api.app.release, release)).claimedBy).toBeUndefined();
    await callTool(second, "claim_task", { taskId: task.id });

    const retried = await app.mutation(api.app.release, release);
    expect(retried.claimedBy?.name).toBe("second");
    const { task: current, history } = await callTool(second, "get_task", { taskId: task.id });
    expect(current.claimedBy.name).toBe("second");
    expect(history.map((h: any) => `${h.action} by ${h.actor}`)).toEqual(["create by agent", "claim by agent", "release by agent", "claim by agent"]);
    await Promise.all([first.close(), second.close()]);
  });

  test("a retried completion that changed nothing does not end a claim taken since the task was reopened", async () => {
    const { app, first, second } = await team();
    const task = await callTool(first, "add_task", { title: "Review the contract" });
    await callTool(first, "complete_task", { taskId: task.id });
    // The phone's queued completion arrives after the agent's own: nothing to complete, and its answer is lost.
    const complete = { taskId: task.id, clientId: "phone-complete-1" };
    expect((await app.mutation(api.app.complete, complete)).task.status).toBe("done");
    await app.mutation(api.app.setStatus, { taskId: task.id, status: "todo" });
    await callTool(second, "claim_task", { taskId: task.id });

    const retried = await app.mutation(api.app.complete, complete);
    expect(retried).toMatchObject({ task: { status: "todo", claimedBy: { name: "second" } }, next: null });
    const { task: current, history } = await callTool(second, "get_task", { taskId: task.id });
    expect(current).toMatchObject({ status: "todo", claimedBy: { name: "second" } });
    expect(history.map((h: any) => `${h.action} by ${h.actor}`)).toEqual(["create by agent", "complete by agent", "setStatus by app", "claim by agent"]);
    await Promise.all([first.close(), second.close()]);
  });

  test("completing ends the claim; done, archived and trashed tasks cannot be claimed", async () => {
    const agent = await mcpClient(await createKey(newUserId(), "builder", "agent"));
    const task = await callTool(agent, "add_task", { title: "Fix the footer" });
    await callTool(agent, "claim_task", { taskId: task.id });
    const { task: done } = await callTool(agent, "complete_task", { taskId: task.id });
    expect(done.claimedBy).toBeUndefined();
    expect(await toolError(agent, "claim_task", { taskId: task.id })).toMatchObject({ code: "invalid_argument" });
    const other = await callTool(agent, "add_task", { title: "Old idea" });
    await callTool(agent, "archive_task", { taskId: other.id });
    expect(await toolError(agent, "claim_task", { taskId: other.id })).toMatchObject({ code: "invalid_argument" });
    expect(await toolError(agent, "claim_task", { taskId: "#99" })).toMatchObject({ code: "not_found" });
    for (const minutes of [0, 1441, 1.5]) {
      expect(await toolError(agent, "claim_task", { taskId: "#1", minutes })).toMatchObject({ code: "invalid_argument" });
    }
    await agent.close();
  });

  test("REST: a claimed task answers 409 conflict to another key", async () => {
    const { userId, first } = await team();
    const restKey = await createKey(userId, "integration", "agent");
    await callTool(first, "add_task", { title: "Reconcile the bank" });
    await callTool(first, "claim_task", { taskId: "#1" });
    const refused = await rest(restKey, "POST", "/tasks/1/claim", { body: { minutes: 15 } });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "conflict", status: 409, title: "Conflict" });
    const events = await rest(restKey, "GET", "/events?since=0");
    expect(events.status).toBe(200);
    expect(events.body.events.map((e: any) => e.action)).toEqual(["create", "claim"]);
    await first.close();
  });
});
