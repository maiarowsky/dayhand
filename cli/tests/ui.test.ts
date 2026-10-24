// dayhand ui driven by keys and clicks on a real pseudo-terminal, against the local
// backend: every change is checked through dayhand --json afterwards. node-pty ships
// prebuilt binaries for macOS and Windows only; elsewhere these tests are skipped.
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createKey, dayhand, helm, dayhandJson, newUser, TEST_HOME } from "./helpers.js";
import { loadPty, uiSession, type UiSession } from "./screen.js";
import { DayhandClient } from "../src/transport/client.js";
import { makeApi } from "../src/ui/api.js";
import { Controller } from "../src/ui/controller.js";
import { rowsText } from "../src/ui/text.js";

const pty = loadPty();
const sessions: UiSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.kill();
});

function open(key: string, args: string[] = [], size?: { columns: number; rows: number }, env: Record<string, string> = {}) {
  const session = uiSession(
    pty!,
    args,
    {
      PATH: process.env.PATH ?? "",
      DAYHAND_CONFIG_DIR: join(TEST_HOME, "ui-config"),
      DAYHAND_CACHE_DIR: join(TEST_HOME, "ui-cache"),
      DAYHAND_CREDENTIAL_STORE: "file",
      DAYHAND_URL: helm().siteUrl,
      DAYHAND_API_KEY: key,
      ...env,
    },
    size,
  );
  sessions.push(session);
  return session;
}

/** Where `text` is on the screen (column and row from 0). */
function locate(screen: string, text: string) {
  const lines = screen.split("\n");
  const y = lines.findIndex((l) => l.includes(text));
  if (y < 0) throw new Error(`${text} is not on the screen:\n${screen}`);
  return { x: lines[y]!.indexOf(text), y };
}

const show = (key: string, ref: number) => dayhandJson(key, ["show", String(ref)]);

