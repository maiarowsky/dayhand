// Count actual MCP reads through the UI API, with Vitest's clock and sample data only.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Project } from "../src/projects.js";
import type { Task, TodayView } from "../src/render/model.js";
import { makeApi } from "../src/ui/api.js";
import { Controller, DEFAULT_INTERVAL_S } from "../src/ui/controller.js";
import type { ViewName } from "../src/ui/state.js";

const NOW = Date.parse("2026-10-23T10:00:00Z");
const SAMPLE: Task = { id: "sample", ref: 1, title: "Sample task", status: "todo", isNow: false, links: [], createdAt: 1, updatedAt: 1, dueDate: "2026-10-23" };

function server() {
  const state = {
    today: { date: "2026-10-23", timezone: "UTC", now: null, overdue: [], today: [SAMPLE], doneToday: [] } as TodayView,
    detail: { task: SAMPLE, history: [] },
    projects: [] as Project[],
  };
  const empty = { count: 0, tasks: [] };
  const replies: Record<string, Record<string, unknown>> = {
    get_settings: { timezone: "UTC" },
    board: { todo: [SAMPLE], doing: [], done: [] }, list_all: { result: [SAMPLE] }, list_trash: { result: [] },
    get_agent_controls: { paused: false, pausedAt: null, reason: null, policies: [] }, list_approvals: { approvals: [] },
    plan_health: {
      agentsPaused: false, overdue: empty, dueToday: empty, inProgress: empty, expiredClaims: empty, blocked: empty,
      awaitingApproval: { ...empty, pendingApprovals: 0 }, proposals: { count: 0 },
      completedToday: { ...empty, withProof: 0, withoutProof: 0 }, oldestOpen: null,
    },
    complete_task: { task: { ...SAMPLE, status: "done" }, next: null },
  };
  const callTool = vi.fn(async (name: string) => {
    const structured = name === "list_today" ? state.today : name === "get_task" ? state.detail : name === "list_projects" ? { result: state.projects } : replies[name];
    if (!structured) throw new Error(`Unexpected tool: ${name}`);
    // Network responses are separate objects, even when their contents did not change.
    return { structured: structuredClone(structured), text: "", content: [] };
  });
  return { state, callTool, api: makeApi({ callTool }), count: (name: string) => callTool.mock.calls.filter(([tool]) => tool === name).length };
}

const controllers: Controller[] = [];
function open(api: ReturnType<typeof server>["api"], view: ViewName = "today", interval?: number) {
  const ui = new Controller({ api, view, interval });
  controllers.push(ui);
  return ui;
}
const advance = (seconds: number) => vi.advanceTimersByTimeAsync(seconds * 1000);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { controllers.splice(0).forEach((ui) => ui.stop()); vi.useRealTimers(); });

