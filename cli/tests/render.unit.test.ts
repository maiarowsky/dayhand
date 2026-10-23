// Human output: alignment by display width, cutting to the terminal, colors,
// relative days and the board's columns. No backend.
import { describe, expect, test } from "vitest";
import { relativeDate } from "../src/render/format.js";
import type { Task } from "../src/render/model.js";
import { makeStyle } from "../src/render/style.js";
import { cellOf, table, truncate } from "../src/render/table.js";
import { renderHuman, renderDryRun } from "../src/render/views.js";
import stringWidth from "string-width";

const ANSI = /\u001b\[/;
const TODAY = "2026-10-22";

let ref = 0;
const task = (title: string, extra: Partial<Task> = {}): Task => ({
  id: `id${++ref}`,
  ref,
  title,
  status: "todo",
  isNow: false,
  labels: [],
  links: [],
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

describe("table", () => {
  test("columns line up by display width, not string length", () => {
    const lines = table([
      [cellOf("#1"), cellOf("Zadzwonić do księgowej"), cellOf("x")],
      [cellOf("#2"), cellOf("会议 准备"), cellOf("y")],
      [cellOf("#10"), cellOf("👍 ok"), cellOf("z")],
    ]);
    const columnOfLast = lines.map((l) => stringWidth(l.slice(0, l.lastIndexOf(" ") + 1)));
    expect(new Set(columnOfLast).size).toBe(1);
    expect(lines[0]).toBe("  #1   Zadzwonić do księgowej  x");
  });

  test("only the flexible column is cut, with …, and only when a width is given", () => {
    const rows = [[cellOf("#1"), cellOf("A rather long task title that goes on"), cellOf("#home")]];
    expect(table(rows, { flex: 1 })[0]).toBe("  #1  A rather long task title that goes on  #home");
    const cut = table(rows, { flex: 1, width: 30 })[0]!;
    expect(stringWidth(cut)).toBeLessThanOrEqual(30);
    expect(cut).toBe("  #1  A rather long ta…  #home");
    expect(truncate("会议准备会议准备", 7)).toBe("会议准…");
  });

  test("empty trailing cells leave no trailing spaces", () => {
    expect(table([[cellOf("#1"), cellOf("A"), cellOf("")], [cellOf("#2"), cellOf("B"), cellOf("#x")]])).toEqual(["  #1  A", "  #2  B  #x"]);
  });
});

test("relative days", () => {
  expect(relativeDate("2026-10-22", TODAY)).toBe("today");
  expect(relativeDate("2026-10-23", TODAY)).toBe("tomorrow");
  expect(relativeDate("2026-10-21", TODAY)).toBe("yesterday");
  expect(relativeDate("2026-10-30", TODAY)).toBe("Fri 30 Oct");
  expect(relativeDate("2027-01-04", TODAY)).toBe("Mon 4 Jan 2027");
  expect(relativeDate("2026-10-30")).toBe("2026-10-30");
});

describe("task lists", () => {
  const tasks = [
    task("Pay rent", { dueDate: "2026-10-21", overdue: true, labels: ["home"] }),
    task("Call the bank", { dueDate: TODAY, dueTime: "18:00", status: "doing", isNow: true }),
    task("Plan the trip", { dueDate: "2026-10-30", repeat: { every: "week", interval: 1 } }),
  ];
  const view = { kind: "tasks" as const, tasks };

  test("without colors: plain, aligned text with relative days", () => {
    const text = renderHuman(view, {}, undefined, { style: makeStyle(false), today: TODAY });
    expect(text).not.toMatch(ANSI);
    expect(text.split("\n")).toEqual([
      expect.stringMatching(/^ {2}#\d +\[ \] {2}yesterday {4}Pay rent {7}#home overdue$/),
      expect.stringMatching(/^ {2}#\d +\[~\] {2}today 18:00 {2}Call the bank {2}now$/),
      expect.stringMatching(/^ {2}#\d +\[ \] {2}Fri 30 Oct {3}Plan the trip {2}↻$/),
    ]);
  });

  test("with colors: the same text plus color codes", () => {
    const colored = renderHuman(view, {}, undefined, { style: makeStyle(true), today: TODAY });
    expect(colored).toMatch(ANSI);
    expect(colored.replace(/\u001b\[[0-9;]*m/g, "")).toBe(renderHuman(view, {}, undefined, { style: makeStyle(false), today: TODAY }));
  });

  test("an empty filtered list says so", () => {
    expect(renderHuman({ kind: "tasks", tasks: [], empty: "no tasks match" }, {})).toBe("(no tasks match)");
  });
});

describe("board", () => {
  const sections = [
    { name: "todo", label: "TODO", tasks: [task("Write the report"), task("Plan")], count: true, empty: "empty" },
    { name: "doing", label: "DOING", tasks: [task("Call", { status: "doing" })], count: true, empty: "empty" },
    { name: "done", label: "DONE", tasks: [], count: true, empty: "empty" },
  ];

  test("side by side on a wide terminal", () => {
    const text = renderHuman({ kind: "sections", columns: true, sections }, {}, undefined, { style: makeStyle(false), width: 100, today: TODAY });
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^TODO \(2\) +DOING \(1\) +DONE \(0\)$/);
    expect(lines[1]).toMatch(/^#\d+ Write the report +#\d+ Call +\(empty\)$/);
    expect(Math.max(...lines.map((l) => stringWidth(l)))).toBeLessThanOrEqual(100);
  });

  test("stacked in a pipe or on a narrow terminal", () => {
    const text = renderHuman({ kind: "sections", columns: true, sections }, {}, undefined, { style: makeStyle(false), today: TODAY });
    expect(text.split("\n").filter((l) => !l.startsWith(" "))).toEqual(["TODO (2)", "DOING (1)", "DONE (0)"]);
    expect(text).toContain("  (empty)");
  });
});

test("dry run lists the held changes", () => {
  const held = [{ tool: "add_task", arguments: { title: "A", dueDate: "2026-10-23" } }, { endpoint: "/devices/revoke", body: { deviceId: "d1" } }];
  expect(renderDryRun(held, "human")).toBe(
    'Dry run: nothing was changed. Would call:\n  add_task {"title":"A","dueDate":"2026-10-23"}\n  POST /devices/revoke {"deviceId":"d1"}',
  );
  const checked = [{ tool: "complete_task", arguments: { taskId: "#4" }, result: { task: { ref: 4, title: "Pay", status: "done" }, next: null, dryRun: true } }];
  expect(renderDryRun(checked as never, "human")).toBe('Dry run: nothing was changed. Would call:\n  complete_task {"taskId":"#4"}\n    → #4 Pay (done)');
  expect(renderDryRun(held, "plain")).toBe('add_task\t{"title":"A","dueDate":"2026-10-23"}\nPOST /devices/revoke\t{"deviceId":"d1"}');
});
