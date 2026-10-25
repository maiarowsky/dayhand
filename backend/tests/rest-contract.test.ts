// Contract of the REST API: every MCP tool has a route, the same steps run
// through MCP (official SDK client) and REST give the same results, the
// OpenAPI document passes the OpenAPI 3.1 schema, and every REST answer of
// these tests follows the response schema the document gives for it.
// tests/fixtures/openapi-3.1.schema.json is the official schema of OpenAPI 3.1
// documents (https://spec.openapis.org/oas/3.1/schema/2022-10-07, Apache-2.0).
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { beforeAll, describe, expect, test } from "vitest";
import { TOOLS } from "../convex/lib/mcpTools";
import { TOOL_ROUTES } from "../convex/lib/restRoutes";
import { createKey, mcpClient, newUserId, openApiChecker, rest, utc, type RestAnswer } from "./helpers";

const AT = utc("2026-11-03T08:00");

type Step = { tool: string; args: Record<string, unknown>; method: string; path: string; body?: unknown; headers?: Record<string, string> };

// Task numbers instead of ids, so both users run the very same steps.
const STEPS: Step[] = [
  { tool: "add_task", args: { title: "Write report", dueDate: "2026-11-03", dueTime: "09:30", labels: ["work"], note: "draft", clientId: "c-1" },
    method: "POST", path: "/tasks", body: { title: "Write report", dueDate: "2026-11-03", dueTime: "09:30", labels: ["work"], note: "draft" }, headers: { "Idempotency-Key": "c-1" } },
  { tool: "add_task", args: { title: "Bins", dueDate: "2026-11-02", repeat: "FREQ=WEEKLY;BYDAY=MO", checklist: [{ title: "Glass" }] },
    method: "POST", path: "/tasks", body: { title: "Bins", dueDate: "2026-11-02", repeat: "FREQ=WEEKLY;BYDAY=MO", checklist: [{ title: "Glass" }] } },
  { tool: "update_task", args: { taskId: "#1", note: null, labels: ["work", "q4"], reminders: [{ minutesBefore: 15 }] },
    method: "PATCH", path: "/tasks/1", body: { note: null, labels: ["work", "q4"], reminders: [{ minutesBefore: 15 }] } },
  { tool: "set_status", args: { taskId: "#1", status: "doing" }, method: "POST", path: "/tasks/1/status", body: { status: "doing" } },
  { tool: "set_now", args: { taskId: "#1", resumeNote: "intro written" }, method: "POST", path: "/tasks/1/now", body: { resumeNote: "intro written" } },
  { tool: "list_today", args: { at: AT }, method: "GET", path: `/today?at=${AT}` },
  { tool: "list_all", args: { query: "report", status: ["doing"], limit: 1, at: AT }, method: "GET", path: `/tasks?query=report&status=doing&limit=1&at=${AT}` },
  { tool: "list_all", args: { at: AT }, method: "GET", path: `/tasks?at=${AT}` },
  { tool: "board", args: { at: AT }, method: "GET", path: `/board?at=${AT}` },
  { tool: "get_task", args: { taskId: "#1", at: AT }, method: "GET", path: `/tasks/1?at=${AT}` },
  { tool: "reschedule_task", args: { taskId: "#2", dueDate: "2026-11-09", dueTime: "07:00" }, method: "POST", path: "/tasks/2/reschedule", body: { dueDate: "2026-11-09", dueTime: "07:00" } },
  { tool: "complete_task", args: { taskId: "#2" }, method: "POST", path: "/tasks/2/complete" },
  { tool: "complete_task", args: { taskId: "#2" }, method: "POST", path: "/tasks/2/complete" },
  { tool: "set_now", args: { taskId: null }, method: "DELETE", path: "/now" },
  { tool: "archive_task", args: { taskId: "#1" }, method: "POST", path: "/tasks/1/archive" },
  { tool: "restore_task", args: { taskId: "#1" }, method: "POST", path: "/tasks/1/restore" },
  { tool: "delete_task", args: { taskId: "#1" }, method: "DELETE", path: "/tasks/1" },
  { tool: "list_trash", args: {}, method: "GET", path: "/trash" },
  { tool: "restore_task", args: { taskId: "#1" }, method: "POST", path: "/tasks/1/restore" },
  { tool: "update_task", args: { taskId: "#1", acceptance: [{ text: "Numbers checked" }], plan: "Draft, then tables", blockedReason: "waiting for Q3" },
    method: "PATCH", path: "/tasks/1", body: { acceptance: [{ text: "Numbers checked" }], plan: "Draft, then tables", blockedReason: "waiting for Q3" } },
  { tool: "list_all", args: { ready: true, at: AT }, method: "GET", path: `/tasks?ready=true&at=${AT}` },
  { tool: "claim_task", args: { taskId: "#1", minutes: 30 }, method: "POST", path: "/tasks/1/claim", body: { minutes: 30 } },
  { tool: "renew_claim", args: { taskId: "#1", minutes: 60 }, method: "POST", path: "/tasks/1/claim/renew", body: { minutes: 60 } },
  { tool: "release_task", args: { taskId: "#1", note: "tables next" }, method: "POST", path: "/tasks/1/release", body: { note: "tables next" } },
  { tool: "renew_claim", args: { taskId: "#1" }, method: "POST", path: "/tasks/1/claim/renew" },
  { tool: "complete_task", args: { taskId: "#1" }, method: "POST", path: "/tasks/1/complete" },
  { tool: "list_events", args: { taskId: "#1", by: "agent: integration", limit: 3 }, method: "GET", path: "/events?taskId=%231&by=agent%3A%20integration&limit=3" },
  { tool: "export_plan", args: { format: "markdown", at: AT }, method: "GET", path: `/export?format=markdown&at=${AT}` },
  { tool: "export_plan", args: { format: "ics", at: AT }, method: "GET", path: `/export?format=ics&at=${AT}` },
  { tool: "get_settings", args: {}, method: "GET", path: "/settings" },
  { tool: "update_settings", args: { timezone: "Europe/Warsaw", defaultReminderMinutes: [10, 0] }, method: "PATCH", path: "/settings", body: { timezone: "Europe/Warsaw", defaultReminderMinutes: [10, 0] } },
  { tool: "add_task", args: { title: "x", dueDate: "someday" }, method: "POST", path: "/tasks", body: { title: "x", dueDate: "someday" } },
  { tool: "get_task", args: { taskId: "#99" }, method: "GET", path: "/tasks/99" },
  { tool: "set_status", args: { taskId: "#3", status: "doing" }, method: "POST", path: "/tasks/3/status", body: { status: "doing" } },
  // Since 0.11.0: approval requests, the owner's controls (refused to an agent key), proposals and plan health.
  { tool: "request_approval", args: { taskId: "#3", action: "Send the report", options: [{ label: "Send" }, { label: "Hold", consequence: "It waits" }], reversible: false, expiresInMinutes: 60 },
    method: "POST", path: "/approvals", body: { taskId: "#3", action: "Send the report", options: [{ label: "Send" }, { label: "Hold", consequence: "It waits" }], reversible: false, expiresInMinutes: 60 } },
  { tool: "list_approvals", args: { status: "pending" }, method: "GET", path: "/approvals?status=pending" },
  { tool: "get_approval", args: { approvalId: "nonsense" }, method: "GET", path: "/approvals/nonsense" },
  { tool: "decide_approval", args: { approvalId: "nonsense", optionId: "o1" }, method: "POST", path: "/approvals/nonsense/decide", body: { optionId: "o1" } },
  { tool: "get_agent_controls", args: {}, method: "GET", path: "/agents" },
  { tool: "pause_agents", args: { paused: true }, method: "POST", path: "/agents/pause", body: { paused: true } },
  { tool: "set_tool_policy", args: { apiKeyId: "k", toolName: "*", rule: "deny" }, method: "POST", path: "/agents/policies", body: { apiKeyId: "k", toolName: "*", rule: "deny" } },
  { tool: "add_task", args: { title: "Proposed", proposal: true, source: { kind: "email", ref: "m-1" } },
    method: "POST", path: "/tasks", body: { title: "Proposed", proposal: true, source: { kind: "email", ref: "m-1" } } },
  { tool: "list_all", args: { proposed: true, limit: 5, at: AT }, method: "GET", path: `/tasks?proposed=true&limit=5&at=${AT}` },
  { tool: "accept_proposal", args: { taskId: "#4" }, method: "POST", path: "/tasks/4/accept" },
  { tool: "merge_proposal", args: { taskId: "#4", intoTaskId: "#3" }, method: "POST", path: "/tasks/4/merge", body: { intoTaskId: "#3" } },
  { tool: "reject_proposal", args: { taskId: "#4" }, method: "POST", path: "/tasks/4/reject" },
  { tool: "plan_health", args: { at: AT }, method: "GET", path: `/health?at=${AT}` },
  // Since 0.12.0: the agent brief and Backlog.md files in and out.
  { tool: "agent_brief", args: { at: AT }, method: "GET", path: `/brief?at=${AT}` },
  { tool: "import_backlog", args: { files: [{ path: "tasks/task-1 - Pack.md", content: "---\nid: TASK-1\ntitle: Pack\nstatus: In Progress\n---\n" }] },
    method: "POST", path: "/import/backlog", body: { files: [{ path: "tasks/task-1 - Pack.md", content: "---\nid: TASK-1\ntitle: Pack\nstatus: In Progress\n---\n" }] } },
  { tool: "export_backlog", args: { prefix: "home" }, method: "GET", path: "/export/backlog?prefix=home" },
  // Since 0.13.1: projects; an agent key may add and change them, but not delete them.
  { tool: "list_projects", args: { at: AT }, method: "GET", path: `/projects?at=${AT}` },
  { tool: "add_project", args: { name: "Report", color: "blue", fromLabel: "work", clientId: "p-1" },
    method: "POST", path: "/projects", body: { name: "Report", color: "blue", fromLabel: "work" }, headers: { "Idempotency-Key": "p-1" } },
  { tool: "add_task", args: { title: "Charts", projectId: "report" }, method: "POST", path: "/tasks", body: { title: "Charts", projectId: "report" } },
  { tool: "update_project", args: { projectId: "Report", note: "Q4 report", icon: "📊", color: null },
    method: "PATCH", path: "/projects/Report", body: { note: "Q4 report", icon: "📊", color: null } },
  { tool: "list_all", args: { projectId: "report", at: AT }, method: "GET", path: `/tasks?projectId=report&at=${AT}` },
  { tool: "list_all", args: { projectId: "none", at: AT }, method: "GET", path: `/tasks?projectId=none&at=${AT}` },
  { tool: "update_task", args: { taskId: "#3", projectId: "Report" }, method: "PATCH", path: "/tasks/3", body: { projectId: "Report" } },
  { tool: "list_today", args: { projectId: "none", at: AT }, method: "GET", path: `/today?projectId=none&at=${AT}` },
  { tool: "board", args: { projectId: "Report", at: AT }, method: "GET", path: `/board?projectId=Report&at=${AT}` },
  { tool: "update_project", args: { projectId: "Nope", name: "x" }, method: "PATCH", path: "/projects/Nope", body: { name: "x" } },
  { tool: "update_project", args: { projectId: "Report", archived: true }, method: "PATCH", path: "/projects/Report", body: { archived: true } },
  { tool: "list_projects", args: { includeArchived: true, at: AT }, method: "GET", path: `/projects?includeArchived=true&at=${AT}` },
  { tool: "delete_project", args: { projectId: "Report", moveTasksTo: "none" }, method: "DELETE", path: "/projects/Report", body: { moveTasksTo: "none" } },
];

