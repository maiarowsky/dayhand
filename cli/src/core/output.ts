// Data goes to stdout, diagnostics to stderr. With --json, stdout carries only
// the result and stderr only JSON lines ({"warning":…} or {"error":…}), so
// `| jq` never sees an error as data.
import type { Format, Warning } from "../config/env.js";
import type { CliError } from "./exit.js";
import type { Io } from "./io.js";

export class Output {
  constructor(
    private readonly io: Io,
    readonly format: Format,
  ) {}

  /** Indented on a terminal, one line in a pipe. */
  json(value: unknown): void {
    const text = this.io.stdout.isTTY ? JSON.stringify(value, null, 2) : JSON.stringify(value);
    this.io.stdout.write(text + "\n");
  }

  text(text: string): void {
    if (text !== "") this.io.stdout.write(text.endsWith("\n") ? text : text + "\n");
  }

  warn(warning: Warning): void {
    if (this.format === "json") this.io.stderr.write(JSON.stringify({ warning }) + "\n");
    else this.io.stderr.write(`hlm: warning: ${warning.message}\n`);
  }

  error(error: CliError): void {
    const { retryable = false, clientId, hint, valid, ref } = error.details;
    if (this.format === "json") {
      const body = { code: error.code, message: error.message, exitCode: error.exitCode, retryable, clientId, ref, valid, hint };
      this.io.stderr.write(JSON.stringify({ error: body }) + "\n");
      return;
    }
    const lines = [`hlm: ${error.message}${ref ? ` (task ${ref})` : ""}`];
    if (valid?.length) lines.push(`Valid: ${valid.join(", ")}`);
    if (retryable && clientId) lines.push(`It may have been applied. Retry safely with: --client-id ${clientId}`);
    if (hint) lines.push(`Try: ${hint}`);
    this.io.stderr.write(lines.join("\n") + "\n");
  }
}
