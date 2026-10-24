// Approval requests, the agent switch and tool policies (docs/agent-work.md
// sections 5 and 6), through the official MCP SDK client, the REST API, an
// OAuth agent connection and the app layer the phone uses.
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { admin, appClient, callTool, createKey, helm, importRows, mcpClient, openApiChecker, rest } from "./helpers";
import { connect, phone } from "./oauthClient";

type Client = Awaited<ReturnType<typeof mcpClient>>;

/** The tool error of a failed call: its code, message and approvalId. */
async function toolError(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, `${name} should fail`).toBe(true);
  return (result.structuredContent as { error: { code: string; message: string; approvalId?: string } }).error;
}

/** The owner on the phone and one agent with its own key. */
async function owner() {
  const { client: app, userId } = await appClient();
  const agentKey = await createKey(userId, "planner", "agent");
  return { app, userId, agentKey, agent: await mcpClient(agentKey) };
}

const DEPLOY = {
  action: "Deploy release 2.4 to production",
  detail: "Tests pass on staging; the migration adds one column.",
  options: [
    { label: "Deploy now", consequence: "Customers get 2.4 within 10 minutes." },
    { label: "Wait until Monday", consequence: "Nothing changes until Monday 09:00." },
    { id: "cancel", label: "Do not deploy" },
  ],
  reversible: true,
  expiresInMinutes: 120,
};

