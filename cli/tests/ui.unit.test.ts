// dayhand ui without a terminal: quick add, the budget, the line editor, keys,
// lists, the key reducer, and the controller with a fake API (offline,
// limits, the cursor following its task). The screens are checked as text.
import { describe, expect, test } from "vitest";
import { CliError } from "../src/core/exit.js";
import { setLanguage, tIn } from "../src/i18n/index.js";
import type { Board, Detail, Task, TodayView } from "../src/render/model.js";
import { makeApi, retryAfterMs, Throttled, type Api } from "../src/ui/api.js";
import { Budget } from "../src/ui/budget.js";
import type { Agents, Approval, Health, WorkTask } from "../src/ui/agents.js";
import { Controller } from "../src/ui/controller.js";
import { handleKey } from "../src/ui/handle.js";
import { chunkKeys, KEY_GROUPS, keyName, keysText } from "../src/ui/keys.js";
import { editLine, insert, line } from "../src/ui/line.js";
import { todaySections, weekDays, weekStart } from "../src/ui/lists.js";
import { derive } from "../src/ui/model.js";
import { parseMove, parseQuickAdd } from "../src/ui/quickadd.js";
import { detailRows } from "../src/ui/screens/detail.js";
import { initialState, type Lists, type UiState } from "../src/ui/state.js";
import { cut, fitRow, rowWidth, rowsText, seg, windowStart } from "../src/ui/text.js";
import { TOPICS } from "../src/topics.js";

// Friday 23 October 2026, 11:00 in London.
const NOW = Date.parse("2026-10-23T10:00:00Z");
const ZONE = { now: NOW, timezone: "Europe/London" };
const TODAY = "2026-10-23";

let nextRef = 1;
function task(title: string, fields: Partial<Task> = {}): Task {
  const ref = fields.ref ?? nextRef++;
  return { id: `t${ref}`, ref, title, status: "todo", isNow: false, labels: [], links: [], createdAt: ref, updatedAt: ref, ...fields };
}

function health(fields: Partial<Health> = {}): Health {
  const empty = () => ({ count: 0, tasks: [] });
  return {
    agentsPaused: false, overdue: empty(), dueToday: empty(), inProgress: empty(), expiredClaims: empty(), blocked: empty(),
    awaitingApproval: { ...empty(), pendingApprovals: 0 }, proposals: { count: 0 },
    completedToday: { ...empty(), withProof: 0, withoutProof: 0 }, oldestOpen: null, ...fields,
  };
}

function approval(fields: Partial<Approval> = {}): Approval {
  return {
    id: "request-1", ref: 42, taskTitle: "Release the demo", action: "Deploy the demo", detail: "The checks passed",
    options: [{ id: "ship", label: "Deploy now", consequence: "The demo becomes public" }, { id: "later", label: "Wait", consequence: "Nothing changes" }],
    reversible: false, status: "pending", expiresAt: NOW + 86_400_000, requestedBy: { type: "agent", name: "demo-agent" }, source: "agent", tool: null, decision: null, ...fields,
  };
}

const emptyAgents = (): Agents => ({ controls: { paused: false, pausedAt: null, reason: null, policies: [] }, approvals: [], proposals: [] });

describe("quick add", () => {
  test("a date phrase at the end, #labels anywhere", () => {
    expect(parseQuickAdd("Call the accountant fri 2pm #home", ZONE)).toEqual({
      title: "Call the accountant",
      labels: ["home"],
      due: { date: "2026-10-30", time: "14:00" },
      phrase: "fri 2pm",
    });
    expect(parseQuickAdd("#work Draft the invoice tomorrow", ZONE)).toMatchObject({ title: "Draft the invoice", labels: ["work"], due: { date: "2026-10-24" } });
  });

  test("a phrase at the start; the longest phrase wins; one word stays the title", () => {
    expect(parseQuickAdd("tomorrow at 9am call mom", ZONE)).toMatchObject({ title: "call mom", due: { date: "2026-10-24", time: "09:00" } });
    expect(parseQuickAdd("Pay rent in 3 days", ZONE)).toMatchObject({ title: "Pay rent", due: { date: "2026-10-26" } });
    expect(parseQuickAdd("tomorrow", ZONE)).toMatchObject({ title: "tomorrow", due: undefined });
  });

  test("no phrase: the caller's day; numbers are not dates; quotes and 'no date'", () => {
    expect(parseQuickAdd("Buy 2 apples", ZONE)).toEqual({ title: "Buy 2 apples", labels: [], due: undefined });
    expect(parseQuickAdd('"Meet on fri"', ZONE)).toEqual({ title: "Meet on fri", labels: [], due: undefined });
    expect(parseQuickAdd("Read a book no date", ZONE)).toMatchObject({ title: "Read a book", due: null });
    expect(parseQuickAdd("Fix #42 bug", ZONE).title).toBe("Fix #42 bug");
  });

  test("move: a phrase, none, or not understood", () => {
    expect(parseMove("next mon 9am", ZONE)).toEqual({ date: "2026-10-26", time: "09:00" });
    expect(parseMove("none", ZONE)).toBeNull();
    expect(parseMove("someday", ZONE)).toBeUndefined();
  });
});

