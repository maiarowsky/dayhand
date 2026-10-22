import { systemCommands } from "./system.js";
import { taskCommands } from "./tasks.js";
import type { CommandSpec } from "./types.js";

export const COMMANDS: CommandSpec[] = [...taskCommands, ...systemCommands];

/** Every command with its full name ("settings set"), depth first. */
export function flatten(commands: CommandSpec[] = COMMANDS, prefix = ""): { path: string; spec: CommandSpec }[] {
  return commands.flatMap((spec) => {
    const path = prefix + spec.name;
    return [{ path, spec }, ...flatten(spec.subcommands ?? [], `${path} `)];
  });
}
