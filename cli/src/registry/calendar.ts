// The read-only calendar feed (docs/calendar.md): its secret address for
// Google and Apple Calendar, a new address, turning it off, and a one-time
// .ics file. The address is a password to read the plan, so it is printed
// only by these commands and never stored by hlm.
import { writeFile } from "node:fs/promises";
import { usageError } from "../core/exit.js";
import type { CommandSpec, Outcome, RunContext } from "./types.js";

type Feed = { url: string; webcalUrl: string; googleCalendarUrl: string; createdAt: number };

const OFF_TEXT = "The calendar feed is off. Turn it on with: hlm calendar on";

function feedOutcome(feed: Feed | null | undefined, lead: string): Outcome {
  if (!feed) return { value: { feed: null }, view: { kind: "text", text: OFF_TEXT } };
  const text = [
    `${lead} Anyone with this address can read your dated tasks; hlm calendar rotate replaces it.`,
    `  ${feed.url}`,
    "",
    "Apple Calendar (iPhone, Mac): open the webcal address, or File → New Calendar Subscription:",
    `  ${feed.webcalUrl}`,
    "Google Calendar (on the web, not the phone app): Other calendars → From URL, or open:",
    `  ${feed.googleCalendarUrl}`,
    "Google refreshes subscribed calendars slowly (hours), so changes show up late there.",
  ].join("\n");
  return { value: { feed }, view: { kind: "text", text } };
}

const show = async (ctx: RunContext): Promise<Outcome> => {
  const { feed } = await (await ctx.client()).request("GET", "/calendar/feed");
  return feedOutcome(feed, "Calendar feed (read-only).");
};

/** Rotating or turning off breaks every subscription to the current address, so it asks first. */
async function confirmBreak(ctx: RunContext, what: string): Promise<void> {
  if (ctx.yes || ctx.dryRun) return;
  const question = `${what} Calendars subscribed to the current address stop updating. Continue?`;
  if (!ctx.interactive) throw usageError(`Refusing without --yes: ${what.toLowerCase()}`, { hint: "add --yes" });
  if (!(await ctx.confirm(question))) throw usageError("Cancelled; nothing was changed");
}

const FILE_OPTION = { flags: "-o, --output <file>", description: "Write to a file instead of stdout (e.g. helm.ics)" };

export const calendarCommands: CommandSpec[] = [
  {
    name: "calendar",
    schema: "calendar-feed.schema.json",
    summary: "Your tasks in Google or Apple Calendar: the secret address of the read-only feed (same as hlm calendar url)",
    description:
      "Dated tasks become calendar events (with a time) or all-day events, repeating ones with their rule, reminders as alerts. " +
      "The address works without a key, so treat it like a password. Needs backend 0.7.0 or later (hlm version).",
    tools: ["/calendar/feed"],
    examples: ["hlm calendar", "hlm calendar on", "hlm calendar rotate --yes", "hlm calendar export -o helm.ics"],
    run: show,
    subcommands: [
      { name: "url", schema: "calendar-feed.schema.json", summary: "Show the feed's addresses (null when it is off)", tools: ["/calendar/feed"], examples: ["hlm calendar url --json"], run: show },
      {
        name: "on", schema: "calendar-feed.schema.json",
        summary: "Turn the feed on (keeps an existing address) and show it",
        tools: ["/calendar/feed"],
        examples: ["hlm calendar on"],
        run: async (ctx) => {
          const { feed } = await (await ctx.client()).request("POST", "/calendar/feed");
          return feedOutcome(feed, "Calendar feed is on.");
        },
      },
      {
        name: "rotate", schema: "calendar-feed.schema.json",
        summary: "A new secret address; the old one stops working at once",
        tools: ["/calendar/feed/rotate"],
        examples: ["hlm calendar rotate --yes"],
        run: async (ctx) => {
          await confirmBreak(ctx, "This replaces the address.");
          const { feed } = await (await ctx.client()).request("POST", "/calendar/feed/rotate");
          return feedOutcome(feed, "New address; the old one now answers 404.");
        },
      },
      {
        name: "off", schema: "calendar-revoke.schema.json",
        summary: "Turn the feed off; its address stops working",
        tools: ["/calendar/feed/revoke"],
        examples: ["hlm calendar off --yes"],
        run: async (ctx) => {
          await confirmBreak(ctx, "This turns the feed off.");
          const value = await (await ctx.client()).request("POST", "/calendar/feed/revoke");
          const text = value.revoked ? "Calendar feed is off; its address now answers 404." : "The calendar feed was already off.";
          return { value, view: { kind: "text", text } };
        },
      },
      {
        name: "export", schema: "export.schema.json",
        summary: "The plan as a one-time .ics file to import (does not need the feed)",
        options: [FILE_OPTION],
        tools: ["export_plan"],
        examples: ["hlm calendar export -o helm.ics", "hlm calendar export > helm.ics"],
        run: async (ctx, _args, opts) => {
          const result = await (await ctx.client()).callTool("export_plan", { format: "ics" });
          const value = result.structured ?? { format: "ics", content: result.text };
          if (opts.output) {
            // The file is always the calendar; --json describes what was written.
            await writeFile(opts.output as string, result.text);
            return { value: { written: opts.output, format: "ics" }, view: { kind: "text", text: `Wrote ${opts.output}` } };
          }
          // The output adds the final \n, so the last line keeps its CRLF and a redirect gives a valid file.
          return { value, view: { kind: "text", text: result.text.replace(/\n$/, "") } };
        },
      },
    ],
  },
];
