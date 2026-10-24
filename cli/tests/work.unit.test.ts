// Pure parts of the agent work commands: --since, --check and the proof,
// editing acceptance criteria, and the log's text.
import { describe, expect, test } from "vitest";
import type { RunContext } from "../src/registry/types.js";
import { criteriaText, editCriteria, logText, parseCheck, proofInput, sinceArg } from "../src/registry/work.js";

const NOW = Date.parse("2026-10-24T12:00:00Z");
// Only the date phrase path reads the context; it reads it like dayhand when.
const ctx = {
  when: async (text: string) => {
    if (text !== "yesterday 09:00") throw new Error(`unexpected phrase ${text}`);
    return { date: "2026-10-23", time: "09:00" };
  },
  zone: async () => "Europe/Warsaw",
} as unknown as RunContext;

describe("dayhand log --since", () => {
  test("cursors, Unix milliseconds and ISO times pass through", async () => {
    for (const value of ["c1793011200000123", "0", "1793011200000", "2026-10-24T08:00:00Z"]) {
      expect(await sinceArg(ctx, value, NOW)).toBe(value);
    }
  });
  test("a time ago and a date phrase in the user's zone become Unix milliseconds", async () => {
    expect(await sinceArg(ctx, "30m", NOW)).toBe(String(NOW - 30 * 60_000));
    expect(await sinceArg(ctx, "2h", NOW)).toBe(String(NOW - 2 * 3_600_000));
    expect(await sinceArg(ctx, "3d", NOW)).toBe(String(NOW - 3 * 86_400_000));
    expect(await sinceArg(ctx, "yesterday 09:00", NOW)).toBe(String(Date.parse("2026-10-23T07:00:00Z")));
  });
});

describe("dayhand done proof", () => {
  test("--check reads name=result and an optional URL", () => {
    expect(parseCheck("unit tests=pass")).toEqual({ name: "unit tests", result: "pass" });
    expect(parseCheck("CI=FAIL https://ci.example/7")).toEqual({ name: "CI", result: "fail", url: "https://ci.example/7" });
    expect(() => parseCheck("tests passed")).toThrow(/--check takes/);
  });
  test("no proof options, no proof; otherwise only the parts given", () => {
    expect(proofInput({ check: [], proofLink: [] })).toBeUndefined();
    expect(proofInput({ summary: "Shipped", check: ["lint=pass"], proofLink: ["https://example.com/pr/7 PR"] })).toEqual({
      summary: "Shipped",
      checks: [{ name: "lint", result: "pass" }],
      links: [{ url: "https://example.com/pr/7", title: "PR" }],
    });
  });
});

describe("dayhand criteria", () => {
  const items = [
    { id: "a1", text: "Tests pass", met: false },
    { id: "a2", text: "Docs updated", met: true },
    { id: "a3", text: "Released", met: false },
  ];
  const none = { add: [], met: [], unmet: [], rm: [] };

  test("marks, removes and adds in that order, keeping ids", () => {
    expect(editCriteria(items, { ...none, met: ["1"], unmet: ["2"], rm: ["3"], add: ["Announced"] })).toEqual([
      { id: "a1", text: "Tests pass", met: true },
      { id: "a2", text: "Docs updated", met: false },
      { text: "Announced" },
    ]);
    expect(editCriteria(items, { ...none, met: ["all"] }).every((item) => item.met)).toBe(true);
    expect(() => editCriteria([], { ...none, met: ["1"] })).toThrow("The task has no acceptance criteria");
  });

  test("prints the criteria numbered, with how many are met", () => {
    const task = { id: "t", ref: 42, title: "Ship", status: "todo", isNow: false, labels: [], links: [], createdAt: 0, updatedAt: 0, acceptance: items } as const;
    expect(criteriaText(task as never)).toBe("#42 Ship (1/3 met)\n  1. [ ] Tests pass\n  2. [x] Docs updated\n  3. [ ] Released");
    expect(criteriaText({ ...task, acceptance: undefined } as never)).toBe("#42 Ship: (no acceptance criteria)");
  });
});

describe("dayhand log text", () => {
  test("one line per change, then how to continue", () => {
    const event = { id: "e", at: Date.parse("2026-10-24T08:05:00Z"), taskId: "t", ref: 7, title: "Bins", action: "update", by: "agent: helper", before: { note: null }, after: { note: "glass" } };
    expect(logText({ events: [event], nextCursor: "c9", hasMore: false }, "UTC")).toBe(
      '2026-10-24 08:05  #7 Bins  update by agent: helper  note: null → "glass"\nnext time: dayhand log --since c9',
    );
    expect(logText({ events: [], nextCursor: "c9", hasMore: true }, "UTC")).toBe("(no changes)\nmore: dayhand log --since c9");
  });
});
