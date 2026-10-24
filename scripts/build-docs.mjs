#!/usr/bin/env node
// Builds the documentation pages of dayhand.dev (site/docs/) from docs/*.md, with Node's standard library only.
//
//   node scripts/build-docs.mjs           # writes site/docs/*.html and site/docs/search-index.js
//   node scripts/build-docs.mjs --check   # writes nothing; exit 1 when site/docs/ is not what docs/ gives
//
// The pages use the landing page's styles.css and main.js (Copy buttons); site/docs/search.js (hand-written)
// searches search-index.js, which is plain JSON assigned to one global, so it also works from the file system.
// Which files become pages, and in which order, is in scripts/docs/pages.mjs. A link to a file that does not
// exist, or to a heading another page does not have, stops the build.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml, plainText, renderMarkdown } from "./docs/markdown.mjs";
import { BRANCH, ORIGIN, REPOSITORY, SECTIONS, pageFile } from "./docs/pages.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const OUT = join(ROOT, "site", "docs");
const HAND_WRITTEN = new Set(["search.js"]);
const INDEX_FILE = "search-index.js";
const SECTION_TEXT_LIMIT = 4000;

const pages = SECTIONS.flatMap((section) => section.pages.map((page) => ({ ...page, section: section.title })));
const bySource = new Map(pages.map((page) => [`docs/${page.src}`, page]));

function fail(message) {
  console.error(`build-docs: ${message}`);
  process.exit(1);
}

/** Maps a link in docs/<src> to a page here, to the file on GitHub, or leaves an outside address alone. */
function linkResolver(page, problems, crossRefs) {
  return (url) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//") || url.startsWith("#")) return url;
    const [path, fragment] = url.split("#");
    const target = posix.normalize(posix.join("docs", path)).replace(/\/$/, "");
    if (target.startsWith("..")) {
      problems.push(`${page.src}: ${url} points outside the repository`);
      return url;
    }
    const linked = bySource.get(target);
    if (linked) {
      if (fragment) crossRefs.push({ from: page.src, to: linked, fragment });
      return pageFile(linked.src) + (fragment ? `#${fragment}` : "");
    }
    const file = join(ROOT, target);
    if (!existsSync(file)) {
      problems.push(`${page.src}: ${url} points at a missing file (${target})`);
      return url;
    }
    const kind = statSync(file).isDirectory() ? "tree" : "blob";
    return `${REPOSITORY}/${kind}/${BRANCH}/${target}${fragment ? `#${fragment}` : ""}`;
  };
}

function navHtml(current) {
  const groups = SECTIONS.map((section, n) => {
    const items = section.pages.map((page) => {
      const here = page === current ? ' aria-current="page"' : "";
      return `          <li><a href="${pageFile(page.src)}"${here}>${escapeHtml(page.nav)}</a></li>`;
    });
    return [
      `        <p class="docs-nav-title" id="docs-nav-${n}">${escapeHtml(section.title)}</p>`,
      `        <ul aria-labelledby="docs-nav-${n}">`,
      ...items,
      "        </ul>",
    ].join("\n");
  });
  return groups.join("\n");
}

function tocHtml(headings) {
  const h2 = headings.filter((h) => h.level === 2);
  if (h2.length < 4) return "";
  const items = h2.map((h) => `      <li><a href="#${h.id}">${h.html.replace(/<a [^>]*>|<\/a>/g, "")}</a></li>`);
  return `\n    <nav class="docs-toc" aria-label="On this page">\n      <p>On this page</p>\n      <ul>\n${items.join("\n")}\n      </ul>\n    </nav>`;
}

function pagerHtml(index) {
  const link = (page, rel, word) =>
    page ? `<a href="${pageFile(page.src)}" rel="${rel}"><span>${word}</span> ${escapeHtml(page.nav)}</a>` : "<span></span>";
  return `<nav class="docs-pager" aria-label="Previous and next page">${link(pages[index - 1], "prev", "Previous")}${link(pages[index + 1], "next", "Next")}</nav>`;
}

function pageHtml(page, index, rendered) {
  const file = pageFile(page.src);
  const canonical = `${ORIGIN}/docs/${file === "index.html" ? "" : file}`;
  const h1 = rendered.html.indexOf("</h1>");
  const body = h1 === -1 ? rendered.html : rendered.html.slice(0, h1 + 5) + tocHtml(rendered.headings) + rendered.html.slice(h1 + 5);
  const source = `${REPOSITORY}/blob/${BRANCH}/docs/${page.src}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(rendered.title)} · Dayhand docs</title>
  <meta name="description" content="${escapeHtml(rendered.description)}">
  <link rel="canonical" href="${canonical}">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#fbf6ee" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#1c140f" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="../favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="../apple-touch-icon.png">
  <link rel="stylesheet" href="../styles.css">
  <script src="../main.js" defer></script>
  <script src="search.js" defer></script>
</head>
<body class="docs">
  <a class="skip-link" href="#main">Skip to content</a>

  <header class="site-header">
    <a class="brand" href="../index.html" aria-label="Dayhand home">
      <img src="../favicon.svg" alt="" width="32" height="32">
      <span>Dayhand</span>
    </a>
    <nav aria-label="Main">
      <ul>
        <li><a href="../index.html">Home</a></li>
        <li><a href="index.html"${file === "index.html" ? ' aria-current="page"' : ""}>Docs</a></li>
        <li><a href="install.html"${file === "install.html" ? ' aria-current="page"' : ""}>Install</a></li>
        <li><a href="${REPOSITORY}">GitHub</a></li>
      </ul>
    </nav>
  </header>

  <div class="docs-layout">
    <nav class="docs-nav" id="docs-nav" aria-label="Documentation">
      <search class="docs-search" hidden>
        <label for="docs-search-input">Search the docs</label>
        <input type="search" id="docs-search-input" autocomplete="off" spellcheck="false"
          aria-describedby="docs-search-status" aria-controls="docs-search-results">
        <p class="docs-search-status" id="docs-search-status" role="status"></p>
        <ol class="docs-results" id="docs-search-results"></ol>
      </search>
      <details class="docs-menu" open>
        <summary>All pages</summary>
${navHtml(page)}
      </details>
    </nav>

    <main id="main" class="docs-main">
      <article class="prose">
${body}
      </article>
      ${pagerHtml(index)}
    </main>
  </div>

  <footer class="site-footer">
    <p class="brand-line"><img src="../favicon.svg" alt="" width="24" height="24"> Dayhand, open source under the
      Apache License 2.0.</p>
    <nav aria-label="Footer">
      <ul>
        <li><a href="${source}">This page on GitHub</a></li>
        <li><a href="${REPOSITORY}">Repository</a></li>
        <li><a href="${REPOSITORY}/blob/${BRANCH}/cli/CHANGELOG.md">Changelog</a></li>
        <li><a href="security.html">Security</a></li>
        <li><a href="${REPOSITORY}/blob/${BRANCH}/LICENSE">License</a></li>
      </ul>
    </nav>
    <p class="fineprint">No cookies, no trackers, nothing loaded from other servers.</p>
  </footer>
</body>
</html>
`;
}

