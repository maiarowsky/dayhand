// A one-line text field: the text and the cursor, edited by key names (keys.ts)
// the way a shell line is: arrows, C-a/C-e, C-u/C-k/C-w, Backspace.

export type Line = { text: string; cursor: number };

export const line = (text = ""): Line => ({ text, cursor: [...text].length });

const CONTROL = /[\u0000-\u001f\u007f]/;

/** The edited line, or undefined when the key is not an editing key. */
export function editLine(current: Line, name: string): Line | undefined {
  const chars = [...current.text];
  const at = Math.max(0, Math.min(current.cursor, chars.length));
  const make = (next: string[], cursor: number): Line => ({ text: next.join(""), cursor });
  switch (name) {
    case "left":
    case "C-b":
      return { ...current, cursor: Math.max(0, at - 1) };
    case "right":
    case "C-f":
      return { ...current, cursor: Math.min(chars.length, at + 1) };
    case "home":
    case "C-a":
      return { ...current, cursor: 0 };
    case "end":
    case "C-e":
      return { ...current, cursor: chars.length };
    case "backspace":
    case "C-h":
      return at === 0 ? current : make([...chars.slice(0, at - 1), ...chars.slice(at)], at - 1);
    case "C-d":
      return make([...chars.slice(0, at), ...chars.slice(at + 1)], at);
    case "C-u":
      return make(chars.slice(at), 0);
    case "C-k":
      return make(chars.slice(0, at), at);
    case "C-w": {
      let start = at;
      while (start > 0 && chars[start - 1] === " ") start--;
      while (start > 0 && chars[start - 1] !== " ") start--;
      return make([...chars.slice(0, start), ...chars.slice(at)], start);
    }
    case "space":
      return insert(current, " ");
    default:
      // Anything that is not a named key is typed text (a fast typist's keys can arrive together).
      return name === "" || name.startsWith("C-") || KEY_NAMES.has(name) ? undefined : insert(current, name);
  }
}

const KEY_NAMES = new Set(["enter", "esc", "tab", "S-tab", "up", "down", "pgup", "pgdn"]);

/** Inserts typed or pasted text at the cursor; line breaks become spaces, other control characters are dropped. */
export function insert(current: Line, text: string): Line {
  const clean = [...text.replace(/\r\n|\r|\n|\t/g, " ")].filter((c) => !CONTROL.test(c));
  if (clean.length === 0) return current;
  const chars = [...current.text];
  const at = Math.max(0, Math.min(current.cursor, chars.length));
  return { text: [...chars.slice(0, at), ...clean, ...chars.slice(at)].join(""), cursor: at + clean.length };
}
