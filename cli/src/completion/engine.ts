// `dayhand __complete <words…>`: the candidates for the last word, from the same
// registry that builds the commands, so completion cannot drift from them.
// Prints "value<TAB>description" lines and ":<directive>"; never fails.
import { expandAlias } from "../config/aliases.js";
import type { Config } from "../config/file.js";
import type { Io } from "../core/io.js";
import { GLOBAL_OPTIONS, VALUE_OPTIONS } from "../globals.js";
import { loadSetup } from "../setup.js";
import { COMMANDS, flatten } from "../registry/index.js";
import type { CommandSpec, OptSpec } from "../registry/types.js";
import { SETTINGS_FIELDS, TASK_FIELDS } from "../render/model.js";
import { TOPICS } from "../topics.js";
import { taskHints, type TaskHints } from "./cache.js";
import { SHELLS } from "./scripts.js";

export const NO_SPACE = 2;
export const NO_FILES = 4;

export type Candidate = { value: string; description?: string };
export type Completion = { candidates: Candidate[]; directive: number };

export type Sources = {
  aliases: Record<string, string>;
  profiles: string[];
  hints(): Promise<TaskHints>;
};

const DATE_WORDS = ["today", "tomorrow", "mon", "tue", "wed", "thu", "fri", "sat", "sun", "next", "this", "weekend", "eow", "eoww", "eom", "eoy", "in"];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const STATUSES = ["todo", "doing", "done"];
const SETTINGS_KEYS = ["timezone=", "summary-time=", "reminders="];
const TOOL_NAMES = [...new Set(flatten().flatMap(({ spec }) => spec.tools))].filter((t) => /^[a-z_]+$/.test(t) && t !== "initialize").sort();

export async function completeCommand(words: string[], io: Io): Promise<number> {
  let result: Completion = { candidates: [], directive: NO_FILES };
  try {
    const setup = loadSetup(io);
    let config: Config | undefined;
    try {
      config = setup.config();
    } catch {
      config = undefined;
    }
    const flags = typedFlags(words);
    let hints: Promise<TaskHints> | undefined;
    result = await complete(words, {
      aliases: setup.aliases,
      profiles: Object.keys(config?.profiles ?? {}),
      hints: () => (hints ??= config ? taskHints(io, setup.paths.cacheDir, setup.paths.configDir, config, flags) : Promise.resolve({ tasks: [], labels: [] })),
    });
  } catch {
    // Completion never prints an error into the user's command line.
  }
  const clean = (text: string) => text.replace(/[\t\r\n]+/g, " ");
  const lines = result.candidates.map((c) => (c.description ? `${clean(c.value)}\t${clean(c.description)}` : clean(c.value)));
  io.stdout.write([...lines, `:${result.directive}`].join("\n") + "\n");
  return 0;
}

/** --url and --profile already typed on the line decide which server's tasks to offer. */
function typedFlags(words: string[]): { url?: string; profile?: string } {
  const flags: { url?: string; profile?: string } = {};
  words.slice(0, -1).forEach((word, i) => {
    if (word === "--url") flags.url = words[i + 1];
    if (word === "--profile") flags.profile = words[i + 1];
  });
  return flags;
}

const takesValue = (option: OptSpec) => option.flags.includes("<");
const names = (option: OptSpec) => option.flags.split(/[ ,]+/).filter((f) => f.startsWith("-"));
const longName = (option: OptSpec) => names(option).find((n) => n.startsWith("--")) ?? names(option)[0]!;

export async function complete(words: string[], sources: Sources): Promise<Completion> {
  const last = words.at(-1) ?? "";
  const current = last === '""' ? "" : last;
  const before = expandAlias(words.slice(0, -1), sources.aliases, VALUE_OPTIONS);
  let command: CommandSpec | undefined;
  let positional = 0;
  let pending: OptSpec | undefined;
  for (const word of before) {
    if (pending) {
      pending = undefined;
      continue;
    }
    if (word.startsWith("-") && word.length > 1) {
      const option = findOption(word.split("=")[0]!, command);
      if (option && takesValue(option) && !word.includes("=")) pending = option;
      continue;
    }
    const children = command ? command.subcommands : COMMANDS;
    const sub = positional === 0 ? children?.find((c) => c.name === word || c.aliases?.includes(word)) : undefined;
    if (sub) command = sub;
    else if (!command && word === "help") return filtered(current, helpWords());
    else if (!command) return { candidates: [], directive: NO_FILES };
    else positional++;
  }
  if (pending) return optionValues(pending, current, sources);
  if (current.startsWith("-")) return filtered(current, optionCandidates(command));
  if (!command) return filtered(current, topLevel(sources.aliases));
  const candidates = positional === 0 && command.subcommands ? command.subcommands.map(describe) : [];
  const values = await argValues(command, positional, current, sources);
  return { candidates: [...candidates.filter((c) => c.value.startsWith(current)), ...values.candidates], directive: values.directive };
}

