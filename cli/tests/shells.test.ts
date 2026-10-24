// The completion scripts in the real shells that are installed (bash, zsh,
// PowerShell, fish), with `dayhand` on the PATH, against the real local backend.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { helm, dayhandJson, newUser, TEST_HOME } from "./helpers.js";

const BIN = fileURLToPath(new URL("../dist/bin/dayhand.js", import.meta.url));
const dir = mkdtempSync(join(process.env.DAYHAND_TEST_TMPDIR ?? tmpdir(), "dayhand-shells-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const has = (shell: string) => process.platform !== "win32" && spawnSync(shell, ["-c", "exit 0"]).status === 0;
const cacheDir = join(TEST_HOME, "shell-cache");

// `dayhand` on the PATH, as after npm install -g.
writeFileSync(join(dir, "dayhand"), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`);
chmodSync(join(dir, "dayhand"), 0o755);

function run(shell: string, args: string[], key?: string) {
  const env = {
    PATH: `${dir}${delimiter}${process.env.PATH}`,
    HOME: TEST_HOME,
    DAYHAND_CONFIG_DIR: join(TEST_HOME, "shell-config"),
    DAYHAND_CACHE_DIR: cacheDir,
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
