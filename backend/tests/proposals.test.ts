// The proposal inbox and the plan health report (docs/agent-work.md sections 7
// and 8), through the official MCP SDK client, the REST API, webhooks and the
// app layer the phone uses.
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { appClient, callTool, createKey, helm, importRows, mcpClient, openApiChecker, rest } from "./helpers";

type Client = Awaited<ReturnType<typeof mcpClient>>;

async function toolError(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, `${name} should fail`).toBe(true);
  return (result.structuredContent as { error: { code: string; message: string } }).error;
}

/** The owner on the phone, an alerting integration and its return webhook. */
async function inbox() {
  const { client: app, userId } = await appClient();
  const key = await createKey(userId, "alerts", "agent");
  const hookId = randomUUID();
  const hook = await rest(key, "POST", "/webhooks", { body: { url: `${helm().webhookOrigin}/hook/${hookId}/ok`, events: ["task.created"] } });
  expect(hook.status).toBe(201);
  return { app, userId, key, agent: await mcpClient(key), hookId, webhookId: hook.body.webhook.id as string };
}

type Message = { body: string };
const received = async (id: string): Promise<Message[]> => (await fetch(`${helm().webhookOrigin}/received/${id}`)).json();

/** The task.returned messages the webhook got, once there are `count`. */
async function returns(hookId: string, count: number) {
  const end = Date.now() + 15_000;
  for (;;) {
    const bodies = (await received(hookId)).map((m) => JSON.parse(m.body)).filter((b) => b.type === "task.returned");
    if (bodies.length >= count) return bodies;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${count} task.returned, got ${bodies.length}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

const ALERT = { kind: "sentry", ref: "CHECKOUT-42", url: "https://sentry.example.com/issues/42" };

describe("the proposal inbox", () => {
  test("a proposal stays out of Today, the board and list_all until the owner accepts it", async () => {
    const { app, agent } = await inbox();
    const proposed = await callTool(agent, "add_task", { title: "Fix checkout timeout", dueDate: "today", proposal: true, source: ALERT, requestedBy: "on-call rota" });
    expect(proposed).toMatchObject({ proposedAt: expect.any(Number), source: ALERT, requestedBy: "on-call rota", status: "todo" });

    expect((await callTool(agent, "list_today")).today).toEqual([]);
    // Without limit, list_all's text is the plain list of tasks.
    expect(await callTool(agent, "list_all")).toEqual([]);
    expect((await callTool(agent, "board")).todo).toEqual([]);
    expect(await callTool(agent, "list_all", { ready: true })).toEqual([]);
    // The iCalendar export's text is the calendar itself.
    expect(await callTool(agent, "export_plan", { format: "ics" })).not.toContain("Fix checkout timeout");
    expect((await callTool(agent, "list_all", { proposed: true, limit: 50 })).result.map((t: any) => t.id)).toEqual([proposed.id]);
    expect(((await app.query(api.app.listProposals, {})) as any[]).map((t) => t.id)).toEqual([proposed.id]);
    expect((await app.query(api.app.listAll, {})) as any[]).toEqual([]);

    // Work waits for the owner: an agent can neither claim nor finish a proposal, nor accept it.
    for (const [name, args] of [["claim_task", {}], ["set_now", {}], ["complete_task", {}], ["set_status", { status: "doing" }]] as const) {
      expect(await toolError(agent, name, { taskId: proposed.id, ...args })).toMatchObject({ code: "invalid_argument", message: expect.stringMatching(/proposal/) });
    }
    expect(await toolError(agent, "accept_proposal", { taskId: proposed.id })).toMatchObject({ code: "forbidden" });

    const accepted = (await app.mutation(api.app.acceptProposal, { taskId: proposed.id })) as any;
    expect(accepted.proposedAt).toBeUndefined();
    expect((await callTool(agent, "list_today")).today.map((t: any) => t.id)).toEqual([proposed.id]);
    expect((await callTool(agent, "get_task", { taskId: proposed.id })).history.map((h: any) => [h.action, h.by])).toEqual([
      ["create", "agent: alerts"],
      ["accept", "app"],
    ]);
    await agent.close();
  });

  test("one source makes one task, also after the proposal was accepted or rejected", async () => {
    const { app, agent } = await inbox();
    const first = await callTool(agent, "add_task", { title: "Checkout times out", proposal: true, source: ALERT });
    const again = await callTool(agent, "add_task", { title: "Checkout times out (again)", proposal: true, source: { kind: "sentry", ref: "CHECKOUT-42" } });
    expect(again.id).toBe(first.id);
    expect((await callTool(agent, "list_all", { proposed: true, limit: 50 })).total).toBe(1);
    await app.mutation(api.app.rejectProposal, { taskId: first.id });
    const afterReject = await callTool(agent, "add_task", { title: "Checkout times out", proposal: true, source: ALERT });
    expect(afterReject).toMatchObject({ id: first.id, deletedAt: expect.any(Number) });
    // Another source is another task; agents default requestedBy to themselves.
    const other = await callTool(agent, "add_task", { title: "Login slow", proposal: true, source: { kind: "sentry", ref: "LOGIN-7" } });
    expect(other).toMatchObject({ requestedBy: "agent: alerts" });
    expect(await toolError(agent, "add_task", { title: "Bad", source: { kind: "no spaces", ref: "x" } })).toMatchObject({ code: "invalid_argument" });
    await agent.close();
  });

  test("the return webhook hears when the task is completed, with the proof", async () => {
    const { app, userId, agent, hookId, webhookId } = await inbox();
    const task = await callTool(agent, "add_task", { title: "Renew the certificate", proposal: true, returnTo: webhookId });
    expect(task.returnTo).toEqual([webhookId]);
    await app.mutation(api.app.acceptProposal, { taskId: task.id });
    const worker = await mcpClient(await createKey(userId, "worker", "agent"));
    await callTool(worker, "complete_task", { taskId: task.id, proof: { summary: "renewed until 2027", checks: [{ name: "tls-check", result: "pass" }] } });
    const [message] = await returns(hookId, 1);
    expect(message).toMatchObject({
      type: "task.returned",
      data: { outcome: "completed", task: { id: task.id, status: "done" }, proof: { summary: "renewed until 2027", checks: [{ name: "tls-check", result: "pass" }] }, requestedBy: "agent: alerts" },
      actor: { type: "agent", name: "worker" },
    });
    expect(await toolError(agent, "add_task", { title: "x", returnTo: "not-a-webhook" })).toMatchObject({ code: "invalid_argument" });
    await Promise.all([agent.close(), worker.close()]);
  });

  test("rejecting moves the proposal to the trash and tells the return webhook", async () => {
    const { app, agent, hookId, webhookId } = await inbox();
    const task = await callTool(agent, "add_task", { title: "Upgrade the database", proposal: true, returnTo: webhookId, source: { kind: "github-issue", ref: "acme/shop#12" } });
    const rejected = (await app.mutation(api.app.rejectProposal, { taskId: task.id, reason: "not this quarter" })) as any;
    expect(rejected.deletedAt).toEqual(expect.any(Number));
    expect(((await app.query(api.app.listTrash, {})) as any[]).map((t) => t.id)).toEqual([task.id]);
    expect((await app.query(api.app.listProposals, {})) as any[]).toEqual([]);
    const [message] = await returns(hookId, 1);
    expect(message.data).toMatchObject({ outcome: "rejected", reason: "not this quarter", source: { kind: "github-issue", ref: "acme/shop#12" } });
    await agent.close();
  });

  test("merging folds a proposal into a task already in the plan", async () => {
    const { app, userId, agent, hookId, webhookId } = await inbox();
    const cli = await mcpClient(await createKey(userId, "laptop", "cli"));
    const existing = await callTool(cli, "add_task", { title: "Speed up checkout", note: "Profile the payment step.", labels: ["shop"] });
    const proposed = await callTool(agent, "add_task", {
      title: "Checkout p95 above 3 s",
      note: "Alert fired 4 times today.",
      links: [{ url: "https://grafana.example.com/d/checkout", title: "Dashboard" }],
      labels: ["alerts"],
      proposal: true,
      source: ALERT,
      returnTo: webhookId,
    });
    const result = await callTool(cli, "merge_proposal", { taskId: `#${proposed.ref}`, intoTaskId: `#${existing.ref}` });
    expect(result.task).toMatchObject({
      id: existing.id,
      note: `Profile the payment step.\n\nMerged from #${proposed.ref}: Checkout p95 above 3 s\n\nAlert fired 4 times today.`,
      labels: ["shop", "alerts"],
      links: [{ url: "https://grafana.example.com/d/checkout", title: "Dashboard" }],
      source: ALERT,
      returnTo: [webhookId],
    });
    expect(result.merged).toMatchObject({ id: proposed.id, mergedInto: existing.id, deletedAt: expect.any(Number) });
    // The alert's source now leads to the merged task.
    expect((await callTool(agent, "add_task", { title: "Checkout p95 above 3 s", proposal: true, source: ALERT })).id).toBe(existing.id);
    const [merged] = await returns(hookId, 1);
    expect(merged.data).toMatchObject({ outcome: "merged", mergedInto: { id: existing.id } });
    await callTool(cli, "complete_task", { taskId: existing.id, proof: { summary: "cached the price lookup" } });
    const [, completed] = await returns(hookId, 2);
    expect(completed.data).toMatchObject({ outcome: "completed", task: { id: existing.id }, proof: { summary: "cached the price lookup" } });
    expect(await toolError(cli, "merge_proposal", { taskId: existing.id, intoTaskId: existing.id })).toMatchObject({ code: "invalid_argument" });
    await Promise.all([agent.close(), cli.close()]);
  });

  test("the REST routes take the same calls and conform to the OpenAPI document", async () => {
    const { userId, key } = await inbox();
    const cliKey = await createKey(userId, "laptop", "cli");
    const { conforms } = await openApiChecker();
    const created = await rest(key, "POST", "/tasks", { body: { title: "Call the supplier", proposal: true, source: { kind: "email", ref: "msg-991" } } });
    expect(created.status).toBe(201);
    const listed = await rest(key, "GET", "/tasks?proposed=true");
    expect(listed.body.result.map((t: any) => t.id)).toEqual([created.body.id]);
    const refused = await rest(key, "POST", `/tasks/${created.body.ref}/accept`, { body: {} });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("forbidden");
    expect(conforms("POST", `/tasks/${created.body.ref}/accept`, refused)).toEqual([]);
    const accepted = await rest(cliKey, "POST", `/tasks/${created.body.ref}/accept`, { body: {} });
    expect(accepted.status).toBe(200);
    expect(conforms("POST", `/tasks/${created.body.ref}/accept`, accepted)).toEqual([]);
  });
});

describe("the plan health report", () => {
  test("counts what needs a look, and lists the tasks behind each count", async () => {
    const { app, userId, agent } = await appClient().then(async ({ client, userId }) => ({
      app: client,
      userId,
      agent: await mcpClient(await createKey(userId, "planner", "agent")),
    }));
    const cli = await mcpClient(await createKey(userId, "laptop", "cli"));
    const overdue = await callTool(cli, "add_task", { title: "Pay the rent", dueDate: "2020-01-05" });
    const today = await callTool(cli, "add_task", { title: "Call mum", dueDate: "today", dueTime: "18:00" });
    const doing = await callTool(cli, "add_task", { title: "Write the report", status: "doing" });
    await callTool(agent, "claim_task", { taskId: doing.id, minutes: 30 });
    const blocked = await callTool(cli, "add_task", { title: "Ship the release", dependsOn: [`#${doing.ref}`], blockedReason: "waiting for legal" });
    const waiting = await callTool(cli, "add_task", { title: "Delete old backups" });
    await callTool(agent, "request_approval", { taskId: waiting.id, action: "Delete 40 GB of backups", options: [{ label: "Yes" }, { label: "No" }], reversible: false });
    await callTool(agent, "add_task", { title: "Proposal from the agent", proposal: true });
    const proven = await callTool(cli, "add_task", { title: "Send the invoice" });
    await callTool(cli, "complete_task", { taskId: proven.id, proof: { summary: "sent" } });
    const unproven = await callTool(cli, "add_task", { title: "Tidy the desk" });
    await callTool(cli, "complete_task", { taskId: unproven.id });
    await importRows("tasks", [
      {
        userId,
        ref: 900,
        title: "Stale claim",
        status: "todo",
        isNow: false,
        labels: [],
        links: [],
        claimedBy: { name: "old agent" },
        claimExpiresAt: Date.now() - 60_000,
        createdAt: Date.now() - 10 * 86_400_000,
        updatedAt: Date.now() - 86_400_000,
      },
    ]);

    const health = await callTool(agent, "plan_health");
    expect(health).toMatchObject({
      agentsPaused: false,
      overdue: { count: 1, tasks: [{ id: overdue.id, title: "Pay the rent", dueDate: "2020-01-05" }] },
      dueToday: { count: 1, tasks: [{ id: today.id, dueTime: "18:00" }] },
      inProgress: { count: 1, tasks: [{ id: doing.id, workingBy: "agent: planner", isNow: false }] },
      expiredClaims: { count: 1, tasks: [{ title: "Stale claim", claimedBy: "old agent" }] },
      blocked: { count: 1, tasks: [{ id: blocked.id, reasons: ["waiting for legal", `waiting for #${doing.ref} Write the report`] }] },
      awaitingApproval: { count: 1, pendingApprovals: 1, tasks: [{ id: waiting.id, approvals: 1 }] },
      proposals: { count: 1 },
      completedToday: { count: 2, withProof: 1, withoutProof: 1 },
      oldestOpen: { title: "Stale claim", ageDays: 10 },
    });
    expect(health.completedToday.tasks.map((t: any) => [t.title, t.proof])).toEqual([
      ["Tidy the desk", false],
      ["Send the invoice", true],
    ]);
    expect(await app.query(api.app.planHealth, { at: health.at })).toEqual(health);

    await app.mutation(api.app.pauseAgents, { paused: true });
    expect((await callTool(agent, "plan_health")).agentsPaused).toBe(true);
    const { conforms } = await openApiChecker();
    const viaRest = await rest(await createKey(userId, "reader", "agent"), "GET", "/health");
    expect(viaRest.status).toBe(200);
    expect(conforms("GET", "/health", viaRest)).toEqual([]);
    await Promise.all([agent.close(), cli.close()]);
  });

  test("the plan_health prompt starts the check with the report attached", async () => {
    const { userId } = await appClient();
    const agent = await mcpClient(await createKey(userId, "planner", "agent"));
    await callTool(agent, "add_task", { title: "Pay the rent", dueDate: "2020-01-05" });
    expect((await agent.listPrompts()).prompts.map((p) => p.name)).toContain("plan_health");
    const prompt = await agent.getPrompt({ name: "plan_health" });
    const texts = prompt.messages.map((m) => (m.content as { text: string }).text);
    expect(texts[0]).toMatch(/health of my plan/);
    expect(JSON.parse(texts[1]!.replace(/^Plan health \(plan_health\):\n/, "")).overdue.count).toBe(1);
    await agent.close();
  });
});

describe("proposals and projects (0.13.0)", () => {
  test("merging a proposal from an archived project leaves an unassigned target without a project", async () => {
    const { client: app } = await appClient();
    const { project }: any = await app.mutation(api.app.addProject, { name: "P" });
    const proposed: any = await app.mutation(api.app.add, { title: "Proposed", proposal: true, projectId: project.id });
    const loose: any = await app.mutation(api.app.add, { title: "Loose" });
    await app.mutation(api.app.updateProject, { projectId: project.id, archived: true });

    const result: any = await app.mutation(api.app.mergeProposal, { taskId: proposed.id, intoTaskId: loose.id, clientId: "archived-merge" });
    expect(result.task).not.toHaveProperty("projectId");
    expect(result.task.note).toContain("Proposed");
    expect(result.merged).toMatchObject({ id: proposed.id, deletedAt: expect.any(Number), mergedInto: loose.id, projectId: project.id });
    expect((await app.query(api.app.getTask, { taskId: loose.id })).task).not.toHaveProperty("projectId");
    const retry: any = await app.mutation(api.app.mergeProposal, { taskId: proposed.id, intoTaskId: loose.id, clientId: "archived-merge" });
    expect(retry.task).not.toHaveProperty("projectId");
  });

  test("merging a proposal with a missing project leaves an unassigned target without a project", async () => {
    const { client: app, userId } = await appClient();
    const { project }: any = await app.mutation(api.app.addProject, { name: "Gone" });
    await app.mutation(api.app.deleteProject, { projectId: project.id });
    const now = Date.now();
    await importRows("tasks", [{
      userId, ref: 900, title: "Dangling proposal", proposedAt: now, projectId: project.id,
      status: "todo", isNow: false, labels: [], links: [], createdAt: now, updatedAt: now,
    }]);
    const [proposed]: any[] = await app.query(api.app.listProposals, {});
    const loose: any = await app.mutation(api.app.add, { title: "Loose" });
    const result: any = await app.mutation(api.app.mergeProposal, { taskId: proposed.id, intoTaskId: loose.id });
    expect(result.task).not.toHaveProperty("projectId");
    expect(result.merged).toMatchObject({ id: proposed.id, mergedInto: loose.id });
    expect((await app.query(api.app.getTask, { taskId: loose.id })).task).not.toHaveProperty("projectId");
  });

  test("a proposal keeps its project when accepted; a merge keeps the target's project or gives it the proposal's", async () => {
    const { client: app, userId } = await appClient();
    const shop: any = (await app.mutation(api.app.addProject, { name: "Shop" })).project;
    const home: any = (await app.mutation(api.app.addProject, { name: "Home" })).project;
    const agent = await mcpClient(await createKey(userId, "triage", "agent"));
    const propose = (title: string) => callTool(agent, "add_task", { title, proposal: true, projectId: "shop" });

    const accepted: any = await app.mutation(api.app.acceptProposal, { taskId: (await propose("accept me")).id });
    expect(accepted.projectId).toBe(shop.id);

    const loose: any = await app.mutation(api.app.add, { title: "no project yet" });
    const intoLoose: any = await app.mutation(api.app.mergeProposal, { taskId: (await propose("merge into loose")).id, intoTaskId: loose.id });
    expect(intoLoose.task.projectId).toBe(shop.id);

    const atHome: any = await app.mutation(api.app.add, { title: "at home", projectId: home.id });
    const intoHome: any = await app.mutation(api.app.mergeProposal, { taskId: (await propose("merge into home")).id, intoTaskId: atHome.id });
    expect(intoHome.task.projectId).toBe(home.id);
    await agent.close();
  });
});
