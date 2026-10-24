// Backlog.md import and export (docs/backlog-md.md) through the official MCP SDK
// client, which also checks every result against the tool's output schema, and
// the REST API. The folders are synthetic, written here for the tests.
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { readTask } from "../convex/lib/backlogMd";
import { parseFrontmatter } from "../convex/lib/frontmatter";
import { appClient, callTool, createKey, mcpClient, newUserId, openApiChecker, rest } from "./helpers";

type File = { path: string; content: string };
type Client = Awaited<ReturnType<typeof mcpClient>>;

const file = (path: string, header: string, body = ""): File => ({ path, content: `---\n${header.trim()}\n---\n${body}` });

/** A small project: custom statuses, a task in each folder, and files that are not tasks. */
const FOLDER: File[] = [
  { path: "config.yml", content: 'project_name: "Shop"\nstatuses: ["To Do", "In Progress", "Review", "Done"]\n' },
  file(
    "tasks/task-1 - Write-the-returns-page.md",
    "id: TASK-1\ntitle: Write the returns page\nstatus: To Do\nlabels: [site]\ndependencies: [TASK-2]\npriority: high\nreferences:\n  - https://shop.example.com/returns\n  - docs/returns.md",
    "\n## Description\n\n<!-- SECTION:DESCRIPTION:BEGIN -->\nCustomers ask how to send things back.\n<!-- SECTION:DESCRIPTION:END -->\n\n## Acceptance Criteria\n<!-- AC:BEGIN -->\n- [ ] #1 The page explains the 30 days\n- [ ] #2 It links the form\n<!-- AC:END -->\n\n## Implementation Plan\n\n<!-- SECTION:PLAN:BEGIN -->\nDraft, review, publish.\n<!-- SECTION:PLAN:END -->\n",
  ),
  file("tasks/task-2 - Agree-the-policy.md", "id: TASK-2\ntitle: Agree the policy\nstatus: Review\nassignee: ['@kim']"),
  file(
    "completed/task-3 - Set-up-the-form.md",
    "id: TASK-3\ntitle: Set up the form\nstatus: Done\nupdated_date: '2026-10-01 12:00'",
    "\n## Acceptance Criteria\n<!-- AC:BEGIN -->\n- [x] #1 The form sends mail\n<!-- AC:END -->\n\n## Final Summary\n\n<!-- SECTION:FINAL_SUMMARY:BEGIN -->\nThe form sends to returns@shop.example.com; tested twice.\n<!-- SECTION:FINAL_SUMMARY:END -->\n",
  ),
  file("tasks/task-4 - Ask-the-carrier.md", "id: TASK-4\ntitle: Ask the carrier about labels\nstatus: Waiting on carrier\ndependencies: [TASK-99]"),
  file("drafts/draft-1 - Free-returns.md", "id: DRAFT-1\ntitle: Offer free returns\nstatus: To Do"),
  file("archive/tasks/task-5 - Old-banner.md", "id: TASK-5\ntitle: Old banner\nstatus: To Do"),
  file("docs/doc-1 - Tone.md", "id: doc-1\ntitle: Tone of voice"),
  file("archive/drafts/draft-2 - Gone.md", "id: DRAFT-2\ntitle: Gone"),
  { path: "tasks/readme.md", content: "# Tasks\n\nOne file per task.\n" },
  file("tasks/task-6 - Too-long.md", `id: TASK-6\ntitle: ${"x".repeat(600)}`),
  { path: "tasks/notes.txt", content: "not markdown" },
];

async function owner() {
  const userId = newUserId();
  const key = await createKey(userId, "laptop", "cli");
  return { userId, key, client: await mcpClient(key) };
}

const byTitle = (tasks: any[], title: string) => tasks.find((t) => t.title === title);
const allTasks = async (client: Client) => [
  ...(await callTool(client, "list_all", { includeArchived: true })),
  ...(await callTool(client, "list_all", { proposed: true })),
];

