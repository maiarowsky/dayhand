// hlm ui: the full-screen terminal app (src/ui/). Ink and React load only
// here, so every other command starts as fast as before.
import { usageError } from "../core/exit.js";
import type { ViewName } from "../ui/state.js";
import type { CommandSpec } from "./types.js";

const VIEWS: ViewName[] = ["today", "board", "week", "trash"];
const INTERVAL = { min: 10, max: 300, default: 12 };
/** A hung server must not keep a change waiting for the default 30 s. */
const TIMEOUT_MS = 10_000;

export const uiCommands: CommandSpec[] = [
  {
    name: "ui",
    summary: "Helm full screen in the terminal: Today, board, week and trash, with keys like vim and lazygit (hlm help ui)",
    description:
      "Needs a terminal. Refreshes every 12 s by default, within the key's limits of 120 reads and 60 changes a minute. " +
      "q quits, ? lists the keys; hlm help ui prints them.",
    options: [
      { flags: "--view <view>", description: "The view to open with", choices: VIEWS },
      { flags: "--interval <seconds>", description: `Seconds between refreshes, ${INTERVAL.min} to ${INTERVAL.max} (default ${INTERVAL.default})`, kind: "int" },
      { flags: "--no-mouse", description: "Leave the mouse to the terminal (for selecting text)" },
    ],
    tools: ["list_today", "board", "list_all", "list_trash", "get_task", "get_settings", "add_task", "update_task", "set_status", "set_now", "complete_task", "reschedule_task", "delete_task", "restore_task"],
    dryRun: false,
    examples: ["hlm ui", "hlm ui --view week", "hlm ui --interval 30 --no-mouse"],
    run: async (ctx, _args, opts) => {
      if (ctx.format !== "human") throw usageError("hlm ui is for a terminal; scripts use hlm today --json, hlm board --json or hlm list --json");
      if (!ctx.interactive) throw usageError("hlm ui needs a terminal (stdin and stdout) and input allowed (no --no-input or HLM_NO_INPUT)", { hint: "hlm today" });
      const interval = (opts.interval as number | undefined) ?? INTERVAL.default;
      if (interval < INTERVAL.min || interval > INTERVAL.max) throw usageError(`--interval must be ${INTERVAL.min} to ${INTERVAL.max} seconds`);
      const { connection } = await ctx.client();
      const [{ HelmClient }, { makeApi }, { runUi }] = await Promise.all([import("../transport/client.js"), import("../ui/api.js"), import("../ui/run.js")]);
      await runUi({
        api: makeApi(new HelmClient(connection, ctx.io.fetch, undefined, TIMEOUT_MS)),
        view: (opts.view as ViewName | undefined) ?? "today",
        interval,
        mouse: opts.mouse !== false,
        color: ctx.color(),
        editText: (text, fileName) => ctx.edit(text, fileName),
      });
      return { value: null, view: { kind: "text", text: "" } };
    },
  },
];
