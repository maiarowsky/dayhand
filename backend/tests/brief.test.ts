// The agent brief (agent_brief, dayhand prime) and the phase guides
// dayhand://workflow/* (docs/agent-work.md#9-phase-guides-and-the-agent-brief),
// through the official MCP SDK client, the REST API and the app layer.
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { appClient, callTool, createKey, importRows, mcpClient, mcpPost, modern, newUserId, openApiChecker, rest } from "./helpers";

const WORKFLOWS = ["dayhand://workflow/intake", "dayhand://workflow/execution", "dayhand://workflow/finalization"];
const textOf = (contents: object[]) => (contents[0] as { text: string }).text;

describe("agent_brief", () => {
  test("list_today plus claims, approvals, ready work and next steps from the caller's side", async () => {
    const { client: app, userId } = await appClient();
    const builder = await mcpClient(await createKey(userId, "builder", "agent"));
    const reviewer = await mcpClient(await createKey(userId, "reviewer", "agent"));

    const mine = await callTool(builder, "add_task", { title: "Ship the invoice export", dueDate: "today" });
    const theirs = await callTool(builder, "add_task", { title: "Review the copy" });
    const ready = await callTool(builder, "add_task", { title: "Write the changelog", dueDate: "tomorrow" });
    await callTool(builder, "add_task", { title: "Translate the page", dependsOn: [ready.id] });
    await callTool(builder, "add_task", { title: "Book the venue", dueDate: "2020-01-01" });
    await callTool(builder, "claim_task", { taskId: mine.id, minutes: 30 });
    await callTool(reviewer, "claim_task", { taskId: theirs.id });
    const asked = await callTool(builder, "request_approval", { taskId: mine.id, action: "Publish the export", options: [{ label: "Publish" }, { label: "Wait" }], reversible: true });
    const decided = await callTool(builder, "request_approval", { action: "Delete the old CSVs", options: [{ label: "Delete" }, { label: "Keep" }], reversible: false });
    await app.mutation(api.app.decideApproval, { approvalId: decided.id, optionId: "o2", note: "keep a month" });

    const brief = await callTool(builder, "agent_brief");
    const today = await callTool(builder, "list_today");
    for (const key of Object.keys(today)) expect(brief[key], key).toEqual(today[key]);
    expect(brief).toMatchObject({
      caller: { type: "agent", name: "builder" },
      agentsPaused: false,
      pausedReason: null,
      policies: [],
      claims: {
        active: {
          count: 2,
          items: [
            expect.objectContaining({ title: "Ship the invoice export", claimedBy: "builder", mine: true }),
            expect.objectContaining({ title: "Review the copy", claimedBy: "reviewer", mine: false }),
          ],
        },
        expired: { count: 0, items: [] },
      },
      approvals: {
        pending: { count: 1, items: [expect.objectContaining({ id: asked.id, action: "Publish the export", ref: mine.ref, mine: true, decision: null })] },
        decided: { count: 1, items: [expect.objectContaining({ id: decided.id, decision: expect.objectContaining({ optionId: "o2", label: "Keep", note: "keep a month" }) })] },
      },
    });
    // Ready: not the dependent task, not the reviewer's claim; the overdue one first.
    expect(brief.ready.items.map((t: any) => t.title)).toEqual(["Book the venue", "Ship the invoice export", "Write the changelog"]);
    expect(brief.nextSteps).toEqual([
      'The owner decided "Delete the old CSVs": Keep (keep a month). Act on that choice and nothing else.',
      expect.stringMatching(/^You hold #\d+ Ship the invoice export until \d{4}-\d{2}-\d{2} \d{2}:\d{2}: renew_claim/),
      expect.stringMatching(/^Waiting for the owner on "Publish the export" until /),
      "1 task(s) are overdue: go through them with the owner (the prompt triage_overdue) before moving any.",
    ]);

    // From the reviewer's side the same plan reads differently.
    const other = await callTool(reviewer, "agent_brief");
    expect(other.claims.active.items.map((c: any) => [c.title, c.mine])).toEqual([
      ["Ship the invoice export", false],
      ["Review the copy", true],
    ]);
    expect(other.approvals.decided.count).toBe(0);
    expect(other.ready.items.map((t: any) => t.title)).not.toContain("Ship the invoice export");
  });

  test("an agent with nothing to do is told so; a paused agent is told to stop; its own policies show", async () => {
    const { client: app, userId } = await appClient();
    const agent = await mcpClient(await createKey(userId, "idle", "agent"));
    expect((await callTool(agent, "agent_brief")).nextSteps).toEqual([
      "Nothing is ready to work on: ask the owner, or propose work with add_task and proposal: true (dayhand://workflow/intake).",
    ]);
    const keys = (await app.query(api.app.listApiKeys, {})) as any[];
    await app.mutation(api.app.setToolPolicy, { apiKeyId: keys.find((k) => k.name === "idle").id, toolName: "delete_task", rule: "deny" });
    await app.mutation(api.app.pauseAgents, { paused: true, reason: "quiet hours" });
    const paused = await callTool(agent, "agent_brief");
    expect(paused).toMatchObject({ agentsPaused: true, pausedReason: "quiet hours", policies: [{ tool: "delete_task", rule: "deny" }] });
    expect(paused.nextSteps).toEqual(["The owner paused all agents (quiet hours): read, but change nothing until they resume you; do not retry in a loop."]);
  });

  test("a recent decision on a seven-day request appears in both decisions and next steps", async () => {
    const { client: app, userId } = await appClient();
    const agent = await mcpClient(await createKey(userId, "patient", "agent"));
    const keys = await app.query(api.app.listApiKeys, {}) as any[];
    const keyId = keys.find((key) => key.name === "patient").id;
    const at = Date.now();
    const hour = 60 * 60 * 1000;
    const request = {
      userId, title: "Long-lived request", options: [{ id: "yes", label: "Proceed" }, { id: "no", label: "Wait" }], reversible: true,
      requestedBy: { actor: "agent", keyId, name: "patient" }, source: "agent", createdAt: at - 7 * 24 * hour - hour,
      expiresAt: at - hour, decidedAt: at - 2 * hour, optionId: "yes", decidedBy: "app",
    };
    await importRows("approvals", [request, { ...request, title: "Old decision", decidedAt: at - 25 * hour }]);
    const brief = await callTool(agent, "agent_brief", { at });
    expect(brief.approvals.decided).toMatchObject({ count: 1, items: [{ action: "Long-lived request", decision: { label: "Proceed", decidedAt: at - 2 * hour } }] });
    expect(brief.nextSteps).toContain('The owner decided "Long-lived request": Proceed. Act on that choice and nothing else.');
    expect(brief.nextSteps.some((step: string) => step.includes("Old decision"))).toBe(false);
  });

  test("projects: those not archived, in menu order with their counts, the first 10 of them", async () => {
    const agent = await mcpClient(await createKey(newUserId(), "planner", "agent"));
    expect((await callTool(agent, "agent_brief")).projects).toEqual({ count: 0, items: [] });
    for (let i = 1; i <= 12; i++) await callTool(agent, "add_project", { name: `Project ${i}` });
    await callTool(agent, "add_task", { title: "Task in an archived project", projectId: "Project 1" });
    await callTool(agent, "update_project", { projectId: "Project 1", archived: true });
    await callTool(agent, "update_project", { projectId: "Project 12", position: 1 });
    await callTool(agent, "add_task", { title: "Send the quote", dueDate: "2020-01-01", projectId: "Project 2" });
    const brief = await callTool(agent, "agent_brief");
    expect(brief.projects.count).toBe(11);
    expect(brief.projects.items.map((p: any) => p.name)).toEqual(["Project 12", ...Array.from({ length: 9 }, (_, i) => `Project ${i + 2}`)]);
    expect(brief.projects.items[1]).toMatchObject({ name: "Project 2", archived: false, counts: { open: 1, overdue: 1, dueToday: 0, done: 0 } });
    expect(brief.projects.items).toEqual((await callTool(agent, "list_projects")).result.slice(0, 10));
    await agent.close();
  });

  test("an expired claim of the caller asks to renew or release; REST gives the same brief", async () => {
    const userId = newUserId();
    const key = await createKey(userId, "slow", "agent");
    const agent = await mcpClient(key);
    const task = await callTool(agent, "add_task", { title: "Long job" });
    await callTool(agent, "claim_task", { taskId: task.id, minutes: 1 });
    const later = Date.now() + 2 * 60_000;
    const brief = await callTool(agent, "agent_brief", { at: later });
    expect(brief.claims).toMatchObject({ active: { count: 0 }, expired: { count: 1, items: [expect.objectContaining({ mine: true })] } });
    expect(brief.nextSteps[0]).toMatch(/^Your claim of #\d+ Long job ran out at .*: renew_claim to go on/);

    const { conforms } = await openApiChecker();
    const answer = await rest(key, "GET", `/brief?at=${later}`);
    expect(answer.status).toBe(200);
    expect(conforms("GET", "/brief", answer)).toEqual([]);
    expect(answer.body).toEqual(brief);
  });
});

describe("phase guides", () => {
  test("listed after the guide, Markdown, readable by anyone with a key and cached as public", async () => {
    const client = await mcpClient(await createKey(newUserId()));
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(["dayhand://today", "dayhand://projects", "dayhand://activity", "dayhand://guide", ...WORKFLOWS]);
    const titles = [];
    for (const uri of WORKFLOWS) {
      const read = await client.readResource({ uri });
      expect(read.contents[0]).toMatchObject({ uri, mimeType: "text/markdown" });
      titles.push(textOf(read.contents).split("\n")[0]);
    }
    expect(titles).toEqual(["# Intake: writing a task down", "# Execution: working on a task", "# Finalization: closing a task"]);
    const execution = textOf((await client.readResource({ uri: WORKFLOWS[1]! })).contents);
    for (const tool of ["claim_task", "renew_claim", "release_task", "request_approval", "update_task"]) expect(execution).toContain(tool);
    expect(textOf((await client.readResource({ uri: "dayhand://guide" })).contents)).toContain("dayhand://workflow/finalization");
    expect(textOf((await client.readResource({ uri: "helm://workflow/intake" })).contents)).toMatch(/^# Intake/);
    await expect(client.readResource({ uri: "dayhand://workflow/constructor" })).rejects.toThrow(/not found/i);
    await client.close();

    // The same text for everyone: a 2026-07-28 client may share it in a public cache, as the guide.
    const { body, headers } = modern("resources/read", { uri: WORKFLOWS[2] });
    const answer = await (await mcpPost(await createKey(newUserId()), body, headers)).json();
    expect(answer.result).toMatchObject({ cacheScope: "public", contents: [expect.objectContaining({ uri: WORKFLOWS[2] })] });
  });
});
