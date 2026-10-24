// sitemap.xml for search engines, written at build time: every page worth finding.
import type { APIRoute } from "astro";
import { PAGES as DOCS, docsPath } from "../docs/pages.ts";
import { SITE_URL } from "../site";

const PAGES = ["/", ...DOCS.map((page) => docsPath(page.src))];

export const GET: APIRoute = () => {
  const urls = PAGES.map((path) => `  <url><loc>${new URL(path, SITE_URL).href}</loc></url>`).join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
