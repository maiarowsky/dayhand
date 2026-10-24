# Landing page research

Before writing the dayhand.dev landing page (`site/`), I looked at the public pages of open source
and developer tools: Zed, Ghostty (home and download page), Atuin, Obsidian, Tailscale, Raycast and
the lazygit README, in October 2026. Only the structure was taken; no text, image or code from
those pages is in `site/`.

Every one of them opens with a single short sentence that says what the tool is, and Tailscale and
Atuin put two buttons under it: one to start, one to read more; Dayhand's hero does the same with
"Get started" and "View on GitHub". Atuin shows its install command in the hero as a monospace block
with a copy button, so the first thing a developer can do is visible at once; Dayhand shows the real
commands that work today and a small script adds a copy button. A short terminal demo or app
screenshot sits right under the hero on Atuin, Obsidian and Zed; Dayhand uses a terminal transcript
whose output comes from the README, checked by `scripts/verify-readme.sh`, and the real macOS screenshot
from `docs/assets`. Ghostty's download page groups the options by platform, with a direct download
where one exists and a route to the docs or a source build where it does not; Dayhand gets one card
per platform with the same split. Ghostty never mentions a platform it does not have, and none of the
pages pretend a package exists; Dayhand labels everything without a published release "Coming soon"
and gives no command or link for it. Raycast and Atuin give their AI and agent features a section of
their own with a mockup of an agent at work; Dayhand's agent section walks through one task an agent
claims, finishes with proof and that the owner can stop. Obsidian puts local-first storage and privacy
in three short points near the top, and Atuin answers self-hosting in a callout and the FAQ; Dayhand
has a "Your own server" section and repeats the key points in the FAQ. Tailscale and Atuin keep open
source in the footer and the FAQ with a link to the code; Dayhand names the license (Apache-2.0) in
its own section and in the footer, next to the repository link. Atuin ends with a five-question FAQ
and a closing call to action, which Dayhand copies as a pattern with native `<details>` elements. The
lazygit README shows that a feature list with a demo per feature reads well, but long pages tire, so
Dayhand keeps one sentence or two per feature and links to the documentation for the rest. None of
those pages needs a framework to read, and Dayhand's page is plain HTML and CSS that works from a
file, with no fonts, scripts or trackers from other servers.
