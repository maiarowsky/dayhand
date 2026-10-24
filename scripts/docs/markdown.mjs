// A small Markdown to HTML converter for the documentation pages (scripts/build-docs.mjs). It covers what
// docs/*.md use: ATX headings with GitHub's ids, paragraphs, nested lists, fenced code, pipe tables,
// block quotes, rules, and inline code, links, emphasis and backslash escapes. Raw HTML is shown as text.

const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const ESCAPABLE = /^\\[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const NO_COPY = new Set(["", "text", "console", "json"]);

export function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** GitHub's heading ids: lower case, punctuation removed, spaces to hyphens; repeats get -1, -2, … */
export function slugify(text, used) {
  const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
  let slug = base;
  for (let n = 1; used.has(slug); n++) slug = `${base}-${n}`;
  used.add(slug);
  return slug;
}

export function plainText(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

const indentOf = (line) => line.length - line.trimStart().length;
const isBlank = (line) => line.trim() === "";

function listMarker(line) {
  const m = LIST_ITEM.exec(line);
  if (!m) return null;
  const ordered = /\d/.test(m[2]);
  const spaces = m[3].length === 0 ? 1 : m[3].length > 4 ? 1 : m[3].length;
  return {
    indent: m[1].length,
    ordered,
    kind: ordered ? m[2].slice(-1) : m[2],
    start: ordered ? Number.parseInt(m[2], 10) : 1,
    offset: m[1].length + m[2].length + spaces,
    rest: m[3].length > 4 ? " ".repeat(m[3].length - 1) + m[4] : m[4],
  };
}

function startsBlock(line, next) {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    /^ {0,3}>/.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_DELIMITER.test(next) && next.includes("-"))
  );
}

function splitRow(line) {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells = [];
  let cell = "";
  let ticks = 0;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === "\\" && row[i + 1] === "|") {
      cell += ticks ? "|" : "\\|";
      i++;
    } else if (ch === "`") {
      let run = 1;
      while (row[i + run] === "`") run++;
      ticks = ticks === run ? 0 : ticks || run;
      cell += "`".repeat(run);
      i += run - 1;
    } else if (ch === "|" && !ticks) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** Converts one Markdown document. `ctx.link(url)` maps every link target; `ctx.ids` collects heading ids. */
export function renderMarkdown(source, ctx) {
  const lines = source
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->\n?/g, "")
    .replace(/\t/g, "    ")
    .split("\n");
  return renderBlocks(lines, ctx, false);
}

