// Questions on a terminal (callers check that one is attached). A hidden
// answer, such as an API key, is read in raw mode and never echoed.
import { createInterface } from "node:readline/promises";
import { CliError } from "./exit.js";
import type { Io } from "./io.js";

export async function confirm(io: Io, question: string): Promise<boolean> {
  return /^y(es)?$/i.test((await ask(io, `${question} [y/N] `)).trim());
}

export async function ask(io: Io, question: string): Promise<string> {
  const rl = createInterface({ input: io.stdin, output: io.stderr as NodeJS.WritableStream });
  const interrupted = new Promise<never>((_, reject) => rl.once("SIGINT", () => reject(interrupt())));
  try {
    return await Promise.race([rl.question(question), interrupted]);
  } finally {
    rl.close();
  }
}

const interrupt = () => new CliError("interrupted", "Interrupted; nothing was changed");

type RawInput = Io["stdin"] & { setRawMode?: (mode: boolean) => unknown };

/** Reads one line without echoing it. Ctrl-C exits with 130, Ctrl-D ends the input. */
export async function askHidden(io: Io, question: string): Promise<string> {
  const stdin = io.stdin as RawInput;
  if (typeof stdin.setRawMode !== "function") return ask(io, question);
  stdin.setRawMode(true);
  try {
    io.stderr.write(question);
    stdin.setEncoding("utf8");
    stdin.resume();
    return await new Promise<string>((resolve, reject) => {
      let answer = "";
      const onData = (chunk: string) => {
        for (const char of chunk) {
          if (char === "\u0003") return finish(() => reject(interrupt()));
          if (char === "\r" || char === "\n" || char === "\u0004") return finish(() => resolve(answer));
          if (char === "\u007f" || char === "\b") answer = answer.slice(0, -1);
          else if (char >= " ") answer += char;
        }
      };
      const finish = (done: () => void) => {
        stdin.removeListener("data", onData);
        done();
      };
      stdin.on("data", onData);
    });
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
    io.stderr.write("\n");
  }
}
