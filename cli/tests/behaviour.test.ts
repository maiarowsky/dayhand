// Output formats, defaults, environment and the people-facing behaviour of
// the commands, against the real local backend.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { flatten } from "../src/registry/index.js";
import { connectAgent, dayhand, dayhandJson, helm, newUser, TEST_HOME } from "./helpers.js";

describe("output", () => {
  test("dayhand without a command shows Today", async () => {
    const { key } = await newUser();
    await dayhand(key, ["add", "Call", "the", "bank", "--time", "18:00"]);
    await dayhand(key, ["now", "1", "--note", "have the account number"]);
    const run = await dayhand(key, []);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/^Today, \w{3} \d{1,2} \w{3} \d{4} \(Europe\/London\)\n/);
    expect(run.stdout).toContain("NOW  #1 Call the bank\n     next: have the account number");
    // Batch 2: aligned columns; inside TODAY only the time is shown.
    expect(run.stdout).toMatch(/#1 +\[~\] +18:00 +Call the bank/);
    expect(await dayhandJson(key, [])).toEqual(await dayhandJson(key, ["today"]));
  });

  test("dayhand prime prints Today, the agent brief and the rules as plain text; --json is agent_brief, list_today's fields included", async () => {
    const { key } = await newUser("agent");
    await dayhand(key, ["add", "Write the report", "--time", "09:00"]);
    await dayhand(key, ["now", "1", "--note", "section 2 next"]);
    const run = await dayhand(key, ["prime"], { env: { FORCE_COLOR: "1" } });
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/^# Dayhand tasks \(dayhand\)\n\nToday, /);
    expect(run.stdout).toContain("NOW  #1 Write the report\n     next: section 2 next");
    expect(run.stdout).toContain("## Using dayhand\n- Pass --json");
    expect(run.stdout).not.toContain("\x1b[");
    expect((await dayhand(key, ["prime", "--plain"])).stdout).toBe(run.stdout);
    expect(run.stdout).toContain("\n## Agent brief\nAgents: running\nReady to work on:\n  #1 Write the report\n");
    expect(run.stdout).toContain("\n## Next steps\n- Ready to work on: #1 Write the report. claim_task it first");
    const brief = await dayhandJson(key, ["prime"]);
    const today = await dayhandJson(key, ["today"]);
    expect(Object.fromEntries(Object.keys(today).map((k) => [k, brief[k]]))).toEqual(today);
    expect(brief).toMatchObject({ caller: { type: "agent" }, agentsPaused: false, ready: { count: 1 }, nextSteps: [expect.stringContaining("claim_task")] });
  });

  test("--plain is tab-separated without headers; --fields picks columns and JSON fields", async () => {
    const { key } = await newUser();
    await dayhand(key, ["add", "Water plants", "--time", "18:00"]);
    await dayhand(key, ["add", "Someday", "--no-due"]);
    const plain = await dayhand(key, ["list", "--plain"]);
    // Server order: undated tasks first, then by day and time.
    expect(plain.stdout).toMatch(/^2\ttodo\t\t\tSomeday\n1\ttodo\t\d{4}-\d{2}-\d{2}\t18:00\tWater plants\n$/);
    expect((await dayhand(key, ["today", "--plain", "--fields", "ref,title"])).stdout).toBe("today\t1\tWater plants\n");
    const json = await dayhandJson(key, ["list", "--fields", "ref,title,dueDate"]);
    expect(json.result).toEqual([
      { ref: 2, title: "Someday" },
      { ref: 1, title: "Water plants", dueDate: expect.any(String) },
    ]);
    expect(await dayhandJson(key, ["settings", "--fields", "timezone"])).toEqual({ timezone: "Europe/London" });
  });

  test("DAYHAND_FORMAT sets the default format; flags win", async () => {
    const { key } = await newUser();
    await dayhand(key, ["add", "A"]);
    const json = await dayhand(key, ["list"], { env: { DAYHAND_FORMAT: "json" } });
    expect(JSON.parse(json.stdout).result).toHaveLength(1);
    expect((await dayhand(key, ["list", "--plain"], { env: { DAYHAND_FORMAT: "json" } })).stdout).toMatch(/^1\ttodo/);
    expect((await dayhand(key, ["list", "--json", "--plain"])).code).toBe(2);
  });

  test("the old HELM_URL and HELM_API_KEY still work, with a deprecation warning", async () => {
    const { key } = await newUser();
    const env = { HELM_URL: helm().siteUrl, HELM_API_KEY: key };
    const run = await dayhand(undefined, ["add", "Old", "env"], { url: "", env });
    expect(run.code).toBe(0);
    expect(run.stderr).toContain("dayhand: warning: HELM_URL is deprecated; set DAYHAND_URL instead");
    expect(run.stderr).toContain("dayhand: warning: HELM_API_KEY is deprecated; set DAYHAND_API_KEY instead");
    const json = await dayhand(undefined, ["list", "--json"], { url: "", env });
    expect(JSON.parse(json.stdout).result).toHaveLength(1);
    const warnings = json.stderr.trim().split("\n").map((l) => JSON.parse(l));
    expect(warnings).toEqual([
      { warning: { code: "deprecated_env", message: "HELM_URL is deprecated; set DAYHAND_URL instead" } },
      { warning: { code: "deprecated_env", message: "HELM_API_KEY is deprecated; set DAYHAND_API_KEY instead" } },
    ]);
    // The new name wins and no warning is printed.
    expect((await dayhand(key, ["list"], { env: { HELM_API_KEY: "helm_old" } })).stderr).toBe("");
  });

  test("the HLM_* names of the hlm command still work, with a deprecation warning, and win over HELM_*", async () => {
    const { key } = await newUser();
    const env = { HLM_URL: helm().siteUrl, HLM_API_KEY: key, HELM_API_KEY: "helm_older", HLM_FORMAT: "json" };
    const run = await dayhand(undefined, ["list"], { url: "", env });
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout).result).toEqual([]);
    expect(run.stderr.trim().split("\n").map((l) => JSON.parse(l).warning.message)).toEqual([
      "HLM_URL is deprecated; set DAYHAND_URL instead",
      "HLM_API_KEY is deprecated; set DAYHAND_API_KEY instead",
      "HLM_FORMAT is deprecated; set DAYHAND_FORMAT instead",
    ]);
    const who = await dayhand(undefined, ["whoami", "--json"], { url: "", env });
    expect(JSON.parse(who.stdout)).toMatchObject({ urlSource: "HLM_URL", keySource: "HLM_API_KEY" });
  });

  test("the config folder of the hlm command is used while there is no dayhand folder, with a warning", async () => {
    const { key } = await newUser();
    const home = mkdtempSync(join(TEST_HOME, "old-home-"));
    const folder = (name: string) =>
      process.platform === "darwin" ? join(home, "Library", "Application Support", name) : process.platform === "win32" ? join(home, name) : join(home, ".config", name);
    mkdirSync(folder("hlm"), { recursive: true });
    writeFileSync(join(folder("hlm"), "config.toml"), `url = "${helm().siteUrl}"\n`);
    const env = { DAYHAND_CONFIG_DIR: "", HOME: home, USERPROFILE: home, APPDATA: home, XDG_CONFIG_HOME: "" };
    const run = await dayhand(key, ["list"], { url: "", env });
    expect(run.code).toBe(0);
    expect(run.stderr).toContain(`dayhand: warning: ${folder("hlm")} is the folder of the old hlm command; move it to ${folder("dayhand")}`);
    mkdirSync(folder("dayhand"));
    // Once the dayhand folder exists, the old one is ignored: without its config.toml there is no URL.
    expect((await dayhand(key, ["list"], { url: "", env })).code).toBe(2);
  });

  test("hlm, the old name of the command, still runs it, with a warning", async () => {
    const { key } = await newUser();
    const run = await dayhand(key, ["add", "From", "hlm"], { bin: "hlm" });
    expect(run).toMatchObject({ code: 0, stderr: "dayhand: warning: hlm is now called dayhand (short: dh); the hlm command goes away in 1.0\n" });
    expect((await dayhandJson(key, ["list"])).result.map((t: { title: string }) => t.title)).toEqual(["From hlm"]);
  });

  test("no output ever contains the API key", async () => {
    const { key } = await newUser();
    const runs = await Promise.all([dayhand(key, ["show", "5"]), dayhand(key, ["list", "--bogus"]), dayhand(key, ["version"]), dayhand(key, ["pair", "--no-qr"])]);
    for (const run of runs) expect(run.stdout + run.stderr).not.toContain(key);
  });
});