describe("budget", () => {
  test("a sliding minute: full, then free again; a pause from the server", () => {
    let now = 0;
    const budget = new Budget(2, () => now);
    expect([budget.take(), budget.take(), budget.take()]).toEqual([true, true, false]);
    expect(budget.waitMs()).toBe(60_000);
    now = 60_001;
    expect(budget.take()).toBe(true);
    budget.pause(5_000);
    expect(budget.take()).toBe(false);
    expect(budget.waitMs()).toBe(5_000);
  });

  test("the api counts reads and changes apart, keeps one clientId through retries, and pauses on rate_limited", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    let failures = 2;
    const client = {
      callTool: async (name: string, args: Record<string, unknown> = {}) => {
        calls.push({ name, args });
        if (name === "add_task" && failures-- > 0) throw new CliError("unavailable", "Cannot reach x (ECONNRESET)", { retryable: true });
        if (name === "board") throw new CliError("rate_limited", "Too many reads; try again in 7 s");
        return { structured: { ok: true }, text: "", content: [] };
      },
    };
    const reads = new Budget(1);
    const api = makeApi(client, { reads, changes: new Budget(5), sleep: async () => {} });
    await api.today();
    await expect(api.today()).rejects.toBeInstanceOf(Throttled);
    await api.change("add_task", { title: "A" });
    const adds = calls.filter((c) => c.name === "add_task");
    expect(adds).toHaveLength(3);
    expect(new Set(adds.map((c) => c.args.clientId)).size).toBe(1);
    expect(retryAfterMs(new CliError("rate_limited", "Too many; try again in 12 s"))).toBe(12_000);
  });
});

test("agent reads and changes use existing MCP schemas, budgets and proposal pagination", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const request = approval();
  const proposed = task("Demo proposal", { proposedAt: NOW });
  const report = health({ proposals: { count: 1 } });
  const client = {
    callTool: async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      const value = name === "plan_health" ? report : name === "get_agent_controls" ? emptyAgents().controls
        : name === "list_approvals" ? { approvals: [request] }
        : name === "list_all" ? (args.cursor ? { result: [proposed], nextCursor: null } : { result: [], nextCursor: "page2" }) : {};
      return { structured: value as unknown as Record<string, unknown>, text: "", content: [] };
    },
  };
  const api = makeApi(client);
  expect(await api.health()).toEqual(report);
  expect(await api.agents()).toEqual({ controls: emptyAgents().controls, approvals: [request], proposals: [proposed] });
  expect(calls).toContainEqual({ name: "list_approvals", args: { status: "pending", limit: 200 } });
  expect(calls).toContainEqual({ name: "list_all", args: { proposed: true, limit: 200, cursor: "page2" } });
  await api.change("pause_agents", { paused: true });
  await api.change("decide_approval", { approvalId: request.id, optionId: "later" });
  await api.change("accept_proposal", { taskId: proposed.id });
  expect(calls).toContainEqual({ name: "pause_agents", args: { paused: true } });
  expect(calls).toContainEqual({ name: "decide_approval", args: { approvalId: request.id, optionId: "later" } });
  expect(calls.at(-1)).toEqual({ name: "accept_proposal", args: { taskId: proposed.id, clientId: expect.any(String) } });
});