describe("import_backlog", () => {
  test("a folder: statuses, criteria, plan, dependencies, proof, drafts, archive, and a report of the rest", async () => {
    const { client } = await owner();
    const preview = await callTool(client, "import_backlog", { files: FOLDER, dryRun: true });
    expect(preview).toMatchObject({ format: "backlog-md", dryRun: true, files: FOLDER.length, created: 6 });
    expect(await callTool(client, "list_all")).toEqual([]);

    const result = await callTool(client, "import_backlog", { files: FOLDER });
    expect(result).toMatchObject({ dryRun: false, created: 6 });
    expect(result.tasks.map((t: any) => t.source.ref)).toEqual(["DRAFT-1", "TASK-2", "TASK-1", "TASK-3", "TASK-4", "TASK-5"]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ path: "docs/doc-1 - Tone.md", reason: "a document, not a task" }),
      expect.objectContaining({ path: "archive/drafts/draft-2 - Gone.md", reason: "an archived draft, not a task" }),
      { path: "tasks/readme.md", reason: "no YAML header (--- … ---), so not a task file" },
      { path: "tasks/notes.txt", reason: "not a Markdown file" },
    ]);
    expect(result.failed).toEqual([{ path: "tasks/task-6 - Too-long.md", title: "x".repeat(600), message: expect.stringContaining("title") }]);
    const messages = result.warnings.map((w: any) => `${w.path ?? "*"}: ${w.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        'tasks/task-4 - Ask-the-carrier.md: status "Waiting on carrier" is not one of the project\'s statuses; read as todo',
        "tasks/task-4 - Ask-the-carrier.md: depends on TASK-99, which is neither in these files nor imported before; left out",
        "*: Not carried over, Dayhand has no field for them: assignee (1 file), priority (1 file)",
      ]),
    );

    const tasks = await allTasks(client);
    const page = byTitle(tasks, "Write the returns page");
    const policy = byTitle(tasks, "Agree the policy");
    expect(page).toMatchObject({
      status: "todo",
      labels: ["site"],
      source: { kind: "backlog-md", ref: "TASK-1" },
      acceptance: [
        { id: "a1", text: "The page explains the 30 days", met: false },
        { id: "a2", text: "It links the form", met: false },
      ],
      plan: "Draft, review, publish.",
      dependsOn: [policy.id],
      links: [{ url: "https://shop.example.com/returns" }],
      note: "Customers ask how to send things back.\n\nReferences:\n- docs/returns.md",
    });
    expect(policy.status).toBe("doing");
    expect(byTitle(tasks, "Set up the form")).toMatchObject({
      status: "done",
      completedAt: Date.parse("2026-10-01T11:00:00Z"), // noon in Europe/London, the default time zone
      proof: { summary: "The form sends to returns@shop.example.com; tested twice." },
    });
    expect(byTitle(tasks, "Old banner").archivedAt).toEqual(expect.any(Number));
    expect(byTitle(tasks, "Offer free returns")).toMatchObject({ proposedAt: expect.any(Number), status: "todo" });
    expect((await callTool(client, "get_task", { taskId: `#${page.ref}` })).history[0]).toMatchObject({ action: "import", by: "cli" });

    // Again: nothing new, and the report says which task each file made.
    const again = await callTool(client, "import_backlog", { files: FOLDER });
    expect(again.created).toBe(0);
    expect(again.skipped.filter((s: any) => s.reason === "imported before")).toHaveLength(6);
    expect(again.skipped).toContainEqual({ path: FOLDER[1]!.path, reason: "imported before", id: "TASK-1", title: page.title, taskId: page.id, ref: page.ref });
    expect(await allTasks(client)).toHaveLength(6);
  });

  test("top-level folders control import state despite nested reserved names", async () => {
    const { client } = await owner();
    const cases = [
      { path: "tasks/docs/task.md", expected: { status: "doing" } },
      { path: "tasks/archive/drafts/task.md", expected: { status: "doing" } },
      { path: "tasks/completed/task.md", expected: { status: "doing" } },
      { path: "drafts/tasks/task.md", expected: { status: "todo", proposedAt: expect.any(Number) } },
      { path: "completed/tasks/task.md", expected: { status: "done" } },
      { path: "archive/tasks/docs/task.md", expected: { status: "doing", archivedAt: expect.any(Number) } },
      { path: "archive/drafts/tasks/task.md", reason: "an archived draft, not a task" },
      { path: "docs/tasks/task.md", reason: "a document, not a task" },
      { path: "decisions/tasks/task.md", reason: "a decision record, not a task" },
      { path: "milestones/tasks/task.md", reason: "a milestone, not a task" },
    ];
    const files = [
      { path: "tasks/docs/config.yml", content: "statuses: [Wrong, Done]\n" },
      { path: "config.yml", content: "statuses: [Queue, Middle, Shipped]\n" },
      ...cases.map((item, index) => file(item.path, `id: TASK-${index}\ntitle: Case ${index}\nstatus: ${item.path.startsWith("drafts/") ? "Queue" : "Middle"}`)),
    ];
    const result = await callTool(client, "import_backlog", { files });
    expect(result).toMatchObject({ created: 6, failed: [], warnings: [] });
    expect(result.skipped).toContainEqual({ path: "tasks/docs/config.yml", reason: "not a Markdown file" });
    for (const [index, item] of cases.entries()) {
      if (item.reason) {
        expect(result.skipped).toContainEqual(expect.objectContaining({ path: item.path, reason: item.reason }));
      } else {
        const task = byTitle(result.tasks, `Case ${index}`);
        expect(task).toMatchObject(item.expected);
        if (!item.path.startsWith("drafts/")) expect(task).not.toHaveProperty("proposedAt");
        if (!item.path.startsWith("archive/tasks/")) expect(task).not.toHaveProperty("archivedAt");
      }
    }
    expect(await allTasks(client)).toHaveLength(6);
  });

  test("negated or embedded status labels never complete work or require completion proof", async () => {
    const client = await mcpClient(await createKey(newUserId(), "status-reader", "agent"));
    const labels = ["Incomplete", "Unfinished", "Unresolved", "Not Started", "Not Done", "Not Completed", "Not in progress", "non-active", "isn't resolved", "Unfinished review", "restarted"];
    const files = labels.flatMap((status, index) => [false, true].map((criteria) => file(
      `tasks/task-${index}-${criteria}.md`,
      `id: TASK-${index * 2 + (criteria ? 1 : 0)}\ntitle: ${status} ${criteria}\nstatus: ${status}`,
      `${criteria ? "## Acceptance Criteria\n- [ ] Still pending\n\n" : ""}## Final Summary\n\nCheckpoint only.\n`,
    )));
    const result = await callTool(client, "import_backlog", { files });
    expect(result).toMatchObject({ created: files.length, failed: [] });
    expect(result.warnings).toHaveLength(files.length);
    for (const task of result.tasks) {
      expect(task).toMatchObject({ status: "todo", note: "## Final Summary\n\nCheckpoint only." });
      expect(task).not.toHaveProperty("completedAt");
      expect(task).not.toHaveProperty("proof");
      if (task.acceptance) expect(task.acceptance).toMatchObject([{ text: "Still pending", met: false }]);
    }
    for (const warning of result.warnings) expect(warning.message).toContain("read as todo");
    const positive = await callTool(client, "import_backlog", { files: [
      file("tasks/finished.md", "id: TASK-100\ntitle: Actually finished\nstatus: Completed", "## Acceptance Criteria\n- [x] Ready\n\n## Final Summary\n\nVerified.\n"),
      file("tasks/review.md", "id: TASK-101\ntitle: Under review\nstatus: Under Review", "## Acceptance Criteria\n- [ ] Pending\n\n## Final Summary\n\nCheckpoint only.\n"),
    ] });
    expect(positive).toMatchObject({ created: 2, failed: [] });
    expect(byTitle(positive.tasks, "Actually finished")).toMatchObject({ status: "done", completedAt: expect.any(Number), proof: { summary: "Verified." } });
    expect(byTitle(positive.tasks, "Under review")).toMatchObject({ status: "doing", note: "## Final Summary\n\nCheckpoint only." });
    expect(byTitle(positive.tasks, "Under review")).not.toHaveProperty("completedAt");
  });

  test("dependencies sent in an earlier call are found by their source; a cycle is reported", async () => {
    const { client } = await owner();
    await callTool(client, "import_backlog", { files: [file("tasks/task-1.md", "id: Task-1\ntitle: First")] });
    const repeated = await callTool(client, "import_backlog", { files: [file("tasks/renamed.md", "id: TASK-1\ntitle: Renamed")] });
    expect(repeated).toMatchObject({ created: 0, skipped: [{ reason: "imported before", id: "TASK-1" }] });
    const second = await callTool(client, "import_backlog", {
      files: [
        file("tasks/task-2.md", "id: TASK-2\ntitle: Second\ndependencies: [TASK-1]"),
        file("tasks/task-3.md", "id: TASK-3\ntitle: Third\ndependencies: [TASK-4]"),
        file("tasks/task-4.md", "id: TASK-4\ntitle: Fourth\ndependencies: [TASK-3]"),
      ],
    });
    const [first] = await callTool(client, "list_all", { query: "First" });
    expect(byTitle(second.tasks, "Second").dependsOn).toEqual([first.id]);
    expect(byTitle(second.tasks, "Fourth").dependsOn).toEqual([byTitle(second.tasks, "Third").id]);
    expect(second.warnings).toEqual([
      { path: "tasks/task-3.md", message: "depends on TASK-4, which is in these files but was not imported before this one (it failed, or the two wait for each other); left out" },
    ]);
  });

  test("one policy approval allows only the exact import call, once", async () => {
    const { client: app, userId } = await appClient();
    const agent = await mcpClient(await createKey(userId, "importer", "agent"));
    const keys = await app.query(api.app.listApiKeys, {}) as any[];
    await app.mutation(api.app.setToolPolicy, { apiKeyId: keys.find((key) => key.name === "importer").id, toolName: "import_backlog", rule: "ask" });
    const files = [file("tasks/one.md", "id: TASK-1\ntitle: First"), file("tasks/two.md", "id: TASK-2\ntitle: Second\ndependencies: [TASK-1]")];
    const refused = await agent.callTool({ name: "import_backlog", arguments: { files } });
    const approvalId = (refused.structuredContent as any).error.approvalId;
    expect(typeof approvalId).toBe("string");
    await app.mutation(api.app.decideApproval, { approvalId, optionId: "allow" });
    const changed = await agent.callTool({ name: "import_backlog", arguments: { files: [file("tasks/other.md", "id: TASK-3\ntitle: Not approved")], approvalId } });
    expect((changed.structuredContent as any).error.code).toBe("approval_required");
    expect((await callTool(agent, "list_all"))).toEqual([]);
    expect((await callTool(agent, "import_backlog", { files, approvalId })).created).toBe(2);
    const repeated = await agent.callTool({ name: "import_backlog", arguments: { files, approvalId } });
    expect((repeated.structuredContent as any).error).toMatchObject({ code: "approval_required", message: expect.stringContaining("already used") });
    expect(await callTool(agent, "list_all")).toHaveLength(2);
  });

  test("id-less files are skipped regardless of the import directory", async () => {
    const { client } = await owner();
    for (const path of ["backlog/tasks/loose.md", "tasks/loose.md"]) {
      const result = await callTool(client, "import_backlog", { files: [file(path, "title: Loose")] });
      expect(result).toMatchObject({ created: 0, failed: [], skipped: [{ path, reason: "the header has no id" }] });
    }
    expect(await callTool(client, "list_all")).toEqual([]);
  });

  test("excess dependencies fail the task; all accepted dependencies survive readiness and export", async () => {
    const { client } = await owner();
    const prerequisites = Array.from({ length: 51 }, (_, i) => file(`tasks/task-${i + 1}.md`, `id: TASK-${i + 1}\ntitle: Prerequisite ${i + 1}\nstatus: ${i === 50 ? "To Do" : "Done"}`));
    const imported = await callTool(client, "import_backlog", { files: prerequisites });
    expect(imported.created).toBe(51);
    const refs = Array.from({ length: 51 }, (_, i) => `TASK-${i + 1}`);
    const result = await callTool(client, "import_backlog", { files: [
      file("tasks/too-many.md", `id: TASK-100\ntitle: Excess edges\ndependencies: [${refs.join(", ")}]`),
      file("tasks/at-limit.md", `id: TASK-101\ntitle: All edges\ndependencies: [${refs.slice(1).join(", ")}]`),
    ] });
    expect(result).toMatchObject({ created: 1, failed: [{ path: "tasks/too-many.md", message: "at most 50 dependencies" }] });
    const dependent = result.tasks[0];
    expect(dependent.dependsOn).toHaveLength(50);
    expect((await callTool(client, "list_all", { ready: true })).map((t: any) => t.id)).not.toContain(dependent.id);
    expect((await callTool(client, "agent_brief")).ready.items.map((t: any) => t.id)).not.toContain(dependent.id);
    const exported = await callTool(client, "export_backlog");
    const restored = await owner();
    const copy = await callTool(restored.client, "import_backlog", { files: [exported.config, ...exported.files.map(({ path, content }: File) => ({ path, content }))] });
    expect(byTitle(copy.tasks, "All edges").dependsOn).toHaveLength(50);
    await callTool(client, "complete_task", { taskId: byTitle(imported.tasks, "Prerequisite 51").id });
    expect((await callTool(client, "agent_brief")).ready.items.map((t: any) => t.id)).toContain(dependent.id);
  });

  test("the same id twice is imported once; limits and an agent's rules hold", async () => {
    const { userId, client } = await owner();
    const twice = await callTool(client, "import_backlog", {
      files: [file("tasks/a.md", "id: TASK-1\ntitle: One"), file("completed/a.md", "id: task-1\ntitle: One again")],
    });
    expect(twice.created).toBe(1);
    expect(twice.skipped).toEqual([{ path: "completed/a.md", reason: "the same id as tasks/a.md", id: "task-1", title: "One again" }]);
    // In a later call too: the id is the same in any case.
    const later = await callTool(client, "import_backlog", { files: [file("tasks/b.md", "id: task-1\ntitle: One, renamed file")] });
    expect(later).toMatchObject({ created: 0, skipped: [{ path: "tasks/b.md", reason: "imported before", id: "task-1" }] });
    const tooMany = await client.callTool({ name: "import_backlog", arguments: { files: Array.from({ length: 201 }, (_, i) => file(`t${i}.md`, `title: T${i}`)) } });
    expect(tooMany.isError).toBe(true);

    // An agent completes nothing by import that complete_task would refuse it.
    const agent = await mcpClient(await createKey(userId, "importer", "agent"));
    const done = await callTool(agent, "import_backlog", {
      files: [file("completed/x.md", "id: TASK-9\ntitle: Claimed done\nstatus: Done", "\n## Acceptance Criteria\n- [ ] #1 Not really\n")],
    });
    expect(done.failed).toEqual([{ path: "completed/x.md", title: "Claimed done", message: expect.stringContaining("Acceptance criteria not met") }]);
    // An agent's draft waits in the inbox saying who proposed it, as add_task with proposal: true does.
    const draft = await callTool(agent, "import_backlog", { files: [file("drafts/d.md", "id: DRAFT-3\ntitle: An idea")] });
    expect(draft.tasks[0]).toMatchObject({ proposedAt: expect.any(Number), requestedBy: "agent: importer" });

    await asOwnerPause(userId);
    const paused = await agent.callTool({ name: "import_backlog", arguments: { files: [file("tasks/y.md", "title: Y")] } });
    expect((paused.structuredContent as any).error.code).toBe("agents_paused");
  });
});

