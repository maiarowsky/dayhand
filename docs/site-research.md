# Website research

Before the second version of dayhand.dev, fourteen public sites of open source apps and tools were read
on 24 October 2026: Immich, Bitwarden, Home Assistant, AppFlowy, Logseq, Joplin, Vikunja, Super
Productivity, Tasks.org, Plausible, Zed, Ghostty, Cal.com and Ente, with their download, install and
self-hosting pages where they have them. Each was fetched as HTML and looked at in headless Chrome at
1280 and 390 px, light and dark. Only structure and practice were taken from them; no text, image or code
of theirs is in `site/`. Page weights below come from the browser's resource timing and are rough.

## What each site does

| Site | First screen | Screenshots | Free and open source | Downloads and docs | Not released yet |
|---|---|---|---|---|---|
| Immich | Download and a demo | real, bare, swapped for dark mode; phones tilted | never named on the home page, no licence | a download page with phone and server cards | roadmap items marked "soon", no dates |
| Bitwarden | sign up free, talk to sales | mostly illustrations; real ones on the download page | "open source" in the subtitle, no licence | an OS tab per platform with a Homebrew command | none |
| Home Assistant | get started, a live demo | a live demo in a CSS phone outline | in the hero; the licence only in the footer | Documentation is the first menu item | early hardware named as a preview edition |
| AppFlowy | self-host, get started | a staged desktop window | "open core", rounded star and download counts | the button label changes with your browser | none |
| Logseq | download for your OS | illustrations | a grid tile, no licence | OS tabs linked to release files | a "coming soon" list |
| Joplin | download, sign up for the paid cloud | one image: laptop with a phone over its corner, same note on both | in the hero, no licence | the download starts by itself | none |
| Vikunja | own server or their cloud, side by side | eight real light and dark pairs in a slideshow | AGPLv3 in the body and the FAQ, with "is it free?" | a three-step install guide | none |
| Super Productivity | a "free, open source" pill, try it, download | a captioned real screenshot, light and dark pairs | MIT in the FAQ; a page that explains why it is free | every platform visible, yours highlighted | none |
| Tasks.org | store badges | none, stock illustrations | GPLv3 in a tile | packages per architecture | a plain "Desktop (alpha)" line under the badges |
| Plausible | free trial, live demo | one real dashboard | AGPLv3 and an honest cloud versus self-hosted page | docs under a menu | none |
| Zed | download, clone the source | the editor rebuilt in HTML | star and contributor counters | version and date first, a Linux one-liner | a preview channel and a beta sign-up |
| Ghostty | download, documentation | none, an animated logo | not on the home page | signed builds, checksums and signatures in the docs | Windows simply not mentioned |
| Cal.com | sign up | a mock with an out-of-date month | not on the home page | the download link fetches an installer at once | "available" in one place, a waitlist in another |
| Ente | sign up, log in | stock photos and a rendered phone | in the tagline, no licence | desktop and mobile cards with every format | none |

Privacy and weight varied as much: consent banners and tag managers on Bitwarden, Zed, Joplin, AppFlowy
and Cal.com; first-party analytics only on Plausible, Ghostty and Super Productivity; pages from about
0.1 MB (Plausible) to over 4 MB (Joplin), with Super Productivity at about 0.2 MB.

## What dayhand.dev takes from them

- **Two buttons and a line of reassurance.** Download and the documentation, as Ghostty, Zed and Immich
  pair them, with three short facts under the buttons (free, no account, your data) as Super
  Productivity and Plausible do.
- **A pill above the heading** saying "free and open source" with the licence, linked to the licence
  section, the slot Super Productivity uses for the same message.
- **The licence named in the body and again in the FAQ**, with a plain "why is it free?" answer, as on
  Vikunja, Super Productivity and Plausible. Dayhand adds that there is no paid plan and no hosted
  service yet (Dayhand Cloud is planned), and says what the one non-Apache part (the Convex local backend) is.
- **Frank about self-hosting.** Like Vikunja's two paths and Plausible's comparison: explain the choices
  before setup. Dayhand's server paths are in [README.md](../README.md#your-own-server).
- **Phone and desktop together, showing the same plan**, the idea from Joplin, built the way Immich builds
  its images: two separate real screenshots, light and dark files swapped by `<picture>`, the phone over
  the Mac window's corner with a caption naming both. On narrow screens the phone takes half the width
  instead of standing alone, so both platforms stay in view.
- **Real screenshots**, as on Vikunja, and one-line captions, as on Super Productivity. Dayhand's capture
  and image-handling rules are in [site/STYLE.md](../site/STYLE.md#screenshots).
- **Rows of phone screens that scroll sideways under the reader's control**, never a slideshow that moves
  by itself.
- **Every platform visible with its real state.** One card per platform with requirements, as Ente, Zed and
  Ghostty list them; availability follows [Install](install.md), with no badge or link for what does not
  exist.
- **An unreleased platform said plainly.** Tasks.org's "Desktop (alpha)" line is the most honest model:
  iPhone and iPad get a muted "In the works" card and a line in the platform list, with no store badge,
  and the download section starts with a "Pre-release" note.
- **Agents shown with real output.** Instead of a mockup, the agent section uses the real `dayhand show`
  and `dayhand` output from the same demo plan as the screenshots.

## What it avoids

- Numbers that cannot be checked or mean little before a release: stars, downloads, users online,
  testimonials and press quotes. The page has none.
- Stock illustrations or rendered devices in place of the product.
- Slideshows that move on their own and hide content.
- Consent banners, tag managers and analytics: there is nothing to consent to.
- Content that only appears with JavaScript. The page is static HTML; the one script adds Copy buttons.
- Heavy pages: the home page loads about 0.5 MB of images at most, for a phone with a dense screen.
- Downloads that start by themselves, and availability said two ways.
- Trust leaks such as leftover template text or a demo that pretends to be real: the footer says that
  the screenshots show made-up demo data, and every alt text describes what is actually on the screen.

Left for later: highlighting the visitor's platform with a small script (Super Productivity) once there
are downloads to point at, and checksums and signatures next to each download (Ghostty) once there are
releases.