describe("line editor and keys", () => {
  test("typing, cursor moves, deleting words and ends", () => {
    let l = line("Call mom");
    l = editLine(l, "C-a")!;
    l = insert(l, "Please ");
    expect(l).toEqual({ text: "Please Call mom", cursor: 7 });
    l = editLine(editLine(l, "C-e")!, "C-w")!;
    expect(l.text).toBe("Please Call ");
    l = editLine(editLine(l, "left")!, "C-k")!;
    expect(l.text).toBe("Please Call");
    expect(editLine(l, "backspace")!.text).toBe("Please Cal");
    expect(editLine(l, "C-u")!.text).toBe("");
    expect(editLine(l, "enter")).toBeUndefined();
    expect(insert(l, "a\nb\u0007").text).toBe("Please Calla b");
  });

  test("key names, typed chunks, and the key map in dayhand help ui", () => {
    const none = { upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, pageDown: false, pageUp: false, home: false, end: false, return: false, escape: false, ctrl: false, shift: false, tab: false, backspace: false, delete: false, meta: false, super: false, hyper: false, capsLock: false, numLock: false };
    expect(keyName("j", none)).toBe("j");
    expect(keyName("", { ...none, tab: true, shift: true })).toBe("S-tab");
    expect(keyName("d", { ...none, ctrl: true })).toBe("C-d");
    expect(keyName("", { ...none, delete: true })).toBe("backspace");
    expect(keyName(" ", none)).toBe("space");
    expect(chunkKeys("aB c\t\u0015")).toEqual(["a", "B", "space", "c", "tab", "C-u"]);
    expect(TOPICS.ui).toContain(keysText());
    for (const group of KEY_GROUPS) expect(keysText()).toContain(`${tIn("en", group.title)}:`);
    expect(TOPICS.ui).toContain("Backlog.md");
  });

  test("text fits by display width", () => {
    expect(cut("Call the accountant", 8)).toBe("Call th…");
    expect(rowsText([fitRow([seg("日本語のタスク")], 7)])).toBe("日本語…");
    expect(windowStart(100, 50, 10)).toBe(45);
    expect(windowStart(5, 4, 10)).toBe(0);
  });
});

describe("lists", () => {
  test("Today: the now task leads and is not repeated; the filter narrows", () => {
    const now = task("Invoice", { isNow: true, status: "doing", resumeNote: "rate in mail", labels: ["work"] });
    const view: TodayView = { date: TODAY, timezone: "Europe/London", now, overdue: [task("Rent", { dueDate: "2026-10-22", overdue: true })], today: [now, task("Plan")], doneToday: [] };
    expect(todaySections(view).map((s) => [s.key, s.tasks.map((t) => t.title)])).toEqual([
      ["now", ["Invoice"]],
      ["overdue", ["Rent"]],
      ["today", ["Plan"]],
    ]);
    // Empty sections go, except Today, which says "no match".
    expect(todaySections(view, "#work").map((s) => [s.key, s.tasks.length, s.empty])).toEqual([
      ["now", 1, undefined],
      ["today", 0, "no match"],
    ]);
  });

  test("the week starts on Monday; open before done, untimed before timed", () => {
    expect(weekStart(TODAY)).toBe("2026-10-19");
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    const tasks = [task("late", { dueDate: TODAY, dueTime: "18:00" }), task("done", { dueDate: TODAY, status: "done" }), task("any time", { dueDate: TODAY }), task("early", { dueDate: TODAY, dueTime: "08:00" })];
    const days = weekDays("2026-10-19", tasks, TODAY);
    expect(days).toHaveLength(7);
    expect(days[4]!.isToday).toBe(true);
    expect(days[4]!.tasks.map((t) => t.title)).toEqual(["any time", "early", "late", "done"]);
  });
});

function lists(over: Partial<Lists> = {}): Lists {
  return { today: [], board: [[], [], []], week: [[], [], [], [], [], [], []], weekDates: Array.from({ length: 7 }, (_, i) => `2026-10-${19 + i}`), trash: [], agents: [], date: TODAY, page: 20, ...over };
}

