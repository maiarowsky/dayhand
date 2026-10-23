// Errors of the REST API as problem details (RFC 9457, application/problem+json).
// `code` is the same code an MCP tool error carries (docs/mcp.md#errors), so a
// client handles both surfaces alike. `type` names the code; it is an
// identifier, not an address to fetch (like the $id of docs/schemas).
import type { ToolErrorCode } from "./toolResults";

export type ProblemCode = ToolErrorCode | "insufficient_scope" | "method_not_allowed" | "unsupported_media_type" | "payload_too_large";

export const PROBLEM_TYPE_BASE = "https://schemas.helm.invalid/problems/";

const TITLES: Record<ProblemCode, string> = {
  invalid_argument: "Invalid argument",
  not_found: "Not found",
  unauthenticated: "Unauthenticated",
  precondition_failed: "Precondition failed",
  rate_limited: "Too many requests",
  internal: "Internal error",
  insufficient_scope: "Insufficient scope",
  method_not_allowed: "Method not allowed",
  unsupported_media_type: "Unsupported media type",
  payload_too_large: "Payload too large",
};

/** The HTTP status of a domain or tool error code. */
export const STATUS_OF: Record<ToolErrorCode, number> = {
  invalid_argument: 422,
  not_found: 404,
  unauthenticated: 401,
  precondition_failed: 412,
  rate_limited: 429,
  internal: 500,
};

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: ProblemCode;
  retryAfterMs?: number;
};

export function problemBody(status: number, code: ProblemCode, detail: string, extra: { retryAfterMs?: number } = {}): Problem {
  return { type: PROBLEM_TYPE_BASE + code, title: TITLES[code], status, detail, code, ...extra };
}

export function problem(
  status: number,
  code: ProblemCode,
  detail: string,
  headers: Record<string, string> = {},
  extra: { retryAfterMs?: number } = {},
): Response {
  return new Response(JSON.stringify(problemBody(status, code, detail, extra)), {
    status,
    headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store", ...headers },
  });
}
