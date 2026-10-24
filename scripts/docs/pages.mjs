// The documentation at dayhand.dev/docs: which docs/*.md files become pages, in which order and group.
// A page's file name in site/docs/ is its source name with .html (README.md becomes index.html).
// Links between these files become links between the pages; links to any other file in the repository
// go to that file on GitHub.

export const REPOSITORY = "https://github.com/maiarowsky/dayhand";
export const BRANCH = "main";
export const ORIGIN = "https://dayhand.dev";

export const SECTIONS = [
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

export const pageFile = (src) => (src === "README.md" ? "index.html" : src.replace(/\.md$/, ".html"));
