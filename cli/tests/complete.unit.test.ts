// `dayhand __complete`: candidates from the registry and the cached task list. No backend.
import { describe, expect, test } from "vitest";
import { complete, NO_FILES, NO_SPACE, type Sources } from "../src/completion/engine.js";
import { completionScript, SHELLS } from "../src/completion/scripts.js";

let hintCalls = 0;
const sources: Sources = {
  aliases: { home: "list -l home" },
  profiles: ["personal", "work"],
  hints: async () => {
    hintCalls++;
    return { tasks: [{ ref: 4, title: "Call the bank" }, { ref: 42, title: "Write the report" }], labels: ["home", "work"] };
  },
};
const values = async (...words: string[]) => (await complete(words, sources)).candidates.map((c) => c.value);

describe("candidates", () => {
  test("commands, their aliases, config aliases and help, with summaries", async () => {
    const result = await complete(["d"], sources);
    expect(result.candidates.map((c) => c.value)).toEqual(["done", "delete", "device", "devices"]);
    expect(result.candidates[0]!.description).toMatch(/^Mark tasks done/);
    expect(result.directive).toBe(NO_FILES);
    expect(await values("ho")).toEqual(["home"]);
    expect(await values("he")).toEqual(["help"]);
    expect(await values("help", "da")).toEqual(["dates"]);
  });

  test("options of the command plus the global ones", async () => {
    const options = await values("list", "--d");
    expect(options).toEqual(["--done", "--due-before", "--due-after", "--dry-run"]);
    expect(await values("--js")).toEqual(["--json"]);
  });

  test("option values: choices, dates, labels, profiles, comma lists, files", async () => {
    expect(await values("--color", "")).toEqual(["auto", "always", "never"]);
    expect(await values("add", "x", "--due", "t")).toEqual(["today", "tomorrow", "tue", "thu", "this"]);
    expect(await values("edit", "4", "--add-label", "")).toEqual(["home", "work"]);
    expect(await values("--profile", "w")).toEqual(["work"]);
    const statuses = await complete(["list", "--status", "todo,d"], sources);
    expect(statuses.candidates.map((c) => c.value)).toEqual(["todo,doing", "todo,done"]);
    expect(statuses.directive).toBe(NO_FILES | NO_SPACE);
    expect((await complete(["export", "-o", ""], sources)).directive).toBe(0);
    expect(await values("when", "x", "--timezone", "Europe/Lond")).toEqual(["Europe/London"]);
  });

  test("task references: now and the numbers with their titles", async () => {
    const result = await complete(["done", "4"], sources);
    expect(result.candidates).toEqual([
      { value: "4", description: "Call the bank" },
      { value: "42", description: "Write the report" },
    ]);
    expect(await values("done", "4", "")).toEqual(["now", "4", "42"]);
    expect(await values("show", "#4")).toEqual(["#4", "#42"]);
  });

  test("subcommands, settings keys, shells, tools, dates for move", async () => {
    expect(await values("settings", "")).toEqual(["get", "set"]);
    const keys = await complete(["settings", "set", "s"], sources);
    expect(keys).toEqual({ candidates: [{ value: "summary-time=" }], directive: NO_FILES | NO_SPACE });
    expect(await values("completion", "")).toEqual([...SHELLS]);
    expect(await values("call", "list_")).toEqual(["list_all", "list_events", "list_today", "list_trash"]);
    expect(await values("move", "4", "n")).toEqual(["next", "none"]);
  });

  test("an alias completes like what it stands for", async () => {
    expect(await values("home", "--st")).toEqual(["--status"]);
  });

  test("nothing for free text, unknown commands or option values without a list", async () => {
    expect(await values("add", "")).toEqual([]);
    expect(await values("frobnicate", "")).toEqual([]);
    expect(await values("add", "x", "--note", "")).toEqual([]);
  });

  test("the task list is fetched only when needed", async () => {
    hintCalls = 0;
    await values("list", "--d");
    await values("");
    expect(hintCalls).toBe(0);
    await values("done", "");
    expect(hintCalls).toBe(1);
  });

  test('"" stands for an empty word (PowerShell cannot always pass one)', async () => {
    expect(await values("settings", '""')).toEqual(["get", "set"]);
  });
});

test.each(SHELLS)("the %s script calls dayhand __complete", (shell) => {
  expect(completionScript(shell)).toContain("dayhand __complete");
});
