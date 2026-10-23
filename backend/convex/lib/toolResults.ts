// What a domain operation's outcome looks like to a client, shared by the
// MCP endpoint (mcp.ts) and the REST API (rest.ts) so both say the same
// thing: the structured result, and errors safe to show with their code.
import { ConvexError } from "convex/values";
import { DRY_RUN_CODE } from "./args";
import type { ErrorCode } from "./core";

export type ToolErrorCode = ErrorCode | "rate_limited" | "internal";
export type ToolError = { code: ToolErrorCode; message: string; retryAfterMs?: number };

const ERROR_CODES: ToolErrorCode[] = ["invalid_argument", "not_found", "unauthenticated", "precondition_failed"];

/** Error safe to show the caller: domain errors and argument errors, nothing internal. */
export function describeError(error: unknown): ToolError {
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
export function dryRunResult(error: unknown): { result: unknown } | undefined {
  if (!(error instanceof ConvexError)) return undefined;
  const data = error.data as { code?: string; result?: unknown };
  return data?.code === DRY_RUN_CODE ? { result: data.result } : undefined;
}

/** The structured result of an operation: an object as it is, a list or null wrapped as `{ result }`. */
export function structuredResult(value: unknown, dryRun = false): Record<string, unknown> {
  const plain = value !== null && typeof value === "object" && !Array.isArray(value);
  const structured: Record<string, unknown> = { ...(plain ? (value as Record<string, unknown>) : { result: value }) };
  if (dryRun) structured.dryRun = true;
  return structured;
}
