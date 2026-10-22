// Output formats, defaults, environment and the people-facing behaviour of
// the commands, against the real local backend.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { flatten } from "../src/registry/index.js";
import { helm, hlm, hlmJson, newUser } from "./helpers.js";

describe("output", () => {
  test("hlm without a command shows Today", async () => {
    const { key } = await newUser();
    await hlm(key, ["add", "Call", "the", "bank", "--time", "18:00", "-l", "admin"]);
    await hlm(key, ["now", "1", "--note", "have the account number"]);
    const run = await hlm(key, []);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/^Today, \w{3} \d{1,2} \w{3} \d{4} \(Europe\/London\)\n/);
    expect(run.stdout).toContain("NOW  #1 Call the bank\n     next: have the account number");
    // Batch 2: aligned columns; inside TODAY only the time is shown.
    expect(run.stdout).toMatch(/#1 +\[~\] +18:00 +Call the bank +#admin/);
    expect(await hlmJson(key, [])).toEqual(await hlmJson(key, ["today"]));
  });

  test("hlm prime prints Today and the agent rules as plain text; --json is list_today", async () => {
    const { key } = await newUser("agent");
    await hlm(key, ["add", "Write the report", "--time", "09:00"]);
    await hlm(key, ["now", "1", "--note", "section 2 next"]);
    const run = await hlm(key, ["prime"], { env: { FORCE_COLOR: "1" } });
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/^# Helm tasks \(hlm\)\n\nToday, /);
    expect(run.stdout).toContain("NOW  #1 Write the report\n     next: section 2 next");
    expect(run.stdout).toContain("## Using hlm\n- Pass --json");
    expect(run.stdout).not.toContain("\x1b[");
    expect((await hlm(key, ["prime", "--plain"])).stdout).toBe(run.stdout);
    expect(await hlmJson(key, ["prime"])).toEqual(await hlmJson(key, ["today"]));
  });

  test("--plain is tab-separated without headers; --fields picks columns and JSON fields", async () => {
    const { key } = await newUser();
    await hlm(key, ["add", "Water plants", "--time", "18:00", "-l", "home", "-l", "garden"]);
    await hlm(key, ["add", "Someday", "--no-due"]);
    const plain = await hlm(key, ["list", "--plain"]);
    // Server order: undated tasks first, then by day and time.
    expect(plain.stdout).toMatch(/^2\ttodo\t\t\tSomeday\t\n1\ttodo\t\d{4}-\d{2}-\d{2}\t18:00\tWater plants\thome,garden\n$/);
    expect((await hlm(key, ["today", "--plain", "--fields", "ref,title"])).stdout).toBe("today\t1\tWater plants\n");
    const json = await hlmJson(key, ["list", "--fields", "ref,title,dueDate"]);
    expect(json.result).toEqual([
      { ref: 2, title: "Someday" },
      { ref: 1, title: "Water plants", dueDate: expect.any(String) },
    ]);
    expect(await hlmJson(key, ["settings", "--fields", "timezone"])).toEqual({ timezone: "Europe/London" });
  });

  test("HLM_FORMAT sets the default format; flags win", async () => {
    const { key } = await newUser();
    await hlm(key, ["add", "A"]);
    const json = await hlm(key, ["list"], { env: { HLM_FORMAT: "json" } });
    expect(JSON.parse(json.stdout).result).toHaveLength(1);
    expect((await hlm(key, ["list", "--plain"], { env: { HLM_FORMAT: "json" } })).stdout).toMatch(/^1\ttodo/);
    expect((await hlm(key, ["list", "--json", "--plain"])).code).toBe(2);
  });

  test("the old HELM_URL and HELM_API_KEY still work, with a deprecation warning", async () => {
    const { key } = await newUser();
    const env = { HELM_URL: helm().siteUrl, HELM_API_KEY: key };
    const run = await hlm(undefined, ["add", "Old", "env"], { url: "", env });
    expect(run.code).toBe(0);
    expect(run.stderr).toContain("hlm: warning: HELM_URL is deprecated; set HLM_URL instead");
    expect(run.stderr).toContain("hlm: warning: HELM_API_KEY is deprecated; set HLM_API_KEY instead");
    const json = await hlm(undefined, ["list", "--json"], { url: "", env });
    expect(JSON.parse(json.stdout).result).toHaveLength(1);
    const warnings = json.stderr.trim().split("\n").map((l) => JSON.parse(l));
    expect(warnings).toEqual([
      { warning: { code: "deprecated_env", message: "HELM_URL is deprecated; set HLM_URL instead" } },
      { warning: { code: "deprecated_env", message: "HELM_API_KEY is deprecated; set HLM_API_KEY instead" } },
    ]);
    // The new name wins and no warning is printed.
    expect((await hlm(key, ["list"], { env: { HELM_API_KEY: "helm_old" } })).stderr).toBe("");
  });

  test("no output ever contains the API key", async () => {
    const { key } = await newUser();
    const runs = await Promise.all([hlm(key, ["show", "5"]), hlm(key, ["list", "--bogus"]), hlm(key, ["version"]), hlm(key, ["pair", "--no-qr"])]);
    for (const run of runs) expect(run.stdout + run.stderr).not.toContain(key);
  });
});

