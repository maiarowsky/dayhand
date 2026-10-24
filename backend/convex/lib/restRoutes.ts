// The REST API /api/v1 (docs/api.md) as data: every route names the MCP tool
// it runs, or an account handler (keys, webhooks, import). The dispatcher
// (rest.ts) and the OpenAPI document (lib/openapi.ts) both read this table,
// and the arguments come from the same validators as the MCP tools, so the
// three surfaces cannot drift apart. Pure: no Convex context here.
import { v, type GenericValidator, type PropertyValidators } from "convex/values";
import { args } from "./args";
import { findTool, type Tool } from "./mcpTools";
import { webhookArgs } from "./webhookEvents";

export const API_PREFIX = "/api/v1";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";
/** What the key must be allowed to do: read < write < full (account management). */
export type RouteScope = "read" | "write" | "full";

type Base = {
  method: Method;
  /** Below /api/v1, with {param} segments. */
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tag: string;
  scope: RouteScope;
  status?: 200 | 201 | 202;
};

/** A route that runs one MCP tool: path parameters, then the query string (reads) or the JSON body (changes). */
export type ToolRoute = Base & {
  tool: string;
  input: "query" | "body";
  /** Arguments fixed by the route, e.g. DELETE /now clears the now task. */
  fixed?: Record<string, unknown>;
  /** The result carries a task: it gets an ETag, and GET answers If-None-Match. */
  etag?: boolean;
  /** The change honours If-Match. */
  ifMatch?: boolean;
  /** 201 with Location of the new task. */
  location?: boolean;
};

/** A route served by an account handler in rest.ts. */
export type HandlerRoute = Base & {
  handler: string;
  query?: PropertyValidators;
  body?: PropertyValidators;
  /** Field descriptions of query and body. */
  docs?: Record<string, string>;
  /** Name of the result's schema in docs/schemas. */
  response: string;
  dryRun?: boolean;
  /** Largest JSON body accepted, when more than the default. */
  maxBodyBytes?: number;
};

export type Route = ToolRoute | HandlerRoute;

const task = "Tasks";
const views = "Views";
const settings = "Settings";

export const TOOL_ROUTES: ToolRoute[] = [
  { method: "GET", path: "/tasks", tool: "list_all", input: "query", operationId: "listTasks", tag: task, scope: "read", summary: "Find tasks (search, filters, pages)" },
  { method: "POST", path: "/tasks", tool: "add_task", input: "body", operationId: "createTask", tag: task, scope: "write", status: 201, etag: true, location: true, summary: "Add a task" },
  { method: "GET", path: "/tasks/{taskId}", tool: "get_task", input: "query", operationId: "getTask", tag: task, scope: "read", etag: true, summary: "One task with its history" },
  {
    method: "PATCH", path: "/tasks/{taskId}", tool: "update_task", input: "body", operationId: "updateTask", tag: task, scope: "write", etag: true, ifMatch: true,
    summary: "Change a task (JSON Merge Patch: null clears a field)",
  },
  { method: "DELETE", path: "/tasks/{taskId}", tool: "delete_task", input: "body", operationId: "deleteTask", tag: task, scope: "write", etag: true, ifMatch: true, summary: "Move a task to the trash" },
  { method: "POST", path: "/tasks/{taskId}/complete", tool: "complete_task", input: "body", operationId: "completeTask", tag: task, scope: "write", etag: true, ifMatch: true, summary: "Mark a task done" },
  { method: "POST", path: "/tasks/{taskId}/status", tool: "set_status", input: "body", operationId: "setTaskStatus", tag: task, scope: "write", etag: true, ifMatch: true, summary: "Move a task between todo, doing and done" },
  { method: "POST", path: "/tasks/{taskId}/reschedule", tool: "reschedule_task", input: "body", operationId: "rescheduleTask", tag: task, scope: "write", etag: true, ifMatch: true, summary: "Move a task to another day" },
  { method: "POST", path: "/tasks/{taskId}/now", tool: "set_now", input: "body", operationId: "setNowTask", tag: task, scope: "write", etag: true, ifMatch: true, summary: "Make a task the now task" },
  { method: "DELETE", path: "/now", tool: "set_now", input: "body", fixed: { taskId: null }, operationId: "clearNowTask", tag: task, scope: "write", summary: "Clear the now task" },
  { method: "POST", path: "/tasks/{taskId}/archive", tool: "archive_task", input: "body", operationId: "archiveTask", tag: task, scope: "write", etag: true, ifMatch: true, summary: "Archive a task" },
  { method: "POST", path: "/tasks/{taskId}/restore", tool: "restore_task", input: "body", operationId: "restoreTask", tag: task, scope: "write", etag: true, ifMatch: true, summary: "Restore a task from the trash or the archive" },
  {
    method: "POST", path: "/tasks/{taskId}/claim", tool: "claim_task", input: "body", operationId: "claimTask", tag: task, scope: "write", etag: true, ifMatch: true,
    summary: "Claim a task for a while (409 while another agent holds it)",
  },
  {
    method: "POST", path: "/tasks/{taskId}/claim/renew", tool: "renew_claim", input: "body", operationId: "renewClaim", tag: task, scope: "write", etag: true, ifMatch: true,
    summary: "Extend your claim of a task",
  },
  {
    method: "POST", path: "/tasks/{taskId}/release", tool: "release_task", input: "body", operationId: "releaseTask", tag: task, scope: "write", etag: true, ifMatch: true,
    summary: "End your claim of a task, optionally with a checkpoint note",
  },
  { method: "GET", path: "/events", tool: "list_events", input: "query", operationId: "listEvents", tag: views, scope: "read", summary: "The activity log: task changes after a cursor" },
  { method: "GET", path: "/today", tool: "list_today", input: "query", operationId: "getToday", tag: views, scope: "read", summary: "The Today screen" },
  { method: "GET", path: "/board", tool: "board", input: "query", operationId: "getBoard", tag: views, scope: "read", summary: "The board: todo, doing, done" },
  { method: "GET", path: "/trash", tool: "list_trash", input: "query", operationId: "listTrash", tag: views, scope: "read", summary: "Tasks in the trash" },
  { method: "GET", path: "/export", tool: "export_plan", input: "query", operationId: "exportPlan", tag: views, scope: "read", summary: "The whole plan as Markdown, JSON or iCalendar" },
  { method: "GET", path: "/settings", tool: "get_settings", input: "query", operationId: "getSettings", tag: settings, scope: "read", summary: "Settings" },
  { method: "PATCH", path: "/settings", tool: "update_settings", input: "body", operationId: "updateSettings", tag: settings, scope: "write", summary: "Change settings (JSON Merge Patch)" },
];

