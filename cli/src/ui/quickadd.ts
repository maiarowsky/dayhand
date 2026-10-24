// Quick add in dayhand ui: one line is a title, `#labels` and a date phrase at the
// end or the start ("Call the accountant fri 2pm #home"), resolved with the same
// grammar as --due (when/parse.ts). The longest phrase wins; at least one word
// stays the title. A line in quotes is taken literally, "no date" adds no day.
import { parseWhen, WhenError, type When, type WhenContext } from "../when/parse.js";

export type QuickAdd = {
  title: string;
  labels: string[];
  /** The resolved day and time; null: no day; undefined: the caller's default day. */
  due: When | null | undefined;
  /** The words read as the date, for the preview. */
  phrase?: string;
};

const LABEL = /^#(\p{L}[\p{L}\p{N}_-]*)$/u;
const MAX_PHRASE_WORDS = 5;

export function parseQuickAdd(text: string, context: WhenContext): QuickAdd {
  const trimmed = text.trim();
  const quoted = /^"(.*)"$/s.exec(trimmed);
  if (quoted) return { title: quoted[1]!.trim(), labels: [], due: undefined };

  const labels: string[] = [];
  const words = trimmed.split(/\s+/).filter((word) => {
    const label = LABEL.exec(word);
    if (label && !labels.includes(label[1]!)) labels.push(label[1]!);
    return !label;
  });
  const lower = words.map((w) => w.toLowerCase());
  if (lower.length > 2 && lower.at(-2) === "no" && lower.at(-1) === "date") {
    return { title: words.slice(0, -2).join(" "), labels, due: null, phrase: "no date" };
  }
  const found = phraseAtEnd(words, context) ?? phraseAtStart(words, context);
  if (!found) return { title: words.join(" "), labels, due: undefined };
  return { title: found.title, labels, due: found.due, phrase: found.phrase };
}

type Found = { title: string; due: When; phrase: string };

function phraseAtEnd(words: string[], context: WhenContext): Found | undefined {
  for (let n = Math.min(MAX_PHRASE_WORDS, words.length - 1); n >= 1; n--) {
    const phrase = words.slice(-n).join(" ");
    const due = tryWhen(phrase, context);
    if (due) return { title: words.slice(0, -n).join(" "), due, phrase };
  }
  return undefined;
}

function phraseAtStart(words: string[], context: WhenContext): Found | undefined {
  for (let n = Math.min(MAX_PHRASE_WORDS, words.length - 1); n >= 1; n--) {
    const phrase = words.slice(0, n).join(" ");
    const due = tryWhen(phrase, context);
    if (due) return { title: words.slice(n).join(" "), due, phrase };
  }
  return undefined;
}

/** A phrase the grammar understands, else undefined; bare numbers ("2 apples") are never dates. */
function tryWhen(phrase: string, context: WhenContext): When | undefined {
  if (/^\d{1,2}$/.test(phrase)) return undefined;
  try {
    return parseWhen(phrase, context);
  } catch (error) {
    if (error instanceof WhenError) return undefined;
    throw error;
  }
}

/** A date phrase typed for "move": "none" clears the day; undefined when not understood. */
export function parseMove(text: string, context: WhenContext): When | null | undefined {
  const trimmed = text.trim();
  if (/^(none|no date)$/i.test(trimmed)) return null;
  return trimmed ? tryWhen(trimmed, context) : undefined;
}
