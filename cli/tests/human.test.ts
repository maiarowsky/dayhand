// Batch 2 against the real local backend: signing in, config.toml profiles
// and aliases, dates in plain English, list filters, --dry-run, colors.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { parseWhen } from "../src/when/parse.js";
import { helm, hlm, hlmJson, jsonError, newUser, schemaValidator } from "./helpers.js";

const validate = schemaValidator();
const homes: string[] = [];
afterAll(() => homes.forEach((home) => rmSync(home, { recursive: true, force: true })));

/** A fresh config folder (and HOME) with keys in a file: like a new machine without a keychain. */
function machine() {
  const home = mkdtempSync(join(process.env.HLM_TEST_TMPDIR ?? tmpdir(), "hlm-machine-"));
  homes.push(home);
  const env = { HLM_CONFIG_DIR: join(home, "config"), HLM_CACHE_DIR: join(home, "cache"), HOME: home };
  const run = (args: string[], options: { input?: string; env?: Record<string, string> } = {}) =>
    hlm(undefined, args, { url: "", input: options.input, env: { ...env, ...options.env } });
  return { home, env, run, configFile: join(home, "config", "config.toml"), credentials: join(home, "config", "credentials.json") };
}

const london = (text: string) => parseWhen(text, { now: Date.now(), timezone: "Europe/London" });

describe("hlm login, whoami, logout", () => {
  test("a key piped to login is checked, stored only in the 0600 file, and used without HLM_API_KEY", async () => {
    const { key } = await newUser();
    const m = machine();
    const login = await m.run(["login", "--url", helm().siteUrl, "--with-key", "--json"], { input: `${key}\n` });
    expect(login.code, login.stderr).toBe(0);
    const value = JSON.parse(login.stdout);
    expect(validate("login.schema.json", value)).toEqual([]);
    expect(value).toMatchObject({ url: helm().siteUrl, store: "file", profile: "default", config: "created", timezone: "Europe/London" });
    expect(login.stdout + login.stderr).not.toContain(key);

    // The key is in credentials.json (mode 0600) and nowhere else: not in config.toml, not in a shell profile.
    expect(readFileSync(m.credentials, "utf8")).toContain(key);
    if (process.platform !== "win32") expect(statSync(m.credentials).mode & 0o777).toBe(0o600);
    expect(readFileSync(m.configFile, "utf8")).not.toContain(key);
    expect(readFileSync(m.configFile, "utf8")).toContain(`url = "${helm().siteUrl}"`);
    expect(readdirSync(m.home).filter((f) => f.startsWith("."))).toEqual([]);

    expect((await m.run(["add", "From", "the", "stored", "key", "--json"])).code).toBe(0);
    const whoami = await m.run(["whoami", "--json"]);
    const who = JSON.parse(whoami.stdout);
    expect(validate("whoami.schema.json", who)).toEqual([]);
    expect(who).toMatchObject({ url: helm().siteUrl, urlSource: "profile default", profile: "default", keySource: "file", configFound: true });
    expect(whoami.stdout).not.toContain(key);
    expect((await m.run(["whoami"])).stdout).toMatch(/^key +from the credentials file \(hlm login\)$/m);

    // HLM_API_KEY still wins over the stored key.
    const other = await newUser();
    expect(JSON.parse((await m.run(["whoami", "--json"], { env: { HLM_API_KEY: other.key } })).stdout).keySource).toBe("HLM_API_KEY");

    const logout = await m.run(["logout", "--json"]);
    expect(JSON.parse(logout.stdout)).toEqual({ url: helm().siteUrl, removed: ["file"] });
    expect(existsSync(m.credentials)).toBe(false);
    const after = await m.run(["list", "--json"]);
    expect(after.code).toBe(3);
    expect(jsonError(after)).toMatchObject({ code: "unauthenticated", hint: "hlm login, or set HLM_API_KEY (an API key with kind cli)" });
    expect(JSON.parse((await m.run(["logout", "--json"])).stdout).removed).toEqual([]);
  });

  test("a wrong key is not stored; without a terminal login needs --with-key; --dry-run is refused", async () => {
    const m = machine();
    const wrong = await m.run(["login", "--url", helm().siteUrl, "--with-key", "--json"], { input: "helm_not_a_real_key\n" });
    expect(wrong.code).toBe(3);
    expect(wrong.stderr).not.toContain("helm_not_a_real_key");
    expect(existsSync(m.credentials)).toBe(false);
    expect(existsSync(m.configFile)).toBe(false);
    expect((await m.run(["login", "--url", helm().siteUrl])).code).toBe(2);
    expect((await m.run(["login", "--url", helm().siteUrl, "--with-key"], { input: "not a key\n" })).code).toBe(2);
    expect((await m.run(["login", "--url", helm().siteUrl, "--with-key", "--dry-run"], { input: "helm_x\n" })).code).toBe(2);
  });
});