describe("keys → state and effects", () => {
  const a = task("A");
  const b = task("B", { status: "doing" });
  const c = task("C", { status: "done" });
  const base = initialState("today", "2026-10-19");
  const press = (state: UiState, keys: string[], l: Lists) => keys.reduce((r, k) => handleKey(r.state, k, l), { state } as ReturnType<typeof handleKey>);

  test("j/k, G and g move; Tab and 1–5 switch views; q quits", () => {
    const l = lists({ today: [a, b, c] });
    expect(press(base, ["j", "j", "j"], l).state.cursor.today).toBe(2);
    expect(press(base, ["G", "k"], l).state.cursor.today).toBe(1);
    expect(press(base, ["tab"], l).state.view).toBe("board");
    expect(press(base, ["S-tab"], l).state.view).toBe("agents");
    expect(press(base, ["5"], l)).toMatchObject({ state: { view: "agents" }, effect: { kind: "refresh" } });
    expect(press(base, ["3"], l)).toMatchObject({ state: { view: "week" }, effect: { kind: "refresh" } });
    expect(handleKey(base, "q", l).effect).toEqual({ kind: "quit" });
  });

  test("space completes or reopens, s starts or stops, Enter opens details, q closes them", () => {
    const l = lists({ today: [a, b, c] });
    expect(handleKey(base, "space", l).effect).toEqual({ kind: "complete", task: a });
    expect(press(base, ["j", "s"], l).effect).toEqual({ kind: "stop", task: b });
    expect(press(base, ["G", "x"], l).effect).toEqual({ kind: "reopen", task: c });
    const open = handleKey(base, "enter", l);
    expect(open).toMatchObject({ state: { detail: { taskId: a.id } }, effect: { kind: "detail", taskId: a.id } });
    expect(handleKey(open.state, "q", { ...l, detail: a }).state.detail).toBeUndefined();
  });

  test("a opens quick add for the selected week day; Enter adds", () => {
    const week = { ...base, view: "week" as const, cursor: { ...base.cursor, weekDay: 2 } };
    const typed = press(week, ["a", "C", "a", "l", "l"], lists());
    expect(typed.state.mode).toMatchObject({ kind: "prompt", prompt: "add", line: { text: "Call" }, date: "2026-10-21" });
    expect(handleKey(typed.state, "enter", lists()).effect).toEqual({ kind: "add", text: "Call", date: "2026-10-21" });
    expect(handleKey(typed.state, "esc", lists()).state.mode.kind).toBe("normal");
  });

  test("week: j runs on into the next day; H/L move the task a day; [ ] and t change the week", () => {
    const l = lists({ week: [[a], [], [b, c], [], [], [], []] });
    const week = { ...base, view: "week" as const };
    expect(press(week, ["j"], l).state.cursor).toMatchObject({ weekDay: 1, weekRow: 0 });
    expect(press(week, ["j", "j", "j"], l).state.cursor).toMatchObject({ weekDay: 2, weekRow: 1 });
    expect(handleKey(week, "L", lists({ week: [[{ ...a, dueDate: "2026-10-19" }], [], [], [], [], [], []] })).effect).toMatchObject({ kind: "shift", days: 1 });
    expect(handleKey(week, "[", l).state.weekStart).toBe("2026-10-12");
    expect(press(week, ["]", "]", "t"], l).state).toMatchObject({ weekStart: "2026-10-19", cursor: { weekDay: 4 } });
  });

  test("board: h/l columns, L moves to the next column (done completes)", () => {
    const l = lists({ board: [[a], [b], [c]] });
    const board = { ...base, view: "board" as const };
    expect(handleKey(board, "L", l).effect).toEqual({ kind: "status", task: a, to: "doing" });
    expect(press(board, ["l", "L"], l).effect).toEqual({ kind: "status", task: b, to: "done" });
    expect(press(board, ["l", "l", "l"], l).state.cursor.boardColumn).toBe(2);
    expect(press(board, ["l", "a"], l).state.mode).toMatchObject({ kind: "prompt", status: "doing" });
  });

  test("d asks first; y deletes and u restores; the filter narrows as it is typed", () => {
    const l = lists({ today: [a] });
    const asked = handleKey(base, "d", l);
    expect(asked.state.mode.kind).toBe("confirm");
    expect(handleKey(asked.state, "n", l).effect).toEqual({ kind: "flash", text: "Kept" });
    const deleted = handleKey(asked.state, "y", l);
    expect(deleted.effect).toEqual({ kind: "delete", taskId: a.id, label: `#${a.ref} A` });
    expect(handleKey(deleted.state, "u", l).effect).toEqual({ kind: "undo", taskId: a.id });
    expect(press(base, ["/", "r", "e"], l).state.filter).toBe("re");
    expect(press(base, ["/", "r", "esc"], l).state.filter).toBe("");
  });

  test("the edit form sends only changed fields; the trash allows only restore", () => {
    const l = lists({ today: [{ ...a, labels: ["home"] }] });
    const form = press(base, ["e", "C-e", "!", "tab", "tab", "C-u", "w", "o", "r", "k"], l);
    expect(handleKey(form.state, "enter", l).effect).toMatchObject({ kind: "edit", changes: { title: "A!", labels: "work" } });
    const gone = { ...a, deletedAt: 1 };
    const trash = { ...base, view: "trash" as const };
    expect(handleKey(trash, "space", lists({ trash: [gone] })).effect).toEqual({ kind: "flash", text: "In the trash: r restores it" });
    expect(handleKey(trash, "r", lists({ trash: [gone] })).effect).toEqual({ kind: "restore", task: gone });
  });
});

