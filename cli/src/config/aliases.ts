// Command aliases from config.toml: `[aliases] home = "list -l home --status todo,doing"`
// makes `hlm home --json` run `hlm list -l home --status todo,doing --json`.
// One level only (an alias never expands into another alias), no shell involved.
import { splitWords } from "../core/words.js";

export { splitWords };

/** Index of the first word that is not a global option or its value, or -1. */
export function commandIndex(argv: string[], valueOptions: ReadonlySet<string>): number {
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!;
    if (word === "--") return i + 1 < argv.length ? i + 1 : -1;
    if (valueOptions.has(word)) i++;
    else if (!word.startsWith("-")) return i;
  }
  return -1;
}

export function expandAlias(argv: string[], aliases: Readonly<Record<string, string>>, valueOptions: ReadonlySet<string>): string[] {
  const index = commandIndex(argv, valueOptions);
  const name = index < 0 ? undefined : argv[index]!;
  if (name === undefined || !Object.hasOwn(aliases, name)) return argv;
  return [...argv.slice(0, index), ...splitWords(aliases[name]!), ...argv.slice(index + 1)];
}
