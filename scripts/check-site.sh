#!/usr/bin/env bash
# Checks the build of the dayhand.dev site (site/dist, made by `npm run build` in site/) before it is published:
# - HTML: doctype, lang, charset, a viewport that allows zoom, one <title>, one <h1>, every element closed
#   in order, unique ids, alt text and a size on every <img>, no inline scripts or on* handlers;
# - links: every internal link, #fragment and https://dayhand.dev/ address points at a file of the build and an
#   id that exists, and links to pages end with a slash, the way the host serves them;
# - nothing from other servers: everything a page loads (styles, scripts, images, icons) is in the build; only
#   plain <a href> links may point at other sites;
# - metadata: every page has a description; a page for search engines has a canonical address of its own,
#   Open Graph tags and a place in sitemap.xml, and any other page says noindex; 404.html and robots.txt exist;
# - images: what one page loads at the widest srcset candidates, for one colour scheme, stays within a budget;
# - the documentation search index: every entry points at a page and a section that exist;
# - static CSS/JS lint: CSS url() paths, no @import, outline: none or transition: all, and no server URL
#   literals in scripts. These pattern scans do not observe browser network behaviour.
#
#   scripts/check-site.sh           # checks site/dist as it is
#   scripts/check-site.sh --build   # first installs site/ from its lockfile (no install scripts) and builds it
#
# Needs python3 (standard library only); --build also needs Node.js 22.12 or newer.
# Exit code 0 when everything passes, 1 with a list of problems, 2 when the check cannot run.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SITE="$ROOT/site"
DIST="$SITE/dist"
command -v python3 >/dev/null || { echo "check-site: python3 is needed" >&2; exit 2; }

case "${1:-}" in
  --build) (cd "$SITE" && npm ci --ignore-scripts && npm run build) ;;
  "") ;;
  *) echo "usage: scripts/check-site.sh [--build]" >&2; exit 2 ;;
esac
[ -d "$DIST" ] || { echo "check-site: no build in $DIST; run scripts/check-site.sh --build" >&2; exit 2; }

exec python3 -I - "$DIST" <<'PY'
import json, os, re, sys
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
from xml.etree import ElementTree

DIST = os.path.abspath(sys.argv[1])
ORIGIN = "https://dayhand.dev"
IMAGE_BUDGET = 1_500_000  # bytes of images one page may load for one colour scheme
SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
EXTERNAL = re.compile(r"^(?:[a-z][a-z0-9+.-]*:)?//", re.I)
DARK = "(prefers-color-scheme: dark)"
problems = []

def problem(path, line, message):
    problems.append(f"{os.path.relpath(path, DIST)}:{line}: {message}")

def srcset_urls(value):
    return [part.split()[0] for part in (value or "").split(",") if part.strip()]