describe("agent screens and decisions", () => {
  const view: TodayView = { date: TODAY, timezone: ZONE.timezone, now: null, overdue: [], today: [], doneToday: [] };

  test("Today puts one coloured health line above the task sections and keeps mouse targets aligned", async () => {
    const planned = task("A planned task");
    const { api, state } = fakeApi({ ...view, today: [planned] });
    const ui = new Controller({ api, view: "today", now: () => NOW, columns: 100, rows: 24 });
    for (const [report, colour, text] of [
      [health(), "green", "Due today: 0 · In progress: 0 · Done today: 0"],
      [health({ proposals: { count: 2 } }), "yellow", "Proposals in the inbox: 2"],
      [health({ overdue: { count: 1, tasks: [] } }), "red", "Overdue: 1"],
      [health({ blocked: { count: 1, tasks: [] } }), "red", "Blocked: 1"],
      [health({ expiredClaims: { count: 1, tasks: [] } }), "red", "Claims run out: 1"],
      [health({ agentsPaused: true }), "yellow", "Agents are paused"],
      [health({ awaitingApproval: { count: 0, tasks: [], pendingApprovals: 1 } }), "yellow", "Approval requests pending: 1"],
      [health({ completedToday: { count: 1, tasks: [], withProof: 0, withoutProof: 1 } }), "yellow", "Done without proof: 1"],
    ] as const) {
      state.health = report;
      await ui.refresh();
      const row = ui.frame().rows[2]!;
      expect(rowsText([row])).toContain(text);
      expect(row[0]?.color).toBe(colour);
      expect(rowsText(ui.frame().rows).indexOf(text)).toBeLessThan(rowsText(ui.frame().rows).indexOf("TODAY (1)"));
    }
    const target = ui.frame().hits.find((h) => h.target.kind === "task")!;
    expect(rowsText([ui.frame().rows[target.y]!])).toContain("A planned task");
    ui.mouse({ button: 0, x: target.x0, y: target.y, release: false });
    await ui.idle();
    expect(ui.snapshot().ui.detail?.taskId).toBe(planned.id);
    ui.stop();
  });

  test("approval digits do not save, Esc backs out, and polling cannot retarget a captured choice", async () => {
    const request = approval();
    const { api, state } = fakeApi(view);
    state.agents = { ...emptyAgents(), approvals: [request] };
    const ui = new Controller({ api, view: "today", now: () => NOW, columns: 100, rows: 24 });
    await ui.refresh();
    ui.key("5");
    await ui.idle();
    const screen = rowsText(ui.frame().rows);
    for (const heading of ["5 Agents", "PAUSE", "APPROVAL REQUESTS (1)", "PROPOSALS (0)"]) expect(screen).toContain(heading);
    ui.key("enter");
    expect(rowsText(ui.frame().rows)).toContain("1. Deploy now");
    expect(rowsText(ui.frame().rows)).toContain("The demo becomes public");
    ui.key("enter");
    ui.key("4"); // There is no fourth option.
    expect(ui.snapshot().ui.mode).not.toHaveProperty("optionId");
    ui.key("1");
    expect(rowsText(ui.frame().rows)).toContain("Record this decision?");
    expect(state.changes).toHaveLength(0);
    ui.key("esc");
    expect(ui.snapshot().ui.mode).toMatchObject({ kind: "approval", optionId: undefined });
    ui.key("esc");
    expect(ui.snapshot().ui.mode.kind).toBe("normal");
    ui.key("enter");
    // Another request arrives while this one is open, with different option IDs.
    state.agents = { ...state.agents, approvals: [approval({ id: "request-2", options: [{ id: "wrong", label: "Another choice", consequence: null }] })] };
    await ui.refresh();
    ui.key("2");
    expect(ui.snapshot().ui.view).toBe("agents");
    expect(state.changes).toHaveLength(0);
    expect(rowsText(ui.frame().rows)).toContain("2. Wait");
    ui.key("enter");
    await ui.idle();
    expect(state.changes).toEqual([{ tool: "decide_approval", args: { approvalId: request.id, optionId: "later" } }]);
    expect(rowsText(ui.frame().rows)).toContain("Decision recorded: Wait");
    ui.stop();
  });

  test("the confirmation shows the selected option before a long request detail and scrolls both ways", async () => {
    const { api, state } = fakeApi(view);
    state.agents.approvals = [approval({ detail: "More context\n".repeat(40) })];
    const ui = new Controller({ api, view: "agents", now: () => NOW, columns: 50, rows: 16 });
    await ui.refresh();
    ui.key("enter");
    ui.key("G");
    expect(rowsText(ui.frame().rows)).toContain("2. Wait");
    ui.key("2");
    expect(rowsText(ui.frame().rows)).toContain("2. Wait");
    ui.key("G");
    const atBottom = ui.snapshot().ui.mode;
    ui.key("k");
    const above = ui.snapshot().ui.mode;
    expect(atBottom.kind === "approval" && above.kind === "approval" && above.scroll === atBottom.scroll - 1).toBe(true);
    ui.key("esc");
    ui.key("esc");
    expect(state.changes).toHaveLength(0);
    ui.stop();
  });

  test.each([false, true])("A accepts a proposal from the list or details (details=%s) and it joins Today", async (detail) => {
    const proposed = task("Proposed demo task", { proposedAt: NOW });
    const { api, state } = fakeApi(view);
    state.agents.proposals = [proposed];
    const ui = new Controller({ api, view: "agents", now: () => NOW, columns: 100, rows: 24 });
    await ui.refresh();
    if (detail) {
      ui.key("enter");
      await ui.idle();
      expect(ui.snapshot().ui.detail?.taskId).toBe(proposed.id);
    }
    ui.key("A");
    await ui.idle();
    expect(state.changes).toEqual([{ tool: "accept_proposal", args: { taskId: proposed.id } }]);
    expect(rowsText(ui.frame().rows)).toContain(`Accepted #${proposed.ref} Proposed demo task`);
    expect(rowsText(ui.frame().rows)).toContain("PROPOSALS (0)");
    expect(ui.snapshot().ui.detail).toBeUndefined();
    ui.key("1");
    await ui.idle();
    expect(ui.selected()).toMatchObject({ id: proposed.id, title: proposed.title });
    expect(ui.selected()?.proposedAt).toBeUndefined();
    ui.stop();
  });

  test("p toggles pause and X requires a reason, supports cancel, and rejects only the selected proposal", async () => {
    const proposed = task("Not this quarter", { proposedAt: NOW });
    const { api, state } = fakeApi(view);
    state.agents.proposals = [proposed];
    const ui = new Controller({ api, view: "agents", now: () => NOW, columns: 100, rows: 24 });
    await ui.refresh();
    ui.key("p");
    await ui.idle();
    expect(rowsText(ui.frame().rows)).toContain("Agents are paused · p resumes");
    ui.key("p");
    await ui.idle();
    expect(rowsText(ui.frame().rows)).toContain("Agents can make changes · p pauses");
    ui.key("X");
    ui.key("enter");
    expect(rowsText(ui.frame().rows)).toContain("A reason is required");
    expect(state.changes.map((c) => c.tool)).toEqual(["pause_agents", "pause_agents"]);
    ui.key("esc");
    ui.key("X");
    ui.paste("Not in scope");
    ui.key("enter");
    await ui.idle();
    expect(state.changes).toEqual([
      { tool: "pause_agents", args: { paused: true } }, { tool: "pause_agents", args: { paused: false } },
      { tool: "reject_proposal", args: { taskId: proposed.id, reason: "Not in scope" } },
    ]);
    expect(rowsText(ui.frame().rows)).toContain("PROPOSALS (0)");
    ui.stop();
  });

  test("details include claims, met and unmet criteria, a wrapped plan, proof, dependencies and blocking", () => {
    const work = task("Work item", {
      claimedBy: { name: "demo-agent" }, claimExpiresAt: NOW - 1,
      acceptance: [{ id: "one", text: "Portable build", met: true }, { id: "two", text: "Ship the demo", met: false }],
      plan: "First build\nThen test the demo", dependsOn: ["task-to-finish"], blockedReason: "Waiting for the test rig",
      proof: { summary: "Build verified", links: [{ url: "https://example.com/proof", title: "Build log" }], checks: [{ name: "unit tests", result: "pass" }, { name: "live demo", result: "fail" }] },
    }) as WorkTask;
    const rows = detailRows({ task: work, history: [] }, TODAY, ZONE.timezone, 100, NOW);
    const text = rowsText(rows);
    for (const value of ["claimed by", "demo-agent", "claim expired", "criteria", "[x] Portable build", "[ ] Ship the demo", "plan", "First build", "Then test the demo", "proof", "Build log <https://example.com/proof>", "pass: unit tests", "fail: live demo", "waits for", "task-to-finish", "blocked", "Waiting for the test rig"]) expect(text).toContain(value);
    for (const row of detailRows({ task: { ...work, plan: "日本語の作業計画".repeat(20) }, history: [] }, TODAY, ZONE.timezone, 40, NOW)) expect(rowWidth(row)).toBeLessThanOrEqual(40);
  });
});

