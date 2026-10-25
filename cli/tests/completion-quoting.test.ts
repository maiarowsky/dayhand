// Real shell line editors insert project candidates from the local backend.
// Capture their editing buffer with a fixed widget; never execute the completed line.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { HOSTILE_PROJECT_NAMES } from "./fixtures/hostile-projects.js";
import { dayhandJson, helm, newUser, TEST_HOME } from "./helpers.js";
import { loadPty } from "./screen.js";

const pty = loadPty();
const has = (shell: string) => process.platform !== "win32" && spawnSync(shell, ["-c", "exit 0"]).status === 0;
const dir = mkdtempSync(join(TEST_HOME, "quoting-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const bin = fileURLToPath(new URL("../dist/bin/dayhand.js", import.meta.url));
writeFileSync(join(dir, "dayhand"), `#!/bin/sh\nexec "${process.execPath}" "${bin}" "$@"\n`);
chmodSync(join(dir, "dayhand"), 0o755);

const PREFIX = "dayhand add Menu -p ";
const START = "__CAPTURE_START__";
const END = "__CAPTURE_END__";
const READY = "__QUOTING_READY__";

function config(shell: "bash" | "zsh"): string {
  const common = `source <(dayhand completion ${shell})\n`;
  return shell === "bash" ? common + [
    `PS1='${READY} '`,
    `_dayhand_capture() { printf '\\n${START}%s${END}\\n' "$READLINE_LINE"; READLINE_LINE=''; READLINE_POINT=0; }`,
    `bind -x '"\\C-x\\C-p":_dayhand_capture'`,
  ].join("\n") : [
    "autoload -Uz compinit; compinit -D -i",
    common,
    `PROMPT='${READY} '`,
    `_dayhand_capture() { print -r -- "${START}\${BUFFER}${END}"; BUFFER=''; CURSOR=0; zle reset-prompt; }`,
    "zle -N _dayhand_capture",
    "bindkey '^X^P' _dayhand_capture",
    "zstyle ':completion:*' menu no",
  ].join("\n");
}

async function captures(shell: "bash" | "zsh", key: string, inputs = HOSTILE_PROJECT_NAMES.map((name) => name.slice(0, 3))): Promise<string[]> {
  const rc = join(dir, `${shell}.rc`);
  writeFileSync(rc, config(shell));
  const args = shell === "bash" ? ["--noprofile", "--rcfile", rc, "-i"] : ["-f", "-i"];
  const child = pty!.spawn(shell, args, { cols: 180, rows: 20, env: {
    PATH: `${dir}${delimiter}${process.env.PATH}`, HOME: TEST_HOME, TERM: "xterm-256color",
    DAYHAND_CONFIG_DIR: join(dir, "config"), DAYHAND_CACHE_DIR: mkdtempSync(join(dir, `${shell}-cache-`)),
    DAYHAND_CREDENTIAL_STORE: "file", DAYHAND_URL: helm().siteUrl, DAYHAND_API_KEY: key,
  } });
  let output = "";
  child.onData((data) => { output += data; });
  async function waitFor(text: string, since = 0): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!output.slice(since).includes(text)) {
      if (Date.now() > deadline) throw new Error(`No ${text} from ${shell}: ${JSON.stringify(output.slice(since))}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  try {
    if (shell === "zsh") child.write(`source '${rc}'\r`);
    await waitFor(READY);
    const lines: string[] = [];
    for (const input of inputs) {
      const since = output.length;
      child.write(`${PREFIX}${input}\t\u0018\u0010`);
      await waitFor(END, since);
      const captured = output.slice(since).split(START).at(-1)!.split(END)[0]!;
      lines.push(captured.trimEnd());
    }
    return lines;
  } finally { child.kill(); }
}

// The fixtures are ASCII; each unsafe byte must be escaped in the actual editing
// buffer. This asserts the public inserted command, not source-code substrings.
const escaped = (name: string) => name.replace(/([^a-zA-Z0-9_./:-])/g, "\\$1");

for (const shell of ["bash", "zsh"] as const) {
  describe.skipIf(!pty || !has(shell))(`${shell} candidate insertion`, () => {
    test("hostile project names are quoted in the real line editor without executing them", async () => {
      const { key } = await newUser();
      for (const name of HOSTILE_PROJECT_NAMES) await dayhandJson(key, ["project", "add", name]);
      const lines = await captures(shell, key);
      expect(lines).toEqual(HOSTILE_PROJECT_NAMES.map((name) => PREFIX + escaped(name)));
    }, 60_000);

    test.skipIf(!has("zsh"))("partial quoted prefixes cannot turn a candidate into shell code", async () => {
      const { key } = await newUser();
      const name = HOSTILE_PROJECT_NAMES[6]!;
      await dayhandJson(key, ["project", "add", name]);
      const inputs = ["'q06", '"q06', "q06'"];
      const lines = await captures(shell, key, inputs);
      for (const [index, line] of lines.entries()) {
        // A shell that does not complete a quoted prefix must leave it alone.
        if (line === PREFIX + inputs[index]) continue;
        // zsh's native lexical splitter and quote-removal flag parse data without
        // evaluating it; no candidate is ever submitted as a shell command.
        const parsed = spawnSync("zsh", ["-fc", 'words=(${(z)1}); print -r -- $#words; for word in $words; do print -r -- ${(Q)word}; done', "--", line], { encoding: "utf8" });
        expect(parsed.status, line).toBe(0);
        expect(parsed.stdout.trimEnd().split("\n"), line).toEqual(["5", "dayhand", "add", "Menu", "-p", name]);
      }
    }, 60_000);
  });
}
