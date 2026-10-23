// MCP server for the agent: stateless Streamable HTTP with JSON responses.
// The caller is a personal API key (actor: the key's kind, "cli" or "agent",
// and its name; every tool) or an OAuth access token of an agent connection
// (actor "agent" with the client's name; the tools its scopes allow, see
// docs/oauth.md). Tools map 1:1 onto the domain operations in ops.ts.
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
import {
  CHALLENGE_SCOPES,
  publicUrl,
  resourceFor,
  resourceMetadataFor,
  SCOPES,
  TOUCH_INTERVAL_MS,
  type Scope,
} from "./lib/oauthConfig";
import { formatScopes } from "./lib/oauthRules";
import { parseSelectorToken, sha256Hex } from "./lib/secrets";

// The version clients check for compatibility (semver): a minor release only
// adds tools, fields and error codes; a major release may change or remove them.
export const SERVER_INFO = { name: "helm", version: "0.3.0" };
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
    "Repeat rule: every day/week/month/year with an interval (1 = every time); weekly rules may list weekdays 1 (Mon) to 7 (Sun). Completing a repeating task creates the next occurrence.",
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
  tool("update_task", "Change a task's title, note, due date/time, resume note, repeat rule, labels or links.", args.update, internal.ops.update),
  tool("set_status", "Move a task between todo, doing and done (done behaves like complete_task).", args.setStatus, internal.ops.setStatus),
  tool(
    "set_now",
    'Make a task the single "now" task (sets it to doing, clears the previous one), optionally with a resume note. taskId null clears the now task.',
    args.setNow,
    internal.ops.setNow,
  ),
  tool("complete_task", "Mark a task done. A repeating task gets its next occurrence, returned as `next`.", args.complete, internal.ops.complete),
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

/** The OAuth scope a tool needs: reading tools tasks:read, every other tool tasks:write. */
export const scopeOf = (name: string): Scope => (READ_ONLY.has(name) ? "tasks:read" : "tasks:write");

/** The tools a caller with these scopes may see and call (an API key has all scopes). */
export function listTools(scopes: readonly Scope[] = SCOPES) {
  return TOOLS.filter((t) => scopes.includes(scopeOf(t.name))).map((t) => ({
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

/** The Bearer challenge: where OAuth clients find the authorization server (RFC 9728) and what to ask for. */
function challenge(fields: Record<string, string>): string {
  const base = publicUrl();
  const all = { realm: "helm", ...fields, ...(base ? { resource_metadata: resourceMetadataFor(base) } : {}) };
  return "Bearer " + Object.entries(all).map(([key, value]) => `${key}="${value}"`).join(", ");
}

/** 401 before any tool runs; a token that was sent but is not valid also gets error="invalid_token". */
function unauthorized(presented: boolean) {
  const fields: Record<string, string> = presented ? { error: "invalid_token" } : {};
  return new Response(
    JSON.stringify({ error: "invalid_token", error_description: "Missing, invalid, expired or revoked API key or access token" }),
    {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": challenge({ ...fields, scope: formatScopes(CHALLENGE_SCOPES) }) },
    },
  );
}

/** 403 for a tool outside the token's scopes: the client may ask the owner again for more (step-up). */
function insufficientScope(needed: Scope, granted: readonly Scope[]) {
  const scopes = SCOPES.filter((s) => s === needed || granted.includes(s));
  return new Response(
    JSON.stringify({ error: "insufficient_scope", error_description: `This tool needs the ${needed} scope` }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": challenge({ error: "insufficient_scope", scope: formatScopes(scopes) }),
      },
    },
  );
}

/** Who is calling: the identity for the domain and the scopes the credential carries. */
type Caller = {
  userId: string;
  actor: "cli" | "agent";
  actorName: string;
  keyId?: Id<"apiKeys">;
  connectionId?: Id<"oauthGrants">;
  scopes: readonly Scope[];
};

async function authenticate(ctx: ActionCtx, presented: string): Promise<Caller | null> {
  const access = parseSelectorToken("helmat_", presented);
  if (access) {
    const connection = await ctx.runQuery(internal.oauth.verifyAccessToken, {
      selector: access.selector,
      secretHash: await sha256Hex(access.secret),
    });
    // The token must have been issued for this server (RFC 8707 audience).
    const base = publicUrl();
    const now = Date.now();
    if (!connection || connection.expiresAt <= now || !base || connection.resource !== resourceFor(base)) return null;
    if (now - (connection.lastUsedAt ?? 0) > TOUCH_INTERVAL_MS) {
      await ctx.runMutation(internal.oauth.touchConnection, { connectionId: connection.connectionId });
    }
    return {
      userId: connection.userId,
      actor: "agent",
      actorName: connection.clientName,
      connectionId: connection.connectionId,
      scopes: connection.scopes,
    };
  }
  const key = await ctx.runQuery(internal.apiKeys.verify, { hash: await hashKey(presented) });
  return key ? { userId: key.userId, actor: key.kind, actorName: key.name, keyId: key.keyId, scopes: SCOPES } : null;
}

type ToolErrorCode = ErrorCode | "internal";
type ToolError = { code: ToolErrorCode; message: string };
const ERROR_CODES: ToolErrorCode[] = ["invalid_argument", "not_found", "unauthenticated"];
const IDENTITY_FIELDS = ["userId", "actor", "keyId", "connectionId", "actorName"];

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

async function callTool(ctx: ActionCtx, owner: Caller, params: any) {
  const found = TOOLS.find((t) => t.name === params?.name);
  if (!found) return null;
  const input = params.arguments ?? {};
  if (typeof input !== "object" || Array.isArray(input)) {
    return toolError({ code: "invalid_argument", message: "arguments must be an object" });
  }
  // Identity always comes from the key or token, never from the arguments.
  if (IDENTITY_FIELDS.some((field) => field in input)) {
    return toolError({ code: "invalid_argument", message: `${IDENTITY_FIELDS.join(", ")} are set by the server` });
  }
  const callArgs: Record<string, unknown> = {
    ...input,
    userId: owner.userId,
    actor: owner.actor,
    keyId: owner.keyId,
    connectionId: owner.connectionId,
    actorName: owner.actorName,
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

async function handleMessage(ctx: ActionCtx, owner: Caller, message: JsonRpcRequest): Promise<Response> {
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
      return rpcResult(message.id, { tools: listTools(owner.scopes) });
    case "tools/call": {
      const name = message.params?.name;
      if (typeof name === "string" && TOOLS.some((t) => t.name === name) && !owner.scopes.includes(scopeOf(name))) {
        return insufficientScope(scopeOf(name), owner.scopes);
      }
      const result = await callTool(ctx, owner, message.params);
      if (!result) return rpcError(message.id, -32602, `Unknown tool: ${message.params?.name}`);
      return rpcResult(message.id, result);
    }
    default:
      return rpcError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

export const handlePost = httpAction(async (ctx, request) => {
  const presented = bearerToken(request);
  const owner = presented ? await authenticate(ctx, presented) : null;
  if (!owner) return unauthorized(presented !== null);
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