/** A fake server: a Today view, a board and a week; changes recorded; `down` makes every call fail. */
function fakeApi(today: TodayView, extra: Partial<Api> = {}) {
  const state = { down: false, changes: [] as { tool: string; args: Record<string, unknown> }[], view: today, health: health(), agents: emptyAgents() };
  const check = () => {
    if (state.down) throw new CliError("unavailable", "Cannot reach http://127.0.0.1:9 (ECONNREFUSED)", { retryable: true });
  };
  const board: Board = { todo: today.today, doing: today.now ? [today.now] : [], done: today.doneToday };
  const api: Api = {
    settings: async () => (check(), { timezone: "Europe/London" }),
    projects: async () => (check(), []),
    today: async () => (check(), state.view),
    health: async () => (check(), state.health),
    agents: async () => (check(), state.agents),
    board: async () => (check(), board),
    week: async () => (check(), [...today.today, ...today.overdue]),
    trash: async () => (check(), []),
    task: async (id) => (check(), { task: [...today.today, ...today.overdue, ...state.agents.proposals].find((t) => t.id === id)!, history: [{ at: NOW, actor: "agent", actorName: "claude-code", by: "agent: claude-code", action: "update", before: { title: "Old" }, after: { title: "New" } }] } as Detail),
    change: async <T>(tool: string, args: Record<string, unknown>) => {
      check();
      state.changes.push({ tool, args });
      if (tool === "pause_agents") state.agents = { ...state.agents, controls: { ...state.agents.controls, paused: Boolean(args.paused) } };
      if (tool === "decide_approval") state.agents = { ...state.agents, approvals: state.agents.approvals.filter((a) => a.id !== args.approvalId) };
      if (tool === "accept_proposal" || tool === "reject_proposal") {
        const proposal = state.agents.proposals.find((t) => t.id === args.taskId)!;
        state.agents = { ...state.agents, proposals: state.agents.proposals.filter((t) => t.id !== args.taskId) };
        const accepted = { ...proposal };
        delete accepted.proposedAt;
        if (tool === "accept_proposal") state.view = { ...state.view, today: [...state.view.today, accepted] };
        return accepted as T;
      }
      return { task: today.today[0], next: null, ...today.today[0] } as T;
    },
    ...extra,
  };
  return { api, state };
}