// The owner (a cli key) through both: names in the path, dry runs, refusals and deleting projects.
const OWNER_STEPS: Step[] = [
  { tool: "add_project", args: { name: "Strona piekarni", icon: "🥐", note: "Menu and photos" },
    method: "POST", path: "/projects", body: { name: "Strona piekarni", icon: "🥐", note: "Menu and photos" } },
  { tool: "add_project", args: { name: "Dom", position: 10 }, method: "POST", path: "/projects", body: { name: "Dom", position: 10 } },
  { tool: "add_project", args: { name: "dom" }, method: "POST", path: "/projects", body: { name: "dom" } },
  { tool: "add_task", args: { title: "Menu", dueDate: "2026-11-03", projectId: "strona piekarni" },
    method: "POST", path: "/tasks", body: { title: "Menu", dueDate: "2026-11-03", projectId: "strona piekarni" } },
  { tool: "add_task", args: { title: "Boiler", dueDate: "2026-11-01", projectId: "Dom" }, method: "POST", path: "/tasks", body: { title: "Boiler", dueDate: "2026-11-01", projectId: "Dom" } },
  { tool: "list_projects", args: { at: AT }, method: "GET", path: `/projects?at=${AT}` },
  { tool: "update_project", args: { projectId: "Strona piekarni", position: 5, color: "amber" },
    method: "PATCH", path: "/projects/Strona%20piekarni", body: { position: 5, color: "amber" } },
  { tool: "list_projects", args: { at: AT }, method: "GET", path: `/projects?at=${AT}` },
  { tool: "delete_project", args: { projectId: "Dom" }, method: "DELETE", path: "/projects/Dom" },
  { tool: "delete_project", args: { projectId: "Dom", moveTasksTo: "Dom" }, method: "DELETE", path: "/projects/Dom", body: { moveTasksTo: "Dom" } },
  { tool: "delete_project", args: { projectId: "Dom", moveTasksTo: "strona piekarni", dryRun: true },
    method: "DELETE", path: "/projects/Dom?dryRun=true", body: { moveTasksTo: "strona piekarni" } },
  { tool: "delete_project", args: { projectId: "Dom", moveTasksTo: "strona piekarni", clientId: "d-1" },
    method: "DELETE", path: "/projects/Dom", body: { moveTasksTo: "strona piekarni" }, headers: { "Idempotency-Key": "d-1" } },
  { tool: "delete_project", args: { projectId: "Dom", moveTasksTo: "strona piekarni", clientId: "d-1" },
    method: "DELETE", path: "/projects/Dom", body: { moveTasksTo: "strona piekarni" }, headers: { "Idempotency-Key": "d-1" } },
  { tool: "list_all", args: { projectId: "Strona piekarni", at: AT }, method: "GET", path: `/tasks?projectId=Strona%20piekarni&at=${AT}` },
  { tool: "agent_brief", args: { at: AT }, method: "GET", path: `/brief?at=${AT}` },
  { tool: "export_backlog", args: { projectId: "strona piekarni" }, method: "GET", path: "/export/backlog?projectId=strona%20piekarni" },
  { tool: "delete_project", args: { projectId: "Strona piekarni", moveTasksTo: "none" }, method: "DELETE", path: "/projects/Strona%20piekarni", body: { moveTasksTo: "none" } },
  { tool: "list_projects", args: { at: AT }, method: "GET", path: `/projects?at=${AT}` },
];