describe("config.toml", () => {
  test("profiles pick the deployment; aliases expand; HLM_URL and flags win", async () => {
    const { key } = await newUser();
    const m = machine();
    const dead = "http://127.0.0.1:9";
    await m.run(["login", "--url", helm().siteUrl, "--with-key"], { input: key });
    writeFileSync(
      m.configFile,
      readFileSync(m.configFile, "utf8") +
        `\n[profiles.broken]\nurl = "${dead}"\n\n[aliases]\nmine = "list -l mine --status todo,doing"\nsoon = "add --due tomorrow"\n`,
    );
    expect((await m.run(["soon", "Labelled", "-l", "mine", "--json"])).code).toBe(0);
    expect((await m.run(["add", "Other", "--json"])).code).toBe(0);
    const mine = JSON.parse((await m.run(["mine", "--json"])).stdout);
    expect(mine.result.map((t: { title: string }) => t.title)).toEqual(["Labelled"]);
    expect(mine.result[0].dueDate).toBe(london("tomorrow").date);

    expect((await m.run(["--profile", "broken", "list", "--json"])).code).toBe(3); // no key stored for that URL
    expect((await m.run(["list", "--json"], { env: { HLM_PROFILE: "broken", HLM_URL: helm().siteUrl, HLM_API_KEY: key } })).code).toBe(0);
    const missing = await m.run(["--profile", "nope", "list", "--json"]);
    expect(jsonError(missing)).toMatchObject({ code: "usage", valid: ["default", "broken"] });
  });

  test("a broken config.toml names the file and the key; --help still works", async () => {
    const m = machine();
    await m.run(["login", "--url", helm().siteUrl, "--with-key"], { input: (await newUser()).key });
    writeFileSync(m.configFile, readFileSync(m.configFile, "utf8") + '\n[ui]\ncolour = "red"\n');
    const run = await m.run(["list", "--json"]);
    expect(run.code).toBe(2);
    expect(jsonError(run)).toMatchObject({ code: "config", message: `${m.configFile}: ui.colour: unknown key (valid: color)`, hint: "hlm help config" });
    expect((await m.run(["--help"])).code).toBe(0);
    expect((await m.run(["help", "config"])).stdout).toMatch(/^Configuration \(config\.toml\)/);
  });
});

