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
};

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

/** Try the native clipboard first, then ask the terminal (also over SSH) via OSC 52. */
export async function copyText(text: string, options: ClipboardOptions = {}): Promise<ClipboardMethod> {
  const platform = options.platform ?? process.platform;
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
  const write = options.writeOsc52 === undefined ? (process.stdout.isTTY ? (sequence: string) => { writeSync(process.stdout.fd, sequence); } : null) : options.writeOsc52;
  if (!write) throw new ClipboardError(failed ? "failed" : "unavailable", cause);
  try {
    write(`\u001b]52;c;${Buffer.from(text, "utf8").toString("base64")}\u0007`);
    return "osc52";
  } catch (error) {
    throw new ClipboardError("failed", error);
  }
}
