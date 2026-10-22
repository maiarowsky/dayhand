// The process boundary, injectable so commands can be tested without spawning.
import type { Env } from "../config/env.js";

export type Stream = { write(chunk: string): unknown; isTTY?: boolean };

export type Io = {
  stdout: Stream;
  stderr: Stream;
  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  env: Env;
  fetch?: typeof fetch;
};

export const processIo = (): Io => ({
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
  env: process.env,
});

/** Reads all of stdin as text (for `-` arguments). */
export async function readStdin(stdin: Io["stdin"]): Promise<string> {
  let text = "";
  stdin.setEncoding("utf8");
  for await (const chunk of stdin) text += chunk;
  return text;
}
