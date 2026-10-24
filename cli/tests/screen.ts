// dayhand ui on a real pseudo-terminal (node-pty), its output fed to a headless
// xterm so tests read the screen as a person sees it, alternate screen
// included. DAYHAND_UI_SCREENS=<dir> also saves each named screen there as text.
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import xterm from "@xterm/headless";

type Pty = typeof import("node-pty");
const BIN = fileURLToPath(new URL("../dist/bin/dayhand.js", import.meta.url));

export function loadPty(): Pty | undefined {
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

export const KEYS: Record<string, string> = {
  enter: "\r",
  esc: "\u001b",
  tab: "\t",
  "S-tab": "\u001b[Z",
  up: "\u001b[A",
  down: "\u001b[B",
  right: "\u001b[C",
  left: "\u001b[D",
  space: " ",
  backspace: "\u007f",
  "C-c": "\u0003",
  "C-u": "\u0015",
};

export type UiSession = {
  /** The visible screen, one line per row, trailing spaces dropped. */
  screen(): Promise<string>;
  waitFor(text: string | RegExp, timeoutMs?: number): Promise<string>;
  /** Keys by name (KEYS) or literal text, each sent on its own with a short pause, as typed. */
  press(...keys: string[]): Promise<void>;
  /** A left click at a cell (from 0), press and release. */
  click(x: number, y: number): Promise<void>;
  resize(columns: number, rows: number): void;
  /** Saves the screen as <name>.txt in DAYHAND_UI_SCREENS (when set). */
  shot(name: string): Promise<string>;
  raw(): string;
  exit: Promise<number>;
  kill(): void;
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function uiSession(pty: Pty, args: string[], env: Record<string, string>, size = { columns: 100, rows: 24 }): UiSession {
  const term = new xterm.Terminal({ cols: size.columns, rows: size.rows, allowProposedApi: true });
  const child = pty.spawn(process.execPath, [BIN, "ui", ...args], { cols: size.columns, rows: size.rows, env: { TERM: "xterm-256color", ...env } });
  let raw = "";
  child.onData((data) => {
    raw += data;
    term.write(data);
  });
  const exit = new Promise<number>((resolve) => child.onExit(({ exitCode }) => resolve(exitCode)));
  const screen = async () => {
    await new Promise<void>((resolve) => term.write("", resolve));
    const buffer = term.buffer.active;
    return Array.from({ length: term.rows }, (_, i) => buffer.getLine(buffer.viewportY + i)?.translateToString(true) ?? "").join("\n");
  };
  const waitFor = async (text: string | RegExp, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const now = await screen();
      if (typeof text === "string" ? now.includes(text) : text.test(now)) return now;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${text}; the screen:\n${now}`);
      await pause(40);
    }
  };
  return {
    screen,
    waitFor,
    press: async (...keys) => {
      for (const key of keys) {
        child.write(KEYS[key] ?? key);
        await pause(key === "esc" ? 120 : 40);
      }
    },
    click: async (x, y) => {
      child.write(`\u001b[<0;${x + 1};${y + 1}M\u001b[<0;${x + 1};${y + 1}m`);
      await pause(60);
    },
    resize: (columns, rows) => {
      child.resize(columns, rows);
      term.resize(columns, rows);
    },
    shot: async (name) => {
      await pause(150);
      const text = await screen();
      const dir = process.env.DAYHAND_UI_SCREENS;
      if (dir) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${name}.txt`), `${text.replace(/\s+$/gm, "")}\n`);
      }
      return text;
    },
    raw: () => raw,
    exit,
    kill: () => child.kill(),
  };
}
