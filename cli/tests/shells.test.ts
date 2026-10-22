// The completion scripts in the real shells that are installed (bash, zsh,
// PowerShell, fish), with `hlm` on the PATH, against the real local backend.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { helm, hlmJson, newUser, TEST_HOME } from "./helpers.js";

const BIN = fileURLToPath(new URL("../dist/bin/hlm.js", import.meta.url));
const dir = mkdtempSync(join(process.env.HLM_TEST_TMPDIR ?? tmpdir(), "hlm-shells-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const has = (shell: string) => process.platform !== "win32" && spawnSync(shell, ["-c", "exit 0"]).status === 0;
const cacheDir = join(TEST_HOME, "shell-cache");

// `hlm` on the PATH, as after npm install -g.
writeFileSync(join(dir, "hlm"), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`);
chmodSync(join(dir, "hlm"), 0o755);

function run(shell: string, args: string[], key?: string) {
  const env = {
    PATH: `${dir}${delimiter}${process.env.PATH}`,
    HOME: TEST_HOME,
    HLM_CONFIG_DIR: join(TEST_HOME, "shell-config"),
    HLM_CACHE_DIR: cacheDir,
    HLM_CREDENTIAL_STORE: "file",
    HLM_URL: helm().siteUrl,
    ...(key ? { HLM_API_KEY: key } : {}),
  };
  const result = spawnSync(shell, args, { env, encoding: "utf8", timeout: 30_000 });
  return result.stdout.split("\n").filter(Boolean);
}

const bash = (words: string[], key?: string) =>
  run("bash", ["-c", `source <(hlm completion bash); COMP_WORDS=(${words.map((w) => `'${w}'`).join(" ")}); COMP_CWORD=${words.length - 1}; _hlm_complete; printf '%s\\n' "\${COMPREPLY[@]}"`], key);

describe.skipIf(!has("bash"))("bash", () => {
  test("commands, options and task numbers from the server, cached for 60 s", async () => {
    expect(bash(["hlm", "do"])).toEqual(["done"]);
    expect(bash(["hlm", "list", "--ov"])).toEqual(["--overdue"]);
    const { key } = await newUser();
    await hlmJson(key, ["add", "Call the bank"]);
    await hlmJson(key, ["add", "Write the report"]);
    expect(bash(["hlm", "done", ""], key)).toEqual(["now", "1", "2"]);
    const cached = readdirSync(cacheDir).filter((f) => f.startsWith("tasks-"));
    expect(cached).toHaveLength(1);
    expect(statSync(join(cacheDir, cached[0]!)).mode & 0o777).toBe(0o600);
    await hlmJson(key, ["add", "Third"]);
    expect(bash(["hlm", "done", ""], key)).toEqual(["now", "1", "2"]); // still the cached list
  });
});

describe.skipIf(!has("zsh"))("zsh", () => {
  test("the script parses and offers values with descriptions", async () => {
    expect(spawnSync("zsh", ["-n", "-c", run("bash", ["-c", "hlm completion zsh"]).join("\n")]).status).toBe(0);
    const script = [
      "compdef() { :; }",
      "_describe() { print -l -- ${(P)4} }",
      "_files() { print FILES }",
      'eval "$(hlm completion zsh)"',
      "words=(hlm settings ''); CURRENT=3; _hlm",
      "words=(hlm export -o ''); CURRENT=4; _hlm",
    ].join("\n");
    const lines = run("zsh", ["-f", "-c", script]);
    expect(lines).toEqual(["get:Show settings", expect.stringMatching(/^set:Change settings/), "FILES"]);
  });
});

describe.skipIf(!has("pwsh"))("PowerShell", () => {
  test("TabExpansion2 offers hlm's candidates", () => {
    const script = [
      "hlm completion powershell | Out-String | Invoke-Expression",
      "(TabExpansion2 -inputScript 'hlm do' -cursorColumn 6).CompletionMatches | ForEach-Object { $_.CompletionText }",
      "(TabExpansion2 -inputScript 'hlm settings ' -cursorColumn 13).CompletionMatches | ForEach-Object { $_.CompletionText }",
    ].join("; ");
    expect(run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script])).toEqual(["done", "get", "set"]);
  }, 60_000);
});

describe.skipIf(!has("fish"))("fish", () => {
  test("complete -C offers hlm's candidates", () => {
    const lines = run("fish", ["--no-config", "-c", 'hlm completion fish | source; complete -C "hlm do"']);
    expect(lines.map((l) => l.split("\t")[0])).toEqual(["done"]);
  });
});
