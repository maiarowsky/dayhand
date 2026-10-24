import { readFileSync, readdirSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { renderDocs } from "../src/docs.js";
import { agentCommands } from "../src/registry/agents.js";
import type { RunContext } from "../src/registry/types.js";
import { DayhandClient } from "../src/transport/client.js";

const schemaDirectory = new URL("../../docs/schemas/", import.meta.url);
const ajv = new Ajv2020({ strict: true, allErrors: true });
for (const file of readdirSync(schemaDirectory).filter((name) => name.endsWith(".schema.json"))) {
  ajv.addSchema(JSON.parse(readFileSync(new URL(file, schemaDirectory), "utf8")));
}

const today = { date: "2026-10-24", timezone: "UTC", now: null, overdue: [], today: [], doneToday: [] };
const empty = { count: 0, items: [] };
const brief = {
  ...today,
  at: Date.parse("2026-10-24T12:00:00Z"),
  caller: { type: "agent", name: "worker" },
  agentsPaused: false,
  pausedReason: null,
  policies: [],
  claims: { active: empty, expired: empty },
  approvals: { pending: empty, decided: empty },
  ready: empty,
  nextSteps: [],
};

const validator = (file: string) => ajv.getSchema(`https://schemas.dayhand.invalid/${file}`)!;

describe("prime JSON contract", () => {
  test.each([false, true])("the actual output matches a schema advertised in the generated command reference (legacy=%s)", async (legacy) => {
    const calls: string[] = [];
    const expected = legacy ? today : brief;
    const fetchImpl: typeof fetch = async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      expect(request.method).toBe("tools/call");
      calls.push(request.params.name);
      if (legacy && request.params.name === "agent_brief") {
        return Response.json({ jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "Unknown tool: agent_brief" } });
      }
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { structuredContent: expected, content: [{ type: "text", text: JSON.stringify(expected) }] } });
    };
    const client = new DayhandClient({ url: "https://dayhand.test", key: "test-key" }, fetchImpl);
    const ctx = { client: async () => client, format: "json" } as unknown as RunContext;
    const outcome = await agentCommands[0]!.run!(ctx, {}, {});
    expect(outcome.value).toEqual(expected);
    expect(calls).toEqual(legacy ? ["agent_brief", "list_today"] : ["agent_brief"]);
    const row = renderDocs().split("\n").find((line) => line.startsWith("| `dayhand prime` |"))!;
    const schemas = [...row.matchAll(/\]\(schemas\/([\w.-]+)\)/g)].map((match) => match[1]!);
    expect(schemas).toEqual(["agent-brief.schema.json", "today.schema.json"]);
    expect(schemas.some((file) => validator(file)(outcome.value))).toBe(true);
    expect(validator("agent-brief.schema.json")(brief)).toBe(true);
    expect(validator("agent-brief.schema.json")(today)).toBe(false);
  });
});