const ID_FIELDS = new Set(["id", "taskId", "repeatedFrom", "keyId", "projectId"]);
const TIME_FIELDS = new Set(["createdAt", "updatedAt", "completedAt", "archivedAt", "deletedAt", "at", "exportedAt", "claimExpiresAt", "proposedAt", "expiresAt"]);

/** Ids become their order of appearance and times a placeholder, so two users' results compare. */
function normalize(value: unknown, ids = new Map<string, string>()): unknown {
  if (Array.isArray(value)) return value.map((v) => normalize(v, ids));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => {
      if (ID_FIELDS.has(key) && typeof v === "string") {
        if (!ids.has(v)) ids.set(v, `id${ids.size + 1}`);
        return [key, ids.get(v)];
      }
      if (TIME_FIELDS.has(key) && typeof v === "number") return [key, "<time>"];
      if (key === "nextCursor" && typeof v === "string" && /^c\d+$/.test(v)) return [key, "<cursor>"];
      if (key === "content" && typeof v === "string") {
        return [
          key,
          v
            .replace(/(DTSTAMP|CREATED|LAST-MODIFIED):\d{8}T\d{6}Z/g, "$1:<time>")
            .replace(/UID:[^\r\n]+/g, "UID:<uid>")
            .replace(/^(created_date|updated_date): .*$/gm, "$1: <time>"),
        ];
      }
      return [key, normalize(v, ids)];
    }),
  );
}

