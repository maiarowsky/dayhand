// Starts hlm ui on the terminal: Ink in the alternate screen (the shell's
// scrollback comes back on quit), SGR mouse reports for clicks and the wheel,
// and the terminal restored on every way out (q, C-c, a crash, a signal).
import { writeSync } from "node:fs";
import { render } from "ink";
import { createElement } from "react";
import { App } from "./app.js";
import type { Api } from "./api.js";
import { Controller } from "./controller.js";
import type { ViewName } from "./state.js";

// Button presses and the wheel (1000), reported as SGR coordinates (1006).
const MOUSE_ON = "\u001b[?1000h\u001b[?1006h";
const MOUSE_OFF = "\u001b[?1000l\u001b[?1006l";

export type UiOptions = {
  api: Api;
  view: ViewName;
  interval: number;
  mouse: boolean;
  color: boolean;
  editText: (text: string, fileName: string) => string;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
};

export async function runUi(options: UiOptions): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const fd = stdout === process.stdout ? 1 : undefined;
  const mouse = (on: boolean) => {
    if (!options.mouse) return;
    // Synchronous, so the sequence is out even when the process is exiting.
    if (fd !== undefined) writeSync(fd, on ? MOUSE_ON : MOUSE_OFF);
    else stdout.write(on ? MOUSE_ON : MOUSE_OFF);
  };
  const controller = new Controller({
    api: options.api,
    view: options.view,
    interval: options.interval,
    columns: stdout.columns,
    rows: stdout.rows,
    editText: options.editText,
    beforeEditor: () => mouse(false),
    afterEditor: () => mouse(true),
  });
  const restore = () => mouse(false);
  process.once("exit", restore);
  mouse(true);
  try {
    const app = render(createElement(App, { controller, color: options.color }), {
      stdin: options.stdin ?? process.stdin,
      stdout,
      alternateScreen: true,
      exitOnCtrlC: false,
      patchConsole: true,
    });
    await app.waitUntilExit();
  } finally {
    controller.stop();
    restore();
    process.removeListener("exit", restore);
  }
}
