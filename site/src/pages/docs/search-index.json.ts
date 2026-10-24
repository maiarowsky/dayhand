// The search index of the documentation, written at build time: one entry per page section (the text
// before the first subheading, then each ## section), which src/scripts/docs-search.ts loads on first use.
import type { APIRoute } from "astro";
import { getEntry } from "astro:content";
import { plainText, prepareDocsHtml } from "../../docs/html.ts";
import { PAGES, docsPath } from "../../docs/pages.ts";

// Text kept per section; enough to find a section by any word in it without a large download.
const SECTION_TEXT_CHARS = 4000;

export const GET: APIRoute = async () => {
  const entries = [];
  for (const page of PAGES) {
    const entry = await getEntry("docs", page.src);
    if (!entry?.rendered) throw new Error(`search index: docs/${page.src} did not render`);
    const { title, html } = prepareDocsHtml(page.src, entry.rendered.html);
    const url = docsPath(page.src);
    // Each ## heading starts a section; its id comes from Astro's heading ids.
    const parts = html.split(/(?=<h2[\s>])/);
    for (const part of parts) {
      const heading = /^<h2[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/.exec(part);
      const text = plainText(heading ? part.slice(heading[0].length) : part).slice(0, SECTION_TEXT_CHARS);
      if (!heading && !text) continue;
      entries.push({
        t: heading ? plainText(heading[2]) : title,
        p: title,
        u: heading ? `${url}#${heading[1]}` : url,
        x: text,
      });
    }
  }
  return new Response(JSON.stringify(entries), { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