describe("commands", () => {
  test("history shows changes from a cli key as cli and from an agent key by name", async () => {
    const { userId, key } = await newUser("cli");
    await dayhand(key, ["add", "Report"]);
    await dayhand(key, ["done", "1"]);
    const { createKey } = await import("./helpers.js");
    const agent = await createKey(userId, "claude-code", "agent");
    await dayhand(agent.key, ["reopen", "1"]);
    const history = (await dayhandJson(key, ["show", "1"])).history;
    expect(history.map((h: { by: string; action: string }) => `${h.by} ${h.action}`)).toEqual([
      "cli create",
      "cli complete",
      "agent: claude-code setStatus",
    ]);
    const shown = await dayhand(key, ["show", "1"]);
    expect(shown.stdout).toMatch(/^#1 Report\nstatus +todo/);
    expect(shown.stdout).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}  cli  complete  .*status: "todo" → "done"/);
  });

  test("now is a task reference; note appends; edit changes the title and clears the note", async () => {
    const { key } = await newUser();
    await dayhand(key, ["add", "Draft", "--note", "outline"]);
    await dayhand(key, ["now", "1"]);
    await dayhand(key, ["note", "now", "intro written"]);
    expect((await dayhand(key, ["note", "1"])).stdout).toBe("outline\nintro written\n");
    const edited = await dayhandJson(key, ["edit", "now", "--title", "Draft v2"]);
    expect(edited).toMatchObject({ ref: 1, title: "Draft v2" });
    expect(edited).not.toHaveProperty("labels");
    expect((await dayhandJson(key, ["edit", "1", "--clear-note"])).note).toBeUndefined();
    expect((await dayhand(key, ["edit", "1"])).code).toBe(2);
    const done = await dayhand(key, ["done", "now"]);
    expect(done.stdout).toMatch(/^Done:\n  #1 +\[x\]/);
  });

  test("several tasks: --yes from three on; without a terminal dayhand never waits", async () => {
    const { key } = await newUser();
    for (const title of ["A", "B", "C", "D"]) await dayhand(key, ["add", title]);
    expect((await dayhand(key, ["rm", "1", "2"])).code).toBe(0);
    const refused = await dayhand(key, ["rm", "3", "4"], { input: "y\n" });
    expect(refused.code).toBe(0);
    for (const title of ["E", "F", "G"]) await dayhand(key, ["add", title]);
    const many = await dayhand(key, ["archive", "5", "6", "7"], { input: "y\n" });
    expect(many).toMatchObject({ code: 2, stdout: "" });
    expect(many.stderr).toMatch(/Refusing to archive 3 tasks without --yes/);
    expect((await dayhandJson(key, ["list"])).result).toHaveLength(3);
    const yes = await dayhandJson(key, ["archive", "5", "6", "7", "-y"]);
    expect(yes.results.map((t: { ref: number }) => t.ref)).toEqual([5, 6, 7]);
    expect((await dayhandJson(key, ["trash"])).result.map((t: { ref: number }) => t.ref).sort()).toEqual([1, 2, 3, 4]);
    expect((await dayhandJson(key, ["restore", "1", "2", "--yes"])).results).toHaveLength(2);
  });

  test("every command finishes without a terminal (no prompts)", async () => {
    const { key } = await newUser();
    await dayhand(key, ["add", "Task", "--note", "n"]);
    const runs = flatten()
      .filter(({ spec }) => spec.run)
      .map(({ path, spec }) => {
        const args = (spec.args ?? []).filter((a) => a.required).map((a) => (a.name === "pairs" ? "timezone=Europe/London" : a.name === "tool" ? "get_settings" : a.name === "date" ? "today" : "1"));
        return [...path.split(" "), ...args];
      });
    for (const args of runs) {
      const run = await dayhand(key, args); // the helper fails the test if a run waits for input
      expect([0, 2, 4], `dayhand ${args.join(" ")}: ${run.stderr}`).toContain(run.code);
    }
  });

  test("settings set, tools, call from stdin, export to a file, version, pairing and devices", async () => {
    const { key } = await newUser();
    const settings = await dayhandJson(key, ["settings", "set", "timezone=Europe/Warsaw", "reminders=10"]);
    expect(settings).toEqual({ timezone: "Europe/Warsaw", summaryTime: "05:00", defaultReminderMinutes: [10] });
    expect((await dayhand(key, ["settings"])).stdout).toMatch(/^timezone +Europe\/Warsaw$/m);

    expect((await dayhand(key, ["tools"])).stdout).toMatch(/^add_task +Add a task/);
    expect((await dayhand(key, ["tools", "set_now"])).stdout).toContain('"taskId"');
    const unknown = await dayhand(key, ["tools", "nope", "--json"]);
    expect(unknown.code).toBe(2);
    expect(JSON.parse(unknown.stderr).error.valid).toContain("add_task");

    const added = await dayhand(key, ["call", "add_task", "-", "--json"], { input: '{"title":"From stdin","dueDate":"tomorrow"}' });
    expect(JSON.parse(added.stdout)).toMatchObject({ ref: 1, title: "From stdin" });

    const dir = mkdtempSync(join(process.env.DAYHAND_TEST_TMPDIR ?? tmpdir(), "dayhand-export-"));
    try {
      const file = join(dir, "plan.json");
      expect(await dayhandJson(key, ["export", "--format", "json", "-o", file])).toEqual({ written: file, format: "json" });
      expect(JSON.parse(readFileSync(file, "utf8")).content.tasks).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect((await dayhand(key, ["version"])).stdout).toBe(`dayhand ${version}\nserver dayhand ${(await dayhandJson(key, ["version"])).server.version}\n`);

    const pairing = await dayhand(key, ["pair", "--no-qr"]);
    expect(pairing.stdout).toMatch(/dayhand:\/\/pair\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+\n/);
    expect(pairing.stdout).not.toContain("&code=");
    expect(pairing.stdout).toContain("Open the Dayhand app and type this code.");
    expect((await dayhand(key, ["devices"])).stdout).toBe("(no paired devices)\n");
    expect((await dayhandJson(key, ["device", "list"])).devices).toEqual([]);
  });

  test("agent connections: list, revoke, and the revoked token stops working", async () => {
    const { userId, key } = await newUser();
    expect((await dayhand(key, ["connections"])).stdout).toBe("(no agent connections)\n");
    const tokens = await connectAgent(userId, "Claude");
    const listed = await dayhandJson(key, ["connection", "list"]);
    expect(listed.connections).toHaveLength(1);
    const [connection] = listed.connections;
    expect(connection).toMatchObject({ clientName: "Claude", clientType: "dcr", clientHost: null, redirectHost: "claude.ai", scopes: ["tasks:read"], active: true });
    const human = (await dayhand(key, ["connections"])).stdout;
    expect(human).toContain(`Claude (registered itself, returns to claude.ai)  read only, connected `);
    expect(human).toContain(`never used (${connection.id})`);

    const mcp = (token: string) =>
      fetch(`${helm().siteUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    expect((await mcp(tokens.access_token)).status).toBe(200);
    // An OAuth token is not an API key: dayhand cannot run on it.
    expect((await dayhand(tokens.access_token, ["connections"])).code).toBe(3);

    const revoked = await dayhand(key, ["connection", "revoke", connection.id]);
    expect(revoked.code).toBe(0);
    expect(revoked.stdout).toContain(`Revoked ${connection.id}`);
    expect((await mcp(tokens.access_token)).status).toBe(401);
    expect((await dayhand(key, ["connections", "--plain"])).stdout).toMatch(new RegExp(`^${connection.id}\tClaude\trevoked\ttasks:read\t`));
    expect((await dayhand(key, ["connection", "revoke", "nope"])).code).toBe(4);
  });
});
