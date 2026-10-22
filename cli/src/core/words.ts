// Splits a command string into words without a shell: spaces separate,
// "double" or 'single' quotes group. Used for aliases and $VISUAL/$EDITOR.
import { usageError } from "./exit.js";

export function splitWords(text: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: string | undefined;
  let started = false;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) throw usageError("Unclosed quote in a command string");
  if (started) words.push(current);
  return words;
}
