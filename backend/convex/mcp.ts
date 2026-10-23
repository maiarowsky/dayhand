// MCP server for the agent: stateless Streamable HTTP with JSON responses,
// serving the 2026-07-28 protocol and the 2025 ones before it (lib/mcpProtocol.ts).
// The caller is a personal API key (actor: the key's kind, "cli" or "agent",
// and its name; everything) or an OAuth access token of an agent connection
// (actor "agent" with the client's name; what its scopes allow, docs/oauth.md).
// Tools map 1:1 onto the domain operations in ops.ts (lib/mcpTools.ts);
// resources and prompts read through the same operations (lib/mcpContent.ts).
import { ConvexError } from "convex/values";
import type { FunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import { hashKey } from "./apiKeys";
import type { CallKind } from "./callLimits";
import { DRY_RUN_CODE } from "./lib/args";
import type { ErrorCode, Identity } from "./lib/core";
import { INSTRUCTIONS } from "./lib/guide";
import { bearerToken } from "./lib/http";
import { getPrompt, PromptArgumentError, PROMPTS, readResource, readsUserData, RESOURCE_TEMPLATES, RESOURCES } from "./lib/mcpContent";
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
import {
  checkModernRequest,
  eraOf,
  LEGACY_VERSIONS,
  modernResult,
  originAllowed,
  PRIVATE_LIVE,
  PUBLIC_LIST,
  RPC,
  rpcError,
  rpcResult,
  SERVER_INFO,
  SUPPORTED_VERSIONS,
  type CacheHint,
  type Era,
  type RpcRequest,
} from "./lib/mcpProtocol";
import { findTool, listTools, scopeOf, type Tool } from "./lib/mcpTools";

const MAX_BODY_BYTES = 256 * 1024;
const CAPABILITIES = { tools: { listChanged: false }, resources: {}, prompts: { listChanged: false } };

// ---- Authentication ----

/** The Bearer challenge: where OAuth clients find the authorization server (RFC 9728) and what to ask for. */
function challenge(fields: Record<string, string>): string {
  const base = publicUrl();
  const all = { realm: "helm", ...fields, ...(base ? { resource_metadata: resourceMetadataFor(base) } : {}) };
  return "Bearer " + Object.entries(all).map(([key, value]) => `${key}="${value}"`).join(", ");
}

/** 401 before anything runs; a credential that was sent but is not valid also gets error="invalid_token". */
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

/** 403 for something outside the token's scopes: the client may ask the owner again for more (step-up). */
function insufficientScope(needed: Scope, granted: readonly Scope[]) {
  const scopes = SCOPES.filter((s) => s === needed || granted.includes(s));
  return new Response(JSON.stringify({ error: "insufficient_scope", error_description: `This needs the ${needed} scope` }), {
    status: 403,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": challenge({ error: "insufficient_scope", scope: formatScopes(scopes) }) },
  });
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
    // The token must be live and issued for this server (RFC 8707 audience).
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

const identityOf = (owner: Caller): Identity => ({
  userId: owner.userId,
  actor: owner.actor,
  keyId: owner.keyId,
  connectionId: owner.connectionId,
  actorName: owner.actorName,
});

// ---- Limits ----

type Refusal = { retryAfterMs: number; message: string };

/** Counts the call against the key's or connection's limit; a refusal says when to try again. */
async function overLimit(ctx: ActionCtx, owner: Caller, kind: CallKind): Promise<Refusal | null> {
  const allowance = await ctx.runMutation(internal.callLimits.consume, { keyId: owner.keyId, connectionId: owner.connectionId, kind });
  if (allowance.ok) return null;
  const seconds = Math.max(1, Math.ceil(allowance.retryAfterMs / 1000));
  const what = kind === "read" ? "reads" : "changes";
  const via = owner.keyId ? "this API key" : "this connection";
  return {
    retryAfterMs: allowance.retryAfterMs,
    message: `Too many ${what} with ${via}: at most ${allowance.limit} a minute. Try again in ${seconds} s.`,
  };
}

const retryAfter = (refusal: Refusal) => ({ "Retry-After": String(Math.max(1, Math.ceil(refusal.retryAfterMs / 1000))) });

// ---- Tools ----

type ToolErrorCode = ErrorCode | "rate_limited" | "internal";
type ToolError = { code: ToolErrorCode; message: string; retryAfterMs?: number };
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

/** What a rolled-back dry run would have returned, or undefined for any other error. */
function dryRunResult(error: unknown): { result: unknown } | undefined {
  if (!(error instanceof ConvexError)) return undefined;
  const data = error.data as { code?: string; result?: unknown };
  return data?.code === DRY_RUN_CODE ? { result: data.result } : undefined;
}

/**
 * A successful tool call. structuredContent is the result (a list or null
 * wrapped as `{ result }`); the text block is the result as JSON, as before
 * 0.4.0: an unpaged list_all gives the plain task array there, so text-only
 * clients keep working. A Markdown export's text is the Markdown itself.
 */
function toolSuccess(tool: Tool, value: unknown, options: { dryRun?: boolean; paged?: boolean } = {}) {
  const plain = value !== null && typeof value === "object" && !Array.isArray(value);
  const structured: Record<string, unknown> = { ...(plain ? (value as Record<string, unknown>) : { result: value }) };
  if (options.dryRun) structured.dryRun = true;
  let text: string;
  if (tool.name === "export_plan" && structured.format === "markdown") text = String(structured.content);
  else if (tool.name === "list_all" && !options.paged) text = JSON.stringify(structured.result, null, 2);
  else text = JSON.stringify(options.dryRun ? structured : value, null, 2);
  return { content: [{ type: "text", text }], structuredContent: structured };
}

type Outcome = {
  result?: Record<string, unknown>;
  cache?: CacheHint;
  error?: { code: number; message: string; data?: unknown };
  status?: number;
  headers?: Record<string, string>;
};

async function callTool(ctx: ActionCtx, owner: Caller, params: any): Promise<Outcome> {
  const tool = findTool(params?.name);
  if (!tool) return { error: { code: RPC.invalidParams, message: `Unknown tool: ${params?.name}` } };
  const input = params.arguments ?? {};
  if (typeof input !== "object" || Array.isArray(input)) {
    return { result: toolError({ code: "invalid_argument", message: "arguments must be an object" }) };
  }
  // Identity always comes from the key or token, never from the arguments.
  if (IDENTITY_FIELDS.some((field) => field in input)) {
    return { result: toolError({ code: "invalid_argument", message: `${IDENTITY_FIELDS.join(", ")} are set by the server` }) };
  }
  const refusal = await overLimit(ctx, owner, tool.kind);
  if (refusal) {
    const { message, retryAfterMs } = refusal;
    return { result: toolError({ code: "rate_limited", message, retryAfterMs }), headers: retryAfter(refusal) };
  }
  const callArgs: Record<string, unknown> = { ...input, ...identityOf(owner) };
  if ("at" in tool.fields && callArgs.at === undefined) callArgs.at = Date.now();
  try {
    const value =
      tool.kind === "read"
        ? await ctx.runQuery(tool.ref as FunctionReference<"query", "internal">, callArgs)
        : await ctx.runMutation(tool.ref as FunctionReference<"mutation", "internal">, callArgs);
    return { result: toolSuccess(tool, value, { paged: input.limit !== undefined || input.cursor !== undefined }) };
  } catch (error) {
    const dryRun = dryRunResult(error);
    if (dryRun) return { result: toolSuccess(tool, dryRun.result, { dryRun: true }) };
    return { result: toolError(describeError(error)) };
  }
}

// ---- Resources and prompts ----

/** A read over the key's limit, refused before it runs: HTTP 429 with Retry-After. */
const refused = (refusal: Refusal): Outcome => ({
  error: { code: RPC.rateLimited, message: refusal.message, data: { retryAfterMs: refusal.retryAfterMs } },
  status: 429,
  headers: retryAfter(refusal),
});

/** Domain "no such task" and malformed numbers mean the resource does not exist. */
function missingResource(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const code = (error.data as { code?: string })?.code;
  return code === "not_found" || code === "invalid_argument";
}

async function readResourceCall(ctx: ActionCtx, owner: Caller, params: any, era: Era): Promise<Outcome> {
  const uri = params?.uri;
  if (typeof uri !== "string") return { error: { code: RPC.invalidParams, message: "uri must be a string" } };
  if (readsUserData(uri)) {
    const refusal = await overLimit(ctx, owner, "read");
    if (refusal) return refused(refusal);
  }
  let contents;
  try {
    contents = await readResource(ctx, identityOf(owner), uri);
  } catch (error) {
    if (!missingResource(error)) throw error;
    contents = null;
  }
  if (!contents) {
    const code = era === "modern" ? RPC.invalidParams : RPC.legacyResourceNotFound;
    return { error: { code, message: "Resource not found", data: { uri } } };
  }
  return { result: { contents: [contents] }, cache: uri === "helm://guide" ? PUBLIC_LIST : PRIVATE_LIVE };
}

async function getPromptCall(ctx: ActionCtx, owner: Caller, params: any): Promise<Outcome> {
  const name = params?.name;
  const args = params?.arguments ?? {};
  const strings = typeof args === "object" && !Array.isArray(args) && Object.values(args).every((v) => typeof v === "string");
  if (typeof name !== "string" || !strings) {
    return { error: { code: RPC.invalidParams, message: "name must be a string and arguments an object of strings" } };
  }
  if (!PROMPTS.some((p) => p.name === name)) return { error: { code: RPC.invalidParams, message: `Unknown prompt: ${name}` } };
  const refusal = await overLimit(ctx, owner, "read");
  if (refusal) return refused(refusal);
  try {
    return { result: (await getPrompt(ctx, identityOf(owner), name, args))! };
  } catch (error) {
    if (error instanceof PromptArgumentError) return { error: { code: RPC.invalidParams, message: error.message } };
    throw error;
  }
}

// ---- JSON-RPC over HTTP ----

// The tool list of a token with fewer scopes is this caller's own.
const PRIVATE_LIST: CacheHint = { ...PUBLIC_LIST, cacheScope: "private" };

/**
 * The scope a request needs beyond what the caller has, or null. A tool needs its kind's scope;
 * reading the user's data through a resource or a prompt needs tasks:read.
 */
function missingScope(owner: Caller, message: RpcRequest): Scope | null {
  let needed: Scope | null = null;
  if (message.method === "tools/call") {
    const tool = findTool(message.params?.name);
    needed = tool ? scopeOf(tool) : null;
  } else if (message.method === "resources/read" && readsUserData(message.params?.uri)) needed = "tasks:read";
  else if (message.method === "prompts/get") needed = "tasks:read";
  return needed && !owner.scopes.includes(needed) ? needed : null;
}

/** The outcome of a request, or null when the method does not exist in the request's era. */
async function dispatch(ctx: ActionCtx, owner: Caller, message: RpcRequest, era: Era): Promise<Outcome | null> {
  switch (message.method) {
    case "tools/list":
      return { result: { tools: listTools(owner.scopes) }, cache: owner.scopes.length === SCOPES.length ? PUBLIC_LIST : PRIVATE_LIST };
    case "tools/call":
      return callTool(ctx, owner, message.params);
    case "resources/list":
      return { result: { resources: RESOURCES }, cache: PUBLIC_LIST };
    case "resources/templates/list":
      return { result: { resourceTemplates: RESOURCE_TEMPLATES }, cache: PUBLIC_LIST };
    case "resources/read":
      return readResourceCall(ctx, owner, message.params, era);
    case "prompts/list":
      return { result: { prompts: PROMPTS }, cache: PUBLIC_LIST };
    case "prompts/get":
      return getPromptCall(ctx, owner, message.params);
  }
  if (era === "modern" && message.method === "server/discover") {
    return {
      result: { supportedVersions: SUPPORTED_VERSIONS, capabilities: CAPABILITIES, instructions: INSTRUCTIONS },
      cache: PUBLIC_LIST,
    };
  }
  if (era === "legacy" && message.method === "initialize") {
    const requested = message.params?.protocolVersion;
    return {
      result: {
        protocolVersion: LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0],
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      },
    };
  }
  if (era === "legacy" && message.method === "ping") return { result: {} };
  return null;
}

async function handleMessage(ctx: ActionCtx, owner: Caller, request: Request, message: RpcRequest): Promise<Response> {
  if (message?.jsonrpc !== "2.0" || typeof message.method !== "string") {
    // Responses from the client, or anything that is not a request.
    if (message && message.id !== undefined && message.method === undefined) return new Response(null, { status: 202 });
    return rpcError(message?.id, RPC.invalidRequest, "Invalid Request", 400);
  }
  if (message.id === undefined) return new Response(null, { status: 202 }); // notification
  const era = eraOf(message);
  if (era === "modern") {
    const rejected = checkModernRequest(request, message);
    if (rejected) return rejected;
  }
  const missing = missingScope(owner, message);
  if (missing) return insufficientScope(missing, owner.scopes);
  const outcome = await dispatch(ctx, owner, message, era);
  if (!outcome) {
    // A modern server answers an unknown method with HTTP 404.
    return rpcError(message.id, RPC.methodNotFound, `Method not found: ${message.method}`, era === "modern" ? 404 : 200);
  }
  if (outcome.error) {
    const { code, message: text, data } = outcome.error;
    return rpcError(message.id, code, text, outcome.status ?? 200, data, outcome.headers);
  }
  const result = era === "modern" ? modernResult(outcome.result!, outcome.cache) : outcome.result;
  return rpcResult(message.id, result, outcome.headers);
}

export const handlePost = httpAction(async (ctx, request) => {
  // Browsers may call only from allowed origins (DNS rebinding, cross-site requests).
  if (!originAllowed(request)) return rpcError(null, RPC.invalidRequest, "Origin not allowed", 403);
  const presented = bearerToken(request);
  const owner = presented ? await authenticate(ctx, presented) : null;
  if (!owner) return unauthorized(presented !== null);
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return rpcError(null, RPC.invalidRequest, "Request too large", 413);
  let message: RpcRequest;
  try {
    message = JSON.parse(body);
  } catch {
    return rpcError(null, RPC.parseError, "Parse error", 400);
  }
  if (Array.isArray(message)) return rpcError(null, RPC.invalidRequest, "Batch requests are not supported", 400);
  return handleMessage(ctx, owner, request, message);
});

/** No server-initiated stream: this server is stateless and JSON-only. */
export const handleOther = httpAction(async () =>
  new Response(null, { status: 405, headers: { Allow: "POST" } }),
);
