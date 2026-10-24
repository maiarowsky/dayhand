// dayhand ui without a terminal: quick add, the budget, the line editor, keys,
// lists, the key reducer, and the controller with a fake API (offline,
// limits, the cursor following its task). The screens are checked as text.
import { describe, expect, test } from "vitest";
import { CliError } from "../src/core/exit.js";
import { setLanguage, tIn } from "../src/i18n/index.js";
import type { Board, Detail, Task, TodayView } from "../src/render/model.js";
import { makeApi, retryAfterMs, Throttled, type Api } from "../src/ui/api.js";
import { Budget } from "../src/ui/budget.js";
import { Controller } from "../src/ui/controller.js";
import { handleKey } from "../src/ui/handle.js";
import { chunkKeys, KEY_GROUPS, keyName, keysText } from "../src/ui/keys.js";
import { editLine, insert, line } from "../src/ui/line.js";
import { todaySections, weekDays, weekStart } from "../src/ui/lists.js";
import { derive } from "../src/ui/model.js";
import { parseMove, parseQuickAdd } from "../src/ui/quickadd.js";
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
  return { today: [], board: [[], [], []], week: [[], [], [], [], [], [], []], weekDates: Array.from({ length: 7 }, (_, i) => `2026-10-${19 + i}`), trash: [], date: TODAY, page: 20, ...over };
}

describe("keys → state and effects", () => {
  const a = task("A");
  const b = task("B", { status: "doing" });
  const c = task("C", { status: "done" });
  const base = initialState("today", "2026-10-19");
  const press = (state: UiState, keys: string[], l: Lists) => keys.reduce((r, k) => handleKey(r.state, k, l), { state } as ReturnType<typeof handleKey>);

  test("j/k, G and g move; Tab and 1–4 switch views; q quits", () => {
    const l = lists({ today: [a, b, c] });
    expect(press(base, ["j", "j", "j"], l).state.cursor.today).toBe(2);
    expect(press(base, ["G", "k"], l).state.cursor.today).toBe(1);
    expect(press(base, ["tab"], l).state.view).toBe("board");
    expect(press(base, ["S-tab"], l).state.view).toBe("trash");
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

/** A fake server: a Today view, a board and a week; changes recorded; `down` makes every call fail. */
function fakeApi(today: TodayView, extra: Partial<Api> = {}) {
  const state = { down: false, changes: [] as { tool: string; args: Record<string, unknown> }[], view: today };
  const check = () => {
    if (state.down) throw new CliError("unavailable", "Cannot reach http://127.0.0.1:9 (ECONNREFUSED)", { retryable: true });
  };
  const board: Board = { todo: today.today, doing: today.now ? [today.now] : [], done: today.doneToday };
  const api: Api = {
    settings: async () => (check(), { timezone: "Europe/London" }),
    today: async () => (check(), state.view),
    board: async () => (check(), board),
    week: async () => (check(), [...today.today, ...today.overdue]),
    trash: async () => (check(), []),
    task: async (id) => (check(), { task: [...today.today, ...today.overdue].find((t) => t.id === id)!, history: [{ at: NOW, actor: "agent", actorName: "claude-code", by: "agent: claude-code", action: "update", before: { title: "Old" }, after: { title: "New" } }] } as Detail),
    change: async <T>(tool: string, args: Record<string, unknown>) => {
      check();
      state.changes.push({ tool, args });
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
    for (const [key, marker] of [["2", "TODO (1)"], ["3", "Fri 23"], ["4", "the trash is empty"], ["?", "Keys"]] as const) {
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
      for (const key of ["2", "3", "4", "?"]) {
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
