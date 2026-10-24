// The OpenAPI 3.1 document of the REST API, served at /api/v1/openapi.json.
// Built from the route table (lib/restRoutes.ts), the tools' validators (the
// same JSON Schema as the MCP inputSchema, lib/jsonSchema.ts) and the result
// schemas of docs/schemas (lib/outputSchemas.ts): nothing here is written by hand twice.
import type { GenericValidator, PropertyValidators } from "convex/values";
import { objectSchema, toJsonSchema } from "./jsonSchema";
import { SERVER_INFO } from "./mcpProtocol";
import { publicUrl } from "./oauthConfig";
import { SCHEMA_DEFS } from "./outputSchemas";
import {
  acceptsDryRun,
  allRoutes,
  API_PREFIX,
  inputFields,
  isToolRoute,
  pathParams,
  toolOf,
  type Route,
} from "./restRoutes";

type Json = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/** docs/schemas definitions point at each other as #/$defs/<name>; here they live in components. */
function relocate(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(relocate);
  if (node === null || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      key === "$ref" && typeof value === "string" ? value.replace("#/$defs/", "#/components/schemas/") : relocate(value),
    ]),
  );
}

const PATH_DOCS: Record<string, string> = {
  taskId: 'The task number (42) or the task id. "#42" works too, written %2342.',
  keyId: "Id of the API key (GET /keys).",
  webhookId: "Id of the webhook (GET /webhooks).",
  approvalId: "Id of the approval request (POST /approvals, GET /approvals).",
};

const RATE_HEADERS = {
  "X-RateLimit-Limit": { $ref: "#/components/headers/X-RateLimit-Limit" },
  "X-RateLimit-Remaining": { $ref: "#/components/headers/X-RateLimit-Remaining" },
  "X-RateLimit-Reset": { $ref: "#/components/headers/X-RateLimit-Reset" },
};

const problemResponse = (description: string) => ({ $ref: `#/components/responses/${description}` });

function parameters(route: Route): Json[] {
  const result: Json[] = pathParams(route.path).map((name) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
    description: PATH_DOCS[name],
  }));
  const query: PropertyValidators = isToolRoute(route) ? (route.input === "query" ? inputFields(route) : {}) : (route.query ?? {});
  const docs = isToolRoute(route) ? toolOf(route).docs : (route.docs ?? {});
  for (const [name, field] of Object.entries(query)) {
    const schema = toJsonSchema(field as GenericValidator);
    result.push({
      name,
      in: "query",
      required: field.isOptional === "required",
      schema,
      ...(schema.type === "array" ? { style: "form", explode: true } : {}),
      ...(docs[name] ? { description: docs[name] } : {}),
    });
  }
  if (acceptsDryRun(route)) {
    result.push({
      name: "dryRun",
      in: "query",
      required: false,
      schema: { type: "boolean" },
      description: "true: check the change and return what it would produce, marked dryRun: true, without saving anything.",
    });
  }
  if (isToolRoute(route)) {
    if ("clientId" in toolOf(route).fields) {
      result.push({
        name: "Idempotency-Key",
        in: "header",
        required: false,
        schema: { type: "string", minLength: 1, maxLength: 128 },
        description: "Unique id of this change (e.g. a UUID), the operation's clientId: repeating it does not apply the change twice.",
      });
    }
    if (route.ifMatch) {
      result.push({
        name: "If-Match",
        in: "header",
        required: false,
        schema: { type: "string" },
        description: "The task's ETag from an earlier answer: the change applies only while the task is at that version (else 412).",
      });
    }
    if (route.etag && route.method === "GET") {
      result.push({ name: "If-None-Match", in: "header", required: false, schema: { type: "string" }, description: "An ETag: 304 while the task is unchanged." });
    }
  }
  return result;
}

function requestBody(route: Route): Json | undefined {
  if (route.method === "GET") return undefined;
  const fields = isToolRoute(route) ? (route.input === "body" ? inputFields(route) : {}) : (route.body ?? {});
  if (Object.keys(fields).length === 0) return undefined;
  const docs = isToolRoute(route) ? toolOf(route).docs : (route.docs ?? {});
  const schema = objectSchema(fields, docs);
  const required = (schema.required as string[]).length > 0;
  const types = route.method === "PATCH" ? ["application/merge-patch+json", "application/json"] : ["application/json"];
  return { required, content: Object.fromEntries(types.map((type) => [type, { schema }])) };
}

