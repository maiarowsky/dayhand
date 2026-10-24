# dayhand.dev: how the page is built

`site/` is the whole landing page: plain HTML, one stylesheet and one small script, with no framework,
no build step and nothing loaded from other servers. Open `site/index.html` from the file system and it
works as it will online. The page is in English; its text is written for this project.

| File | What it is |
|---|---|
| `index.html` | the landing page |
| `404.html` | the page a host shows for a missing address; its links start at `/` so it works at any path, which also means it has no styles when opened as a file |
| `styles.css` | every style, with the tokens on `:root` |
| `main.js` | adds a Copy button to code blocks; the page works without it |
| `favicon.svg` | a copy of `design/icon/dayhand-icon.svg` |
| `apple-touch-icon.png`, `og-image.png` | rendered by `scripts/render-site-images.sh` from the icon and `og-image.svg` |
| `assets/today-macos.png` | a copy of `docs/assets/today-macos.png`, the macOS app on sample data |
| `robots.txt`, `sitemap.xml` | for search engines, with the address `https://dayhand.dev` |

Check it with `scripts/check-site.sh` before every change is merged: it fails on unclosed elements,
duplicate ids, images without alt text or size, dead internal links and fragments, anything loaded from
another server, and the CSS patterns ruled out below.

## Rules from good-css.com that this page follows

The CSS follows the principles published at [good-css.com](https://good-css.com) (read in October 2026).
The layout was checked at 390 px and 1280 px wide, in the light and the dark theme:

- **Tokens on `:root`.** Colours, the type and space scale, radii, fonts and motion are custom
  properties; components only use them. Hover tints are made with `color-mix(in oklch, …)` from a token,
  never a second hard-coded colour.
- **OKLCH colour, one token for light and dark.** Every colour is `oklch()`, the palette comes from the
  app icon (espresso, caramel, cream), and each token holds both values with `light-dark()`.
  `color-scheme: light dark` makes the browser pick them from `prefers-color-scheme`; a
  `prefers-color-scheme: dark` query also dims the light screenshot a little.
- **Fluid sizes with `clamp()`.** Type and space steps mix `rem` and `vw` (never a bare `vw`), and no
  maximum is more than 2.5 times its minimum, so text still grows with the reader's font setting.
- **A reset:** `border-box`, `min-inline-size: 0` on grid and flex items, `text-wrap: balance` on headings
  and `pretty` on paragraphs, `font-synthesis: none`, `100svh`, a stable scrollbar gutter and
  `overflow-wrap: break-word` at the root (not `anywhere`).
- **Logical properties** (`inline-size`, `padding-block`, `inset-inline-start`, `margin-block-start`)
  instead of left, right, top and bottom.
- **A content grid with named lines.** Header, sections and footer share
  `[full-start] … [content-start] … [content-end] … [full-end]`, so the 16 px gutter (`--gutter`) holds at
  any width and nothing scrolls sideways; code blocks scroll inside themselves.
- **Intrinsic grids instead of breakpoints.** Cards use
  `repeat(auto-fit, minmax(min(100%, 15rem), 1fr))`; the only width queries move the header navigation
  below the name and put the screenshot beside its text on wide screens.
- **Spacing set by the parent** with `gap`; children carry no outer margins and there are no spacer
  elements.
- **One focus ring** with `:focus-visible` in `currentColor`, never `outline: none`; a skip link is the
  first element on the page.
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
  terminal sample), never truncate text.

Not used, because the page does not need them: subgrid, container queries, popovers, view transitions,
scroll-driven animation, `text-box` and `@property`.

## Accessibility

- Text and links reach WCAG AA contrast in both themes. Measured in Chrome on every text element in
  October 2026, the lowest pair was 6.4:1 in the light theme and 6.6:1 in the dark one.
- Landmarks: `header`, `nav` (named "Main" and "Footer"), `main`, `footer`; each section is labelled by its
  heading, and headings go in order (one `h1`).
- Every image has alt text, or `alt=""` when the name next to it already says it; code blocks that scroll
  are focusable and named.
- The Copy button announces the result through a `role="status"` element.

## Privacy

No cookies, no analytics, no fonts or scripts from other servers. `scripts/check-site.sh` fails if
anything the page loads comes from another address.
