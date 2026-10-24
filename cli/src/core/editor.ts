// Opens $VISUAL or $EDITOR (only ever on a terminal) on a private temporary
// file and returns what was saved. The editor string may carry arguments
// ("code --wait"); it is split without a shell, except on Windows, where
// editors are often .cmd scripts that only cmd.exe can start.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Env } from "../config/env.js";
import { CliError } from "./exit.js";
import { splitWords } from "./words.js";

export function editorCommand(env: Env, platform: NodeJS.Platform = process.platform): string {
  return env.VISUAL?.trim() || env.EDITOR?.trim() || (platform === "win32" ? "notepad" : "vi");
}

export function editText(env: Env, initial: string, fileName: string, platform: NodeJS.Platform = process.platform): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dayhand-"));
  const file = path.join(dir, fileName);
  try {
    writeFileSync(file, initial, { mode: 0o600 });
    const command = editorCommand(env, platform);
    const result =
      platform === "win32"
        ? spawnSync(`${command} "${file}"`, { stdio: "inherit", shell: true })
        : (() => {
            const [program, ...args] = splitWords(command);
            return spawnSync(program!, [...args, file], { stdio: "inherit" });
          })();
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code ?? "error";
      throw new CliError("usage", `Cannot start the editor (${code}); set VISUAL or EDITOR`, {}, { cause: result.error });
    }
    if (result.status !== 0) throw new CliError("internal", `The editor exited with status ${result.status}; nothing was changed`);
    return readFileSync(file, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