// These controller tests always use the real backend, including Linux without node-pty.
describe("agent UI with the local backend", () => {
  test("a request is decided only after opening, choosing a digit and confirming; p toggles agent pause", async () => {
    const { key, userId } = await newUser();
    const agent = (await createKey(userId, "demo-agent", "agent")).key;
    const request = await dayhandJson(agent, ["ask", "Deploy the demo", "--option", "Deploy now: The demo becomes public", "--option", "Wait: Nothing changes"]);
    const ui = new Controller({ api: makeApi(new DayhandClient({ url: helm().siteUrl, key })), view: "today", columns: 100, rows: 24 });
    try {
      await ui.refresh();
      expect(rowsText(ui.frame().rows)).toContain("Approval requests pending: 1");
      expect(ui.frame().rows[2]?.[0]?.color).toBe("yellow");
      ui.key("5");
      await ui.idle();
      expect(rowsText(ui.frame().rows)).toContain("APPROVAL REQUESTS (1)");
      ui.key("enter");
      expect(rowsText(ui.frame().rows)).toContain("The demo becomes public");
      ui.key("2");
      expect((await dayhandJson(key, ["approval", request.id])).status).toBe("pending");
      ui.key("esc");
      ui.key("esc");
      expect((await dayhandJson(key, ["approval", request.id])).status).toBe("pending");
      ui.key("enter");
      ui.key("1");
      expect(rowsText(ui.frame().rows)).toContain("Record this decision?");
      expect((await dayhandJson(key, ["approval", request.id])).status).toBe("pending");
      ui.key("enter");
      await ui.idle();
      const decided = await dayhandJson(agent, ["approval", request.id]);
      expect(decided).toMatchObject({ status: "decided", decision: { optionId: request.options[0].id, label: "Deploy now" } });
      expect(rowsText(ui.frame().rows)).toContain("APPROVAL REQUESTS (0)");
      ui.key("p");
      await ui.idle();
      expect((await dayhandJson(key, ["agents"])).paused).toBe(true);
      expect(rowsText(ui.frame().rows)).toContain("Agents are paused · p resumes");
      ui.key("p");
      await ui.idle();
      expect((await dayhandJson(key, ["agents"])).paused).toBe(false);
    } finally {
      ui.stop();
    }
  });

  test("A accepts a proposal into Today; X rejects another only with a nonempty reason", async () => {
    const { key, userId } = await newUser();
    const agent = (await createKey(userId, "demo-agent", "agent")).key;
    const proposal = await dayhandJson(agent, ["add", "Prepare the demo", "--propose", "--requested-by", "demo customer"]);
    const rejected = await dayhandJson(agent, ["add", "Unrelated work", "--propose"]);
    expect((await dayhandJson(key, ["today"])).today).toHaveLength(0);
    const ui = new Controller({ api: makeApi(new DayhandClient({ url: helm().siteUrl, key })), view: "agents", columns: 100, rows: 24 });
    try {
      await ui.refresh();
      expect(rowsText(ui.frame().rows)).toContain("PROPOSALS (2)");
      ui.key("/");
      ui.paste("Prepare the demo");
      ui.key("enter");
      expect(ui.selected()?.id).toBe(proposal.id);
      ui.key("enter");
      await ui.idle();
      expect(rowsText(ui.frame().rows)).toContain("A accept");
      ui.key("A");
      await ui.idle();
      expect((await show(key, proposal.ref)).task.proposedAt).toBeUndefined();
      expect((await dayhandJson(key, ["today"])).today).toEqual([expect.objectContaining({ id: proposal.id })]);
      ui.key("esc"); // Clear the filter.
      ui.key("X");
      ui.key("enter");
      await ui.idle();
      expect((await show(key, rejected.ref)).task.deletedAt).toBeUndefined();
      ui.paste("Outside this demo");
      ui.key("enter");
      await ui.idle();
      expect((await show(key, rejected.ref)).task.deletedAt).toEqual(expect.any(Number));
      expect(rowsText(ui.frame().rows)).toContain("PROPOSALS (0)");
      ui.key("1");
      await ui.idle();
      expect(rowsText(ui.frame().rows)).toContain("Prepare the demo");
      expect(ui.snapshot().data.today?.today.map((task) => task.id)).toEqual([proposal.id]);
    } finally {
      ui.stop();
    }
  });

  test("dayhand help ui advertises the fifth view and agent keys", async () => {
    const help = await dayhand(undefined, ["help", "ui"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/1 2 3 4 5 +Today, Board, Week, Trash, Agents/);
    for (const binding of [/p +Agents: pause \/ resume changes/, /1 2 3 4 +Request: choose an option/, /Enter Esc +Request: confirm/, /A +Accept the selected proposal/, /X +Reject the selected proposal/]) expect(help.stdout).toMatch(binding);
  });
});

describe.skipIf(!pty)("dayhand ui", () => {
  test("opens Today full screen with the mouse on, and q gives the terminal back", async () => {
    const { key } = await newUser();
    await dayhandJson(key, ["add", "Pay rent", "--due", "yesterday", "-l", "home"]);
    await dayhandJson(key, ["add", "Review the plan", "--time", "09:00"]);
    await dayhandJson(key, ["add", "Draft the invoice", "--item", "hours", "--item", "rate"]);
    await dayhandJson(key, ["now", "3", "--note", "rate is in the email"]);
    const s = open(key);
    const screen = await s.waitFor("NOW");
    expect(screen).toMatch(/^ Dayhand +1 Today +2 Board +3 Week +4 Trash/);
    expect(screen).toMatch(/NOW\n› #3 ◐ +today +Draft the invoice +0\/2/);
    expect(screen).toContain("next: rate is in the email");
    expect(screen).toMatch(/OVERDUE \(1\)\n {2}#1 ○ yesterday Pay rent +#home/);
    expect(screen).toMatch(/TODAY \(1\)\n {2}#2 ○ 09:00 +Review the plan/);
    await s.shot("today");
    expect(s.raw()).toContain("\u001b[?1049h");
    expect(s.raw()).toContain("\u001b[?1000h\u001b[?1006h");
    await s.press("q");
    expect(await s.exit).toBe(0);
    expect(s.raw()).toContain("\u001b[?1049l");
    expect(s.raw()).toContain("\u001b[?1000l\u001b[?1006l");
  });

  test("quick add reads a date phrase and #labels; space completes; s starts; n makes it the now task", async () => {
    const { key } = await newUser();
    const s = open(key);
    await s.waitFor("nothing planned");
    await s.press("a", ..."Call the accountant tomorrow 2pm #money");
    await s.waitFor(/Add: Call the accountant tomorrow 2pm #money +→ tomorrow 14:00 #money/);
    await s.shot("quick-add");
    await s.press("enter");
    await s.waitFor("Added #1 Call the accountant · tomorrow 14:00");
    expect((await show(key, 1)).task).toMatchObject({ title: "Call the accountant", dueTime: "14:00", labels: ["money"] });

    await s.press("a", ..."Send the newsletter");
    await s.press("enter");
    await s.waitFor(/TODAY \(1\)\n› #2 ○ +Send the newsletter/);
    await s.press("s");
    await s.waitFor("Started: #2 Send the newsletter");
    expect((await show(key, 2)).task.status).toBe("doing");
    await s.press("n", ..."draft is in the doc", "enter");
    await s.waitFor(/NOW\n› #2 ◐ today Send the newsletter[\s\S]*next: draft is in the doc/);
    expect((await show(key, 2)).task).toMatchObject({ isNow: true, resumeNote: "draft is in the doc" });
    await s.press("space");
    await s.waitFor(/DONE TODAY \(1\)\n› #2 ✔ +Send the newsletter/);
    expect((await show(key, 2)).task.status).toBe("done");
    await s.press("N");
    await s.waitFor("Now task cleared");
  });

  test("the board: H/L move a task between columns and the cursor follows it", async () => {
    const { key } = await newUser();
    await dayhandJson(key, ["add", "Write the post"]);
    await dayhandJson(key, ["add", "Fix the bike", "--status", "doing"]);
    const s = open(key, ["--view", "board"]);
    await s.waitFor(/TODO \(1\) +│ DOING \(1\) +│ DONE \(0\)/);
    await s.press("L");
    await s.waitFor(/TODO \(0\) +│ DOING \(2\)/);
    expect((await show(key, 1)).task.status).toBe("doing");
    await s.press("L");
    await s.waitFor(/DOING \(1\) +│ DONE \(1\)/);
    expect((await show(key, 1)).task.status).toBe("done");
    await s.shot("board");
    await s.press("H");
    await s.waitFor(/DOING \(2\) +│ DONE \(0\)/);
    await s.press("h", "h", "l");
    await s.waitFor(/│› #1 ◐ today Write the post/);
  });

  test("the week: ] the next week, h/l the day, L moves a task a day later; narrow terminals get bars", async () => {
    const { key } = await newUser();
    await dayhandJson(key, ["add", "Gym", "--due", "next mon", "--time", "07:30"]);
    await dayhandJson(key, ["add", "Dentist", "--due", "next tue"]);
    const s = open(key, ["--view", "week"], { columns: 120, rows: 30 });
    await s.waitFor("· today ·");
    await s.press("]", "h", "h", "h", "h", "h", "h");
    await s.waitFor(/Mon \d+ \w+ 2026 · 1 task\n› #1 ○ 07:30 Gym/);
    await s.shot("week");
    await s.press("L");
    await s.waitFor(/Tue \d+ \w+ 2026 · 2 tasks\n {2}#2 ○ +Dentist\n› #1 ○ 07:30 Gym/);
    expect((await show(key, 1)).task).toMatchObject({ dueDate: (await dayhandJson(key, ["when", "next tue"])).date, dueTime: "07:30" });
    s.resize(56, 20);
    await s.waitFor("█");
    await s.shot("week-narrow");
    await s.press("t");
    await s.waitFor("· today ·");
  });

  test("details name who changed what: cli, and agent: <key name>", async () => {
    const { key, userId } = await newUser();
    const agent = (await createKey(userId, "claude-code", "agent")).key;
    await dayhandJson(agent, ["add", "Draft the ACME invoice", "--note", "hours are in the timesheet"]);
    await dayhandJson(key, ["edit", "1", "--title", "Draft and send the ACME invoice"]);
    const s = open(key);
    await s.waitFor("Draft and send the ACME invoice");
    await s.press("enter");
    const screen = await s.waitFor("history (2, newest first)");
    expect(screen).toMatch(/changed +cli/);
    expect(screen).toMatch(/added by +agent: claude-code/);
    expect(screen).toMatch(/cli +changed +title: "Draft the ACME invoice" → "Draft and send/);
    expect(screen).toMatch(/agent: claude-code +added/);
    expect(screen).toContain("hours are in the timesheet");
    await s.shot("detail");
    await s.press("q");
    await s.waitFor("Today, ");
  });

  test("Agents: consent needs a digit and confirmation, and A brings a proposal into Today", async () => {
    const { key, userId } = await newUser();
    const agent = (await createKey(userId, "demo-agent", "agent")).key;
    const request = await dayhandJson(agent, ["ask", "Deploy the demo", "--option", "Deploy now: The demo becomes public", "--option", "Wait: Nothing changes"]);
    const proposal = await dayhandJson(agent, ["add", "Prepare the demo", "--propose"]);
    const s = open(key);
    await s.waitFor("Approval requests pending: 1");
    await s.press("5");
    await s.waitFor("APPROVAL REQUESTS (1)");
    await s.press("enter");
    await s.waitFor("1. Deploy now");
    await s.press("2");
    await s.waitFor("Record this decision?");
    expect((await dayhandJson(key, ["approval", request.id])).status).toBe("pending");
    await s.shot("approval-confirm");
    await s.press("enter");
    await s.waitFor("APPROVAL REQUESTS (0)");
    expect((await dayhandJson(agent, ["approval", request.id])).decision.optionId).toBe(request.options[1].id);
    await s.shot("agents");
    await s.press("A");
    await s.waitFor("PROPOSALS (0)");
    expect((await show(key, proposal.ref)).task.proposedAt).toBeUndefined();
    await s.press("1");
    await s.waitFor("Prepare the demo");
    expect((await dayhandJson(key, ["today"])).today).toEqual([expect.objectContaining({ id: proposal.id })]);
  });

  test("the edit form saves title, due day and labels in one change", async () => {
    const { key } = await newUser();
    await dayhandJson(key, ["add", "Pay rent", "-l", "home"]);
    const s = open(key);
    await s.waitFor("Pay rent");
    await s.press("e", "C-u", ..."Pay the rent", "tab", "C-u", ..."next mon 9am", "tab", ..." money");
    await s.waitFor(/Due +next mon 9am +→ Mon \d+ \w+ 09:00/);
    await s.shot("edit");
    await s.press("enter");
    await s.waitFor("Saved #1 Pay the rent");
    const { task, history } = await show(key, 1);
    expect(task).toMatchObject({ title: "Pay the rent", dueTime: "09:00", labels: ["home", "money"] });
    expect(history.filter((h: { action: string }) => h.action === "update")).toHaveLength(1);
  });

  test("d asks first, y moves the task to the trash, u restores it; r restores in the trash view", async () => {
    const { key } = await newUser();
    await dayhandJson(key, ["add", "Old idea"]);
    const s = open(key);
    await s.waitFor("Old idea");
    await s.press("d");
    await s.waitFor("Move #1 Old idea to the trash? y/N");
    await s.press("n");
    await s.waitFor("Kept");
    await s.press("d", "y");
    await s.waitFor("Moved #1 Old idea to the trash · u undoes");
    expect((await dayhandJson(key, ["trash"])).result).toHaveLength(1);
    await s.press("u");
    await s.waitFor("Restored #1 Old idea");
    await s.press("d", "y");
    await s.waitFor("to the trash");
    await s.press("4");
    await s.waitFor(/Trash · 1 task ·[\s\S]*› #1 ○ today Old idea +deleted \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    await s.shot("trash");
    await s.press("r");
    await s.waitFor("Restored #1 Old idea");
    expect((await dayhandJson(key, ["trash"])).result).toHaveLength(0);
  });

  test("an agent's change shows up by itself at the next refresh", async () => {
    const { key, userId } = await newUser();
    const agent = (await createKey(userId, "claude-code", "agent")).key;
    const s = open(key, ["--interval", "10"]);
    await s.waitFor("nothing planned");
    await dayhandJson(agent, ["add", "Reply to the client"]);
    await s.waitFor("Reply to the client", 15_000);
  }, 30_000);

  test("without a server it says so, stays responsive, and q quits", async () => {
    const { key } = await newUser();
    const s = open(key, [], undefined, { DAYHAND_URL: "http://127.0.0.1:9" });
    const screen = await s.waitFor("Cannot reach http://127.0.0.1:9");
    expect(screen).toContain("● offline");
    expect(screen).toContain("Retrying every 12 s; R retries now, q quits.");
    await s.shot("offline");
    await s.press("?");
    await s.waitFor("Keys");
    await s.press("q", "q");
    expect(await s.exit).toBe(0);
  });

  test("the mouse selects a row (a second click opens it) and switches views; ? lists the keys", async () => {
    const { key } = await newUser();
    await dayhandJson(key, ["add", "First"]);
    await dayhandJson(key, ["add", "Second"]);
    const s = open(key);
    const screen = await s.waitFor(/› #1 ○ First/);
    const second = locate(screen, "Second");
    await s.click(second.x, second.y);
    await s.waitFor(/› #2 ○ Second/);
    await s.click(second.x, second.y);
    await s.waitFor("history (1, newest first)");
    await s.press("esc");
    const tab = locate(await s.screen(), "2 Board");
    await s.click(tab.x, tab.y);
    await s.waitFor("TODO (2)");
    await s.press("?");
    await s.waitFor(/Keys[\s\S]*Move[\s\S]*Board and week/);
    await s.shot("help");
  });

  test("speaks the terminal's language, DAYHAND_LANG and --lang choose another; what scripts read stays English", async () => {
    const { key } = await newUser();
    await dayhandJson(key, ["add", "Pay rent", "--due", "yesterday", "-l", "home"]);
    const polish = open(key, [], undefined, { LANG: "pl_PL.UTF-8" });
    const screen = await polish.waitFor("ZALEGŁE");
    expect(screen).toMatch(/^ Dayhand +1 Dzisiaj +2 Tablica +3 Tydzień +4 Kosz/);
    expect(screen).toMatch(/ZALEGŁE \(1\)\n› #1 ○ wczoraj Pay rent +#home/);
    await polish.press("a", ..."Zadzwoń tomorrow 2pm");
    await polish.press("enter");
    await polish.waitFor("Dodano #2 Zadzwoń · jutro 14:00");
    await polish.shot("today-pl");
    await polish.press("q");
    expect(await polish.exit).toBe(0);

    const japanese = open(key, ["--lang", "ja"], undefined, { LANG: "pl_PL.UTF-8", DAYHAND_LANG: "de" });
    await japanese.waitFor(/期限切れ \(1\)/);
    await japanese.press("?");
    await japanese.waitFor(/キー[\s\S]*移動/);
    await japanese.press("q", "q");
    expect(await japanese.exit).toBe(0);

    const german = open(key, [], undefined, { LANG: "pl_PL.UTF-8", DAYHAND_LANG: "de" });
    await german.waitFor("ÜBERFÄLLIG");

    const unknown = open(key, ["--lang", "tlh"]);
    await unknown.waitFor("--lang must be one of en, pl, de, es, fr, pt-BR, ja, zh-Hans");
    expect(await unknown.exit).toBe(2);
    const listed = await dayhand(key, ["list", "--json"], { env: { LANG: "pl_PL.UTF-8", DAYHAND_LANG: "pl" } });
    expect(listed.stdout).toMatch(/"title": ?"Zadzwoń"/);
  }, 30_000);
});
