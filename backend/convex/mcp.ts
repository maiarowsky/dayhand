// MCP server for the agent: stateless Streamable HTTP with JSON responses.
// The personal API key establishes the user and the actor: the key's kind
// ("cli" or "agent") and name. Tools map 1:1 onto the domain operations in ops.ts.
import { ConvexError, type PropertyValidators } from "convex/values";
import type { FunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import { hashKey } from "./apiKeys";
import { args } from "./lib/args";
import type { ErrorCode } from "./lib/core";
import { bearerToken } from "./lib/http";
import { objectSchema } from "./lib/jsonSchema";

// The version clients check for compatibility (semver): a minor release only
// adds tools, fields and error codes; a major release may change or remove them.
export const SERVER_INFO = { name: "helm", version: "0.4.0" };
const SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY_BYTES = 256 * 1024;

const FIELD_DOCS: Record<string, string> = {
  taskId: 'Task id (the `id` field returned by other tools) or the task number as "#42" (the `ref` field).',
  title: "Short task title.",
  note: "Free-text note. In update_task, null clears it.",
  dueDate: 'Due day as YYYY-MM-DD in the user\'s time zone, or "today" / "tomorrow". Null clears it.',
  dueTime: "Optional due time HH:MM (24h, local). Reminders ring only for timed tasks. Null clears it.",
  status: "todo, doing (in progress) or done.",
  resumeNote: '"Where I stopped / next step" note shown on the Today screen.',
  repeat:
    'Repeat rule: every day/week/month/year with an interval (1 = every time); weekly rules may list weekdays 1 (Mon) to 7 (Sun); monthly rules may set monthDay (1-31, -1 = last day) or weekdayOfMonth {nth: 1-5 or -1 (last), weekday: 1-7}. from: "due" (default, next date after the due date) or "completion" (counted from the day it is done). End with until (YYYY-MM-DD) or count (occurrences left, this one included). Or give an RFC 5545 RRULE string, e.g. "FREQ=MONTHLY;BYDAY=-1FR". Completing a repeating task creates the next occurrence. Null clears it.',
  checklist:
    "Checklist items in order: {title, done?, id?}. The whole list is replaced; keep the ids of existing items (new items get one). Null or [] removes the checklist.",
  reminders:
    'Reminders of this task, replacing the default ones from settings: {minutesBefore} (before the due time; only timed tasks) or {time: "HH:MM", daysBefore?} (on the due day, or that many days before). [] = no reminders; null = back to the defaults.',
  labels: "Labels (projects). In list_all, only tasks having all of these labels are returned.",
  links: "Links attached to the task (URL and optional title). Files are not supported.",
  clientId:
    "Optional unique id of this operation (e.g. a UUID). Retrying with the same clientId does not apply the change twice.",
  at: "Evaluate as of this Unix time in milliseconds (default: now).",
  includeDone: "Include done tasks (default true).",
  includeArchived: "Include archived tasks (default false).",
  doneLimit: "Maximum number of tasks in the done column (default 50).",
  format: "markdown (readable) or json (full copy including history).",
  timezone: 'IANA time zone, e.g. "Europe/London". Decides what "today" and "overdue" mean.',
  summaryTime: "Time of the morning summary, HH:MM.",
  defaultReminderMinutes: "Default reminders for timed tasks, in minutes before the due time (0 = at the time).",
};

type Tool = {
  name: string;
  description: string;
  fields: PropertyValidators;
  ref: FunctionReference<"query" | "mutation", "internal">;
};

const tool = (
  name: string,
  description: string,
  fields: PropertyValidators,
  ref: FunctionReference<"query" | "mutation", "internal">,
): Tool => ({ name, description, fields, ref });

export const TOOLS: Tool[] = [
  tool("add_task", "Add a task. Without dueDate it has no day and shows only in list_all and board.", args.add, internal.ops.add),
  tool(
    "update_task",
    "Change a task's title, note, due date/time, resume note, repeat rule, labels, links, checklist or reminders.",
    args.update,
    internal.ops.update,
  ),
  tool("set_status", "Move a task between todo, doing and done (done behaves like complete_task).", args.setStatus, internal.ops.setStatus),
  tool(
    "set_now",
    'Make a task the single "now" task (sets it to doing, clears the previous one), optionally with a resume note. taskId null clears the now task.',
    args.setNow,
    internal.ops.setNow,
  ),
  tool(
    "complete_task",
    "Mark a task done. A repeating task gets its next occurrence (checklist unticked), returned as `next`; null when its series has ended.",
    args.complete,
    internal.ops.complete,
  ),
  tool("reschedule_task", "Move a task to another day (and optionally time). dueDate null removes the date.", args.reschedule, internal.ops.reschedule),
  tool("archive_task", "Archive a task: it leaves Today and the board but stays in exports. restore_task brings it back.", args.archive, internal.ops.archive),
  tool("delete_task", "Move a task to the trash. It is purged after 30 days; restore_task undoes this.", args.softDelete, internal.ops.softDelete),
  tool("restore_task", "Restore a task from the trash (or, if not in the trash, from the archive).", args.restore, internal.ops.restore),
  tool(
    "list_today",
    "The Today screen: overdue tasks (not done, due before today in the user's time zone), today's tasks, tasks done today and the current now task.",
    args.listToday,
    internal.ops.listToday,
  ),
  tool("list_all", "All tasks not in the trash, optionally filtered by labels.", args.listAll, internal.ops.listAll),
  tool("list_trash", "Tasks in the trash, newest first.", args.listTrash, internal.ops.listTrash),
  tool("board", "Kanban board with three columns: todo, doing and done.", args.board, internal.ops.board),
  tool("get_task", "One task with its full change history (who changed what, when, before and after).", args.getTask, internal.ops.getTask),
  tool("export_plan", "Export the whole plan as Markdown or JSON.", args.exportPlan, internal.ops.exportPlan),
  tool("get_settings", "The user's settings: time zone, morning summary time, default reminders.", args.getSettings, internal.ops.getSettings),
  tool("update_settings", "Change time zone, morning summary time or default reminders.", args.updateSettings, internal.ops.updateSettings),
];

const READ_ONLY = new Set(["list_today", "list_all", "list_trash", "board", "get_task", "export_plan", "get_settings"]);

export function listTools() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: objectSchema(t.fields, FIELD_DOCS),
    annotations: { readOnlyHint: READ_ONLY.has(t.name) },
  }));
}

