// Today as an agenda in dayhand ui, on the sample day of tests/fixtures/sample-day.ts:
// the screens as text at 80 and 140 columns (tests/screens/), To plan beside the
// agenda or behind l, done folded behind z, what is left without colour, and the
// reads To plan makes.
import { afterEach, describe, expect, test, vi } from "vitest";
import { setLanguage, type Language } from "../src/i18n/index.js";
import { makeApi, type Api } from "../src/ui/api.js";
import { Controller } from "../src/ui/controller.js";
import { derive } from "../src/ui/model.js";
import { rowsText, type Row } from "../src/ui/text.js";
import { SAMPLE_NO_DAY, SAMPLE_NOW, SAMPLE_PROJECTS, SAMPLE_TASKS, SAMPLE_UPCOMING, SAMPLE_VIEW, SAMPLE_ZONE, sampleHealth } from "./fixtures/sample-day.js";

const api: Api = {
  settings: async () => ({ timezone: SAMPLE_ZONE }),
  projects: async () => SAMPLE_PROJECTS,
  today: async () => SAMPLE_VIEW,
  health: async () => sampleHealth(),
  plan: async () => ({ upcoming: SAMPLE_UPCOMING, noDay: SAMPLE_NO_DAY }),
  agents: async () => ({ controls: { paused: false, pausedAt: null, reason: null, policies: [] }, approvals: [], proposals: [] }),
  board: async () => ({ todo: [], doing: [], done: [] }),
  week: async () => [],
  trash: async () => [],
  task: async (id) => ({ task: Object.values(SAMPLE_TASKS).find((t) => t.id === id)!, history: [] }),
  change: async () => ({}) as never,
};

const controllers: Controller[] = [];
async function open(columns: number, rows = 24, language: Language = "en", source: Api = api) {
  setLanguage(language);
  const ui = new Controller({ api: source, view: "today", now: () => SAMPLE_NOW, columns, rows });
  controllers.push(ui);
  await ui.refresh();
  return { ui, text: () => rowsText(ui.frame().rows), selected: () => derive(ui.snapshot()).lists.today[ui.snapshot().ui.cursor.today]?.title };
}

afterEach(() => {
  controllers.splice(0).forEach((ui) => ui.stop());
  setLanguage("en");
});

/** The frame as NO_COLOR paints it: colour and dim dropped, bold, reverse and the rest kept (app.tsx). */
const withoutColour = (rows: Row[]) => rows.map((row) => row.map(({ color: _color, dim: _dim, ...rest }) => rest));