describe("UI polling", () => {
  test.each([
    ["today", ["list_today"]], ["board", ["board"]], ["week", ["list_all"]],
    ["trash", ["list_trash"]], ["agents", ["get_agent_controls", "list_approvals", "list_all"]],
  ] as const)("%s: five ticks read only the current view; Today health on the fifth", async (view, reads) => {
    const s = server();
    const ui = open(s.api, view);
    await ui.start();
    expect(s.count("list_projects")).toBe(1);
    s.callTool.mockClear();
    for (let tick = 1; tick <= 5; tick++) {
      ui.key("j"); // Active user: stay at the base interval without a read on the key itself.
      await advance(60);
      expect(s.count("plan_health")).toBe(view === "today" ? Math.floor(tick / 5) : 0);
    }
    for (const read of reads) expect(s.count(read)).toBe(5);
    expect(s.callTool).toHaveBeenCalledTimes(5 * reads.length + (view === "today" ? 1 : 0));
    expect(s.count("get_settings")).toBe(0);
    expect(s.count("list_projects")).toBe(0);
  });

  test.each([10, 30, 300])("--interval %s is the base; idle intervals double after three ticks, capped at 300", async (base) => {
    const s = server();
    await open(s.api, "today", base).start();
    s.callTool.mockClear();
    let calls = 0;
    for (const delay of [base, base, base, Math.min(base * 2, 300), Math.min(base * 2, 300), Math.min(base * 2, 300), Math.min(base * 4, 300)]) {
      await advance(delay - 1);
      expect(s.count("list_today")).toBe(calls);
      await advance(1);
      expect(s.count("list_today")).toBe(++calls);
    }
  });

  test("an idle first hour has 19 polling reads, versus 900 at the old 12-second cadence", async () => {
    expect(DEFAULT_INTERVAL_S).toBe(60);
    const s = server();
    await open(s.api).start();
    expect(s.callTool).toHaveBeenCalledTimes(4); // settings + projects + Today + health
    s.callTool.mockClear();
    await advance(3600);
    expect(s.count("list_today")).toBe(16);
    expect(s.count("plan_health")).toBe(3);
    expect(s.callTool).toHaveBeenCalledTimes(19);
    // At the cap: five ticks per 25 minutes, each with Today and one extra health read.
    s.callTool.mockClear();
    await advance(1500);
    expect(s.count("list_today")).toBe(5);
    expect(s.count("plan_health")).toBe(1);
    expect(s.callTool).toHaveBeenCalledTimes(6);
  });

  test("changing data keeps Today at 72 polling reads per hour, without project reads", async () => {
    const s = server();
    await open(s.api).start();
    s.callTool.mockClear();
    for (let minute = 1; minute <= 60; minute++) {
      s.state.today = { ...s.state.today, today: [{ ...SAMPLE, title: `Update ${minute}` }] };
      await advance(60);
    }
    expect(s.count("list_today")).toBe(60);
    expect(s.count("plan_health")).toBe(12);
    expect(s.callTool).toHaveBeenCalledTimes(72);
  });

  test("any key resets backoff without a read, and R, a view switch and a mutation read projects immediately", async () => {
    const s = server();
    const ui = open(s.api);
    await ui.start();
    await advance(180); // three unchanged ticks: next delay is 120
    s.callTool.mockClear();
    ui.key("unknown-key");
    expect(s.callTool).not.toHaveBeenCalled();
    await advance(59);
    expect(s.callTool).not.toHaveBeenCalled();
    await advance(1);
    expect(s.count("list_today")).toBe(1);
    ui.key("R");
    await ui.idle();
    expect(s.count("list_projects")).toBe(1);
    expect(s.count("plan_health")).toBe(1);
    ui.key("2");
    await ui.idle();
    expect(s.count("board")).toBe(1);
    expect(s.count("list_projects")).toBe(2);
    ui.key("1");
    await ui.idle();
    expect(s.count("plan_health")).toBe(2);
    expect(s.count("list_projects")).toBe(3);
    ui.key("space");
    await ui.idle();
    expect(s.count("complete_task")).toBe(1);
    expect(s.count("list_projects")).toBe(4);
    expect(s.count("plan_health")).toBe(3);
  });

  test("a project created elsewhere is named after the next tick, then project reads stop", async () => {
    const s = server();
    const ui = open(s.api);
    await ui.start();
    s.callTool.mockClear();
    s.state.projects = [{ id: "groceries", name: "Groceries", position: 1024, archived: false, createdAt: 1, updatedAt: 1 }];
    s.state.today = { ...s.state.today, today: [{ ...SAMPLE, id: "milk", title: "Buy milk", projectId: "groceries" }] };
    await advance(60);
    expect(s.count("list_projects")).toBe(1);
    expect(ui.snapshot().data.today?.today[0]?.project).toBe("Groceries");
    await advance(60);
    expect(s.count("list_today")).toBe(2);
    expect(s.count("list_projects")).toBe(1);
  });

  test("a changed open task resets backoff; closing it stops detail polling", async () => {
    const s = server();
    const ui = open(s.api);
    await ui.start();
    ui.key("enter");
    await ui.idle();
    s.callTool.mockClear();
    await advance(180);
    expect(s.count("get_task")).toBe(3);
    s.state.detail = { ...s.state.detail, task: { ...SAMPLE, note: "New note" } };
    await advance(120);
    expect(s.count("get_task")).toBe(4);
    await advance(60);
    expect(s.count("get_task")).toBe(5);
    expect(s.count("list_projects")).toBe(0);
    ui.key("esc");
    await advance(60);
    expect(s.count("get_task")).toBe(5);
    expect(s.count("list_today")).toBe(6);
  });

  test.each(["get_settings", "list_projects"])("a failed initial %s is retried until the initial cache is filled", async (failed) => {
    const s = server();
    const reply = s.callTool.getMockImplementation()!;
    let fail = true;
    s.callTool.mockImplementation(async (name) => {
      if (name === failed && fail) {
        fail = false;
        throw new Error("Offline");
      }
      return reply(name);
    });
    const ui = open(s.api);
    await ui.start();
    expect(ui.snapshot().data.projects).toBeUndefined();
    await advance(60);
    expect(ui.snapshot().data.projects).toEqual([]);
    expect(ui.snapshot().data.today).toEqual(s.state.today);
    expect(s.count("plan_health")).toBe(1);
    s.callTool.mockClear();
    await advance(60);
    expect(s.callTool.mock.calls).toEqual([["list_today", {}]]);
  });

  test("offline retry text follows the backed-off interval and a key restores it", async () => {
    const s = server();
    s.callTool.mockRejectedValue(new Error("Offline"));
    const ui = open(s.api);
    await ui.start();
    await advance(180);
    expect(ui.snapshot().interval).toBe(120);
    ui.key("j");
    expect(ui.snapshot().interval).toBe(60);
  });

  test("slow reads never overlap ticks; a key during the read preserves the base interval; stop cancels polling", async () => {
    const s = server();
    const ui = open(s.api);
    await ui.start();
    await advance(120);
    let release!: () => void;
    s.callTool.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ structured: s.state.today, text: "", content: [] });
    }));
    s.callTool.mockClear();
    await advance(60);
    expect(s.callTool).toHaveBeenCalledTimes(1);
    ui.key("j");
    await advance(300);
    expect(s.callTool).toHaveBeenCalledTimes(1);
    release();
    await advance(0);
    await advance(60);
    expect(s.count("list_today")).toBe(2);
    ui.stop();
    await advance(3600);
    expect(s.count("list_today")).toBe(2);
  });
});
