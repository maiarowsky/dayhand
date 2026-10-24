// `dayhand prime`: a short context block for an agent's session start (a
// SessionStart hook, a system prompt): Today plus the rules of the road.
import { AGENT_RULES } from "../guide.js";
import type { TodayView } from "../render/model.js";
import { PLAIN_STYLE } from "../render/style.js";
import { renderHuman } from "../render/views.js";
import { tool } from "./ops.js";
import type { CommandSpec } from "./types.js";

export function primeText(view: TodayView): string {
  return [
    "# Dayhand tasks (dayhand)",
    "",
    // No colors and no cutting: the text goes into a context window, not a terminal.
    renderHuman({ kind: "today", view }, view, undefined, { style: PLAIN_STYLE, today: view.date }),
    "",
    "## Using dayhand",
    ...AGENT_RULES.map((rule) => `- ${rule}`),
    "- Reference: dayhand help, dayhand <command> --help, dayhand tools.",
  ].join("\n");
}

const prime: CommandSpec = {
  name: "prime",
  schema: "today.schema.json",
  summary: "Context for an AI agent: Today and how to use dayhand (for a SessionStart hook)",
  description:
    "Prints plain text without colors in every format except --json, which prints list_today like dayhand today --json. In a Claude Code hook: {\"hooks\":{\"SessionStart\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"dayhand prime\"}]}]}}.",
  tools: ["list_today"],
  examples: ["dayhand prime", "dayhand prime --json"],
  run: async (ctx) => {
    const view = await tool<TodayView>(ctx, "list_today");
    return { value: view, view: { kind: "text", text: primeText(view) } };
  },
};

export const agentCommands: CommandSpec[] = [prime];
