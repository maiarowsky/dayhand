// The REST API /api/v1 for integrations (docs/api.md): a thin HTTP layer over
// the same domain operations as MCP. It only establishes who is calling (a
// personal API key and its scope), counts the call against the key's limit,
// turns the request into the tool's arguments (lib/restRoutes.ts) and the
// result or error into HTTP: JSON, problem details (RFC 9457), ETag and
// If-Match, Idempotency-Key as the operation's clientId, X-RateLimit-* headers.
// OAuth access tokens are bound to /mcp (RFC 8707) and are not accepted here.
import type { FunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { scopeCovers } from "./apiKeys";
import type { CallAllowance } from "./callLimits";
import { versionTag } from "./lib/core";
import { bearerToken } from "./lib/http";
import { openApiDocument } from "./lib/openapi";
import { problem, STATUS_OF } from "./lib/problem";
import {
  acceptsDryRun,
  API_PREFIX,
  inputFields,
  isToolRoute,
  matchRoute,
  queryArgs,
  RestInputError,
  taskIdParam,
  toolOf,
  type HandlerRoute,
  type Match,
  type ToolRoute,
} from "./lib/restRoutes";
import { describeError, dryRunResult, structuredResult } from "./lib/toolResults";
import { keyIdentity, keyOwner, type KeyOwner } from "./pairing";
import { ACCOUNT_HANDLERS } from "./restAccount";

const MAX_BODY_BYTES = 256 * 1024;
const JSON_TYPES = ["application/json", "application/merge-patch+json"];
// Set by the server, never by the caller (as on /mcp), and the precondition comes from If-Match only.
const RESERVED_FIELDS = ["userId", "actor", "keyId", "connectionId", "actorName", "ifMatch"];
const PRIVATE = { "Cache-Control": "no-store" };
const CHALLENGE = { "WWW-Authenticate": 'Bearer realm="dayhand"' };

export type RestCall = {
  owner: KeyOwner;
  identity: ReturnType<typeof keyIdentity>;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
  dryRun: boolean;
};
export type HandlerResult = { status?: number; body: unknown; headers?: Record<string, string> };
export type RestHandler = (ctx: ActionCtx, call: RestCall) => Promise<HandlerResult>;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...PRIVATE, ...headers } });

// ---- Who is calling, and may they ----

async function authenticate(ctx: ActionCtx, request: Request): Promise<KeyOwner | Response> {
  const presented = bearerToken(request);
  if (!presented) return problem(401, "unauthenticated", "Send a personal API key: Authorization: Bearer dayhand_…", CHALLENGE);
  if (presented.startsWith("helmat_")) {
    return problem(401, "unauthenticated", "OAuth access tokens are only for /mcp; the REST API takes a personal API key", CHALLENGE);
  }
  const owner = await keyOwner(ctx, request);
  return owner ?? problem(401, "unauthenticated", "The API key is invalid, expired or revoked", CHALLENGE);
}

function rateHeaders(allowance: CallAllowance): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(allowance.limit),
    "X-RateLimit-Remaining": String(allowance.remaining),
    "X-RateLimit-Reset": String(Math.ceil(allowance.resetAt / 1000)),
  };
}

// ---- The request ----

/** The JSON object body of a change; empty is {}. */
async function readBody(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpProblem(413, "payload_too_large", `The body is larger than ${maxBytes} bytes`);
  if (text.trim() === "") return {};
  const type = (request.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!JSON_TYPES.includes(type)) throw new HttpProblem(415, "unsupported_media_type", "Send the body as application/json");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpProblem(400, "invalid_argument", "The body is not valid JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HttpProblem(400, "invalid_argument", "The body must be a JSON object");
  return value as Record<string, unknown>;
}

class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: Parameters<typeof problem>[1],
    message: string,
  ) {
    super(message);
  }
}

function dryRunOf(url: URL, accepts: boolean): boolean {
  const value = url.searchParams.get("dryRun");
  if (value === null || value === "false") return false;
  if (value !== "true") throw new RestInputError("Query parameter dryRun must be true or false");
  if (!accepts) throw new RestInputError("This route has no dry run");
  return true;
}

function refuseReserved(input: Record<string, unknown>, taken: string[]) {
  const reserved = [...RESERVED_FIELDS, ...taken].filter((name) => name in input);
  if (reserved.length) throw new RestInputError(`${reserved.join(", ")} cannot be set here (path, headers or the API key decide)`);
}

/** If-Match: "*" or a list of entity tags; weak tags never match a change (RFC 9110 strong comparison). */
const entityTags = (header: string) => header.split(",").map((tag) => tag.trim()).filter((tag) => tag !== "");

// ---- Tool routes ----

/** The task a result is about: the result itself, or its `task` (get_task, complete_task). */
function taskOf(result: Record<string, unknown>): { id: string; ref?: number; updatedAt: number } | null {
  const candidate = (result.task ?? result) as Record<string, unknown>;
  return typeof candidate?.id === "string" && typeof candidate.updatedAt === "number" ? (candidate as never) : null;
}