let document: any;
let conforms: (method: string, path: string, answer: RestAnswer) => string[];

beforeAll(async () => {
  ({ document, conforms } = await openApiChecker());
});

describe("REST contract", () => {
  test("every MCP tool has a REST route, and every route names a real tool", () => {
    const routed = new Set(TOOL_ROUTES.map((r) => r.tool));
    expect(TOOLS.map((t) => t.name).filter((name) => !routed.has(name))).toEqual([]);
    expect([...routed].filter((name) => !TOOLS.some((t) => t.name === name))).toEqual([]);
  });

  test("the steps cover every tool", () => {
    const stepped = new Set([...STEPS, ...OWNER_STEPS].map((s) => s.tool));
    expect(TOOLS.map((t) => t.name).filter((name) => !stepped.has(name))).toEqual([]);
  });

  test("the OpenAPI document is a valid OpenAPI 3.1 document and its schemas compile", () => {
    // Ajv resolves the schema's $dynamicRef "#meta" to the wrong place; without a dialect of
    // our own it means the plain Schema Object definition, so point at that directly.
    const text = readFileSync(new URL("./fixtures/openapi-3.1.schema.json", import.meta.url), "utf8");
    const meta = JSON.parse(text.replaceAll('"$dynamicRef": "#meta"', '"$ref": "#/$defs/schema"'));
    const checker = new Ajv2020({ strict: false, allErrors: true });
    const validate = checker.compile(meta);
    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
    // Each schema on its own, in strict mode: every keyword known, every reference resolved.
    // Formats are annotations here (ajv-formats is not a dependency); the ones used are declared.
    const strict = new Ajv2020({ strict: true, allErrors: true, formats: { "date-time": true } });
    const own = (name: string) => `https://helm.test/schemas/${name}`;
    for (const [name, schema] of Object.entries(document.components.schemas)) {
      const text = JSON.stringify(schema).replace(/"#\/components\/schemas\/([\w-]+)"/g, (_, n) => JSON.stringify(own(n)));
      strict.addSchema({ $id: own(name), ...JSON.parse(text) });
    }
    for (const name of Object.keys(document.components.schemas)) {
      expect(() => strict.getSchema(own(name)), name).not.toThrow();
    }
    const operations = Object.values(document.paths).flatMap((item: any) => Object.values(item)) as any[];
    expect(new Set(operations.map((o) => o.operationId)).size).toBe(operations.length);
  });

  test("the document has the project routes and the projectId of an import (since 0.13.1)", () => {
    const { paths } = document;
    expect(Object.keys(paths["/projects"])).toEqual(["get", "post"]);
    expect(Object.keys(paths["/projects/{projectId}"])).toEqual(["patch", "delete"]);
    expect(paths["/projects/{projectId}"].delete).toMatchObject({ "x-mcp-tool": "delete_project", "x-dayhand-scope": "write", tags: ["Projects"] });
    expect(paths["/projects"].post.responses).toHaveProperty("201");
    const tasks = paths["/tasks"].get.parameters.find((p: any) => p.name === "projectId");
    expect(tasks).toMatchObject({ in: "query", required: false, description: expect.stringContaining('"none"') });
    const imported = paths["/import"].post.requestBody.content["application/json"].schema;
    expect(imported.properties.projectId).toMatchObject({ type: "string", description: expect.stringContaining("project") });
  });

  describe("the same steps through MCP and REST give the same results", () => {
    test("step by step", async () => {
      const errors = await sameResults(STEPS, "agent");
      // The project steps: what succeeds and what is refused, the same through both.
      expect(errors.slice(-13)).toEqual([null, null, null, null, null, null, null, null, null, "not_found", null, null, "forbidden"]);
    });

    test("the owner's project steps", async () => {
      const errors = await sameResults(OWNER_STEPS, "cli");
      expect(errors).toEqual([null, null, "invalid_argument", null, null, null, null, null, "precondition_failed", "invalid_argument", null, null, null, null, null, null, null, null]);
    });
  });
});