describe("controller", () => {
  const plan = task("Plan the week", { dueDate: TODAY, dueTime: "09:00" });
  const rent = task("Pay rent", { dueDate: "2026-10-22", overdue: true, labels: ["home"] });
  const view: TodayView = { date: TODAY, timezone: "Europe/London", now: null, overdue: [rent], today: [plan], doneToday: [] };

  test("loads Today, keeps the data and says why when the server goes away, and recovers", async () => {
    const { api, state } = fakeApi(view);
    const ui = new Controller({ api, view: "today", now: () => NOW, columns: 80, rows: 16 });
    await ui.refresh();
    const text = () => rowsText(ui.frame().rows);
    expect(text()).toContain("Today, Fri 23 Oct 2026 · Europe/London");
    expect(text()).toMatch(/OVERDUE \(1\)\n› #\d+ ○ yesterday Pay rent +#home/);
    state.down = true;
    await ui.refresh();
    expect(text()).toContain("● offline");
    expect(text()).toContain("Cannot reach http://127.0.0.1:9 (ECONNREFUSED) · showing data from 11:00");
    expect(text()).toContain("Pay rent");
    state.down = false;
    await ui.refresh();
    expect(text()).toContain("● 11:00");
    ui.stop();
  });

  test("a quick add sends add_task with the phrase resolved and labels; the details name the agent", async () => {
    const { api, state } = fakeApi(view);
    const ui = new Controller({ api, view: "today", now: () => NOW, columns: 100, rows: 24 });
    await ui.refresh();
    for (const key of ["a", ..."Call the accountant fri 2pm #home"].map((k) => (k === " " ? "space" : k))) ui.key(key);
    expect(rowsText(ui.frame().rows)).toContain("Add: Call the accountant fri 2pm #home   → Fri 30 Oct 14:00 #home");
    ui.key("enter");
    await ui.idle();
    expect(state.changes).toEqual([{ tool: "add_task", args: { title: "Call the accountant", dueDate: "2026-10-30", dueTime: "14:00", labels: ["home"] } }]);
    ui.key("j");
    ui.key("enter");
    await ui.idle();
    const detail = rowsText(ui.frame().rows);
    expect(detail).toContain("changed   agent: claude-code");
    expect(detail).toMatch(/agent: claude-code +changed +title: "Old" → "New"/);
    ui.stop();
  });

  test("a change's message shows only with the refreshed list, so the next key acts on what it says", async () => {
    const waiting: (() => void)[] = [];
    const { api, state } = fakeApi(view, {
      // Today answers only when the test lets it, after the projects, as a slower read would.
      today: () => new Promise((resolve) => waiting.push(() => resolve(state.view))),
    });
    const answerToday = async () => {
      while (waiting.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
      waiting.shift()!();
    };
    const ui = new Controller({ api, view: "today", now: () => NOW, columns: 100, rows: 24 });
    const first = ui.refresh();
    await answerToday();
    await first;
    const stale: string[] = [];
    ui.subscribe(() => {
      const text = rowsText(ui.frame().rows);
      if (text.includes("to the trash · u undoes") && text.includes("OVERDUE (1)")) stale.push(text);
    });
    ui.key("d");
    state.view = { ...view, overdue: [] };
    ui.key("y");
    await answerToday();
    await ui.idle();
    expect(rowsText(ui.frame().rows)).toContain("to the trash · u undoes");
    expect(stale).toEqual([]);
    ui.stop();
  });

  test("a change's message waits for a read that started before the change, and then for a fresh read", async () => {
    let holding = false;
    let release: (() => void) | undefined;
    const { api, state } = fakeApi(view, {
      // A held read answers with the list as it was when it started, as a read before the change would.
      today: () => {
        const value = state.view;
        if (!holding) return Promise.resolve(value);
        holding = false;
        return new Promise((resolve) => (release = () => resolve(value)));
      },
    });
    const ui = new Controller({ api, view: "today", now: () => NOW, columns: 100, rows: 24 });
    await ui.refresh();
    const stale: string[] = [];
    ui.subscribe(() => {
      const text = rowsText(ui.frame().rows);
      if (text.includes("to the trash · u undoes") && text.includes("OVERDUE (1)")) stale.push(text);
    });
    ui.key("d");
    holding = true;
    const inflight = ui.refresh();
    state.view = { ...view, overdue: [] };
    ui.key("y");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.changes).toHaveLength(1);
    release!();
    await inflight;
    await ui.idle();
    const text = rowsText(ui.frame().rows);
    expect(text).toContain("to the trash · u undoes");
    expect(text).not.toContain("OVERDUE (1)");
    expect(stale).toEqual([]);
    ui.stop();
  });

  test("the cursor follows its task when a refresh moves it; a too small terminal says so", async () => {
    const { api, state } = fakeApi(view);
    const ui = new Controller({ api, view: "today", now: () => NOW, columns: 80, rows: 16 });
    await ui.refresh();
    ui.key("j");
    expect(ui.selected()?.title).toBe("Plan the week");
    state.view = { ...view, overdue: [task("New overdue", { dueDate: "2026-10-20" }), rent] };
    await ui.refresh();
    expect(ui.selected()?.title).toBe("Plan the week");
    ui.resize(30, 8);
    expect(rowsText(ui.frame().rows)).toBe("Terminal too small\nnow 30×8, needs 40×10\nq quits");
    ui.stop();
  });

  test("the UI's own budget stops polling before the server's limit and says it is waiting", async () => {
    const { api } = fakeApi(view);
    const reads = new Budget(2);
    const limited = { ...api, today: async () => (reads.take() ? view : Promise.reject(new Throttled(reads.waitMs()))) };
    const ui = new Controller({ api: limited, view: "today", now: () => NOW, columns: 80, rows: 16 });
    await ui.refresh();
    await ui.refresh();
    await ui.refresh();
    expect(rowsText(ui.frame().rows)).toMatch(/● waiting[\s\S]*Waiting 60 s to stay under the server's limits/);
    ui.stop();
  });

  test("every view renders at 100×24 and at 50×16 (the week as bars without titles)", async () => {
    const { api } = fakeApi(view);
    const ui = new Controller({ api, view: "today", now: () => NOW, columns: 100, rows: 24 });
    for (const [key, marker] of [["2", "TODO (1)"], ["3", "Fri 23"], ["4", "the trash is empty"], ["5", "APPROVAL REQUESTS (0)"], ["?", "Keys"]] as const) {
      ui.key(key);
      await ui.refresh();
      expect(rowsText(ui.frame().rows), key).toContain(marker);
    }
    ui.key("esc");
    ui.key("3");
    await ui.refresh();
    ui.resize(50, 16);
    const narrow = rowsText(ui.frame().rows);
    expect(narrow).toContain("█");
    expect(narrow).toContain("Fri 23 Oct 2026 · today · 1 task");
    expect(derive(ui.snapshot()).lists.week[4]).toHaveLength(1);
    ui.stop();
  });

  test("the screens switch language and stay inside the terminal; the key map in dayhand help ui stays English", async () => {
    const { api } = fakeApi(view);
    const ui = new Controller({ api, view: "today", now: () => NOW, columns: 80, rows: 16 });
    await ui.refresh();
    try {
      setLanguage("pl");
      const polish = rowsText(ui.frame().rows);
      expect(polish).toContain("Dzisiaj, pt., 23 paź 2026 · Europe/London");
      expect(polish).toMatch(/ZALEGŁE \(1\)\n› #\d+ ○ wczoraj Pay rent +#home/);
      expect(polish).toContain("? pomoc");
      setLanguage("ja");
      for (const key of ["2", "3", "4", "5", "?"]) {
        ui.key(key);
        await ui.refresh();
        for (const row of ui.frame().rows) expect(rowWidth(row), key).toBeLessThanOrEqual(80);
      }
      expect(rowsText(ui.frame().rows)).toContain("キー");
      expect(keysText()).toContain("Next / previous task");
      setLanguage("en");
      ui.key("esc");
      ui.key("?");
      expect(rowsText(ui.frame().rows)).toContain("Keys");
    } finally {
      setLanguage("en");
      ui.stop();
    }
  });
});
