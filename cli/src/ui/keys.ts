// Key names and the key map of dayhand ui. The map is the single source of the
// in-app help (?) and of `dayhand help ui` / docs/cli.md. Keys follow vim and
// lazygit: j/k and h/l move, Tab switches views, ? shows help, q quits.
import type { Key } from "ink";

/** "j", "J", "enter", "esc", "tab", "S-tab", "up", "pgdn", "space", "C-d", … */
export function keyName(input: string, key: Key): string {
  if (key.return) return "enter";
  if (key.escape) return "esc";
  if (key.tab) return key.shift ? "S-tab" : "tab";
  if (key.upArrow) return "up";
  if (key.downArrow) return "down";
  if (key.leftArrow) return "left";
  if (key.rightArrow) return "right";
  if (key.pageUp) return "pgup";
  if (key.pageDown) return "pgdn";
  if (key.home) return "home";
  if (key.end) return "end";
  // Most terminals send DEL (0x7f) for Backspace, which Ink reports as delete.
  if (key.backspace || key.delete) return "backspace";
  if (key.ctrl && input) return `C-${input.toLowerCase()}`;
  if (input === " ") return "space";
  return input;
}

const CONTROL_NAMES: Record<string, string> = { "\t": "tab", "\r": "enter", "\n": "enter", "\u007f": "backspace", "\b": "backspace", "\u001b": "esc", " ": "space" };

/**
 * A chunk of fast typing ("aCall mom", "\tfri") as one key per character, so
 * `a` opens the prompt before the rest is typed into it and a Tab moves on.
 */
export function chunkKeys(input: string): string[] {
  return [...input].map((char) => {
    if (CONTROL_NAMES[char]) return CONTROL_NAMES[char]!;
    const code = char.codePointAt(0)!;
    return code >= 1 && code <= 26 ? `C-${String.fromCharCode(code + 96)}` : char;
  });
}

export type Binding = { keys: string; does: string };
export type KeyGroup = { title: string; bindings: Binding[] };

export const KEY_GROUPS: KeyGroup[] = [
  {
    title: "Move",
    bindings: [
      { keys: "j k  ↓ ↑", does: "Next / previous task" },
      { keys: "h l  ← →", does: "Board column, week day" },
      { keys: "g G  Home End", does: "First / last task" },
      { keys: "C-d C-u  PgDn PgUp", does: "Half a page down / up" },
      { keys: "Enter", does: "Open a task (an empty day: add)" },
      { keys: "Esc", does: "Back; clears the filter" },
    ],
  },
  {
    title: "Views",
    bindings: [
      { keys: "Tab S-Tab", does: "Next / previous view" },
      { keys: "1 2 3 4", does: "Today, Board, Week, Trash" },
      { keys: "/", does: "Filter: title, #label, note, #42" },
      { keys: "R", does: "Refresh now (also every 12 s)" },
      { keys: "?", does: "This help" },
      { keys: "q  C-c", does: "Quit (q in details: back)" },
    ],
  },
  {
    title: "Tasks",
    bindings: [
      { keys: "a", does: 'Add: Pay rent fri 2pm #home' },
      { keys: "Space x", does: "Done / not done (repeats go on)" },
      { keys: "s", does: "Start (doing) / stop (todo)" },
      { keys: "n", does: "Now task, with a resume note" },
      { keys: "N", does: "Clear the now task" },
      { keys: "e", does: "Edit title, due, labels, resume note" },
      { keys: "E", does: "Title and note in $EDITOR" },
      { keys: "m", does: 'Move: tomorrow, fri 9am, none' },
      { keys: "d", does: "To the trash (asks); u undoes" },
      { keys: "r", does: "Restore (in the trash)" },
    ],
  },
  {
    title: "Board and week",
    bindings: [
      { keys: "H L", does: "Board: column left / right" },
      { keys: "H L", does: "Week: a day earlier / later" },
      { keys: "[ ]", does: "Week: previous / next week" },
      { keys: "t", does: "Week: this week" },
    ],
  },
  {
    title: "Typing",
    bindings: [
      { keys: "Enter Esc", does: "Save / cancel" },
      { keys: "Tab S-Tab", does: "Next / previous field (edit)" },
      { keys: "← → C-a C-e", does: "Move the cursor; start / end" },
      { keys: "C-u C-k C-w", does: "Delete to start / to end / a word" },
    ],
  },
];

/** The key map as plain text: `dayhand help ui` and docs/cli.md. */
export function keysText(): string {
  const width = Math.max(...KEY_GROUPS.flatMap((g) => g.bindings.map((b) => b.keys.length))) + 2;
  return KEY_GROUPS.map((group) => [`${group.title}:`, ...group.bindings.map((b) => `  ${b.keys.padEnd(width)}${b.does}`)].join("\n")).join("\n\n");
}