// ---- JSON-RPC over HTTP ----

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: any };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const rpcResult = (id: JsonRpcRequest["id"], result: unknown) => json({ jsonrpc: "2.0", id, result });
const rpcError = (id: JsonRpcRequest["id"], code: number, message: string, status = 200) =>
  json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);

function unauthorized() {
  return new Response(JSON.stringify({ error: "invalid_token", error_description: "Missing, invalid or revoked API key" }), {
    status: 401,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="helm"' },
  });
}

type KeyOwner = { userId: string; keyId: Id<"apiKeys">; name: string; kind: "cli" | "agent" };

async function authenticate(ctx: ActionCtx, request: Request): Promise<KeyOwner | null> {
  const key = bearerToken(request);
  if (!key) return null;
  return ctx.runQuery(internal.apiKeys.verify, { hash: await hashKey(key) });
}

type ToolErrorCode = ErrorCode | "internal";
type ToolError = { code: ToolErrorCode; message: string };
const ERROR_CODES: ToolErrorCode[] = ["invalid_argument", "not_found", "unauthenticated"];
const IDENTITY_FIELDS = ["userId", "actor", "keyId", "actorName"];

/** A failed tool call: the message as text, and `{ error: { code, message } }` for programs. */
function toolError(error: ToolError) {
  return { content: [{ type: "text", text: error.message }], structuredContent: { error }, isError: true };
}