function renderBlocks(lines, ctx, tight) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const [, indent, marks, info] = fence;
      const body = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${marks[0] === "`" ? "`" : "~"}{${marks.length},}\\s*$`).test(lines[i])) {
        body.push(lines[i].replace(new RegExp(`^ {0,${indent.length}}`), ""));
        i++;
      }
      i++;
      out.push(codeBlock(body.join("\n"), info || ""));
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push(headingHtml(heading[1].length, heading[2], ctx));
      i++;
      continue;
    }
    if (RULE.test(line) && !listMarker(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      const quoted = [];
      while (i < lines.length && !isBlank(lines[i])) quoted.push(lines[i++].replace(/^ {0,3}> ?/, ""));
      out.push(`<blockquote>\n${renderBlocks(quoted, ctx, false)}\n</blockquote>`);
      continue;
    }
    if (line.includes("|") && TABLE_DELIMITER.test(lines[i + 1] ?? "") && (lines[i + 1] ?? "").includes("-")) {
      const rows = [splitRow(line)];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) rows.push(splitRow(lines[i++]));
      out.push(tableHtml(rows, ctx));
      continue;
    }
    const marker = listMarker(line);
    if (marker) {
      const parsed = parseList(lines, i, marker);
      out.push(listHtml(parsed, ctx));
      i = parsed.end;
      continue;
    }
    const para = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) {
      const m = listMarker(lines[i]);
      if (m && (!m.ordered || m.start === 1)) break;
      para.push(lines[i].trim());
      i++;
    }
    const text = inline(para.join("\n"), ctx);
    out.push(tight ? text : `<p>${text}</p>`);
  }
  return out.join("\n");
}

function parseList(lines, start, first) {
  const items = [];
  let loose = false;
  let i = start;
  while (i < lines.length) {
    const m = listMarker(lines[i]);
    if (!m || m.ordered !== first.ordered || m.kind !== first.kind || m.indent > first.indent + 3) break;
    const body = [m.rest];
    i++;
    let blankInside = false;
    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) {
        let j = i + 1;
        while (j < lines.length && isBlank(lines[j])) j++;
        if (j < lines.length && indentOf(lines[j]) >= m.offset) {
          for (; i < j; i++) body.push("");
          blankInside = true;
          continue;
        }
        const next = j < lines.length ? listMarker(lines[j]) : null;
        if (next && next.ordered === first.ordered && next.kind === first.kind && next.indent <= first.indent + 3) {
          loose = true;
          i = j;
        }
        break;
      }
      if (indentOf(line) >= m.offset) {
        body.push(line.slice(m.offset));
        i++;
        continue;
      }
      if (listMarker(line) || startsBlock(line, lines[i + 1])) break;
      body.push(line.trim()); // a lazy continuation line of the item's paragraph
      i++;
    }
    if (blankInside && body.slice(0, -1).some((l, n) => l === "" && body[n + 1] !== "")) loose = true;
    items.push(body);
    if (i >= lines.length || isBlank(lines[i])) break;
  }
  return { ordered: first.ordered, start: first.start, items, loose, end: i };
}

function listHtml(list, ctx) {
  const tag = list.ordered ? "ol" : "ul";
  const start = list.ordered && list.start !== 1 ? ` start="${list.start}"` : "";
  const items = list.items.map((body) => `<li>${renderBlocks(body, ctx, !list.loose)}</li>`);
  return `<${tag}${start}>\n${items.join("\n")}\n</${tag}>`;
}

function headingHtml(level, text, ctx) {
  const html = inline(text, ctx);
  const id = slugify(plainText(html), ctx.ids);
  ctx.headings.push({ level, id, html });
  return `<h${level} id="${id}">${html}</h${level}>`;
}

function codeBlock(code, info) {
  const lang = info.toLowerCase();
  const label = lang === "sh" || lang === "bash" ? "Shell commands" : lang ? `Code: ${lang}` : "Example";
  const copy = NO_COPY.has(lang) ? "" : " data-copy";
  return `<pre class="code" tabindex="0" aria-label="${label}"${copy}><code>${escapeHtml(code)}</code></pre>`;
}

function tableHtml(rows, ctx) {
  const [head, ...body] = rows;
  const label = ctx.headings.length ? plainText(ctx.headings[ctx.headings.length - 1].html) : "Table";
  const th = head.map((cell) => `<th scope="col">${inline(cell, ctx)}</th>`).join("");
  const trs = body.map((row) => {
    const cells = head.map((_, n) => `<td>${inline(row[n] ?? "", ctx)}</td>`).join("");
    return `<tr>${cells}</tr>`;
  });
  return (
    `<div class="table-wrap" tabindex="0" role="region" aria-label="${escapeHtml(label)}">` +
    `<table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${trs.join("\n")}\n</tbody>\n</table></div>`
  );
}

/** Inline Markdown: code spans and links become placeholders first, so emphasis never reaches into them. */
function inline(text, ctx) {
  const kept = [];
  const keep = (html) => `\u0000${kept.push(html) - 1}\u0000`;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && ESCAPABLE.test(text.slice(i, i + 2))) {
      out += keep(escapeHtml(text[i + 1]));
      i += 2;
      continue;
    }
    if (ch === "`") {
      let run = 1;
      while (text[i + run] === "`") run++;
      const close = text.indexOf("`".repeat(run), i + run);
      if (close !== -1 && text[close + run] !== "`") {
        let code = text.slice(i + run, close).replace(/\n/g, " ");
        if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
        out += keep(`<code>${escapeHtml(code)}</code>`);
        i = close + run;
        continue;
      }
      out += "`".repeat(run);
      i += run;
      continue;
    }
    if (ch === "<") {
      const auto = /^<(https?:\/\/[^\s<>]+)>/.exec(text.slice(i));
      if (auto) {
        out += keep(`<a href="${escapeHtml(ctx.link(auto[1]))}">${escapeHtml(auto[1])}</a>`);
        i += auto[0].length;
        continue;
      }
    }
    if (ch === "[") {
      const link = parseLink(text, i);
      if (link) {
        const label = inline(link.label, ctx);
        out += keep(`<a href="${escapeHtml(ctx.link(link.url))}">${label}</a>`);
        i = link.end;
        continue;
      }
    }
    out += ch;
    i++;
  }
  let html = escapeHtml(out)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*]*?[^\s*])\*(?![\w*])/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?![\w])/g, "$1<em>$2</em>");
  html = html.replace(/\u0000(\d+)\u0000/g, (_, n) => kept[Number(n)]);
  return html.replace(/\u0000(\d+)\u0000/g, (_, n) => kept[Number(n)]);
}

function parseLink(text, start) {
  let depth = 0;
  let i = start;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
    } else if (ch === "`") {
      const close = text.indexOf("`", i + 1);
      if (close === -1) return null;
      i = close;
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]" && --depth === 0) {
      break;
    }
  }
  if (depth !== 0 || text[i + 1] !== "(") return null;
  const target = /^\(\s*<?([^\s)>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(text.slice(i + 1));
  if (!target) return null;
  return { label: text.slice(start + 1, i), url: target[1], end: i + 1 + target[0].length };
}
