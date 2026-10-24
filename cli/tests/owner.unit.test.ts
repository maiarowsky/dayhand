// Pure parts of the owner's commands: --option, --expires, --source, the
// proposal fields of add, and the text of approvals, controls and health.
import { describe, expect, test } from "vitest";
import {
  approvalText,
  controlsText,
  healthText,
  parseMinutes,
  parseOption,
  parseSource,
  proposalArgs,
  type Approval,
  type Health,
} from "../src/registry/owner.js";

describe("dayhand ask", () => {
  test("--option is a label, optionally followed by its consequence", () => {
    expect(parseOption("Yes")).toEqual({ label: "Yes" });
    expect(parseOption(" Deploy now : live in 10 minutes ")).toEqual({ label: "Deploy now", consequence: "live in 10 minutes" });
    expect(parseOption("Read: see https://example.com/runbook")).toEqual({ label: "Read", consequence: "see https://example.com/runbook" });
    expect(parseOption("Hold:")).toEqual({ label: "Hold" });
    expect(() => parseOption(": no label")).toThrow(/needs a label/);
  });

  test("--expires takes minutes, 30m, 2h or 1d", () => {
    expect(parseMinutes("90")).toBe(90);
    expect(parseMinutes("30m")).toBe(30);
    expect(parseMinutes("2H")).toBe(120);
    expect(parseMinutes("1d")).toBe(1440);
    for (const bad of ["", "soon", "2w", "-5", "1.5h"]) expect(() => parseMinutes(bad)).toThrow(/--expires/);
  });

  const approval: Approval = {
    id: "ap1",
    ref: 4,
    taskTitle: "Release 2.4",
    action: "Deploy 2.4",
    detail: "Tests passed",
    options: [{ id: "o1", label: "Deploy", consequence: "live now" }, { id: "o2", label: "Wait" }],
    reversible: false,
    status: "decided",
    expiresAt: Date.parse("2026-10-24T14:00:00Z"),
    requestedBy: { type: "agent", name: "claude" },
    decision: { optionId: "o2", label: "Wait", note: "Monday", decidedAt: Date.parse("2026-10-24T12:00:00Z") },
  } as unknown as Approval;

  test("a request prints the task, the options with consequences and the decision", () => {
    const text = approvalText(approval, "UTC");
    expect(text).toContain("Deploy 2.4  (#4 Release 2.4)");
    expect(text).toContain("ap1  decided  asked by claude");
    expect(text).toContain("o1: Deploy - live now");
    expect(text).toContain("o2: Wait\n");
    expect(text).toContain("cannot be undone");
    expect(text).toMatch(/decided o2 \(Wait\) on .*: Monday/);
  });
});

describe("dayhand add --propose", () => {
  test("--source is kind:ref with an optional URL", () => {
    expect(parseSource("email:m-1")).toEqual({ kind: "email", ref: "m-1" });
    expect(parseSource("sentry:CHECKOUT-42 https://sentry.example/i/42")).toEqual({ kind: "sentry", ref: "CHECKOUT-42", url: "https://sentry.example/i/42" });
    for (const bad of ["no-colon", ":ref", "kind:", "a:b c d"]) expect(() => parseSource(bad)).toThrow(/--source/);
  });

  test("the proposal fields are added only when given", () => {
    const plain: Record<string, unknown> = { title: "x" };
    proposalArgs({}, plain);
    expect(plain).toEqual({ title: "x" });
    const proposal: Record<string, unknown> = { title: "x" };
    proposalArgs({ propose: true, source: "gh:12", requestedBy: "Ann", returnTo: "wh1" }, proposal);
    expect(proposal).toEqual({ title: "x", proposal: true, source: { kind: "gh", ref: "12" }, requestedBy: "Ann", returnTo: "wh1" });
  });
});

describe("dayhand agents, policy and health", () => {
  test("controls say whether agents run and list the rules", () => {
    expect(controlsText({ paused: false, pausedAt: null, reason: null, policies: [] })).toBe("Agents run.\nTool policies: none (every tool allowed)");
    const paused = controlsText(
      { paused: true, pausedAt: Date.parse("2026-10-24T12:00:00Z"), reason: "lunch", policies: [{ keyId: "k1", keyName: "worker", tool: "*", rule: "ask" }] },
      "UTC",
    );
    expect(paused).toMatch(/^Agents are paused since .* \(lunch\): they read, their changes are refused\./);
    expect(paused).toContain("  worker  *  ask  (key k1)");
  });

  test("health prints each section's count and its tasks", () => {
    const none = { count: 0, tasks: [] };
    const health = {
      agentsPaused: true,
      overdue: { count: 1, tasks: [{ ref: 2, title: "Pay rent", dueDate: "2026-10-20" }] },
      dueToday: none,
      inProgress: { count: 1, tasks: [{ ref: 3, title: "Fix login", dueDate: null, workingBy: "agent: claude" }] },
      expiredClaims: none,
      blocked: { count: 1, tasks: [{ ref: 5, title: "Ship", dueDate: null, reasons: ["waiting for #3 Fix login"] }] },
      awaitingApproval: { ...none, pendingApprovals: 2 },
      proposals: { count: 4 },
      completedToday: { count: 3, tasks: [], withProof: 2, withoutProof: 1 },
      oldestOpen: { ref: 2, title: "Pay rent", dueDate: "2026-10-20", ageDays: 9 },
    } as unknown as Health;
    expect(healthText(health).split("\n")).toEqual([
      "Agents are paused (dayhand agents resume).",
      "Overdue: 1",
      "  #2 Pay rent  (due 2026-10-20)",
      "Due today: 0",
      "In progress: 1",
      "  #3 Fix login  (agent: claude)",
      "Claims run out: 0",
      "Blocked: 1",
      "  #5 Ship  (waiting for #3 Fix login)",
      "Waiting for approval: 0",
      "Approval requests pending: 2",
      "Proposals in the inbox: 4",
      "Done today: 3 (2 with proof, 1 without)",
      "Oldest open: #2 Pay rent, 9 days",
    ]);
  });
});