/** One search entry per heading (h1 to h3) with the text under it, without addresses (see check-site.sh). */
function searchEntries(page, rendered) {
  const parts = rendered.html.split(/(<h[1-3] id="[^"]+">[\s\S]*?<\/h[1-3]>)/);
  const entries = [];
  let current = null;
  for (const part of parts) {
    const heading = /^<h([1-3]) id="([^"]+)">([\s\S]*?)<\/h[1-3]>$/.exec(part);
    if (heading) {
      const anchor = heading[1] === "1" ? "" : `#${heading[2]}`;
      current = { p: rendered.title, t: plainText(heading[3]), u: pageFile(page.src) + anchor, x: "" };
      entries.push(current);
    } else if (current) {
      current.x += ` ${plainText(part.replace(/<\/(?:p|li|td|th|tr|pre|h4|h5|h6|summary)>|<br>/g, " $&"))}`;
    }
  }
  for (const entry of entries) {
    entry.x = entry.x.replace(/(?:[a-z][a-z0-9+.-]*:)?\/\/\S+/gi, " ").replace(/\s+/g, " ").trim().slice(0, SECTION_TEXT_LIMIT);
  }
  return entries;
}

function build() {
  const problems = [];
  const crossRefs = [];
  const rendered = new Map();
  for (const page of pages) {
    const file = join(DOCS, page.src);
    if (!existsSync(file)) fail(`docs/${page.src} is listed in scripts/docs/pages.mjs but does not exist`);
    const ctx = { ids: new Set(), headings: [], link: linkResolver(page, problems, crossRefs) };
    const html = renderMarkdown(readFileSync(file, "utf8"), ctx);
    const titles = ctx.headings.filter((h) => h.level === 1);
    if (titles.length !== 1) problems.push(`${page.src}: needs exactly one # title, has ${titles.length}`);
    const first = /<p>([\s\S]*?)<\/p>/.exec(html);
    const description = plainText(first ? first[1] : "").replace(/\s+/g, " ").trim();
    rendered.set(page, {
      html,
      headings: ctx.headings,
      ids: ctx.ids,
      title: titles[0] ? plainText(titles[0].html) : page.nav,
      description: description.length > 160 ? `${description.slice(0, 157).replace(/\s+\S*$/, "")}…` : description,
    });
  }
  for (const ref of crossRefs) {
    if (!rendered.get(ref.to).ids.has(ref.fragment)) problems.push(`${ref.from}: ${ref.to.src}#${ref.fragment}: no such heading`);
  }
  if (problems.length) fail(`${problems.length} problem(s):\n  ${problems.join("\n  ")}`);

  const files = new Map();
  pages.forEach((page, n) => files.set(pageFile(page.src), pageHtml(page, n, rendered.get(page))));
  const index = pages.flatMap((page) => searchEntries(page, rendered.get(page)));
  files.set(
    INDEX_FILE,
    `// Generated by scripts/build-docs.mjs from docs/*.md. Do not edit by hand.\nwindow.DAYHAND_DOCS_INDEX = ${JSON.stringify(index)};\n`,
  );
  return files;
}

const files = build();
mkdirSync(OUT, { recursive: true });
const existing = readdirSync(OUT).filter((name) => /\.(html|js)$/.test(name) && !HAND_WRITTEN.has(name));
const stray = existing.filter((name) => !files.has(name));

if (process.argv.includes("--check")) {
  const stale = [...files].filter(([name, text]) => !existsSync(join(OUT, name)) || readFileSync(join(OUT, name), "utf8") !== text);
  const wrong = [...stale.map(([name]) => `${name} is out of date`), ...stray.map((name) => `${name} is not built from docs/`)];
  if (wrong.length) {
    fail(`site/docs/ does not match docs/ (run node scripts/build-docs.mjs and commit):\n  ${wrong.join("\n  ")}`);
  }
  console.log(`build-docs: ${files.size} file(s) in ${relative(ROOT, OUT)} are up to date`);
} else {
  for (const [name, text] of files) writeFileSync(join(OUT, name), text);
  if (stray.length) console.warn(`build-docs: not built from docs/, remove if unused: ${stray.join(", ")}`);
  console.log(`build-docs: wrote ${files.size} file(s) to ${relative(ROOT, OUT)}`);
}
