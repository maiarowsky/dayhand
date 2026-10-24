// dayhand ui: the full-screen terminal app (src/ui/). Ink and React load only
// here, so every other command starts as fast as before.
import { usageError } from "../core/exit.js";
import { LANGUAGES, matchLanguage, resolveLanguage } from "../i18n/index.js";
import type { ViewName } from "../ui/state.js";
import type { CommandSpec } from "./types.js";

const VIEWS: ViewName[] = ["today", "board", "week", "trash"];
const INTERVAL = { min: 10, max: 300, default: 12 };
/** A hung server must not keep a change waiting for the default 30 s. */
const TIMEOUT_MS = 10_000;

export const uiCommands: CommandSpec[] = [
  {
    name: "ui",
    summary: "Dayhand full screen in the terminal: Today, board, week and trash, with keys like vim and lazygit (dayhand help ui)",
    description:
      "Needs a terminal. Refreshes every 12 s by default, within the key's limits of 120 reads and 60 changes a minute. " +
      "q quits, ? lists the keys; dayhand help ui prints them. The screens speak the terminal's language (LC_ALL, LC_MESSAGES " +
      `or LANG, overridden by DAYHAND_LANG or --lang) when it is one of ${LANGUAGES.join(", ")}, else English; ` +
      "date phrases stay English.",
    options: [
      { flags: "--view <view>", description: "The view to open with", choices: VIEWS },
      { flags: "--interval <seconds>", description: `Seconds between refreshes, ${INTERVAL.min} to ${INTERVAL.max} (default ${INTERVAL.default})`, kind: "int" },
      { flags: "--no-mouse", description: "Leave the mouse to the terminal (for selecting text)" },
      { flags: "--lang <language>", description: `The screens' language: ${LANGUAGES.join(", ")} (default: DAYHAND_LANG, then the locale)` },
    ],
    tools: ["list_today", "board", "list_all", "list_trash", "get_task", "get_settings", "add_task", "update_task", "set_status", "set_now", "complete_task", "reschedule_task", "delete_task", "restore_task"],
    dryRun: false,
    examples: ["dayhand ui", "dayhand ui --view week", "dayhand ui --interval 30 --no-mouse", "dayhand ui --lang pl"],
    run: async (ctx, _args, opts) => {
      if (ctx.format !== "human") throw usageError("dayhand ui is for a terminal; scripts use dayhand today --json, dayhand board --json or dayhand list --json");
      if (!ctx.interactive) throw usageError("dayhand ui needs a terminal (stdin and stdout) and input allowed (no --no-input or DAYHAND_NO_INPUT)", { hint: "dayhand today" });
      const interval = (opts.interval as number | undefined) ?? INTERVAL.default;
      if (interval < INTERVAL.min || interval > INTERVAL.max) throw usageError(`--interval must be ${INTERVAL.min} to ${INTERVAL.max} seconds`);
      const lang = opts.lang as string | undefined;
      if (lang !== undefined && !matchLanguage(lang)) throw usageError(`--lang must be one of ${LANGUAGES.join(", ")}`, { valid: [...LANGUAGES] });
      const { connection } = await ctx.client();
      const [{ DayhandClient }, { makeApi }, { runUi }] = await Promise.all([import("../transport/client.js"), import("../ui/api.js"), import("../ui/run.js")]);
      await runUi({
        api: makeApi(new DayhandClient(connection, ctx.io.fetch, undefined, TIMEOUT_MS)),
        view: (opts.view as ViewName | undefined) ?? "today",
        interval,
        mouse: opts.mouse !== false,
        language: resolveLanguage(lang, ctx.env),
        color: ctx.color(),
        editText: (text, fileName) => ctx.edit(text, fileName),
      });
      return { value: null, view: { kind: "text", text: "" } };
    },
  },
];