describe("commands", () => {
  test("history shows changes from a cli key as cli and from an agent key by name", async () => {
    const { userId, key } = await newUser("cli");
    await hlm(key, ["add", "Report"]);
    await hlm(key, ["done", "1"]);
    const { createKey } = await import("./helpers.js");
    const agent = await createKey(userId, "claude-code", "agent");
    await hlm(agent.key, ["reopen", "1"]);
    const history = (await hlmJson(key, ["show", "1"])).history;
    expect(history.map((h: { by: string; action: string }) => `${h.by} ${h.action}`)).toEqual([
      "cli create",
      "cli complete",
      "agent: claude-code setStatus",
    ]);
    const shown = await hlm(key, ["show", "1"]);
    expect(shown.stdout).toMatch(/^#1 Report\nstatus +todo/);
    expect(shown.stdout).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}  cli  complete  .*status: "todo" → "done"/);
  });

  test("now is a task reference; note appends; edit adds and removes labels", async () => {
    const { key } = await newUser();
    await hlm(key, ["add", "Draft", "-l", "home", "--note", "outline"]);
    await hlm(key, ["now", "1"]);
    await hlm(key, ["note", "now", "intro written"]);
    expect((await hlm(key, ["note", "1"])).stdout).toBe("outline\nintro written\n");
    const edited = await hlmJson(key, ["edit", "now", "--add-label", "work", "--rm-label", "home"]);
    expect(edited.labels).toEqual(["work"]);
    expect((await hlmJson(key, ["edit", "1", "--clear-note", "--clear-labels"])).note).toBeUndefined();
    expect((await hlm(key, ["edit", "1"])).code).toBe(2);
    const done = await hlm(key, ["done", "now"]);
    expect(done.stdout).toMatch(/^Done:\n  #1 +\[x\]/);
  });

  test("several tasks: --yes from three on; without a terminal hlm never waits", async () => {
    const { key } = await newUser();
    for (const title of ["A", "B", "C", "D"]) await hlm(key, ["add", title]);
    expect((await hlm(key, ["rm", "1", "2"])).code).toBe(0);
    const refused = await hlm(key, ["rm", "3", "4"], { input: "y\n" });
    expect(refused.code).toBe(0);
    for (const title of ["E", "F", "G"]) await hlm(key, ["add", title]);
    const many = await hlm(key, ["archive", "5", "6", "7"], { input: "y\n" });
    expect(many).toMatchObject({ code: 2, stdout: "" });
    expect(many.stderr).toMatch(/Refusing to archive 3 tasks without --yes/);
    expect((await hlmJson(key, ["list"])).result).toHaveLength(3);
    const yes = await hlmJson(key, ["archive", "5", "6", "7", "-y"]);
    expect(yes.results.map((t: { ref: number }) => t.ref)).toEqual([5, 6, 7]);
    expect((await hlmJson(key, ["trash"])).result.map((t: { ref: number }) => t.ref).sort()).toEqual([1, 2, 3, 4]);
    expect((await hlmJson(key, ["restore", "1", "2", "--yes"])).results).toHaveLength(2);
  });

  test("every command finishes without a terminal (no prompts)", async () => {
    const { key } = await newUser();
    await hlm(key, ["add", "Task", "--note", "n"]);
    const runs = flatten()
      .filter(({ spec }) => spec.run)
      .map(({ path, spec }) => {
        const args = (spec.args ?? []).filter((a) => a.required).map((a) => (a.name === "pairs" ? "timezone=Europe/London" : a.name === "tool" ? "get_settings" : a.name === "date" ? "today" : "1"));
        return [...path.split(" "), ...args];
      });
    for (const args of runs) {
      const run = await hlm(key, args); // the helper fails the test if a run waits for input
      expect([0, 2, 4], `hlm ${args.join(" ")}: ${run.stderr}`).toContain(run.code);
    }
  });

  test("settings set, tools, call from stdin, export to a file, version, pairing and devices", async () => {
    const { key } = await newUser();
    const settings = await hlmJson(key, ["settings", "set", "timezone=Europe/Warsaw", "reminders=10"]);
    expect(settings).toEqual({ timezone: "Europe/Warsaw", summaryTime: "05:00", defaultReminderMinutes: [10] });
    expect((await hlm(key, ["settings"])).stdout).toMatch(/^timezone +Europe\/Warsaw$/m);

    expect((await hlm(key, ["tools"])).stdout).toMatch(/^add_task +Add a task/);
    expect((await hlm(key, ["tools", "set_now"])).stdout).toContain('"taskId"');
    const unknown = await hlm(key, ["tools", "nope", "--json"]);
    expect(unknown.code).toBe(2);
    expect(JSON.parse(unknown.stderr).error.valid).toContain("add_task");

    const added = await hlm(key, ["call", "add_task", "-", "--json"], { input: '{"title":"From stdin","dueDate":"tomorrow"}' });
    expect(JSON.parse(added.stdout)).toMatchObject({ ref: 1, title: "From stdin" });

    const dir = mkdtempSync(join(process.env.HLM_TEST_TMPDIR ?? tmpdir(), "hlm-export-"));
    try {
      const file = join(dir, "plan.json");
      expect(await hlmJson(key, ["export", "--format", "json", "-o", file])).toEqual({ written: file, format: "json" });
      expect(JSON.parse(readFileSync(file, "utf8")).content.tasks).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect((await hlm(key, ["version"])).stdout).toBe(`hlm ${version}\nserver helm ${(await hlmJson(key, ["version"])).server.version}\n`);

    const pairing = await hlm(key, ["pair", "--no-qr"]);
    expect(pairing.stdout).toMatch(/helm:\/\/pair\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+&code=[0-9A-Z-]{14}/);
    expect((await hlm(key, ["devices"])).stdout).toBe("(no paired devices)\n");
    expect((await hlmJson(key, ["device", "list"])).devices).toEqual([]);
  });
});
