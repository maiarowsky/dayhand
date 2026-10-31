import { describe, expect, test, vi } from "vitest";
import { LANGUAGES, tIn } from "../src/i18n/index.js";
import type { Task } from "../src/render/model.js";
import { ClipboardError, copyText, taskText } from "../src/ui/clipboard.js";
import { handleKey } from "../src/ui/handle.js";
import { KEY_GROUPS, keysText } from "../src/ui/keys.js";
import { initialState, type Lists, type ViewName } from "../src/ui/state.js";

const task: Task = { id: "task-id", ref: 42, title: "Prepare the demo", status: "doing", isNow: false, links: [], createdAt: 1, updatedAt: 1 };
const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });

describe("task text for a chat", () => {
  test("full id, ref, title, status, project, due date/time and multiline notes, without colours", () => {
    const value = { ...task, title: "\u001b[31mZażółć 日本語 🚀\u001b[0m", project: "Demo project", dueDate: "2026-10-31", dueTime: "14:00", note: "First line\r\nSecond line\u0000", resumeNote: "Review the draft" };
    expect(taskText(value)).toBe("ID: task-id\nRef: #42\nTitle: Zażółć 日本語 🚀\nStatus: doing\nProject: Demo project\nDue: 2026-10-31 14:00\nNote:\nFirst line\nSecond line\nResume note: Review the draft");
    expect(value.title).toContain("\u001b[31m");
  });

  test("optional fields are omitted; an unresolved project still has its id", () => {
    expect(taskText({ ...task, ref: undefined })).toBe("ID: task-id\nTitle: Prepare the demo\nStatus: doing");
    expect(taskText({ ...task, projectId: "project-id", dueDate: "2026-10-31" })).toContain("Project: project-id\nDue: 2026-10-31");
    const note = "A long note\n".repeat(1000);
    expect(taskText({ ...task, note }).endsWith(note)).toBe(true);
  });
});

describe("clipboard tools", () => {
  test.each([
    ["darwin", "pbcopy", []],
    ["linux", "wl-copy", []],
    ["win32", "clip", []],
  ] as const)("%s chooses %s and pipes text, never shell arguments", async (platform, command, args) => {
    const text = "Zażółć 日本語 🚀\n$(not a command)";
    const run = vi.fn(async () => {});
    const writeOsc52 = vi.fn();
    await expect(copyText(text, { platform, run, writeOsc52 })).resolves.toBe("system");
    const input = platform === "win32" ? Buffer.from(`\ufeff${text}`, "utf16le") : Buffer.from(text, "utf8");
    expect(run).toHaveBeenCalledExactlyOnceWith(command, args, input);
    expect(writeOsc52).not.toHaveBeenCalled();
  });

  test.each([
    ["xclip", ["-selection", "clipboard"], 2],
    ["xsel", ["--clipboard", "--input"], 3],
  ] as const)("Linux tries %s if earlier tools are missing or cannot access a display", async (available, args, count) => {
    const run = vi.fn(async (command: string) => {
      if (command !== available) throw command === "wl-copy" ? new Error("no Wayland display") : missing();
    });
    await expect(copyText("demo", { platform: "linux", run, writeOsc52: null })).resolves.toBe("system");
    expect(run).toHaveBeenCalledTimes(count);
    expect(run).toHaveBeenLastCalledWith(available, args, Buffer.from("demo"));
  });

  test("without tools, OSC 52 sends the complete UTF-8 text to the terminal", async () => {
    const text = "Zażółć 日本語 🚀\n".repeat(100);
    const run = vi.fn(async () => { throw missing(); });
    const writeOsc52 = vi.fn();
    await expect(copyText(text, { platform: "linux", run, writeOsc52 })).resolves.toBe("osc52");
    expect(run).toHaveBeenCalledTimes(3);
    expect(writeOsc52).toHaveBeenCalledExactlyOnceWith(`\u001b]52;c;${Buffer.from(text).toString("base64")}\u0007`);
  });

  test("without a tool or terminal, failure retains the cause", async () => {
    const cause = missing();
    await expect(copyText("demo", { platform: "darwin", run: async () => { throw cause; }, writeOsc52: null })).rejects.toMatchObject({ reason: "unavailable", cause });
  });

  test("tool and terminal write errors are failures, not successful copies", async () => {
    const cause = new Error("clipboard not available");
    await expect(copyText("demo", { platform: "darwin", run: async () => { throw cause; }, writeOsc52: null })).rejects.toMatchObject({ reason: "failed", cause });
    await expect(copyText("demo", { platform: "linux", run: async () => { throw missing(); }, writeOsc52: () => { throw cause; } })).rejects.toMatchObject({ reason: "failed", cause });
    expect(new ClipboardError("failed", cause).cause).toBe(cause);
  });
});

const lists: Lists = {
  today: [task], board: [[task], [], []], week: [[task], [], [], [], [], [], []], weekDates: [],
  trash: [{ ...task, deletedAt: 1 }], agents: [{ kind: "proposal", task: { ...task, proposedAt: 1 } }], date: "2026-10-31", page: 20,
};

describe("y copies only in normal task selection mode", () => {
  test.each<ViewName>(["today", "board", "week", "trash", "agents"])("%s: copying leaves selection and task state untouched", (view) => {
    const state = initialState(view, "2026-10-26");
    const before = structuredClone({ state, lists });
    const result = handleKey(state, "y", lists);
    expect(result.effect).toMatchObject({ kind: "copy", task: { id: task.id } });
    expect(result.state).toBe(state);
    expect({ state, lists }).toEqual(before);
    const detail = { ...state, detail: { taskId: "open-id", scroll: 2 } };
    expect(handleKey(detail, "y", { ...lists, detail: { ...task, id: "open-id" } })).toEqual({ state: detail, effect: { kind: "copy", task: { ...task, id: "open-id" } } });
  });

  test("no selected task reports why; y still types into prompts and confirms trash", () => {
    const state = initialState("today", "2026-10-26");
    expect(handleKey(state, "y", { ...lists, today: [] }).effect).toEqual({ kind: "flash", text: "No task selected" });
    const prompt = handleKey(state, "a", lists).state;
    expect(handleKey(prompt, "y", lists)).toMatchObject({ state: { mode: { kind: "prompt", line: { text: "y" } } } });
    const asked = handleKey(state, "d", lists).state;
    expect(handleKey(asked, "y", lists).effect).toMatchObject({ kind: "delete", taskId: task.id });
    const help = handleKey(state, "?", lists).state;
    expect(handleKey(help, "y", lists)).toEqual({ state });
  });

  test("the key map and every language expose copy in hints and help", () => {
    expect(KEY_GROUPS.flatMap((group) => group.bindings)).toContainEqual({ keys: "y", does: "keys.tasks.copy" });
    expect(keysText()).toMatch(/y +Copy the selected task as plain text/);
    for (const language of LANGUAGES) {
      for (const key of ["hints.today", "hints.board", "hints.week", "hints.trash", "hints.detail", "hints.agents", "hints.proposal"] as const) expect(tIn(language, key)).toMatch(/^y /);
      expect(tIn(language, "keys.tasks.copy")).not.toBe("");
    }
  });
});