const account = "Account";
const hooks = "Webhooks";

/** Account routes, served by handlers in rest.ts and restAccount.ts; they need a full key. */
export const HANDLER_ROUTES: HandlerRoute[] = [
  { method: "GET", path: "/keys", handler: "listKeys", operationId: "listApiKeys", tag: account, scope: "full", response: "api-key-list", summary: "API keys" },
  {
    method: "POST", path: "/keys", handler: "createKey", operationId: "createApiKey", tag: account, scope: "full", status: 201, response: "api-key-created",
    body: args.createApiKey,
    docs: {
      name: "Name shown in history, e.g. the integration (1 to 100 characters).",
      kind: "cli (the user at a terminal) or agent (default): the actor of the key's changes.",
      scope: "read or write (default read). A key created with a key can never be full.",
      expiresAt: "When the key stops working, Unix milliseconds; no later than the creating key's own expiry.",
    },
    summary: "Create an API key (shown once) that reads or writes",
    description: "The new key works only while the key that created it works: revoking that one stops this one too.",
  },
  {
    method: "DELETE", path: "/keys/{keyId}", handler: "revokeKey", operationId: "revokeApiKey", tag: account, scope: "full", response: "api-key-revoke",
    summary: "Revoke an API key (and the keys it created)",
  },
  { method: "GET", path: "/webhooks", handler: "listWebhooks", operationId: "listWebhooks", tag: hooks, scope: "full", response: "webhook-list", summary: "Webhooks" },
  {
    method: "POST", path: "/webhooks", handler: "createWebhook", operationId: "createWebhook", tag: hooks, scope: "full", status: 201, response: "webhook-created",
    body: webhookArgs.create,
    docs: {
      url: "HTTPS address on a public host that receives the events.",
      events: "Event types to send (default: all): task.created, task.updated, task.completed, task.deleted, task.restored, now.changed.",
      description: "What the webhook is for (up to 200 characters).",
    },
    summary: "Add a webhook; its signing secret is shown once",
  },
  { method: "GET", path: "/webhooks/{webhookId}", handler: "getWebhook", operationId: "getWebhook", tag: hooks, scope: "full", response: "webhook-one", summary: "One webhook" },
  {
    method: "DELETE", path: "/webhooks/{webhookId}", handler: "deleteWebhook", operationId: "deleteWebhook", tag: hooks, scope: "full", response: "webhook-delete",
    summary: "Remove a webhook and its delivery log",
  },
  {
    method: "POST", path: "/webhooks/{webhookId}/test", handler: "testWebhook", operationId: "testWebhook", tag: hooks, scope: "full", status: 202, response: "webhook-test",
    summary: "Send a webhook.test message now",
  },
  {
    method: "POST", path: "/webhooks/{webhookId}/enable", handler: "enableWebhook", operationId: "enableWebhook", tag: hooks, scope: "full", response: "webhook-one",
    summary: "Turn a webhook back on after it was turned off for failing",
  },
  {
    method: "GET", path: "/webhooks/{webhookId}/deliveries", handler: "listDeliveries", operationId: "listWebhookDeliveries", tag: hooks, scope: "full", response: "webhook-delivery-list",
    query: webhookArgs.deliveries, docs: { limit: "How many of the newest deliveries, 1 to 200 (default 50)." },
    summary: "The delivery log: the newest deliveries with every attempt",
  },
  {
    method: "POST", path: "/import", handler: "importPlan", operationId: "importPlan", tag: account, scope: "full", response: "import-result",
    dryRun: true, maxBodyBytes: 2 * 1024 * 1024,
    body: {
      content: v.string(),
      format: v.optional(v.union(v.literal("auto"), v.literal("dayhand-json"), v.literal("helm-json"), v.literal("ics"), v.literal("todoist-csv"))),
    },
    docs: {
      content: "The file's text: Dayhand's JSON export, an iCalendar file (VTODO, VEVENT) or a Todoist CSV export.",
      format: "auto (default: recognised from the content), dayhand-json (also its old name helm-json), ics or todoist-csv.",
    },
    summary: "Import a plan from Dayhand JSON, iCalendar or Todoist CSV",
    description:
      "Each task is checked like add_task; one that fails is listed in failed and the others are imported. Importing the same file again skips what it brought before. " +
      "dryRun=true shows what would happen without storing anything.",
  },
];

