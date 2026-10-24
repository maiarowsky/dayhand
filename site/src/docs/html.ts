// Turns the HTML that Astro renders from a docs/*.md file into the body of a documentation page. Astro's
// Markdown output is regular, so a few string passes do it with no Markdown plugins and no extra package:
// - raw HTML that is not a known element is shown as text, because the docs write placeholders such as
//   <deployment> in plain text, which a browser would otherwise swallow as an unknown tag;
// - the # title and the first paragraph become the page title and description;
// - links to listed docs become links to their pages, links to other files in the repository go to GitHub,
//   a link to a file that does not exist stops the build, and a bare "https://…" stays text;
// - code blocks and tables can be scrolled with the keyboard, and shell blocks get a Copy button.
// scripts/check-site.sh then checks the built pages: closed elements, unique ids and every internal link.
import { existsSync, statSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { REPO_URL } from "../site.ts";
import { docsPath, isDocsPage } from "./pages.ts";

/** The repository: the nearest folder, from where the build runs, that holds both docs/ and site/. */
function findRoot(start: string): string {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "docs")) && existsSync(join(dir, "site"))) return dir;
    if (dirname(dir) === dir) throw new Error(`docs: no repository with docs/ and site/ above ${start}`);
  }
}

const ROOT = findRoot(process.cwd());
const DESCRIPTION_CHARS = 160;
const TABLE_LABEL_CHARS = 60;
const NO_COPY = new Set(["text", "console", "json"]);
// Elements Markdown itself produces, plus a few that docs may write on purpose.
const KNOWN_TAGS = new Set(
  ("a abbr b blockquote br code dd del details div dl dt em h1 h2 h3 h4 h5 h6 hr i img input kbd li ol p pre " +
    "s section span strong sub summary sup table tbody td tfoot th thead tr u ul").split(" "),
);
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

export interface DocsHtml {
  title: string;
  description: string;
  html: string;
}

const escapeText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (text: string): string => escapeText(text).replace(/"/g, "&quot;");

/** The readable text of an HTML fragment, on one line. */
export function plainText(html: string): string {
  return html
    .replace(/<\/(?:p|li|h[1-6]|t[dhr]|pre|blockquote|div|[ou]l|table|thead|tbody)>|<br\s*\/?>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name])
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, text.lastIndexOf(" ", limit - 1))}…`;
}

/** Where a link written in docs/<src> goes on the site; throws when its target does not exist. */
function resolveLink(src: string, href: string): string {
  if (href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return href;
  const [path, fragment] = href.split("#", 2);
  const hash = fragment ? `#${fragment}` : "";
  const target = posix.normalize(posix.join("docs", decodeURI(path))).replace(/\/$/, "");
  if (target.startsWith("..")) throw new Error(`docs/${src}: ${href} points outside the repository`);
  const name = target.slice("docs/".length);
  if (target.startsWith("docs/") && !name.includes("/") && isDocsPage(name)) return docsPath(name) + hash;
  const file = resolve(ROOT, target);
  if (!existsSync(file)) throw new Error(`docs/${src}: ${href} points at a missing file (${target})`);
  return `${REPO_URL}/${statSync(file).isDirectory() ? "tree" : "blob"}/main/${target}${hash}`;
}

/** Whether an address that Markdown turned into a link names a real host, unlike "https://…" in a sentence. */
function isRealAddress(href: string): boolean {
  try {
    const { hostname } = new URL(href.replace(/&amp;/g, "&"));
    return hostname === "localhost" || hostname.includes(".");
  } catch {
    return false;
  }
}

export function prepareDocsHtml(src: string, rendered: string): DocsHtml {
  const html = rendered.replace(/<(\/?)([A-Za-z][A-Za-z0-9-]*)([^<>]*)>/g, (tag, _slash, name: string) =>
    KNOWN_TAGS.has(name.toLowerCase()) ? tag : escapeText(tag),
  );

  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  if (!h1) throw new Error(`docs/${src}: the page needs a # title`);
  const body = html.slice(0, h1.index) + html.slice(h1.index + h1[0].length);
  const lead = /<p>([\s\S]*?)<\/p>/.exec(body);
  const title = plainText(h1[1]);

  const page = body
    // Bare addresses become links in Markdown; one without a real host is example text.
    .replace(/<a href="(https?:\/\/[^"]*)">([^<]*)<\/a>/g, (link, href: string, text: string) =>
      isRealAddress(href) ? link : text,
    )
    .replace(/<a href="([^"]*)"/g, (_, href: string) => {
      const target = resolveLink(src, href.replace(/&amp;/g, "&"));
      return `<a href="${escapeAttribute(target)}"`;
    })
    .replace(/<pre>(<code(?: class="language-([^"]+)")?)/g, (_, code: string, language?: string) => {
      const copy = language && !NO_COPY.has(language) ? " data-copy" : "";
      return `<pre tabindex="0"${copy}>${code}`;
    })
    .replace(/<table>([\s\S]*?)<\/table>/g, (_, inner: string) => {
      const header = /<thead>([\s\S]*?)<\/thead>/.exec(inner);
      const label = `Table: ${shorten(header ? plainText(header[1]) : "", TABLE_LABEL_CHARS)}`;
      return `<div class="table-wrap" tabindex="0" role="region" aria-label="${escapeAttribute(label)}"><table>${inner}</table></div>`;
    });

  return { title, description: shorten(lead ? plainText(lead[1]) : title, DESCRIPTION_CHARS), html: page };
}