function findOption(name: string, command: CommandSpec | undefined): OptSpec | undefined {
  return [...(command?.options ?? []), ...GLOBAL_OPTIONS].find((o) => names(o).includes(name));
}

const describe = (spec: CommandSpec): Candidate => ({ value: spec.name, description: spec.summary });

function topLevel(aliases: Record<string, string>): Candidate[] {
  return [
    ...COMMANDS.flatMap((spec) => [describe(spec), ...(spec.aliases ?? []).map((a) => ({ value: a, description: spec.summary }))]),
    { value: "help", description: "Help for a command or a topic" },
    ...Object.entries(aliases).map(([name, expansion]) => ({ value: name, description: `alias: ${expansion}` })),
  ];
}

const helpWords = (): Candidate[] => [
  ...Object.keys(TOPICS).map((t) => ({ value: t, description: "topic" })),
  ...COMMANDS.map(describe),
];

function optionCandidates(command: CommandSpec | undefined): Candidate[] {
  const options = [...(command?.options ?? []), ...GLOBAL_OPTIONS, { flags: "-h, --help", description: "Show help" }];
  return options.filter((option, index) => options.findIndex((other) => longName(other) === longName(option)) === index).map((o) => ({
    value: longName(o),
    description: o.description,
  }));
}

function filtered(current: string, candidates: Candidate[], directive = NO_FILES): Completion {
  return { candidates: candidates.filter((c) => c.value.startsWith(current)), directive };
}

const words = (values: readonly string[]) => values.map((value) => ({ value }));

/** "todo,do" → "todo,doing", "todo,done": completes the last item of a comma list. */
function commaList(current: string, values: readonly string[]): Completion {
  const cut = current.lastIndexOf(",") + 1;
  const done = current.slice(0, cut);
  const chosen = done.split(",").filter(Boolean);
  const candidates = values.filter((v) => !chosen.includes(v)).map((v) => ({ value: done + v }));
  return filtered(current, candidates, NO_FILES | NO_SPACE);
}

async function optionValues(option: OptSpec, current: string, sources: Sources): Promise<Completion> {
  if (option.choices) return filtered(current, words(option.choices));
  switch (longName(option)) {
    case "--due":
    case "--due-before":
    case "--due-after":
      return filtered(current, words(DATE_WORDS));
    case "--project":
    case "--move-tasks-to":
      return filtered(current, words([...(await sources.hints()).projects?.filter((p) => !p.archived).map((p) => p.name) ?? [], "none"]));
    case "--before":
    case "--after":
      return filtered(current, words((await sources.hints()).projects?.map((p) => p.name) ?? []));
    case "--from-label":
    case "--label":
    case "--add-label":
    case "--rm-label":
      return filtered(current, words((await sources.hints()).labels));
    case "--profile":
      return filtered(current, words(sources.profiles));
    case "--status":
      return commaList(current, STATUSES);
    case "--on":
      return commaList(current, WEEKDAYS);
    case "--fields":
      return commaList(current, [...new Set([...TASK_FIELDS, ...SETTINGS_FIELDS])]);
    case "--timezone":
      return filtered(current, words(Intl.supportedValuesOf("timeZone")));
    case "--output":
      return { candidates: [], directive: 0 };
    default:
      return { candidates: [], directive: NO_FILES };
  }
}

async function argValues(command: CommandSpec, positional: number, current: string, sources: Sources): Promise<Completion> {
  const args = command.args ?? [];
  const arg = args[positional] ?? (args.at(-1)?.variadic ? args.at(-1) : undefined);
  switch (arg?.name) {
    case "ref":
    case "refs": {
      const { tasks } = await sources.hints();
      const hash = current.startsWith("#") ? "#" : "";
      const candidates = [{ value: "now", description: "the now task" }, ...tasks.map((t) => ({ value: `${hash}${t.ref}`, description: t.title }))];
      return filtered(current, candidates);
    }
    case "project":
    case "projects": {
      const projects = (await sources.hints()).projects ?? [];
      return filtered(current, words([...projects.filter((p) => command.name !== "assign" || !p.archived).map((p) => p.name), ...(command.name === "assign" ? ["none"] : [])]));
    }
    case "date":
      return filtered(current, words([...DATE_WORDS, "none"]));
    case "phrase":
      return filtered(current, words(DATE_WORDS));
    case "shell":
      return filtered(current, words(SHELLS));
    case "tool":
    case "name":
      return filtered(current, command.tools.includes("add_project") ? [] : words(TOOL_NAMES));
    case "pairs":
      return current.startsWith("timezone=")
        ? filtered(current, words(Intl.supportedValuesOf("timeZone").map((z) => `timezone=${z}`)))
        : filtered(current, words(SETTINGS_KEYS), NO_FILES | NO_SPACE);
    default:
      return { candidates: [], directive: NO_FILES };
  }
}