class Page(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.path = path
        self.stack = []
        self.ids = {}
        self.refs = []  # (line, attribute, value, tag, attrs)
        self.counts = {"title": 0, "h1": 0}
        self.title_text = ""
        self.in_title = False
        self.lang = None
        self.charset = False
        self.viewport = None
        self.meta = {}  # name or property -> content
        self.canonicals = []
        self.images = []  # (line, light candidate URLs, dark candidate URLs)
        self.dark = None  # dark candidates of the <picture> being read

    def handle_starttag(self, tag, attrs):
        line = self.getpos()[0]
        a = dict(attrs)
        if tag not in VOID:
            self.stack.append((tag, line))
        if tag in self.counts:
            self.counts[tag] += 1
        if tag == "title":
            self.in_title = True
        if tag == "html":
            self.lang = a.get("lang")
        if tag == "meta":
            if (a.get("charset") or "").lower() == "utf-8":
                self.charset = True
            key = a.get("name") or a.get("property")
            if key:
                self.meta[key] = a.get("content") or ""
            if a.get("name") == "viewport":
                self.viewport = a.get("content") or ""
        if tag == "link" and "canonical" in (a.get("rel") or "").lower().split():
            self.canonicals.append(a.get("href") or "")
        if "id" in a:
            if a["id"] in self.ids:
                problem(self.path, line, f'id "{a["id"]}" is used twice (first on line {self.ids[a["id"]]})')
            self.ids[a["id"]] = line
        for name, value in attrs:
            if name.startswith("on"):
                problem(self.path, line, f"inline event handler {name}= (put scripts in a file of their own)")
        if tag == "script" and "src" not in a:
            problem(self.path, line, "inline <script> (put scripts in a file of their own)")
        if tag == "style":
            problem(self.path, line, "inline <style> (styles belong in the stylesheet)")
        if tag == "picture":
            self.dark = []
        if tag == "source" and self.dark is not None and (a.get("media") or "").strip() == DARK:
            self.dark += srcset_urls(a.get("srcset"))
        if tag == "img":
            if "alt" not in a:
                problem(self.path, line, "<img> without alt")
            if "width" not in a or "height" not in a:
                problem(self.path, line, "<img> without width and height")
            light = [a["src"]] if a.get("src") else []
            light += srcset_urls(a.get("srcset"))
            self.images.append((line, light, self.dark if self.dark else light))
        for name in ("href", "src"):
            if name in a:
                self.refs.append((line, name, a[name] or "", tag, a))
        if "srcset" in a:
            for url in srcset_urls(a["srcset"]):
                self.refs.append((line, "srcset", url, tag, a))
        if tag == "meta" and a.get("property") in ("og:image", "og:url"):
            self.refs.append((line, "content", a.get("content") or "", tag, a))
        if "style" in a and re.search(r"url\(", a["style"] or ""):
            problem(self.path, line, "url() in a style attribute")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        line = self.getpos()[0]
        if tag == "title":
            self.in_title = False
        if tag == "picture":
            self.dark = None
        if tag in VOID:
            problem(self.path, line, f"</{tag}> closes a void element")
            return
        if not self.stack:
            problem(self.path, line, f"</{tag}> with nothing open")
            return
        open_tag, open_line = self.stack[-1]
        if open_tag == tag:
            self.stack.pop()
        elif any(t == tag for t, _ in self.stack):
            problem(self.path, line, f"</{tag}> closes <{tag}> while <{open_tag}> from line {open_line} is still open")
            while self.stack and self.stack[-1][0] != tag:
                self.stack.pop()
            self.stack.pop()
        else:
            problem(self.path, line, f"</{tag}> without a matching <{tag}>")

    def handle_data(self, data):
        if self.in_title:
            self.title_text += data

def local_target(page_path, url):
    """The file a same-site address points at, and its fragment; None when it is another site."""
    if url.startswith(ORIGIN + "/") or url == ORIGIN:
        url = url[len(ORIGIN):] or "/"
    elif EXTERNAL.match(url) or re.match(r"^[a-z][a-z0-9+.-]*:", url, re.I):
        return None
    parts = urlsplit(url)
    path = unquote(parts.path)
    if path.startswith("/"):
        target = os.path.join(DIST, path.lstrip("/"))
    elif path:
        target = os.path.join(os.path.dirname(page_path), path)
    else:
        target = page_path
    if os.path.isdir(target):
        target = os.path.join(target, "index.html")
    return os.path.normpath(target), parts.fragment

def page_url(path):
    """The address the host serves a built file at: dist/docs/index.html is /docs/."""
    rel = os.path.relpath(path, DIST).replace(os.sep, "/")
    return "/" + (rel[: -len("index.html")] if rel == "index.html" or rel.endswith("/index.html") else rel)

pages = {}
for dirpath, _, files in os.walk(DIST):
    for name in sorted(files):
        if name.endswith(".html"):
            path = os.path.join(dirpath, name)
            with open(path, encoding="utf-8") as f:
                text = f.read()
            page = Page(path)
            page.feed(text)
            page.close()
            pages[path] = (page, text)

if not pages:
    problems.append("no .html files")

indexed = set()  # canonical addresses of the pages for search engines
for path, (page, text) in pages.items():
    if not re.match(r"\s*<!doctype html>", text, re.I):
        problem(path, 1, "does not start with <!doctype html>")
    if not page.lang:
        problem(path, 1, "<html> without lang")
    if not page.charset:
        problem(path, 1, 'no <meta charset="utf-8">')
    if page.viewport is None:
        problem(path, 1, "no viewport <meta>")
    elif re.search(r"user-scalable\s*=\s*(no|0)|maximum-scale", page.viewport, re.I):
        problem(path, 1, "the viewport <meta> stops zooming")
    if page.counts["title"] != 1 or not page.title_text.strip():
        problem(path, 1, "needs exactly one non-empty <title>")
    if page.counts["h1"] != 1:
        problem(path, 1, f"needs exactly one <h1>, has {page.counts['h1']}")
    for tag, line in page.stack:
        problem(path, line, f"<{tag}> is never closed")
    if not page.meta.get("description", "").strip():
        problem(path, 1, "no description <meta>")

    if "noindex" in page.meta.get("robots", "").lower():
        if page.canonicals:
            problem(path, 1, "a noindex page needs no canonical link")
    else:
        expected = ORIGIN + page_url(path)
        if page.canonicals != [expected]:
            problem(path, 1, f"needs exactly one canonical link to {expected} (or noindex)")
        indexed.add(expected)
        for key in ("og:title", "og:description", "og:image", "twitter:card"):
            if not page.meta.get(key, "").strip():
                problem(path, 1, f"no {key} <meta>")
        if page.meta.get("og:url") != expected:
            problem(path, 1, f"og:url should be {expected}")
        if not page.meta.get("og:image", "").startswith(ORIGIN + "/"):
            problem(path, 1, f"og:image should be an address on {ORIGIN}")

    for line, attr, value, tag, a in page.refs:
        rel = (a.get("rel") or "").lower().split()
        if value == "" or value == "#":
            problem(path, line, f'empty {attr} on <{tag}>')
            continue
        target = local_target(path, value)
        if target is None:
            # Other sites: only plain links may point there; anything the page would load must be local.
            if tag != "a":
                problem(path, line, f"<{tag} {attr}> references another server: {value}")
            continue
        if value.startswith(ORIGIN) and tag == "link" and "canonical" not in rel:
            problem(path, line, f"<link {attr}> should be relative, not {value}")
        if tag == "a":
            link_path = urlsplit(value).path
            last = link_path.rsplit("/", 1)[-1]
            if link_path and not link_path.endswith("/") and "." not in last:
                problem(path, line, f"{value} should end with a slash; the host would redirect it")
        file, fragment = target
        if not file.startswith(DIST + os.sep) and file != DIST:
            problem(path, line, f"{value} points outside the build")
            continue
        if not os.path.isfile(file):
            problem(path, line, f"{value} points at a missing file")
            continue
        if fragment:
            other = pages.get(file)
            if other is None:
                problem(path, line, f"{value} has a fragment but is not an HTML page")
            elif fragment not in other[0].ids:
                problem(path, line, f'{value}: no id "{fragment}"')

    for scheme, pick in (("light", 1), ("dark", 2)):
        total = 0
        for image in page.images:
            sizes = []
            for url in image[pick]:
                target = local_target(path, url)
                if target and os.path.isfile(target[0]):
                    sizes.append(os.path.getsize(target[0]))
            total += max(sizes, default=0)
        if total > IMAGE_BUDGET:
            problem(path, 1, f"images for the {scheme} scheme weigh {total} bytes, over the budget of {IMAGE_BUDGET}")

for dirpath, _, files in os.walk(DIST):
    for name in sorted(files):
        path = os.path.join(dirpath, name)
        if name.endswith(".css"):
            with open(path, encoding="utf-8") as f:
                css = f.read()
            for n, line in enumerate(css.splitlines(), 1):
                for m in re.finditer(r"url\(\s*['\"]?([^'\")]+)", line):
                    target = local_target(path, m.group(1))
                    if target is None and not m.group(1).startswith("data:"):
                        problem(path, n, f"CSS lint: external URL literal url({m.group(1)})")
                    elif target and not os.path.isfile(target[0]):
                        problem(path, n, f"CSS lint: url({m.group(1)}) points at a missing file")
                if re.search(r"@import", line):
                    problem(path, n, "CSS lint: @import (one stylesheet, no imports)")
                if re.search(r"outline\s*:\s*(none|0)\b", line):
                    problem(path, n, "CSS lint: outline: none")
                if re.search(r"transition\s*:\s*all\b", line):
                    problem(path, n, "CSS lint: transition: all")
        elif name.endswith(".js"):
            with open(path, encoding="utf-8") as f:
                for n, line in enumerate(f, 1):
                    if re.search(r"(?:https?:)?//[a-z0-9.-]+\.[a-z]{2,}", line, re.I):
                        problem(path, n, "JS lint: server URL literal in a script")

not_found = os.path.join(DIST, "404.html")
if not_found not in pages:
    problems.append("404.html is missing (the host serves it for unknown addresses)")
elif "noindex" not in pages[not_found][0].meta.get("robots", "").lower():
    problem(not_found, 1, "the 404 page should say noindex")

search_index = os.path.join(DIST, "docs", "search-index.json")
if os.path.isdir(os.path.join(DIST, "docs")):
    try:
        with open(search_index, encoding="utf-8") as f:
            entries = json.load(f)
    except (OSError, ValueError) as error:
        problems.append(f"docs/search-index.json cannot be read: {error}")
        entries = []
    if not isinstance(entries, list) or not entries:
        problems.append("docs/search-index.json lists no sections")
        entries = []
    for n, entry in enumerate(entries, 1):
        if not isinstance(entry, dict) or not all(isinstance(entry.get(k), str) for k in ("t", "p", "u", "x")):
            problem(search_index, n, "an entry needs the strings t, p, u and x")
            continue
        target = local_target(search_index, entry["u"]) if entry["u"].startswith("/") else None
        if target is None or target[0] not in pages:
            problem(search_index, n, f"{entry['u']} is not a page of this site")
        elif target[1] and target[1] not in pages[target[0]][0].ids:
            problem(search_index, n, f'{entry["u"]}: no id "{target[1]}"')

sitemap = os.path.join(DIST, "sitemap.xml")
robots = os.path.join(DIST, "robots.txt")
if not os.path.isfile(sitemap):
    problems.append("sitemap.xml is missing")
else:
    try:
        root = ElementTree.parse(sitemap).getroot()
    except ElementTree.ParseError as error:
        problem(sitemap, error.position[0], "invalid XML")
    else:
        if root.tag != f"{SITEMAP_NS}urlset":
            problem(sitemap, 1, "needs a sitemap urlset root")
        locs = {(element.text or "").strip() for element in root.findall(f"{SITEMAP_NS}url/{SITEMAP_NS}loc")}
        for loc in sorted(locs - indexed):
            problem(sitemap, 1, f"{loc} is not a page of this site for search engines")
        for loc in sorted(indexed - locs):
            problem(sitemap, 1, f"{loc} is missing")
if not os.path.isfile(robots):
    problems.append("robots.txt is missing")
else:
    with open(robots, encoding="utf-8") as f:
        sitemaps = []
        for line in f:
            name, separator, value = line.partition("#")[0].partition(":")
            if separator and name.strip().lower() == "sitemap":
                sitemaps.append(value.strip())
    if f"{ORIGIN}/sitemap.xml" not in sitemaps:
        problems.append(f"robots.txt does not name {ORIGIN}/sitemap.xml")

if problems:
    print(f"check-site: {len(problems)} problem(s) in {DIST}")
    for p in problems:
        print(f"  {p}")
    sys.exit(1)
print(f"check-site: {len(pages)} page(s) in {os.path.relpath(DIST)} pass")
PY
