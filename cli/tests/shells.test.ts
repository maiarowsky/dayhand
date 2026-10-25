// The completion scripts in the real shells that are installed (bash, zsh,
// PowerShell, fish), with `dayhand` on the PATH, against the real local backend.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { dayhand, helm, dayhandJson, newUser, TEST_HOME } from "./helpers.js";
import { HOSTILE_PROJECT_NAMES } from "./fixtures/hostile-projects.js";

const BIN = fileURLToPath(new URL("../dist/bin/dayhand.js", import.meta.url));
const dir = mkdtempSync(join(process.env.DAYHAND_TEST_TMPDIR ?? tmpdir(), "dayhand-shells-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const has = (shell: string) => process.platform !== "win32" && spawnSync(shell, ["-c", "exit 0"]).status === 0;
const cacheDir = join(TEST_HOME, "shell-cache");

// `dayhand` on the PATH, as after npm install -g.
writeFileSync(join(dir, "dayhand"), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`);
chmodSync(join(dir, "dayhand"), 0o755);

function run(shell: string, args: string[], key?: string, cache = cacheDir) {
  const env = {
    PATH: `${dir}${delimiter}${process.env.PATH}`,
    HOME: TEST_HOME,
    DAYHAND_CONFIG_DIR: join(TEST_HOME, "shell-config"),
    DAYHAND_CACHE_DIR: cache,
    DAYHAND_CREDENTIAL_STORE: "file",
    DAYHAND_URL: helm().siteUrl,
    ...(key ? { DAYHAND_API_KEY: key } : {}),
  };
  const result = spawnSync(shell, args, { env, encoding: "utf8", timeout: 30_000 });
  return result.stdout.split("\n").filter(Boolean);
}

const bash = (words: string[], key?: string) =>
  run("bash", ["-c", `source <(dayhand completion bash); COMP_WORDS=(${words.map((w) => `'${w}'`).join(" ")}); COMP_CWORD=${words.length - 1}; _dayhand_complete; printf '%s\\n' "\${COMPREPLY[@]}"`], key);

describe.skipIf(!has("bash"))("bash", () => {
  test("the script completes dh, the short name, too", () => {
    expect(run("bash", ["-c", "source <(dayhand completion bash); complete -p dayhand dh"])).toEqual([
      "complete -F _dayhand_complete dayhand",
      "complete -F _dayhand_complete dh",
    ]);
  });

  test("commands, options and task numbers from the server, cached for 60 s", async () => {
    expect(bash(["dayhand", "do"])).toEqual(["done"]);
    expect(bash(["dayhand", "list", "--ov"])).toEqual(["--overdue"]);
    const { key } = await newUser();
    await dayhandJson(key, ["add", "Call the bank"]);
    await dayhandJson(key, ["add", "Write the report"]);
    expect(bash(["dayhand", "done", ""], key)).toEqual(["now", "1", "2"]);
    const cached = readdirSync(cacheDir).filter((f) => f.startsWith("tasks-"));
    expect(cached).toHaveLength(1);
    expect(statSync(join(cacheDir, cached[0]!)).mode & 0o777).toBe(0o600);
    await dayhandJson(key, ["add", "Third"]);
    expect(bash(["dayhand", "done", ""], key)).toEqual(["now", "1", "2"]); // still the cached list
  });

  test("wildcard project names survive candidate loading even when paths match them", async () => {
    const { key } = await newUser();
    for (const name of ["cli*", "cli?", "cli[123]"]) await dayhandJson(key, ["project", "add", name]);
    const cwd = mkdtempSync(join(dir, "glob-"));
    for (const name of ["cli", "cli1", "cli2"]) mkdirSync(join(cwd, name));
    const script = [
      `cd '${cwd}'`,
      "source <(dayhand completion bash)",
      "COMP_WORDS=(dayhand add Menu -p cli); COMP_CWORD=4",
      "_dayhand_complete",
      "printf '%s\\n' \"${COMPREPLY[@]}\"",
    ].join("\n");
    expect(run("bash", ["-c", script], key, join(cwd, "cache"))).toEqual(["cli\\*", "cli\\?", "cli\\[123\\]"]);
  });
});

describe.skipIf(!has("zsh"))("zsh", () => {
  test("the script parses and offers values with descriptions", async () => {
    expect(spawnSync("zsh", ["-n", "-c", run("bash", ["-c", "dayhand completion zsh"]).join("\n")]).status).toBe(0);
    const script = [
      "compdef() { :; }",
      "_describe() { print -l -- ${(P)4} }",
      "_files() { print FILES }",
      'eval "$(dayhand completion zsh)"',
      "words=(dayhand settings ''); CURRENT=3; _dayhand",
      "words=(dayhand export -o ''); CURRENT=4; _dayhand",
    ].join("\n");
    const lines = run("zsh", ["-f", "-c", script]);
    expect(lines).toEqual(["get:Show settings", expect.stringMatching(/^set:Change settings/), "FILES"]);
  });
});

describe.skipIf(!has("pwsh"))("PowerShell", () => {
  test("project completion stays a single PowerShell literal even with shell punctuation", async () => {
    const { key } = await newUser();
    const names = HOSTILE_PROJECT_NAMES;
    for (const name of names) await dayhandJson(key, ["project", "add", name]);
    const prefixes = names.map((name) => `'${name.slice(0, 3)}'`).join(",");
    const script = [
      "dayhand completion powershell | Out-String | Invoke-Expression",
      `$items = @(foreach ($prefix in @(${prefixes})) {`,
      "  $line = 'dayhand add Menu -p ' + $prefix",
      "  $matches = @((TabExpansion2 -inputScript $line -cursorColumn $line.Length).CompletionMatches)",
      "  $tokens = $null; $errors = $null",
      "  $completed = 'dayhand add Menu -p ' + $matches[0].CompletionText",
      "  $ast = [System.Management.Automation.Language.Parser]::ParseInput($completed, [ref]$tokens, [ref]$errors)",
      "  $commands = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true))",
      "  $argument = $commands[0].CommandElements[-1]",
      "  [pscustomobject]@{ matches=$matches.Count; errors=$errors.Count; commands=$commands.Count; literal=($argument -is [System.Management.Automation.Language.StringConstantExpressionAst]); value=$argument.Value }",
      "})",
      "$items | ConvertTo-Json -Compress",
    ].join("\n");
    const result = run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script], key, join(TEST_HOME, "ps-security-cache"));
    expect(JSON.parse(result.join("\n"))).toEqual(names.map((value) => ({ matches: 1, errors: 0, commands: 1, literal: true, value })));
    // Newlines never enter the candidate catalog: the actual backend rejects them.
    const invalid = await dayhand(key, ["project", "add", "q09 line\nbreak", "--json"]);
    expect(invalid.code).toBe(2);
  }, 60_000);

  test("TabExpansion2 offers dayhand's candidates", () => {
    const script = [
      "dayhand completion powershell | Out-String | Invoke-Expression",
      "(TabExpansion2 -inputScript 'dayhand do' -cursorColumn 10).CompletionMatches | ForEach-Object { $_.CompletionText }",
      "(TabExpansion2 -inputScript 'dayhand settings ' -cursorColumn 17).CompletionMatches | ForEach-Object { $_.CompletionText }",
    ].join("; ");
    expect(run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script])).toEqual(["done", "get", "set"]);
  }, 60_000);
});

describe.skipIf(!has("fish"))("fish", () => {
  test("complete -C offers dayhand's candidates", () => {
    const lines = run("fish", ["--no-config", "-c", 'dayhand completion fish | source; complete -C "dayhand do"']);
    expect(lines.map((l) => l.split("\t")[0])).toEqual(["done"]);
  });
});
