import { describe, expect, test } from "vitest";
import { CliError } from "../src/core/exit.js";
import { DayhandClient } from "../src/transport/client.js";

async function refused(status: number, payload: unknown): Promise<CliError> {
  const client = new DayhandClient({ url: "https://dayhand.test", key: "test-key" }, async () => Response.json(payload, { status }), []);
  try {
    await client.request("POST", "/api/v1/import/backlog?dryRun=true", { files: [] });
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    return error;
  }
  throw new Error("Expected the REST preview to be refused");
}

describe("HTTP error decoding for REST previews", () => {
  test.each(["agents_paused", "forbidden"] as const)("HTTP 403 preserves %s and its message without key-scope advice", async (code) => {
    const message = "The owner refused this change";
    for (const payload of [
      { code, detail: message },
      { error: code, error_description: message },
      { code, error: { message } },
    ]) {
      const error = await refused(403, payload);
      expect(error).toMatchObject({ code, message, exitCode: 7 });
      expect(error.details).toEqual({});
    }
    const fallback = await refused(403, { code });
    expect(fallback).toMatchObject({ code, exitCode: 7 });
    expect(fallback.message).toContain("HTTP 403");
    expect(fallback.details).toEqual({});
  });

  test.each(["insufficient_scope", "approval_required", "invalid_argument", "conflict", "precondition_failed", "unauthenticated", "rate_limited", "internal", "unknown", null])("other HTTP 403 codes retain the existing authentication mapping: %s", async (code) => {
    const error = await refused(403, { code, detail: "Original refusal" });
    expect(error).toMatchObject({ code: "unauthenticated", message: "Original refusal", exitCode: 3 });
    expect(error.details.hint).toBe("use a key with scope full (dayhand key list shows each key's scope)");
  });

  test("an unrecognized nested error code keeps its existing mapping", async () => {
    const error = await refused(403, { error: { code: "forbidden", message: "Nested refusal" } });
    expect(error).toMatchObject({ code: "unauthenticated", message: "Nested refusal", exitCode: 3 });
    expect(error.details.hint).toContain("scope full");
  });

  test.each([
    [400, "invalid_argument", 2],
    [401, "unauthenticated", 3],
    [404, "internal", 1],
    [413, "invalid_argument", 2],
    [415, "invalid_argument", 2],
    [418, "internal", 1],
    [422, "invalid_argument", 2],
    [429, "rate_limited", 5],
    [500, "unavailable", 5],
  ] as const)("HTTP %s retains its existing mapping to %s", async (status, expected, exitCode) => {
    for (const code of ["agents_paused", "forbidden"]) {
      expect(await refused(status, { code, detail: "Original refusal" })).toMatchObject({ code: expected, exitCode });
    }
  });

  test.each([400, 403, 404, 422])("not_found keeps its existing precedence for HTTP %s", async (status) => {
    expect(await refused(status, { code: "not_found", detail: "Missing task" })).toMatchObject({ code: "not_found", message: "Missing task", exitCode: 4 });
  });
});