describe("Today as an agenda", () => {
  test.each([
    [80, "en"],
    [140, "en"],
    [80, "pl"],
  ] as const)("%i columns (%s) look like tests/screens", async (columns, language) => {
    const { text } = await open(columns, 24, language);
    await expect(`${text()}\n`).toMatchFileSnapshot(`screens/today-${language}-${columns}.txt`);
  });

  test("narrow: overdue leads the agenda; l shows To plan in its place and h or Esc brings the agenda back", async () => {
    const { ui, text, selected } = await open(80);
    expect(text()).toMatch(/OVERDUE \(1\)\n› +▌ #9 ○ Fri 20 Nov Send the invoice to Anna/);
    expect(text()).toMatch(/TO PLAN \(4\) l →$/m);
    expect(text()).not.toContain("NO DAY");
    ui.key("l");
    expect(text()).toMatch(/← h Today$/m);
    expect(text()).toMatch(/NO DAY \(2\)\n {2}#10 ○ +Idea for a blog post/);
    expect(text()).toMatch(/COMING UP \(1\)\n {2}#12 ○ tomorrow 10:00 Dentist +\+Health/);
    expect(text()).not.toContain("Write the project brief");
    expect(selected()).toBe("Send the invoice to Anna");
    ui.key("j");
    ui.key("j");
    expect(selected()).toBe("Photos for the gallery");
    ui.key("h");
    expect(text()).toContain("Write the project brief");
    expect(selected()).toBe("Send the invoice to Anna");
    ui.key("l");
    ui.key("esc");
    expect(text()).toContain("Write the project brief");
  });

  test("wide: To plan is beside the agenda with the overdue tasks; j walks on into it, h and l jump between the two", async () => {
    const { ui, text, selected } = await open(140);
    expect(text()).not.toContain("l →");
    expect(text()).toMatch(/› +NOW ▌ #1 ◐ Write the project brief/);
    expect(text()).toMatch(/│ {2}OVERDUE \(1\)/);
    ui.key("l");
    expect(selected()).toBe("Send the invoice to Anna");
    ui.key("j");
    expect(selected()).toBe("Idea for a blog post");
    ui.key("h");
    expect(selected()).toBe("Write the project brief");
    ui.key("G");
    expect(selected()).toBe("Dentist");
  });

  test("a click on a task in To plan selects it and a second click opens it, so the hits line up with the column", async () => {
    const { ui, selected } = await open(140);
    const frame = ui.frame();
    const dentist = frame.hits.find((h) => h.target.kind === "task" && rowsText([frame.rows[h.y]!]).includes("Dentist") && h.x0 > 0)!;
    expect(rowsText([frame.rows[dentist.y]!]).slice(dentist.x0)).toMatch(/^ +#12 ○ tomorrow 10:00 Dentist/);
    const click = () => ui.mouse({ button: 0, x: dentist.x0 + 5, y: dentist.y, release: false });
    click();
    expect(selected()).toBe("Dentist");
    click();
    await ui.idle();
    expect(ui.snapshot().ui.detail?.taskId).toBe(SAMPLE_TASKS.dentist.id);
  });

  test("done today is folded; z unfolds it and the cursor reaches its tasks", async () => {
    const { ui, text, selected } = await open(80, 30);
    expect(text()).toMatch(/▸ DONE TODAY \(2\) {2}z$/m);
    expect(text()).not.toContain("Pay the electricity bill");
    ui.key("G");
    expect(selected()).toBe("Buy milk");
    ui.key("z");
    expect(text()).toMatch(/▾ DONE TODAY \(2\) {2}z\n +▌ #7 ✔ Pay the electricity bill/);
    ui.key("G");
    expect(selected()).toBe("Book a haircut");
    ui.key("z");
    expect(text()).not.toContain("Book a haircut");
  });

  test("wide: z keeps the selected task, and folding a selected done task leaves the cursor in the agenda", async () => {
    const { ui, selected } = await open(140, 30);
    ui.key("l");
    expect(selected()).toBe("Send the invoice to Anna");
    ui.key("z");
    expect(selected()).toBe("Send the invoice to Anna");
    ui.key("h");
    for (let i = 0; i < 7; i++) ui.key("j");
    expect(selected()).toBe("Book a haircut");
    ui.key("z");
    expect(selected()).toBe("Buy milk");
  });

  test("a resize across the width where To plan moves beside the agenda keeps the selected task", async () => {
    const { ui, selected } = await open(80);
    expect(selected()).toBe("Send the invoice to Anna");
    ui.resize(140, 24);
    expect(selected()).toBe("Send the invoice to Anna");
    ui.key("h");
    ui.key("j");
    expect(selected()).toBe("Review pull request #42");
    ui.resize(80, 24);
    expect(selected()).toBe("Review pull request #42");
  });

  test("a resize to a narrow terminal shows the panel that holds the selected task", async () => {
    const { ui, text, selected } = await open(140);
    ui.key("l");
    ui.key("j");
    expect(selected()).toBe("Idea for a blog post");
    ui.resize(80, 24);
    expect(selected()).toBe("Idea for a blog post");
    expect(text()).toMatch(/← h Today$/m);
    ui.resize(140, 24);
    ui.key("h");
    ui.key("j");
    expect(selected()).toBe("Review pull request #42");
    ui.resize(80, 24);
    expect(selected()).toBe("Review pull request #42");
    expect(text()).toMatch(/TO PLAN \(4\) l →$/m);
  });

  test("without colour, today is still in reverse, each task keeps its status mark and overdue its heading", async () => {
    const { ui } = await open(80);
    const rows = withoutColour(ui.frame().rows);
    const today = rows.flat().find((part) => part.text === " 22 ");
    expect(today).toMatchObject({ inverse: true, bold: true });
    const text = rowsText(rows);
    expect(text).toMatch(/OVERDUE \(1\)\n.*▌ #9 ○/);
    expect(text).toMatch(/▌ #5 ◐ Ship the release notes/);
    expect(text).toMatch(/Good morning\. 6 on today's plan\. {2}2 at set times · 1 repeating · 1 overdue/);
  });

  test("wide: completing the last open task of the agenda keeps the cursor in the agenda, on the task above", async () => {
    let view = SAMPLE_VIEW;
    const completing: Api = {
      ...api,
      today: async () => view,
      change: (async (_name: string, args: { taskId: string }) => {
        const task = { ...view.today.find((t) => t.id === args.taskId)!, status: "done" as const, completedAt: SAMPLE_NOW };
        view = { ...view, today: view.today.filter((t) => t.id !== task.id), doneToday: [...view.doneToday, task] };
        return { task, next: null };
      }) as Api["change"],
    };
    const { ui, selected } = await open(140, 24, "en", completing);
    for (let i = 0; i < 5; i++) ui.key("j");
    expect(selected()).toBe("Buy milk");
    ui.key("x");
    await ui.idle();
    expect(view.doneToday.map((t) => t.title)).toContain("Buy milk");
    expect(selected()).toBe("Ship the release notes");
  });

  test("To plan says every open task has a day only when the plan has loaded and nothing is due after today", async () => {
    const quiet = { ...SAMPLE_VIEW, overdue: [] };
    const free = "Every open task has a day";
    const withPlan = (plan: Api["plan"]): Api => ({ ...api, today: async () => quiet, plan });
    const unloaded = await open(140, 24, "en", withPlan(async () => Promise.reject(new Error("offline"))));
    expect(unloaded.text()).toMatch(/│ {2}TO PLAN/);
    expect(unloaded.text()).not.toContain(free);
    const later = await open(140, 24, "en", withPlan(async () => ({ upcoming: [SAMPLE_TASKS.passport], noDay: [] })));
    expect(later.text()).not.toContain("Renew the passport");
    expect(later.text()).not.toContain(free);
    const empty = await open(140, 24, "en", withPlan(async () => ({ upcoming: [], noDay: [] })));
    expect(empty.text()).toContain(free);
  });

  test("a short terminal gives the strip of days' rows to the tasks and keeps the sentence on one row", async () => {
    const { text } = await open(80, 16);
    expect(text()).not.toMatch(/Sun Mon Tue/);
    expect(text()).toMatch(/^ Good morning\. 6 on today's plan\..*…$/m);
    expect(text()).toContain("Write the project brief");
  });
});

describe("To plan's reads", () => {
  test("open tasks of the next 14 days, and the pages without a day until the first dated task", async () => {
    const noDay = (n: number) => Array.from({ length: n }, (_, i) => ({ ...SAMPLE_TASKS.blog, id: `n${i}` }));
    const pages = [{ result: noDay(200), nextCursor: "2" }, { result: [...noDay(3), SAMPLE_TASKS.dentist], nextCursor: "3" }];
    const callTool = vi.fn(async (_name: string, args: Record<string, unknown>) => {
      const structured = args.dueAfter ? { result: SAMPLE_UPCOMING, nextCursor: null } : pages[args.cursor ? 1 : 0];
      return { structured, text: "", content: [] };
    });
    const plan = await makeApi({ callTool }).plan("2026-11-22");
    expect(callTool.mock.calls).toEqual([
      ["list_all", { status: ["todo", "doing"], dueAfter: "2026-11-21", dueBefore: "2026-12-06", limit: 200 }],
      ["list_all", { status: ["todo", "doing"], limit: 200 }],
      ["list_all", { status: ["todo", "doing"], limit: 200, cursor: "2" }],
    ]);
    expect(plan.upcoming).toEqual(SAMPLE_UPCOMING);
    expect(plan.noDay).toHaveLength(203);
  });
});