/** Error safe to show the agent: domain errors and argument errors, nothing internal. */
function describeError(error: unknown): ToolError {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: string; message?: string } | string;
    if (typeof data === "string") return { code: "internal", message: data };
    const code = ERROR_CODES.find((c) => c === data.code) ?? "internal";
    return { code, message: data.message ?? "Request failed" };
  }
  const message = error instanceof Error ? error.message : "";
  const validation = /ArgumentValidationError:([\s\S]*?)(\n\s*\n|$)/.exec(message);
  if (validation) return { code: "invalid_argument", message: `Invalid arguments:${validation[1]}`.trim() };
  return { code: "internal", message: "Internal error" };
}

async function callTool(ctx: ActionCtx, owner: KeyOwner, params: any) {
  const found = TOOLS.find((t) => t.name === params?.name);
  if (!found) return null;
  const input = params.arguments ?? {};
  if (typeof input !== "object" || Array.isArray(input)) {
    return toolError({ code: "invalid_argument", message: "arguments must be an object" });
  }
  // Identity always comes from the key, never from the arguments.
  if (IDENTITY_FIELDS.some((field) => field in input)) {
    return toolError({ code: "invalid_argument", message: `${IDENTITY_FIELDS.join(", ")} are set by the server` });
  }
  const callArgs: Record<string, unknown> = {
    ...input,
    userId: owner.userId,
    actor: owner.kind,
    keyId: owner.keyId,
    actorName: owner.name,
  };
  if ("at" in found.fields && callArgs.at === undefined) callArgs.at = Date.now();
  try {
    const result = READ_ONLY.has(found.name)
      ? await ctx.runQuery(found.ref as FunctionReference<"query", "internal">, callArgs)
      : await ctx.runMutation(found.ref as FunctionReference<"mutation", "internal">, callArgs);
    if (found.name === "export_plan" && result.format === "markdown") {
      return { content: [{ type: "text", text: result.content }] };
    }
    const structured = result !== null && typeof result === "object" && !Array.isArray(result) ? result : { result };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: structured };
  } catch (error) {
    return toolError(describeError(error));
  }
}

async function handleMessage(ctx: ActionCtx, owner: KeyOwner, message: JsonRpcRequest): Promise<Response> {
  if (message?.jsonrpc !== "2.0" || typeof message.method !== "string") {
    // Responses from the client, or anything that is not a request.
    if (message && message.id !== undefined && message.method === undefined) return new Response(null, { status: 202 });
    return rpcError(message?.id, -32600, "Invalid Request", 400);
  }
  if (message.id === undefined) return new Response(null, { status: 202 }); // notification
  switch (message.method) {
    case "initialize": {
      const requested = message.params?.protocolVersion;
      return rpcResult(message.id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Helm is the user's personal task list and day plan. Start with list_today. Refer to a task by its id or its number as \"#42\". Pass a clientId with changes you might retry.",
      });
    }
    case "ping":
      return rpcResult(message.id, {});
    case "tools/list":
      return rpcResult(message.id, { tools: listTools() });
    case "tools/call": {
      const result = await callTool(ctx, owner, message.params);
      if (!result) return rpcError(message.id, -32602, `Unknown tool: ${message.params?.name}`);
      return rpcResult(message.id, result);
    }
    default:
      return rpcError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

export const handlePost = httpAction(async (ctx, request) => {
  const owner = await authenticate(ctx, request);
  if (!owner) return unauthorized();
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return rpcError(null, -32600, "Request too large", 413);
  let message: JsonRpcRequest;
  try {
    message = JSON.parse(body);
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (Array.isArray(message)) return rpcError(null, -32600, "Batch requests are not supported", 400);
  return handleMessage(ctx, owner, message);
});

/** No server-initiated stream: this server is stateless and JSON-only. */
export const handleOther = httpAction(async () =>
  new Response(null, { status: 405, headers: { Allow: "POST" } }),
);
