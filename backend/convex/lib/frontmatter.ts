// The YAML header of a Markdown file ("frontmatter", between two "---" lines),
// as Backlog.md task files use it (docs/backlog-md.md): keys with plain or
// quoted scalars, flow lists ([a, "b"]) and block lists ("- a"), and block
// text (| and >). Not a full YAML reader: nested maps, anchors and tags are
// not part of that header and are read as text. Pure functions.

export type FrontValue = string | string[] | null;
export type Front = Record<string, FrontValue>;

export class FrontmatterError extends Error {}

const KEY = /^([A-Za-z_][\w.-]*)\s*:(?:\s+(.*))?$/;
const LIST_ITEM = /^\s*-(?:\s+(.*))?$/;

/** The header and the text after it; a file without a header has `front` null. */
export function splitFrontmatter(content: string): { front: string | null; body: string } {
  const text = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!text.startsWith("---\n")) return { front: null, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) throw new FrontmatterError("The YAML header has no closing --- line");
  const after = text.indexOf("\n", end + 4);
  return { front: text.slice(4, end + 1), body: after === -1 ? "" : text.slice(after + 1) };
}

/** Removes a trailing comment (" # …") outside quotes. */
function stripComment(value: string): string {
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (quote) {
      if (c === quote && !(quote === '"' && value[i - 1] === "\\")) quote = null;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s,[]/.test(value[i - 1]!)) quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(value[i - 1]!))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value;
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/", "0": "\0" };

/** One scalar: quoted ('it''s', "a \"b\"") or plain; ~ and null are no value. */
function scalar(raw: string): string | null {
  const value = raw.trim();
  if (value === "" || value === "~" || value === "null" || value === "Null" || value === "NULL") return null;
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e: string) => (e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : (ESCAPES[e] ?? e)));
  }
  return value;
}

/** The items of a flow list "[a, 'b, c', \"d\"]". */
function flowList(raw: string): string[] {
  const inner = raw.trim().slice(1, -1);
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (quote) {
      current += c;
      if (c === quote) {
        if (quote === "'" && inner[i + 1] === "'") current += inner[++i];
        else if (!(quote === '"' && inner[i - 1] === "\\")) quote = null;
      }
    } else if (c === "'" || c === '"') {
      quote = c;
      current += c;
    } else if (c === ",") {
      items.push(current);
      current = "";
    } else current += c;
  }
  if (current.trim() !== "" || items.length > 0) items.push(current);
  return items.map(scalar).filter((item): item is string => item !== null);
}

const indentOf = (line: string) => line.length - line.trimStart().length;

/** Block text after "key: |" or "key: >": the more indented lines that follow. */
function blockText(lines: string[], start: number, folded: boolean): { value: string; next: number } {
  let i = start;
  const taken: string[] = [];
  while (i < lines.length && (lines[i]!.trim() === "" || indentOf(lines[i]!) > 0)) taken.push(lines[i++]!);
  while (taken.length && taken[taken.length - 1]!.trim() === "") taken.pop();
  const indent = Math.min(...taken.filter((l) => l.trim() !== "").map(indentOf));
  const body = taken.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
  const value = folded ? body.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ") : body.join("\n");
  return { value, next: i };
}

/** Reads the header's keys. A key given twice keeps its last value, as YAML readers do. */
export function parseFrontmatter(front: string): Front {
  const lines = front.split("\n");
  const result: Front = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      i++;
      continue;
    }
    const match = indentOf(line) === 0 ? KEY.exec(line) : null;
    if (!match) throw new FrontmatterError(`Line ${i + 1} of the YAML header is not "key: value": ${line.trim().slice(0, 80)}`);
    const key = match[1]!;
    const raw = stripComment(match[2] ?? "");
    i++;
    if (raw === "|" || raw === "|-" || raw === ">" || raw === ">-") {
      const block = blockText(lines, i, raw.startsWith(">"));
      result[key] = block.value;
      i = block.next;
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      result[key] = flowList(raw);
    } else if (raw === "") {
      // A block list follows, or the key has no value.
      const items: string[] = [];
      while (i < lines.length && (lines[i]!.trim() === "" || LIST_ITEM.test(lines[i]!))) {
        const item = LIST_ITEM.exec(lines[i]!);
        if (item) {
          const value = scalar(stripComment(item[1] ?? ""));
          if (value !== null) items.push(value);
        }
        i++;
      }
      result[key] = items.length > 0 ? items : null;
    } else {
      // A plain scalar may continue on more indented lines.
      let value = raw;
      while (i < lines.length && lines[i]!.trim() !== "" && indentOf(lines[i]!) > 0 && !LIST_ITEM.test(lines[i]!)) value += ` ${lines[i++]!.trim()}`;
      result[key] = scalar(value);
    }
  }
  return result;
}

// ---- Writing ----

const PLAIN = /^[A-Za-z0-9_/.()+-][^:#\n]*$/;
const RESERVED = /^(?:true|false|yes|no|on|off|null|~|[-+]?(?:\d[\d_]*)?(?:\.\d+)?(?:e[-+]?\d+)?|0x[0-9a-f]+)$/i;

/** A scalar as YAML: plain when that reads back as the same text, else single-quoted. */
export function yamlScalar(value: string): string {
  if (value !== "" && PLAIN.test(value) && value === value.trim() && !RESERVED.test(value) && !value.startsWith("- ")) return value;
  return `'${value.replace(/'/g, "''").replace(/\n/g, " ")}'`;
}

/** The header lines for the keys in order; a list is written as a block list, an empty one as []. */
export function writeFrontmatter(entries: [string, string | string[] | undefined][]): string {
  const lines: string[] = ["---"];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) lines.push(`${key}: []`);
      else lines.push(`${key}:`, ...value.map((item) => `  - ${yamlScalar(item)}`));
    } else lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}