const received = async (id: string): Promise<{ body: string }[]> => (await fetch(`${helm().webhookOrigin}/received/${id}`)).json();

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string): Promise<T> {
  const end = Date.now() + 15_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

describe("approval requests", () => {
  test("an agent asks, the owner decides on the phone, the agent reads the decision", async () => {
    const { app, agent } = await owner();
    const task = await callTool(agent, "add_task", { title: "Release 2.4" });
    const asked = await callTool(agent, "request_approval", { ...DEPLOY, taskId: `#${task.ref}` });
    expect(asked).toMatchObject({
      status: "pending",
      action: DEPLOY.action,
      ref: task.ref,
      reversible: true,
      source: "agent",
      decision: null,
      requestedBy: { type: "agent", name: "planner" },
      options: [
        { id: "o1", label: "Deploy now", consequence: "Customers get 2.4 within 10 minutes." },
        { id: "o2", label: "Wait until Monday" },
        { id: "cancel", label: "Do not deploy", consequence: null },
      ],
    });
    expect(asked.expiresAt - asked.createdAt).toBe(120 * 60_000);

    const waiting = (await app.query(api.app.listApprovals, { status: "pending" })) as any;
    expect(waiting.approvals.map((a: any) => a.id)).toEqual([asked.id]);
    const decided = (await app.mutation(api.app.decideApproval, { approvalId: asked.id, optionId: "o2", note: "after the weekend" })) as any;
    expect(decided).toMatchObject({ status: "decided", decision: { optionId: "o2", label: "Wait until Monday", note: "after the weekend", by: "app" } });

    expect(await callTool(agent, "get_approval", { approvalId: asked.id })).toEqual(decided);
    // The request and the decision are in the task's history, and so in the activity log.
    const log = await callTool(agent, "list_events", { since: "0", taskId: `#${task.ref}` });
    expect(log.events.map((e: any) => [e.action, e.by])).toEqual([
      ["create", "agent: planner"],
      ["approvalRequest", "agent: planner"],
      ["approvalDecide", "app"],
    ]);
    // Deciding again the same way changes nothing; another way is refused.
    expect(await app.mutation(api.app.decideApproval, { approvalId: asked.id, optionId: "o2" })).toMatchObject({ decision: { note: "after the weekend" } });
    await expect(app.mutation(api.app.decideApproval, { approvalId: asked.id, optionId: "o1" })).rejects.toThrow(/already decided/);
    await agent.close();
  });

  test("only the owner decides; agents do not even see decide_approval", async () => {
    const { userId, agent } = await owner();
    const asked = await callTool(agent, "request_approval", DEPLOY);
    expect(await toolError(agent, "decide_approval", { approvalId: asked.id, optionId: "o1" })).toMatchObject({ code: "forbidden" });
    const agentTools = (await agent.listTools()).tools.map((t) => t.name);
    expect(agentTools).toContain("request_approval");
    expect(agentTools).not.toContain("decide_approval");
    // A cli key is the owner at a terminal: it sees and uses the owner's tools.
    const cli = await mcpClient(await createKey(userId, "laptop", "cli"));
    expect((await cli.listTools()).tools.map((t) => t.name)).toContain("decide_approval");
    expect(await callTool(cli, "decide_approval", { approvalId: asked.id, optionId: "cancel" })).toMatchObject({ decision: { optionId: "cancel", by: "cli" } });
    await Promise.all([agent.close(), cli.close()]);
  });

  test("checks the options, the expiry and the ids", async () => {
    const { agent } = await owner();
    const one = await toolError(agent, "request_approval", { ...DEPLOY, options: [{ label: "Yes" }] });
    expect(one).toMatchObject({ code: "invalid_argument", message: expect.stringMatching(/2 to 4/) });
    const five = Array.from({ length: 5 }, (_, i) => ({ label: `Option ${i}` }));
    expect(await toolError(agent, "request_approval", { ...DEPLOY, options: five })).toMatchObject({ code: "invalid_argument" });
    expect(await toolError(agent, "request_approval", { ...DEPLOY, expiresInMinutes: 0 })).toMatchObject({ code: "invalid_argument" });
    expect(await toolError(agent, "get_approval", { approvalId: "nonsense" })).toMatchObject({ code: "invalid_argument" });
    // The same clientId asks once.
    const clientId = randomUUID();
    const first = await callTool(agent, "request_approval", { ...DEPLOY, clientId });
    expect((await callTool(agent, "request_approval", { ...DEPLOY, clientId })).id).toBe(first.id);
    await agent.close();
  });

  test("a request nobody decided in time is expired and can no longer be decided", async () => {
    const { app, userId } = await owner();
    const past = Date.now() - 60_000;
    await importRows("approvals", [
      {
        userId,
        title: "Rotate the API keys",
        options: [{ id: "o1", label: "Yes" }, { id: "o2", label: "No" }],
        reversible: false,
        expiresAt: past,
        requestedBy: { actor: "agent", name: "planner" },
        source: "agent",
        createdAt: past - 3_600_000,
      },
    ]);
    const [expired] = ((await app.query(api.app.listApprovals, {})) as any).approvals;
    expect(expired).toMatchObject({ status: "expired", decision: null });
    await expect(app.mutation(api.app.decideApproval, { approvalId: expired.id, optionId: "o1" })).rejects.toThrow(/expired/);
  });

  test("approval.decided reaches a subscribed webhook with the request and the decision", async () => {
    const { app, userId, agent } = await owner();
    const fullKey = await createKey(userId, "integration", "agent");
    const hookId = randomUUID();
    const hook = await rest(fullKey, "POST", "/webhooks", { body: { url: `${helm().webhookOrigin}/hook/${hookId}/ok`, events: ["approval.decided"] } });
    expect(hook.status).toBe(201);
    const asked = await callTool(agent, "request_approval", DEPLOY);
    await app.mutation(api.app.decideApproval, { approvalId: asked.id, optionId: "o1" });
    const [message] = await waitFor(() => received(hookId), (m) => m.length >= 1, "approval.decided");
    const body = JSON.parse(message!.body);
    expect(body).toMatchObject({ type: "approval.decided", data: { approval: { id: asked.id, status: "decided", decision: { optionId: "o1" } } }, actor: { type: "app" } });
    await agent.close();
  });
});

describe("pausing agents", () => {
  test("while paused, agent keys and agent connections only read; the owner's own changes go through", async () => {
    const owner = await phone();
    const { client: app, userId } = owner;
    const agentKey = await createKey(userId, "planner", "agent");
    const agent = await mcpClient(agentKey);
    const task = await callTool(agent, "add_task", { title: "Water the plants" });
    const { tokens } = await connect({ owner });
    const connection = await mcpClient(tokens.access_token);
    const cli = await mcpClient(await createKey(userId, "laptop", "cli"));

    const paused = (await app.mutation(api.app.pauseAgents, { paused: true, reason: "going on holiday" })) as any;
    expect(paused).toMatchObject({ paused: true, pausedBy: "app", reason: "going on holiday" });

    for (const client of [agent, connection]) {
      const refused = await toolError(client, "update_task", { taskId: `#${task.ref}`, note: "twice a week" });
      expect(refused).toMatchObject({ code: "agents_paused", message: expect.stringMatching(/going on holiday/) });
      expect(await toolError(client, "request_approval", DEPLOY)).toMatchObject({ code: "agents_paused" });
      expect((await callTool(client, "list_today")).date).toBeDefined();
    }
    const viaRest = await rest(agentKey, "POST", `/tasks/${task.ref}/complete`, { body: {} });
    expect(viaRest.status).toBe(403);
    expect(viaRest.body.code).toBe("agents_paused");
    expect((await rest(agentKey, "POST", "/keys", { body: { name: "sneaky" } })).body.code).toBe("agents_paused");
    expect((await rest(agentKey, "GET", "/agents")).body).toMatchObject({ paused: true });

    // The owner: the phone and a cli key work on; an agent cannot resume itself.
    expect(await callTool(cli, "update_task", { taskId: `#${task.ref}`, note: "from the laptop" })).toMatchObject({ note: "from the laptop" });
    await app.mutation(api.app.update, { taskId: `#${task.ref}`, title: "Water the plants!" });
    expect(await toolError(agent, "pause_agents", { paused: false })).toMatchObject({ code: "agents_paused" });

    expect(await callTool(cli, "pause_agents", { paused: false })).toMatchObject({ paused: false, pausedAt: null, reason: null });
    expect(await callTool(agent, "update_task", { taskId: `#${task.ref}`, note: "back" })).toMatchObject({ note: "back" });
    expect(await toolError(agent, "pause_agents", { paused: true })).toMatchObject({ code: "forbidden" });
    await Promise.all([agent.close(), connection.close(), cli.close()]);
  });
});

describe("tool policies", () => {
  test("deny refuses one tool to one key; other tools, other keys and reads are unaffected", async () => {
    const { app, userId, agent } = await owner();
    const other = await mcpClient(await createKey(userId, "helper", "agent"));
    const keys = (await app.query(api.app.listApiKeys, {})) as any[];
    const planner = keys.find((k) => k.name === "planner");
    const controls = (await app.mutation(api.app.setToolPolicy, { apiKeyId: planner.id, toolName: "delete_task", rule: "deny" })) as any;
    expect(controls.policies).toEqual([expect.objectContaining({ keyName: "planner", tool: "delete_task", rule: "deny" })]);
    // Setting the same rule again changes nothing, so a retry gets the same answer.
    expect(await app.mutation(api.app.setToolPolicy, { apiKeyId: planner.id, toolName: "delete_task", rule: "deny" })).toEqual(controls);

    const task = await callTool(agent, "add_task", { title: "Old draft" });
    expect(await toolError(agent, "delete_task", { taskId: `#${task.ref}` })).toMatchObject({ code: "forbidden" });
    expect(await toolError(agent, "delete_task", { taskId: `#${task.ref}`, dryRun: true })).toMatchObject({ code: "forbidden" });
    expect((await callTool(agent, "get_task", { taskId: `#${task.ref}` })).task.deletedAt).toBeUndefined();
    expect(await callTool(other, "delete_task", { taskId: `#${task.ref}` })).toMatchObject({ deletedAt: expect.any(Number) });

    // "*" covers every write tool without its own rule; allow on one tool lets it through.
    await app.mutation(api.app.setToolPolicy, { apiKeyId: planner.id, toolName: "*", rule: "deny" });
    await app.mutation(api.app.setToolPolicy, { apiKeyId: planner.id, toolName: "add_task", rule: "allow" });
    expect(await callTool(agent, "add_task", { title: "Allowed" })).toMatchObject({ title: "Allowed" });
    expect(await toolError(agent, "update_task", { taskId: `#${task.ref}`, title: "x" })).toMatchObject({ code: "forbidden" });
    await expect(app.mutation(api.app.setToolPolicy, { apiKeyId: planner.id, toolName: "list_today", rule: "deny" })).rejects.toThrow(/changes the plan/);
    await Promise.all([agent.close(), other.close()]);
  });

  test("ask: the call waits for an approval, then runs once with approvalId", async () => {
    const { app, userId, agent } = await owner();
    const planner = ((await app.query(api.app.listApiKeys, {})) as any[]).find((k) => k.name === "planner");
    const task = await callTool(agent, "add_task", { title: "Invoice for March" });
    await app.mutation(api.app.setToolPolicy, { apiKeyId: planner.id, toolName: "complete_task", rule: "ask" });
    const call = { taskId: `#${task.ref}`, proof: { summary: "sent by email" } };

    // A dry run needs no approval: nothing changes.
    expect(await callTool(agent, "complete_task", { ...call, dryRun: true })).toMatchObject({ dryRun: true });
    const first = await toolError(agent, "complete_task", call);
    expect(first).toMatchObject({ code: "approval_required", approvalId: expect.any(String) });
    // Asking again waits for the same request instead of flooding the phone.
    expect((await toolError(agent, "complete_task", call)).approvalId).toBe(first.approvalId);
    const request = await callTool(agent, "get_approval", { approvalId: first.approvalId });
    expect(request).toMatchObject({ source: "policy", tool: "complete_task", status: "pending", ref: task.ref, options: [{ id: "allow" }, { id: "deny" }] });
    expect(JSON.parse(request.arguments)).toEqual({ proof: { summary: "sent by email" }, taskId: `#${task.ref}` });
    expect(await toolError(agent, "complete_task", { ...call, approvalId: first.approvalId })).toMatchObject({ code: "approval_required", approvalId: first.approvalId });

    await app.mutation(api.app.decideApproval, { approvalId: first.approvalId!, optionId: "allow" });
    // The approval is for this call only: other arguments are refused.
    const other = await toolError(agent, "complete_task", { taskId: `#${task.ref}`, approvalId: first.approvalId });
    expect(other).toMatchObject({ code: "approval_required" });
    const done = await callTool(agent, "complete_task", { ...call, approvalId: first.approvalId, clientId: randomUUID() });
    expect(done.task).toMatchObject({ status: "done", proof: { summary: "sent by email" } });
    expect((await callTool(agent, "get_approval", { approvalId: first.approvalId })).used).toBe(true);

    // One approval, one call; a denial is final.
    await callTool(agent, "set_status", { taskId: `#${task.ref}`, status: "todo" });
    const again = await toolError(agent, "complete_task", { ...call, approvalId: first.approvalId });
    expect(again.code).toBe("approval_required");
    const second = await toolError(agent, "complete_task", call);
    expect(second.approvalId).not.toBe(first.approvalId);
    await app.mutation(api.app.decideApproval, { approvalId: second.approvalId!, optionId: "deny", note: "not yet paid" });
    expect(await toolError(agent, "complete_task", { ...call, approvalId: second.approvalId })).toMatchObject({ code: "forbidden", message: expect.stringMatching(/not yet paid/) });
    await agent.close();
  });

  test("the REST API refuses an ask with 403 and the approvalId, and documents it", async () => {
    const { app, agentKey } = await owner();
    const planner = ((await app.query(api.app.listApiKeys, {})) as any[]).find((k) => k.name === "planner");
    await app.mutation(api.app.setToolPolicy, { apiKeyId: planner.id, toolName: "add_task", rule: "ask" });
    const { conforms } = await openApiChecker();
    const refused = await rest(agentKey, "POST", "/tasks", { body: { title: "Book flights" } });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "approval_required", approvalId: expect.any(String) });
    expect(conforms("POST", "/tasks", refused)).toEqual([]);
    await app.mutation(api.app.decideApproval, { approvalId: refused.body.approvalId, optionId: "allow" });
    const created = await rest(agentKey, "POST", "/tasks", { body: { title: "Book flights", approvalId: refused.body.approvalId } });
    expect(created.status).toBe(201);
    const controls = await rest(agentKey, "GET", "/agents");
    expect(conforms("GET", "/agents", controls)).toEqual([]);
    expect(controls.body.policies).toEqual([expect.objectContaining({ tool: "add_task", rule: "ask" })]);
  });

  test("policies are only for agent keys of the same user", async () => {
    const { app, userId } = await owner();
    await createKey(userId, "laptop", "cli");
    const keys = (await app.query(api.app.listApiKeys, {})) as any[];
    const laptop = keys.find((k) => k.name === "laptop");
    await expect(app.mutation(api.app.setToolPolicy, { apiKeyId: laptop.id, toolName: "*", rule: "deny" })).rejects.toThrow(/agent keys/);
    const stranger = await appClient();
    await expect(stranger.client.mutation(api.app.setToolPolicy, { apiKeyId: keys[0].id, toolName: "*", rule: "deny" })).rejects.toThrow(/not found/);
    expect(await admin().query(internal.ops.agentsPaused, { userId })).toBe(false);
  });
});
