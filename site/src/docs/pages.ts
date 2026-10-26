// The documentation at dayhand.dev/docs/: which docs/*.md files become pages, in which group and order, and
// the address of each. docs/README.md is /docs/; any other page is /docs/<file name without .md>/. Links to
// a docs/*.md file that is not listed here, or to any other file in the repository, go to GitHub.

export interface DocsPage {
  /** The file in docs/, such as `deploy.md`. */
  src: string;
  /** The name in the side navigation. */
  nav: string;
}

export interface DocsSection {
  title: string;
  pages: DocsPage[];
}

export const SECTIONS: DocsSection[] = [
  {
    title: "Get started",
    pages: [
      { src: "README.md", nav: "Overview" },
      { src: "getting-started.md", nav: "Quick start" },
      { src: "install.md", nav: "Install" },
    ],
  },
  {
    title: "Apps",
    pages: [
      { src: "projects.md", nav: "Projects and labels" },
      { src: "android.md", nav: "Android" },
      { src: "macos-app.md", nav: "macOS" },
      { src: "linux.md", nav: "Linux and Omarchy" },
      { src: "terminal.md", nav: "Terminal: dayhand ui" },
      { src: "omarchy.md", nav: "dayhand ui on Omarchy" },
    ],
  },
  {
    title: "Command line",
    pages: [{ src: "cli.md", nav: "Command reference" }],
  },
  {
    title: "Agents",
    pages: [
      { src: "agents.md", nav: "Agents and you" },
      { src: "agent-work.md", nav: "How agent work is designed" },
      { src: "mcp.md", nav: "MCP endpoint" },
      { src: "oauth.md", nav: "Claude apps (OAuth)" },
    ],
  },
  {
    title: "Server and integrations",
    pages: [
      { src: "deploy.md", nav: "Your own server" },
      { src: "pairing.md", nav: "Phone pairing" },
      { src: "api.md", nav: "REST API" },
      { src: "webhooks.md", nav: "Webhooks" },
      { src: "calendar.md", nav: "Calendar feed" },
      { src: "architecture.md", nav: "Architecture" },
    ],
  },
  {
    title: "Security and help",
    pages: [
      { src: "security.md", nav: "Security and privacy" },
      { src: "oauth-threat-model.md", nav: "OAuth threat model" },
      { src: "faq.md", nav: "FAQ and troubleshooting" },
      { src: "contributing.md", nav: "Contributing" },
      { src: "rename.md", nav: "Renamed from Helm" },
    ],
  },
];

/** Every page in reading order, with the title of its group. */
export const PAGES = SECTIONS.flatMap((section) => section.pages.map((page) => ({ ...page, section: section.title })));

/** The slug of a page: empty for docs/README.md, otherwise the file name without .md. */
export const docsSlug = (src: string): string => (src === "README.md" ? "" : src.replace(/\.md$/, ""));

/** The address of a page on the site, always with a trailing slash. */
export const docsPath = (src: string): string => {
  const slug = docsSlug(src);
  return slug ? `/docs/${slug}/` : "/docs/";
};

const LISTED = new Set(PAGES.map((page) => page.src));

/** Whether docs/<src> is a page of the site, rather than a file shown on GitHub. */
export const isDocsPage = (src: string): boolean => LISTED.has(src);
