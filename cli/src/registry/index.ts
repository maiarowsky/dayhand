import { agentCommands } from "./agents.js";
import { authCommands } from "./auth.js";
import { calendarCommands } from "./calendar.js";
import { integrationCommands } from "./integrations.js";
import { localCommands } from "./local.js";
import { serverCommands } from "./server.js";
import { systemCommands } from "./system.js";
import { taskCommands } from "./tasks.js";
import type { CommandSpec } from "./types.js";
import { uiCommands } from "./ui.js";

export const COMMANDS: CommandSpec[] = [...taskCommands, ...systemCommands, ...calendarCommands, ...integrationCommands, ...authCommands, ...serverCommands, ...agentCommands, ...localCommands, ...uiCommands];

/** Top-level names and aliases (and help): config.toml aliases may not reuse them. */
export function commandNames(): Set<string> {
  return new Set(["help", ...COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])])]);
}

/** Every command with its full name ("settings set"), depth first. */
export function flatten(commands: CommandSpec[] = COMMANDS, prefix = ""): { path: string; spec: CommandSpec }[] {
  return commands.flatMap((spec) => {
    const path = prefix + spec.name;
    return [{ path, spec }, ...flatten(spec.subcommands ?? [], `${path} `)];
  });
}