export const isToolRoute = (route: Route): route is ToolRoute => "tool" in route;

export const allRoutes = (): Route[] => [...TOOL_ROUTES, ...HANDLER_ROUTES];

export const toolOf = (route: ToolRoute): Tool => {
  const tool = findTool(route.tool);
  if (!tool) throw new Error(`Route ${route.method} ${route.path} names an unknown tool ${route.tool}`);
  return tool;
};

export const pathParams = (path: string) => [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);

/** Fields of a tool route the caller gives in the query string or the body (not the path, not fixed, not dryRun). */
export function inputFields(route: ToolRoute): PropertyValidators {
  const taken = new Set([...pathParams(route.path), ...Object.keys(route.fixed ?? {}), "dryRun"]);
  return Object.fromEntries(Object.entries(toolOf(route).fields).filter(([name]) => !taken.has(name)));
}

export const acceptsDryRun = (route: Route) => (isToolRoute(route) ? "dryRun" in toolOf(route).fields : route.dryRun === true);

export type Match = { route: Route; params: Record<string, string> };

/** The route of a request path below /api/v1 and its decoded parameters; `allowed` lists the methods the path has. */
export function matchRoute(method: string, path: string): { match: Match | null; allowed: Method[] } {
  const segments = path.split("/").slice(1);
  const allowed: Method[] = [];
  let match: Match | null = null;
  for (const route of allRoutes()) {
    const pattern = route.path.split("/").slice(1);
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const fits = pattern.every((part, i) => {
      const param = /^\{(\w+)\}$/.exec(part);
      if (!param) return part === segments[i];
      if (!segments[i]) return false;
      try {
        params[param[1]!] = decodeURIComponent(segments[i]!);
      } catch {
        return false;
      }
      return true;
    });
    if (!fits) continue;
    allowed.push(route.method);
    if (route.method === method) match = { route, params };
  }
  return { match, allowed };
}

/** A task in a path: its number ("42", or "#42" encoded as %2342) or its id. */
export const taskIdParam = (value: string) => (/^\d{1,15}$/.test(value) ? `#${value}` : value);

export class RestInputError extends Error {}

/** One query parameter as the validator wants it: numbers, booleans and lists from text. */
function coerce(name: string, validator: GenericValidator, values: string[]): unknown {
  const v = validator;
  if (v.kind === "array") {
    const parts = values.flatMap((value) => value.split(",")).map((p) => p.trim()).filter((p) => p !== "");
    return parts.map((part) => coerce(name, v.element as GenericValidator, [part]));
  }
  if (values.length > 1) throw new RestInputError(`Query parameter ${name} may be given only once`);
  const value = values[0]!;
  switch (v.kind) {
    case "boolean":
      if (value === "true") return true;
      if (value === "false") return false;
      throw new RestInputError(`Query parameter ${name} must be true or false`);
    case "float64": {
      const number = Number(value);
      if (value.trim() === "" || !Number.isFinite(number)) throw new RestInputError(`Query parameter ${name} must be a number`);
      return number;
    }
    case "string":
    case "id":
    case "literal":
      return value;
    case "union":
      if ((v.members as GenericValidator[]).every((m) => m.kind === "literal" || m.kind === "string")) return value;
      break;
  }
  throw new RestInputError(`Query parameter ${name} cannot be given in the query string`);
}

/** The query string as arguments of `fields`; unknown parameters are refused, as unknown body fields are. */
export function queryArgs(query: URLSearchParams, fields: PropertyValidators, reserved: string[] = []): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const name of new Set(query.keys())) {
    if (reserved.includes(name)) continue;
    const field = fields[name];
    if (!field) throw new RestInputError(`Unknown query parameter ${name}`);
    result[name] = coerce(name, field as GenericValidator, query.getAll(name));
  }
  return result;
}
