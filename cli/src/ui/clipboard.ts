// Plain task context for a chat, copied without changing anything on the server.
import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import type { Task } from "../render/model.js";

const CLIPBOARD_TIMEOUT_MS = 3000;
export type ClipboardMethod = "system" | "osc52";
type Run = (command: string, args: string[], input: Buffer) => Promise<void>;
export type ClipboardOptions = {
  platform?: NodeJS.Platform;
  run?: Run;
  /** Raw terminal output, outside Ink's patched stdout; null disables OSC 52. */
  writeOsc52?: ((sequence: string) => void) | null;
  /** Read for SSH_CONNECTION, SSH_CLIENT and SSH_TTY. */
  env?: NodeJS.ProcessEnv;
};

/** Over SSH the host's clipboard is not the one in front of the user. */
function overSsh(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
}

export class ClipboardError extends Error {
  constructor(readonly reason: "unavailable" | "failed", cause?: unknown) {
    super(`Clipboard ${reason}`, { cause });
  }
}

/** Stable English field names, full values, no screen layout or ANSI colours. */
export function taskText(task: Task): string {
  const due = [task.dueDate, task.dueTime].filter(Boolean).join(" ");
  const project = task.project ?? task.projectId;
  const lines = [
    `ID: ${task.id}`,
    ...(task.ref === undefined ? [] : [`Ref: #${task.ref}`]),
    `Title: ${task.title}`,
    `Status: ${task.status}`,
    ...(project ? [`Project: ${project}`] : []),
    ...(due ? [`Due: ${due}`] : []),
    ...(task.note ? [`Note:\n${task.note}`] : []),
    ...(task.resumeNote ? [`Resume note: ${task.resumeNote}`] : []),
  ];
  return stripVTControlCharacters(lines.join("\n")).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
}

function runCommand(command: string, args: string[], input: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"], windowsHide: true, timeout: CLIPBOARD_TIMEOUT_MS, killSignal: "SIGKILL" });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error("Clipboard command failed")));
    child.stdin.end(input);
  });
}

/**
 * Try the native clipboard first, then ask the terminal via OSC 52. Over SSH the
 * terminal goes first: the host's pbcopy or xclip would succeed on the wrong machine.
 */
export async function copyText(text: string, options: ClipboardOptions = {}): Promise<ClipboardMethod> {
  const platform = options.platform ?? process.platform;
  const write = options.writeOsc52 === undefined ? (process.stdout.isTTY ? (sequence: string) => { writeSync(process.stdout.fd, sequence); } : null) : options.writeOsc52;
  if (write && overSsh(options.env ?? process.env)) return osc52(text, write);
  const commands: [string, string[]][] = platform === "darwin" ? [["pbcopy", []]]
    : platform === "win32" ? [["clip", []]]
    : platform === "linux" ? [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]] : [];
  // clip.exe recognizes UTF-16LE with a BOM; the Unix tools read UTF-8.
  const input = platform === "win32" ? Buffer.from(`\ufeff${text}`, "utf16le") : Buffer.from(text, "utf8");
  let cause: unknown;
  let failed = false;
  for (const [command, args] of commands) {
    try {
      await (options.run ?? runCommand)(command, args, input);
      return "system";
    } catch (error) {
      cause = error;
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) failed = true;
    }
  }
  if (!write) throw new ClipboardError(failed ? "failed" : "unavailable", cause);
  return osc52(text, write);
}

function osc52(text: string, write: (sequence: string) => void): ClipboardMethod {
  try {
    write(`\u001b]52;c;${Buffer.from(text, "utf8").toString("base64")}\u0007`);
    return "osc52";
  } catch (error) {
    throw new ClipboardError("failed", error);
  }
}
