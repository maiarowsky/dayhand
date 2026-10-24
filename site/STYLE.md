# dayhand.dev: how the site is built

`site/` is an [Astro](https://astro.build) project that builds dayhand.dev into `site/dist/` as plain
static files: HTML, one stylesheet, one small script and images, with no server code, no framework on the
page and nothing loaded from other servers. The site is in English; its text is written for this project.

Astro is the only dependency, pinned in `package-lock.json`. Install from the lockfile with install scripts
off, and run Astro through the npm scripts, which start it with its telemetry off (`scripts/astro.mjs`):

```sh
cd site
npm ci --ignore-scripts
npm run dev       # http://localhost:4321, rebuilds on every save
npm run build     # writes dist/
npm run preview   # serves dist/ as it will be published
```

| File | What it is |
|---|---|
| `astro.config.mjs` | static output into `dist/`, a folder per page with a trailing slash, no inline styles or scripts, images through sharp |
| `src/pages/index.astro` | the home page; each section is a component in `src/components/home/` |
| `src/pages/404.astro` | the page the host serves for an address that does not exist |
| `src/pages/sitemap.xml.ts` | `sitemap.xml`, written at build time |
| `src/layouts/Page.astro` | the head with its metadata, the header and the footer of every page |
| `src/components/Screenshot.astro` | one app screenshot, light and dark, as WebP at the widths a place needs |
| `src/styles/site.css` | every style, with the tokens on `:root` |
| `src/scripts/copy-buttons.ts` | adds a Copy button to code blocks; the page works without it |
| `src/site.ts` | the addresses the pages link to |
| `src/assets/screens/` | the app screenshots the build resizes |
| `public/` | files copied as they are: `favicon.svg` (a copy of `design/icon/dayhand-icon.svg`), `robots.txt`, and `apple-touch-icon.png` and `og-image.png`, rendered by `scripts/render-site-images.sh` from the icon and `og-image.svg` |
| `wrangler.toml` | the Cloudflare Worker that serves `dist/` at dayhand.dev |

Check the build with `scripts/check-site.sh` before every change is merged (`--build` installs and builds
first). It reads `site/dist/`: HTML structure, image attributes, internal links and fragments, that pages
link with a trailing slash, that nothing a page loads comes from another server, the metadata of every page
(description; canonical address, Open Graph tags and a sitemap entry, or `noindex`), the 404 page, the
image weight of a page, `sitemap.xml` and `robots.txt`. Its CSS/JS scans are static lint rules for URL
literals and the CSS patterns ruled out below; they do not run code or watch network requests.

## Deploying

Only maintainers deploy, after a merge to `main`. From `site/`, with Wrangler logged in to the Cloudflare
account that owns dayhand.dev:

```sh
npm run build && wrangler deploy
```

`wrangler.toml` names the Worker (`dayhand-site`), the folder it serves (`./dist`), the 404 handling and
the custom domain. It holds no account id and no secrets: the account comes from `wrangler login`.

## Screenshots

Every screenshot shows the real apps, built from this repository, on made-up demo data: a one-person
business's day with its agents, entered into a throwaway local backend. Never take them on a real plan or a
real account. The Mac app ran under its own bundle id with its own data folder and no keychain entry; the
Android app ran on an emulator with the demo-mode status bar. Each screen has a light and a dark file, which
`<picture>` swaps by `prefers-color-scheme`.

The files in `src/assets/screens/` are lossless WebP at device resolution (Android 1080 × 2400, a Mac
window 2160 × 1400); the build makes smaller WebP files at the widths each place asks for, with width and
height set so nothing moves while they load. To replace one, keep the file name, check the new picture by
eye for anything that is not demo data, and look at the page in both themes.

## Rules from good-css.com that this site follows

The CSS follows the principles published at [good-css.com](https://good-css.com) (read in October 2026).
The layout was checked at 390 px and 1280 px wide, in the light and the dark theme:

- **Tokens on `:root`.** Colours, the type and space scale, radii, fonts and motion are custom
  properties; components only use them. Hover tints are made with `color-mix(in oklch, …)` from a token,
  never a second hard-coded colour.
- **One stylesheet.** `site.css` is imported once by the layout and built into one file; components have
  no `<style>` blocks, so every rule is in one place.
- **OKLCH colour, shared theme tokens.** The palette comes from the app icon (espresso, caramel,
  cream). Theme-dependent tokens use `light-dark()` with `oklch()` colours; the palette and terminal
  text colours stay fixed across themes. `color-scheme: light dark` makes the browser pick them from
  `prefers-color-scheme`.
- **Fluid sizes with `clamp()`.** Type and space steps mix `rem` and `vw` (never a bare `vw`), and no
  maximum is more than 2.5 times its minimum, so text still grows with the reader's font setting.
- **A reset:** `border-box`, `min-inline-size: 0` on grid and flex items, `text-wrap: balance` on headings
  and `pretty` on paragraphs, `font-synthesis: none`, `100svh`, a stable scrollbar gutter and
  `overflow-wrap: break-word` at the root (not `anywhere`).
- **Logical properties** (`inline-size`, `padding-block`, `inset-inline-start`, `margin-block-start`)
  instead of left, right, top and bottom.
- **A content grid with named lines.** Header, sections and footer share
  `[full-start] … [content-start] … [content-end] … [full-end]`, so the 16 px gutter (`--gutter`) holds at
  any width and the page never scrolls sideways; code blocks and the rows of phone screens scroll inside
  themselves.
- **Intrinsic grids first.** Cards use `repeat(auto-fit, minmax(min(100%, …), 1fr))`. The few width
  queries move the header navigation below the name, put a screenshot beside its text, turn a row of
  phone screens from a sideways strip into a grid, and give the phone in the first screen more room on
  narrow screens.
- **Group spacing set by the parent** with `gap`; there are no spacer elements.
- **One focus ring** with `:focus-visible` in the accent colour (the code colour on the dark code
  background), never `outline: none`; a skip link is the first element on the page.
- **Hover only where hover exists** (`hover: hover` and `pointer: fine`), press feedback with
  `scale: 0.97`, and hit areas of at least 44 px for buttons and navigation links (a positioned
  `::after` on the small ones).
- **Opt-in motion.** Movement only inside `prefers-reduced-motion: no-preference`; colour fades stay
  outside. Transitions name their properties (never `transition: all`), use an ease-out token and stay
  under 300 ms.
- **`overflow: clip` instead of `hidden`** on the terminal frames, and `tabular-nums` only on the step
  numbers.
- **Native elements before scripts.** The FAQ is `<details>`; JavaScript only adds Copy buttons.
- **Never disable zoom**, never `user-select: none` on text you read (only on the `$` prompt of the
  terminal samples), never truncate text.

Not used, because the site does not need them: subgrid, container queries, popovers, view transitions,
scroll-driven animation, `text-box` and `@property`.

## Accessibility

- Text, links and badges reach WCAG AA contrast in both themes: worked out from the colour tokens in
  October 2026, the lowest pair is 6.1:1. Lighthouse scored accessibility 100 for the home page on a
  desktop in the light theme and on a phone in the dark one.
- Landmarks: `header`, `nav` (named "Main" and "Footer"), `main`, `footer`; each section is labelled by its
  heading, and headings go in order (one `h1`).
- Every screenshot has alt text that says what the screen shows; decorative images have `alt=""`. Code
  blocks and rows that scroll sideways are focusable and named.
- The Copy button announces the result through a `role="status"` element.

## Privacy

No cookies, no analytics, no fonts or scripts from other servers. `scripts/check-site.sh` checks what the
built pages reference and lints the built CSS and JS; it does not prove runtime network behaviour. Verify
requests separately in a browser's Network panel.
