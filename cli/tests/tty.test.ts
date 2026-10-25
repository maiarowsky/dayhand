// Smoke tests on a real pseudo-terminal (node-pty): the --yes prompt, the
// hidden key prompt, Ctrl-C, $EDITOR for note and edit, the board's columns.
// node-pty ships prebuilt binaries for macOS and Windows only; where it cannot
// start (Linux without a build toolchain) these tests are skipped.
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { helm, dayhandJson, newUser, TEST_HOME } from "./helpers.js";

type Pty = typeof import("node-pty");
const BIN = fileURLToPath(new URL("../dist/bin/dayhand.js", import.meta.url));

function loadPty(): Pty | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pty = require("node-pty") as Pty;
    // `npm ci --ignore-scripts` skips node-pty's postinstall, which marks its helper executable.
    const helper = join(dirname(require.resolve("node-pty/package.json")), "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
    if (existsSync(helper) && (statSync(helper).mode & 0o111) === 0) chmodSync(helper, 0o755);
    pty.spawn(process.execPath, ["-e", ""], {}).kill();
    return pty;
  } catch {
    return undefined;
  }
}

const pty = loadPty();
const work = mkdtempSync(join(process.env.DAYHAND_TEST_TMPDIR ?? tmpdir(), "dayhand-tty-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

type Session = { output: () => string; waitFor: (text: string | RegExp) => Promise<void>; write: (data: string) => void; exit: Promise<number>; kill(): void };

function session(args: string[], env: Record<string, string>, cols = 100): Session {
  const term = pty!.spawn(process.execPath, [BIN, ...args], {
    cols,
    rows: 30,
    env: { PATH: process.env.PATH ?? "", DAYHAND_CONFIG_DIR: join(TEST_HOME, "tty-config"), DAYHAND_CACHE_DIR: join(TEST_HOME, "tty-cache"), DAYHAND_CREDENTIAL_STORE: "file", DAYHAND_URL: helm().siteUrl, TERM: "xterm-256color", NO_COLOR: "1", ...env },
  });
  let output = "";
  term.onData((data) => (output += data));
  const exit = new Promise<number>((resolve) => term.onExit(({ exitCode }) => resolve(exitCode)));
  const waitFor = async (text: string | RegExp) => {
    const deadline = Date.now() + 15_000;
    while (!(typeof text === "string" ? output.includes(text) : text.test(output))) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${text}; got: ${JSON.stringify(output)}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  return { output: () => output, waitFor, write: (data) => term.write(data), exit, kill: () => term.kill() };
}

/** An "editor" that runs as node: rewrites the file it is given. */
function editor(name: string, body: string): string {
  const file = join(work, `${name}.mjs`);
  writeFileSync(file, `import { readFileSync, writeFileSync } from "node:fs";\nconst file = process.argv.at(-1);\nconst text = readFileSync(file, "utf8");\n${body}\n`);
  return `"${process.execPath}" "${file}"`;
}

describe.skipIf(!pty)("on a terminal", () => {
  test("changing three tasks asks first; y confirms", async () => {
    const { key } = await newUser();
    for (const t of ["A", "B", "C"]) await dayhandJson(key, ["add", t]);
    const s = session(["rm", "1", "2", "3"], { DAYHAND_API_KEY: key });
    await s.waitFor("Delete 3 tasks? [y/N] ");
    s.write("y\r");
    expect(await s.exit).toBe(0);
    expect(s.output()).toContain("Moved to the trash:");
    expect((await dayhandJson(key, ["trash"])).result).toHaveLength(3);
  });

  test("global --no-input after project assign refuses without prompting on a real terminal", async () => {
    const { key } = await newUser();
    await dayhandJson(key, ["project", "add", "Home"]);
    for (const title of ["A", "B"]) await dayhandJson(key, ["add", title]);
    const s = session(["project", "assign", "Home", "1", "2", "--no-input"], { DAYHAND_API_KEY: key });
    try {
      await s.waitFor("without --yes");
      expect(await s.exit).toBe(2);
      expect(s.output()).not.toContain("[y/N]");
      expect((await dayhandJson(key, ["list", "-p", "none"])).total).toBe(2);
    } finally { s.kill(); }
  });

  test("dayhand login reads the key at a hidden prompt and never echoes it; Ctrl-C exits with 130", async () => {
    const { key } = await newUser();
    const s = session(["login", "--url", helm().siteUrl], {});
    await s.waitFor("API key (input hidden): ");
    s.write(`${key}\r`);
    expect(await s.exit).toBe(0);
    expect(s.output()).toContain("Signed in to");
    expect(s.output()).not.toContain(key);
    const who = session(["whoami"], {});
    expect(await who.exit).toBe(0);
    expect(who.output()).toMatch(/key +from the credentials file/);

    const interrupted = session(["login", "--url", helm().siteUrl], {});
    await interrupted.waitFor("API key (input hidden): ");
    interrupted.write("helm_part\u0003");
    expect(await interrupted.exit).toBe(130);
    expect(interrupted.output()).toContain("Interrupted; nothing was changed");
  });

  test("dayhand note <ref> and dayhand edit <ref> open $EDITOR; an unchanged file sends nothing", async () => {
    const { key } = await newUser();
    await dayhandJson(key, ["add", "Draft", "--note", "outline"]);
    const append = editor("append", 'writeFileSync(file, text.trimEnd() + "\\nintro written\\n");');
    const note = session(["note", "1"], { DAYHAND_API_KEY: key, EDITOR: append });
    expect(await note.exit).toBe(0);
    expect(note.output()).toContain("Note updated:");
    expect((await dayhandJson(key, ["show", "1"])).task.note).toBe("outline\nintro written");

    const retitle = editor("retitle", 'writeFileSync(file, text.replace(/^Draft/, "Final draft"));');
    const edit = session(["edit", "1"], { DAYHAND_API_KEY: key, VISUAL: retitle, EDITOR: "false" });
    expect(await edit.exit).toBe(0);
    expect((await dayhandJson(key, ["show", "1"])).task).toMatchObject({ title: "Final draft", note: "outline\nintro written" });

    const untouched = session(["note", "1"], { DAYHAND_API_KEY: key, EDITOR: editor("noop", "") });
    expect(await untouched.exit).toBe(0);
    expect(untouched.output()).toContain("Note unchanged");
    expect((await dayhandJson(key, ["show", "1"])).history).toHaveLength(3);
  });

  test("the board shows its columns side by side on a wide terminal", async () => {
    const { key } = await newUser();
    await dayhandJson(key, ["add", "Write the report"]);
    await dayhandJson(key, ["add", "Call", "--status", "doing"]);
    const s = session(["board"], { DAYHAND_API_KEY: key }, 120);
    expect(await s.exit).toBe(0);
    expect(s.output()).toMatch(/TODO \(1\) +DOING \(1\) +DONE \(0\)/);
    expect(s.output()).toMatch(/#1 Write the report +#2 Call +\(empty\)/);
  });
});