function responses(route: Route): Json {
  const output = isToolRoute(route) ? toolOf(route).output : route.response;
  const status = String(route.status ?? 200);
  const headers: Json = { ...RATE_HEADERS };
  if (isToolRoute(route) && route.etag) headers.ETag = { $ref: "#/components/headers/ETag" };
  if (isToolRoute(route) && route.location) headers.Location = { description: "Where the new task is: /api/v1/tasks/<number>", schema: { type: "string" } };
  const result: Json = {
    [status]: { description: "Success", headers, content: { "application/json": { schema: ref(output) } } },
  };
  if (status === "201" && acceptsDryRun(route)) {
    result["200"] = { description: "A dry run: what the change would produce, marked dryRun: true", headers: RATE_HEADERS, content: { "application/json": { schema: ref(output) } } };
  }
  if (isToolRoute(route) && route.etag && route.method === "GET") result["304"] = { description: "Not modified (If-None-Match)" };
  result["401"] = problemResponse("Unauthenticated");
  result["403"] = problemResponse("InsufficientScope");
  if (pathParams(route.path).length) result["404"] = problemResponse("NotFound");
  if (isToolRoute(route) && route.ifMatch) {
    result["409"] = problemResponse("Conflict");
    result["412"] = problemResponse("PreconditionFailed");
  }
  if (route.method !== "GET") result["403"] = problemResponse("Refused");
  result["422"] = problemResponse("InvalidArgument");
  result["429"] = problemResponse("RateLimited");
  result.default = problemResponse("Problem");
  return result;
}

function operation(route: Route): Json {
  const extras: Json = { "x-dayhand-scope": route.scope };
  if (isToolRoute(route)) extras["x-mcp-tool"] = route.tool;
  const description = route.description ?? (isToolRoute(route) ? toolOf(route).description : undefined);
  const body = requestBody(route);
  return {
    operationId: route.operationId,
    summary: route.summary,
    ...(description ? { description } : {}),
    tags: [route.tag],
    parameters: parameters(route),
    ...(body ? { requestBody: body } : {}),
    responses: responses(route),
    ...extras,
  };
}

const problemOf = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ref("problem") } },
});

const DESCRIPTION =
  "Dayhand's REST API for integrations (Shortcuts, n8n, Home Assistant, scripts). Every route runs the same domain operation as the MCP tool named in x-mcp-tool, " +
  "with the same results and error codes. Authenticate with a personal API key (Authorization: Bearer dayhand_…); x-dayhand-scope is the key scope a route needs. " +
  "Guide: docs/api.md in the Dayhand repository.";

/** The whole document; `base` is the deployment's public URL (servers), when known. */
export function openApiDocument(base: string | null = publicUrl()): Json {
  const paths: Record<string, Json> = {};
  for (const route of allRoutes()) {
    const key = route.path;
    paths[key] = { ...(paths[key] ?? {}), [route.method.toLowerCase()]: operation(route) };
  }
  paths["/openapi.json"] = {
    get: {
      operationId: "getOpenApi",
      summary: "This document",
      tags: ["Meta"],
      security: [],
      responses: { "200": { description: "The OpenAPI 3.1 document", content: { "application/json": { schema: { type: "object" } } } } },
    },
  };
  const tags = [...new Set([...allRoutes().map((r) => r.tag), "Meta"])].map((name) => ({ name }));
  return {
    openapi: "3.1.0",
    info: {
      title: "Dayhand API",
      version: SERVER_INFO.version,
      description: DESCRIPTION,
      license: { name: "Apache-2.0", identifier: "Apache-2.0" },
    },
    servers: base ? [{ url: `${base}${API_PREFIX}` }] : [],
    security: [{ apiKey: [] }],
    tags,
    paths,
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", description: "A personal API key (dayhand_…) with the scope the route needs (read < write < full)." },
      },
      schemas: relocate(SCHEMA_DEFS),
      headers: {
        ETag: { description: "Version of the task (changes with every change to it); send it in If-Match", schema: { type: "string" } },
        "X-RateLimit-Limit": { description: "Calls of this kind (reads or changes) the key may make per minute", schema: { type: "integer" } },
        "X-RateLimit-Remaining": { description: "Calls of this kind left in the current minute", schema: { type: "integer" } },
        "X-RateLimit-Reset": { description: "When the current minute ends, Unix seconds", schema: { type: "integer" } },
      },
      responses: {
        Problem: problemOf("An error (problem details, RFC 9457)"),
        Unauthenticated: problemOf("Missing, invalid, expired or revoked API key"),
        InsufficientScope: problemOf("The key's scope does not allow this route"),
        Refused: problemOf(
          "The key's scope does not allow this route (insufficient_scope); or the owner refused the change: agents are paused (agents_paused), only the owner may do this or the owner's policy denies the tool to this key (forbidden), or the policy asks first (approval_required, with the approvalId of the request to wait for)",
        ),
        NotFound: problemOf("No such task, key or webhook"),
        PreconditionFailed: problemOf(
          "If-Match: the task has changed since that version; or the task's state does not allow the change yet (an agent completing a task with unmet acceptance criteria, renewing a claim it does not hold)",
        ),
        Conflict: problemOf("Another agent holds the task's claim (claim_task) until the time the detail names"),
        InvalidArgument: problemOf("Wrong or missing arguments, or a change the task's state does not allow"),
        RateLimited: { ...problemOf("Too many calls with this key; Retry-After says when to try again"), headers: { "Retry-After": { schema: { type: "integer" } } } },
      },
    },
  };
}
