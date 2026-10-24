// The search index of the documentation, written at build time: one entry per page section (the text
// before the first subheading, then each ## or ### section), which src/scripts/docs-search.ts loads on first use.
import type { APIRoute } from "astro";
import { getEntry } from "astro:content";
import { plainText, prepareDocsHtml } from "../../docs/html.ts";
import { PAGES, docsPath } from "../../docs/pages.ts";

export const GET: APIRoute = async () => {
  const entries = [];
  for (const page of PAGES) {
    const entry = await getEntry("docs", page.src);
    if (!entry?.rendered) throw new Error(`search index: docs/${page.src} did not render`);
    const { title, html } = prepareDocsHtml(page.src, entry.rendered.html);
    const url = docsPath(page.src);
    const parts = html.split(/(?=<h[23][\s>])/);
    for (const part of parts) {
      const heading = /^<h[23][^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h[23]>/.exec(part);
      const text = plainText(heading ? part.slice(heading[0].length) : part);
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