/**
 * Runs the steps for two new users, one through MCP (official SDK client) and one through REST,
 * and compares each result. Returns each step's error code, null when it succeeded.
 */
async function sameResults(steps: Step[], kind: "agent" | "cli"): Promise<(string | null)[]> {
  const mcp = await mcpClient(await createKey(newUserId(), "integration", kind));
  const restKey = await createKey(newUserId(), "integration", kind);
  const mcpIds = new Map<string, string>();
  const restIds = new Map<string, string>();
  const errors: (string | null)[] = [];
  try {
    for (const [i, step] of steps.entries()) {
      const label = `step ${i + 1}: ${step.tool} / ${step.method} ${step.path}`;
      const viaMcp = await mcp.callTool({ name: step.tool, arguments: step.args });
      const viaRest = await rest(restKey, step.method, step.path, { body: step.body, headers: step.headers });
      expect(conforms(step.method, step.path, viaRest), label).toEqual([]);
      const structured = viaMcp.structuredContent as Record<string, any>;
      errors.push(viaMcp.isError ? structured.error.code : null);
      if (viaMcp.isError) {
        // The same error code and message, as problem details.
        expect(viaRest.headers.get("content-type"), label).toBe("application/problem+json");
        expect({ code: viaRest.body.code, message: viaRest.body.detail }, label).toEqual(structured.error);
        continue;
      }
      expect(viaRest.status, label).toBeLessThan(300);
      expect(normalize(viaRest.body, restIds), label).toEqual(normalize(structured, mcpIds));
    }
  } finally {
    await mcp.close();
  }
  return errors;
}