/** The owner pauses agents with a cli key, as dayhand agents pause does. */
async function asOwnerPause(userId: string) {
  const ownerClient = await mcpClient(await createKey(userId, "phone-less owner", "cli"));
  await callTool(ownerClient, "pause_agents", { paused: true });
}

describe("export_backlog", () => {
  test("serialized task files over 100000 characters warn without truncation; the exact limit is importable", async () => {
    const { client } = await owner();
    const links = Array.from({ length: 20 }, (_, i) => ({ url: `https://example.com/${i}/`.padEnd(2_000, "x") }));
    const acceptance = Array.from({ length: 50 }, () => ({ text: "c".repeat(500) }));
    const task = await callTool(client, "add_task", { title: "Large file", note: "n".repeat(20_000), plan: "p".repeat(20_000), acceptance, links });
    const exported = await callTool(client, "export_backlog");
    const output = exported.files[0];
    expect(output.content.length).toBeGreaterThan(100_000);
    expect(exported.notes).toEqual([`${output.path}: exported file exceeds Dayhand import limit (100000 characters); text was not truncated`]);
    expect(readTask(output)).toMatchObject({ description: "n".repeat(20_000), plan: "p".repeat(20_000), acceptance: acceptance.map((item) => ({ ...item, met: false })), references: links.map((link) => link.url) });
    const target = await owner();
    const refused = await target.client.callTool({ name: "import_backlog", arguments: { files: [{ path: output.path, content: output.content }] } });
    expect((refused.structuredContent as any).error).toMatchObject({ code: "invalid_argument", message: expect.stringContaining("100000 characters") });
    const excess = output.content.length - 100_000;
    await callTool(client, "update_task", { taskId: task.id, plan: "p".repeat(20_000 - excess) });
    const boundary = await callTool(client, "export_backlog");
    expect(boundary.files[0].content.length).toBe(100_000);
    expect(boundary.notes).toEqual([]);
    expect((await callTool(target.client, "import_backlog", { files: boundary.files.map(({ path, content }: File) => ({ path, content })) })).created).toBe(1);
  });

  test("an oversized config warns and retains every aggregated label", async () => {
    const { client } = await owner();
    const labels = Array.from({ length: 100 }, (_, i) => Array.from({ length: 20 }, (_, j) => `label-${i}-${j}-`.padEnd(50, "x")));
    const files = labels.map((group, i) => file(`tasks/task-${i}.md`, `id: TASK-${i}\ntitle: Labels ${i}\nlabels: ${JSON.stringify(group)}`));
    expect((await callTool(client, "import_backlog", { files })).created).toBe(100);
    const exported = await callTool(client, "export_backlog");
    expect(exported.config.content.length).toBeGreaterThan(100_000);
    expect(exported.notes).toEqual(["config.yml: exported file exceeds Dayhand import limit (100000 characters); text was not truncated"]);
    expect(parseFrontmatter(exported.config.content).labels).toEqual(labels.flat().sort());
    const target = await owner();
    const refused = await target.client.callTool({ name: "import_backlog", arguments: { files: [exported.config] } });
    expect((refused.structuredContent as any).error).toMatchObject({ code: "invalid_argument", message: expect.stringContaining("100000 characters") });
  });

  test("flattened text stays complete and warnings name every task over the import limits", async () => {
    const { client } = await owner();
    const checklist = await callTool(client, "add_task", { title: "Checklist overflow", note: "n".repeat(20_000), checklist: [{ title: "Keep this item" }] });
    const resume = await callTool(client, "add_task", { title: "Resume overflow", note: "n".repeat(19_990) });
    await callTool(client, "set_now", { taskId: resume.id, resumeNote: "Keep this checkpoint" });
    const blocked = await callTool(client, "add_task", { title: "Blocked overflow", note: "n".repeat(19_990), blockedReason: "Keep this reason" });
    const unfinished = await callTool(client, "add_task", { title: "Unfinished proof overflow", note: "n".repeat(19_990) });
    await callTool(client, "complete_task", { taskId: unfinished.id, proof: { summary: "Keep this previous proof" } });
    await callTool(client, "set_status", { taskId: unfinished.id, status: "todo" });
    const proofLink = await callTool(client, "add_task", { title: "Proof link overflow" });
    await callTool(client, "complete_task", { taskId: proofLink.id, proof: { summary: "s".repeat(4_000), links: [{ url: "https://example.com/evidence" }] } });
    const proofCheck = await callTool(client, "add_task", { title: "Proof check overflow" });
    await callTool(client, "complete_task", { taskId: proofCheck.id, proof: { summary: "s".repeat(4_000), checks: [{ name: "Keep this check", result: "pass" }] } });
    const boundary = await callTool(client, "add_task", { title: "Exactly at the limits", note: "n".repeat(20_000) });
    await callTool(client, "complete_task", { taskId: boundary.id, proof: { summary: "s".repeat(4_000) } });
    const exported = await callTool(client, "export_backlog");
    expect(exported.total).toBe(7);
    expect(exported.notes).toHaveLength(6);
    for (const task of [checklist, resume, blocked, unfinished, proofLink, proofCheck]) {
      const output = exported.files.find((file: any) => file.taskId === task.id);
      expect(exported.notes).toContainEqual(expect.stringContaining(`${output.id} (${task.title}): exported fields exceed Dayhand import limits`));
    }
    const parsed = new Map(exported.files.map((file: File & { taskId: string }) => [file.taskId, readTask(file)])) as Map<string, ReturnType<typeof readTask>>;
    expect(parsed.get(checklist.id)!.description).toBe("n".repeat(20_000) + "\n\nChecklist:\n- [ ] Keep this item");
    expect(parsed.get(resume.id)!.extra).toEqual(["## Implementation Notes\n\nResume: Keep this checkpoint"]);
    expect(parsed.get(blocked.id)!.extra).toEqual(["## Implementation Notes\n\nBlocked: Keep this reason"]);
    expect(parsed.get(unfinished.id)!.finalSummary).toBe("Keep this previous proof");
    expect(parsed.get(proofLink.id)!.finalSummary).toBe("s".repeat(4_000) + "\n- https://example.com/evidence");
    expect(parsed.get(proofCheck.id)!.finalSummary).toBe("s".repeat(4_000) + "\n- Keep this check: pass");
    const target = await owner();
    const imported = await callTool(target.client, "import_backlog", { files: exported.files.map(({ path, content }: File) => ({ path, content })) });
    expect(imported).toMatchObject({ created: 1, tasks: [{ title: boundary.title }] });
    expect(imported.failed).toHaveLength(6);
    for (const failed of imported.failed) expect(exported.notes).toContainEqual(expect.stringContaining(failed.message));
  });

  test("archived proposals export as archived drafts and cannot reappear as ordinary tasks", async () => {
    const { client } = await owner();
    const proposal = await callTool(client, "add_task", { title: "Archived idea", proposal: true });
    await callTool(client, "archive_task", { taskId: proposal.id });
    expect((await callTool(client, "export_backlog")).files).toEqual([]);
    const exported = await callTool(client, "export_backlog", { includeArchived: true });
    expect(exported.files).toHaveLength(1);
    expect(exported.files[0].path).toMatch(/^archive\/drafts\/draft-\d+ - Archived-idea\.md$/);
    const target = await owner();
    const result = await callTool(target.client, "import_backlog", { files: exported.files.map(({ path, content }: File) => ({ path, content })) });
    expect(result).toMatchObject({ created: 0, skipped: [{ reason: "an archived draft, not a task" }] });
    expect(await allTasks(target.client)).toEqual([]);
  });

  test("quoted titles and narrative headings survive export and an agent's import without becoming criteria", async () => {
    const { client: source } = await owner();
    const title = "O'Brien #42";
    const note = "## Acceptance Criteria\n- [ ] This is only an example.\n\n## Final Summary\nNot the actual proof.";
    const plan = "## Rollout\nDeploy in stages.";
    const summary = "## Evidence\nThe checks passed.";
    const task = await callTool(source, "add_task", { title, note, plan, acceptance: [{ text: "Actual criterion", met: true }] });
    await callTool(source, "complete_task", { taskId: task.id, proof: { summary } });
    const exported = await callTool(source, "export_backlog");
    const target = await mcpClient(await createKey(newUserId(), "reader", "agent"));
    const imported = await callTool(target, "import_backlog", { files: [exported.config, ...exported.files.map(({ path, content }: File) => ({ path, content }))] });
    expect(imported).toMatchObject({ created: 1, failed: [], tasks: [{ title, note, plan, status: "done", acceptance: [{ text: "Actual criterion", met: true }], proof: { summary } }] });
  });

  test("round trip: export one plan, import it into another, and the criteria, dependencies and statuses survive", async () => {
    const { client: source } = await owner();
    const base = await callTool(source, "add_task", { title: "Pick a supplier", labels: ["ops"] });
    const work = await callTool(source, "add_task", {
      title: "Order the boxes",
      note: "Two sizes.",
      labels: ["ops", "q4"],
      links: [{ url: "https://supplier.example.com/boxes", title: "catalogue" }],
      checklist: [{ title: "Measure" }],
      acceptance: [{ text: "Boxes arrive", met: false }, { text: "Invoice filed", met: true }],
      plan: "Order on Monday.",
      dependsOn: [`#${base.ref}`],
      blockedReason: "waiting for prices",
      dueDate: "tomorrow",
    });
    await callTool(source, "set_status", { taskId: `#${work.ref}`, status: "doing" });
    await callTool(source, "complete_task", { taskId: `#${base.ref}`, proof: { summary: "Chose the local one.", checks: [{ name: "quotes", result: "pass" }] } });
    await callTool(source, "add_task", { title: "Maybe a new logo", proposal: true });
    const archived = await callTool(source, "add_task", { title: "Old idea" });
    await callTool(source, "archive_task", { taskId: archived.id });

    const exported = await callTool(source, "export_backlog", {});
    expect(exported).toMatchObject({ format: "backlog-md", prefix: "task", total: 3, config: { path: "config.yml" } });
    expect(exported.files.map((f: any) => [f.path, f.id])).toEqual([
      [`tasks/task-${base.ref} - Pick-a-supplier.md`, `TASK-${base.ref}`],
      [`tasks/task-${work.ref} - Order-the-boxes.md`, `TASK-${work.ref}`],
      [expect.stringMatching(/^drafts\/draft-\d+ - Maybe-a-new-logo\.md$/), expect.stringMatching(/^DRAFT-\d+$/)],
    ]);
    expect(exported.notes).toEqual(["1 due date(s) and time(s) left out: Backlog.md has no field for them"]);
    const order = exported.files[1].content as string;
    expect(order).toContain(`status: In Progress`);
    expect(order).toContain(`dependencies:\n  - TASK-${base.ref}`);
    expect(order).toContain("- [ ] #1 Boxes arrive\n- [x] #2 Invoice filed");
    expect(order).toContain("Blocked: waiting for prices");
    expect((await callTool(source, "export_backlog", { includeArchived: true })).files.map((f: any) => f.path)).toContainEqual(expect.stringMatching(/^archive\/tasks\//));

    const { client: target } = await owner();
    const imported = await callTool(target, "import_backlog", { files: [exported.config, ...exported.files.map(({ path, content }: File) => ({ path, content }))] });
    expect(imported).toMatchObject({ created: 3, failed: [], skipped: [] });
    const tasks = await allTasks(target);
    const supplier = byTitle(tasks, "Pick a supplier");
    expect(supplier).toMatchObject({ status: "done", labels: ["ops"], proof: { summary: "Chose the local one.\n- quotes: pass" } });
    expect(byTitle(tasks, "Order the boxes")).toMatchObject({
      status: "doing",
      labels: ["ops", "q4"],
      links: [{ url: "https://supplier.example.com/boxes" }],
      acceptance: [
        { text: "Boxes arrive", met: false },
        { text: "Invoice filed", met: true },
      ],
      plan: "Order on Monday.",
      dependsOn: [supplier.id],
      note: expect.stringMatching(/^Two sizes\.\n\nChecklist:\n- \[ \] Measure\n\n## Implementation Notes\n\nBlocked: waiting for prices/),
      source: { kind: "backlog-md", ref: `TASK-${work.ref}` },
    });
    expect(byTitle(tasks, "Maybe a new logo").proposedAt).toEqual(expect.any(Number));

    // The imported plan exported again keeps the ids it came with.
    const reexported = await callTool(target, "export_backlog", { prefix: "shop" });
    expect(reexported.files.map((f: any) => f.id).sort()).toEqual(exported.files.map((f: any) => f.id).sort());
    expect((await callTool(target, "import_backlog", { files: reexported.files.map(({ path, content }: File) => ({ path, content })) })).created).toBe(0);
  });

  test("an id taken by an imported task is not given twice; the prefix is checked", async () => {
    const { client } = await owner();
    await callTool(client, "add_task", { title: "Native one" });
    await callTool(client, "import_backlog", { files: [file("tasks/t.md", "id: TASK-1\ntitle: Imported one")] });
    const { files } = await callTool(client, "export_backlog", {});
    expect(files.map((f: any) => [f.id, f.content.match(/^title: (.*)$/m)[1]])).toEqual([
      ["TASK-2", "Native one"],
      ["TASK-1", "Imported one"],
    ]);
    const bad = await client.callTool({ name: "export_backlog", arguments: { prefix: "no spaces" } });
    expect((bad.structuredContent as any).error.code).toBe("invalid_argument");
  });

  test("the REST routes give the same results and follow the OpenAPI document", async () => {
    const { key, client } = await owner();
    const { conforms } = await openApiChecker();
    const files = [file("tasks/t.md", "id: TASK-1\ntitle: Over REST")];
    const preview = await rest(key, "POST", "/import/backlog?dryRun=true", { body: { files } });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ dryRun: true, created: 1 });
    expect(conforms("POST", "/import/backlog", preview)).toEqual([]);
    const imported = await rest(key, "POST", "/import/backlog", { body: { files } });
    expect(imported.body.created).toBe(1);
    const exported = await rest(key, "GET", "/export/backlog?prefix=web");
    expect(conforms("GET", "/export/backlog", exported)).toEqual([]);
    expect(exported.body).toEqual(await callTool(client, "export_backlog", { prefix: "web" }));
    expect((await rest(key, "GET", "/export/backlog?prefix=1x")).status).toBe(422);
  });
});

describe("the phone", () => {
  test("an imported task is an ordinary task in the app", async () => {
    const { client: app, userId } = await appClient();
    const client = await mcpClient(await createKey(userId, "laptop", "cli"));
    await callTool(client, "import_backlog", { files: [file("tasks/t.md", "id: TASK-1\ntitle: From the folder\nstatus: In Progress")] });
    expect(((await app.query(api.app.listAll, {})) as any[]).map((t) => [t.title, t.status])).toEqual([["From the folder", "doing"]]);
  });
});