async function runTool(ctx: ActionCtx, request: Request, url: URL, match: Match & { route: ToolRoute }, owner: KeyOwner): Promise<Response> {
  const { route, params } = match;
  const tool = toolOf(route);
  const fields = inputFields(route);
  const dryRun = dryRunOf(url, acceptsDryRun(route));
  // Reads take their arguments from the query string, changes from the body (and only dryRun in the query).
  const fromQuery = queryArgs(url.searchParams, route.input === "query" ? fields : {}, ["dryRun"]);
  const input = route.input === "query" ? fromQuery : await readBody(request, MAX_BODY_BYTES);
  refuseReserved(input, [...Object.keys(params), ...Object.keys(route.fixed ?? {}), "dryRun"]);
  const callArgs: Record<string, unknown> = { ...input, ...route.fixed, ...keyIdentity(owner) };
  for (const [name, value] of Object.entries(params)) callArgs[name] = name === "taskId" ? taskIdParam(value) : value;
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (idempotencyKey !== null && "clientId" in tool.fields) {
    if (input.clientId !== undefined && input.clientId !== idempotencyKey) throw new RestInputError("clientId and Idempotency-Key differ");
    callArgs.clientId = idempotencyKey;
  }
  const ifMatch = request.headers.get("If-Match");
  if (route.ifMatch && ifMatch !== null) callArgs.ifMatch = entityTags(ifMatch);
  if (dryRun) callArgs.dryRun = true;
  if ("at" in tool.fields && callArgs.at === undefined) callArgs.at = Date.now();

  let value: unknown;
  try {
    value =
      tool.kind === "read"
        ? await ctx.runQuery(tool.ref as FunctionReference<"query", "internal">, callArgs)
        : await ctx.runMutation(tool.ref as FunctionReference<"mutation", "internal">, callArgs);
  } catch (error) {
    const preview = dryRunResult(error);
    if (!preview) {
      const { code, message } = describeError(error);
      return problem(STATUS_OF[code], code, message);
    }
    return json(200, structuredResult(preview.result, true));
  }
  const result = structuredResult(value);
  const headers: Record<string, string> = {};
  const task = route.etag ? taskOf(result) : null;
  if (task) {
    headers.ETag = versionTag(task);
    if (request.method === "GET" && entityTags(request.headers.get("If-None-Match") ?? "").some((tag) => tag === "*" || tag.replace(/^W\//, "") === headers.ETag)) {
      return new Response(null, { status: 304, headers: { ETag: headers.ETag, ...PRIVATE } });
    }
    if (route.location && task.ref !== undefined) headers.Location = `${API_PREFIX}/tasks/${task.ref}`;
  }
  if (typeof result.nextCursor === "string") {
    const next = new URL(url);
    next.searchParams.set("cursor", result.nextCursor);
    headers.Link = `<${next.pathname}${next.search}>; rel="next"`;
  }
  return json(route.status ?? 200, result, headers);
}

// ---- Account routes ----

async function runHandler(ctx: ActionCtx, request: Request, url: URL, match: Match & { route: HandlerRoute }, owner: KeyOwner): Promise<Response> {
  const { route, params } = match;
  const handler = ACCOUNT_HANDLERS[route.handler];
  if (!handler) throw new Error(`No handler ${route.handler}`);
  const dryRun = dryRunOf(url, acceptsDryRun(route));
  const query = queryArgs(url.searchParams, route.query ?? {}, ["dryRun"]);
  const body = route.method === "GET" || route.method === "DELETE" ? {} : await readBody(request, route.maxBodyBytes ?? MAX_BODY_BYTES);
  refuseReserved(body, Object.keys(params));
  try {
    const result = await handler(ctx, { owner, identity: keyIdentity(owner), params, query, body, dryRun });
    return json(result.status ?? route.status ?? 200, result.body, result.headers);
  } catch (error) {
    if (error instanceof RestInputError || error instanceof HttpProblem) throw error;
    const { code, message } = describeError(error);
    return problem(STATUS_OF[code], code, message);
  }
}

// ---- The endpoint ----

function openApi(): Response {
  return new Response(JSON.stringify(openApiDocument(), null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}

export const handle = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const path = url.pathname.slice(API_PREFIX.length);
  if (request.method === "GET" && path === "/openapi.json") return openApi();
  const { match, allowed } = matchRoute(request.method, path);
  if (!match) {
    if (allowed.length) return problem(405, "method_not_allowed", `${request.method} is not allowed here`, { Allow: allowed.join(", ") });
    return problem(404, "not_found", `No route ${request.method} ${API_PREFIX}${path} (see ${API_PREFIX}/openapi.json)`);
  }
  const owner = await authenticate(ctx, request);
  if (owner instanceof Response) return owner;
  if (!scopeCovers(owner.scope, match.route.scope)) {
    return problem(403, "insufficient_scope", `This needs an API key with scope ${match.route.scope}; this key has scope ${owner.scope}`);
  }
  const kind = request.method === "GET" ? "read" : "write";
  const allowance = await ctx.runMutation(internal.callLimits.consume, { keyId: owner.keyId, kind });
  const limits = rateHeaders(allowance);
  if (!allowance.ok) {
    const seconds = Math.max(1, Math.ceil(allowance.retryAfterMs / 1000));
    const what = kind === "read" ? "reads" : "changes";
    const detail = `Too many ${what} with this API key: at most ${allowance.limit} a minute. Try again in ${seconds} s.`;
    return problem(429, "rate_limited", detail, { ...limits, "Retry-After": String(seconds) }, { retryAfterMs: allowance.retryAfterMs });
  }
  let response: Response;
  try {
    response = isToolRoute(match.route)
      ? await runTool(ctx, request, url, match as Match & { route: ToolRoute }, owner)
      : await runHandler(ctx, request, url, match as Match & { route: HandlerRoute }, owner);
  } catch (error) {
    if (error instanceof HttpProblem) response = problem(error.status, error.code, error.message);
    else if (error instanceof RestInputError) response = problem(422, "invalid_argument", error.message);
    else throw error;
  }
  for (const [name, value] of Object.entries(limits)) response.headers.set(name, value);
  return response;
});