describe("dates in plain English", () => {
  test("--due and move resolve phrases in the user's zone; the server's own forms pass unchanged", async () => {
    const { key } = await newUser();
    const fri = london("fri 14:00");
    const added = await hlmJson(key, ["add", "Call", "--due", "fri 14:00"]);
    expect([added.dueDate, added.dueTime]).toEqual([fri.date, fri.time]);
    const moved = await hlmJson(key, ["move", String(added.ref), "next mon 9am"]);
    expect([moved.dueDate, moved.dueTime]).toEqual([london("next mon").date, "09:00"]);
    const edited = await hlmJson(key, ["edit", String(added.ref), "--due", "in 3 days", "--time", "10:15"]);
    expect([edited.dueDate, edited.dueTime]).toEqual([london("in 3 days").date, "10:15"]);

    const bad = await hlm(key, ["add", "X", "--due", "someday", "--json"]);
    expect(jsonError(bad)).toMatchObject({ code: "invalid_argument", exitCode: 2, hint: "hlm help dates" });
    expect(jsonError(await hlm(key, ["add", "X", "--due", "fri 2pm", "--time", "10:00", "--json"]))).toMatchObject({ exitCode: 2 });
  });

  test("--dry-run shows the resolved change and sends nothing", async () => {
    const { key } = await newUser();
    const run = await hlm(key, ["add", "Pay", "rent", "--due", "tomorrow 9am", "--dry-run", "--json", "--client-id", "c1"]);
    const value = JSON.parse(run.stdout);
    expect(validate("dry-run.schema.json", value)).toEqual([]);
    expect(value).toEqual({
      dryRun: true,
      calls: [{ tool: "add_task", arguments: { title: "Pay rent", clientId: "c1", dueDate: london("tomorrow").date, dueTime: "09:00" } }],
    });
    expect((await hlmJson(key, ["list"])).result).toEqual([]);
    const human = await hlm(key, ["add", "Pay", "--dry-run"]);
    expect(human.stdout).toMatch(/^Dry run: nothing was sent\. Would call:\n {2}add_task \{"title":"Pay","clientId":"[^"]+","dueDate":"\d{4}-\d{2}-\d{2}"\}\n$/);
    // A command that only reads ignores --dry-run.
    expect((await hlm(key, ["list", "--dry-run", "--json"])).stdout).toBe('{"result":[]}\n');
  });

  test("hlm when uses the server's zone, --timezone or --now; without a server, this computer's zone", async () => {
    const { key } = await newUser();
    const value = await hlmJson(key, ["when", "tomorrow", "at", "noon"]);
    expect(validate("when.schema.json", value)).toEqual([]);
    expect(value).toMatchObject({ date: london("tomorrow").date, time: "12:00", timezone: "Europe/London", relative: "tomorrow" });
    const pinned = await hlmJson(key, ["when", "1:30am", "--now", "2026-03-28T23:30:00Z"]);
    expect(pinned).toEqual({ date: "2026-03-29", time: "02:30", timezone: "Europe/London", weekday: "Sun", relative: "tomorrow", shiftedFrom: "01:30" });
    const human = await hlm(key, ["when", "eom", "--now", "2026-10-22T09:00:00Z", "--timezone", "Asia/Tokyo"]);
    expect(human.stdout).toBe("Sat 31 Oct 2026 (Asia/Tokyo), in 9 days\n");
    const offline = await hlm(undefined, ["when", "today", "--json"], { url: "" });
    expect(offline.code).toBe(0);
    expect(JSON.parse(offline.stderr).warning.code).toBe("local_timezone");
    expect((await hlm(key, ["when", "someday"])).code).toBe(2);
  });
});

test("list filters narrow list_all's result and keep its schema", async () => {
  const { key } = await newUser();
  await hlm(key, ["add", "Old bill", "--due", "yesterday", "-l", "home"]);
  await hlm(key, ["add", "Call the accountant", "--due", "tomorrow", "--note", "VAT question"]);
  await hlm(key, ["add", "Someday idea", "--no-due"]);
  await hlm(key, ["add", "Doing now", "--status", "doing", "--due", "in 10 days"]);
  await hlm(key, ["done", "4"]);
  const titles = async (...args: string[]) => {
    const value = await hlmJson(key, ["list", ...args]);
    expect(validate("task-list.schema.json", value)).toEqual([]);
    return value.result.map((t: { title: string }) => t.title);
  };
  expect(await titles("--overdue")).toEqual(["Old bill"]);
  expect(await titles("--search", "vat")).toEqual(["Call the accountant"]);
  expect(await titles("--due-before", "tomorrow")).toEqual(["Old bill"]);
  expect(await titles("--due-after", "today")).toEqual(["Call the accountant"]);
  expect(await titles("--status", "done")).toEqual(["Doing now"]);
  expect(await titles("--status", "todo", "--limit", "2")).toEqual(["Someday idea", "Old bill"]);
  expect((await hlm(key, ["list", "--status", "finished"])).code).toBe(2);
  expect((await hlm(key, ["list", "--search", "zzz"])).stdout).toBe("(no tasks match)\n");
});

test("colors: only with --color always (or FORCE_COLOR) in a pipe, never in --json or --plain", async () => {
  const { key } = await newUser();
  await hlm(key, ["add", "Colorful", "-l", "x"]);
  const ESC = "\u001b[";
  expect((await hlm(key, ["list"])).stdout).not.toContain(ESC);
  expect((await hlm(key, ["list", "--color", "always"])).stdout).toContain(ESC);
  expect((await hlm(key, ["list"], { env: { FORCE_COLOR: "1" } })).stdout).toContain(ESC);
  expect((await hlm(key, ["list", "--no-color"], { env: { FORCE_COLOR: "1" } })).stdout).not.toContain(ESC);
  expect((await hlm(key, ["list", "--json", "--color", "always"])).stdout).not.toContain(ESC);
  expect((await hlm(key, ["list", "--plain", "--color", "always"])).stdout).not.toContain(ESC);
});
