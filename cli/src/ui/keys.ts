// Key names and the key map of dayhand ui. The map is the single source of the
// in-app help (?) and of `dayhand help ui` / docs/cli.md. Keys follow vim and
// lazygit: j/k and h/l move, Tab switches views, ? shows help, q quits.
import type { Key as InkKey } from "ink";
import { tIn, type Key } from "../i18n/index.js";

/** "j", "J", "enter", "esc", "tab", "S-tab", "up", "pgdn", "space", "C-d", … */
export function keyName(input: string, key: InkKey): string {
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

/** `title` and `does` are message keys, so the help speaks the UI's language and `dayhand help ui` English. */
export type Binding = { keys: string; does: Key };
export type KeyGroup = { title: Key; bindings: Binding[] };

export const KEY_GROUPS: KeyGroup[] = [
  {
    title: "keys.move",
    bindings: [
      { keys: "j k  ↓ ↑", does: "keys.move.next" },
      { keys: "h l  ← →", does: "keys.move.column" },
      { keys: "g G  Home End", does: "keys.move.ends" },
      { keys: "C-d C-u  PgDn PgUp", does: "keys.move.page" },
      { keys: "Enter", does: "keys.move.open" },
      { keys: "Esc", does: "keys.move.back" },
    ],
  },
  {
    title: "keys.views",
    bindings: [
      { keys: "Tab S-Tab", does: "keys.views.next" },
      { keys: "1 2 3 4 5", does: "keys.views.pick" },
      { keys: "/", does: "keys.views.filter" },
      { keys: "R", does: "keys.views.refresh" },
      { keys: "?", does: "keys.views.help" },
      { keys: "q  C-c", does: "keys.views.quit" },
    ],
  },
  {
    title: "keys.tasks",
    bindings: [
      { keys: "a", does: "keys.tasks.add" },
      { keys: "y", does: "keys.tasks.copy" },
      { keys: "Space x", does: "keys.tasks.done" },
      { keys: "s", does: "keys.tasks.start" },
      { keys: "n", does: "keys.tasks.now" },
      { keys: "N", does: "keys.tasks.clearNow" },
      { keys: "e", does: "keys.tasks.edit" },
      { keys: "E", does: "keys.tasks.editor" },
      { keys: "m", does: "keys.tasks.move" },
      { keys: "d", does: "keys.tasks.trash" },
      { keys: "r", does: "keys.tasks.restore" },
    ],
  },
  {
    title: "keys.boardWeek",
    bindings: [
      { keys: "H L", does: "keys.boardWeek.column" },
      { keys: "H L", does: "keys.boardWeek.day" },
      { keys: "[ ]", does: "keys.boardWeek.weeks" },
      { keys: "t", does: "keys.boardWeek.thisWeek" },
    ],
  },
  {
    title: "keys.typing",
    bindings: [
      { keys: "Enter Esc", does: "keys.typing.save" },
      { keys: "Tab S-Tab", does: "keys.typing.field" },
      { keys: "← → C-a C-e", does: "keys.typing.cursor" },
      { keys: "C-u C-k C-w", does: "keys.typing.delete" },
    ],
  },
  {
    title: "keys.agents",
    bindings: [
      { keys: "p", does: "keys.agents.pause" },
      { keys: "Enter", does: "keys.agents.open" },
      { keys: "1 2 3 4", does: "keys.agents.choose" },
      { keys: "Enter Esc", does: "keys.agents.confirm" },
      { keys: "A", does: "keys.agents.accept" },
      { keys: "X", does: "keys.agents.reject" },
    ],
  },
];

/** The key map as plain text: `dayhand help ui` and docs/cli.md. */
export function keysText(): string {
  const width = Math.max(...KEY_GROUPS.flatMap((g) => g.bindings.map((b) => b.keys.length))) + 2;
  return KEY_GROUPS.map((group) => [`${tIn("en", group.title)}:`, ...group.bindings.map((b) => `  ${b.keys.padEnd(width)}${tIn("en", b.does)}`)].join("\n")).join("\n\n");
}
