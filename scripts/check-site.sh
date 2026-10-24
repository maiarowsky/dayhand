#!/usr/bin/env bash
# Checks the dayhand.dev page (site/) before it is published:
# - HTML: doctype, lang, charset, a viewport that allows zoom, one <title>, one <h1>, every element closed
#   in order, unique ids, alt text and a size on every <img>, no inline scripts or on* handlers;
# - links: every #fragment, relative path and https://dayhand.dev/ address (canonical, og:image, sitemap)
#   points at a file and an id that exist;
# - resource references: HTML attributes must be local (plain <a href> links may be external);
# - static CSS/JS lint: CSS url() paths, no @import, outline: none or transition: all, and no
#   server URL literals in scripts. These pattern scans do not observe browser network behaviour.
#
#   scripts/check-site.sh            # always checks this checkout's site/
#
# Needs python3 (standard library only). Exit code 0 when everything passes, 1 with a list of problems.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SITE="$ROOT/site"
[ -d "$SITE" ] || { echo "check-site: no folder $SITE" >&2; exit 2; }
command -v python3 >/dev/null || { echo "check-site: python3 is needed" >&2; exit 2; }

exec python3 -I - "$SITE" <<'PY'
import os, re, sys
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
from xml.etree import ElementTree

SITE = os.path.abspath(sys.argv[1])
ORIGIN = "https://dayhand.dev"
SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
EXTERNAL = re.compile(r"^(?:[a-z][a-z0-9+.-]*:)?//", re.I)
problems = []

def problem(path, line, message):
    problems.append(f"{os.path.relpath(path, SITE)}:{line}: {message}")

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
            if a.get("name") == "viewport":
                self.viewport = a.get("content") or ""
        if "id" in a:
            if a["id"] in self.ids:
                problem(self.path, line, f'id "{a["id"]}" is used twice (first on line {self.ids[a["id"]]})')
            self.ids[a["id"]] = line
        for name, value in attrs:
            if name.startswith("on"):
                problem(self.path, line, f"inline event handler {name}= (put scripts in a .js file)")
        if tag == "script" and "src" not in a:
            problem(self.path, line, "inline <script> (put scripts in a .js file)")
        if tag == "img":
            if "alt" not in a:
                problem(self.path, line, "<img> without alt")
            if "width" not in a or "height" not in a:
                problem(self.path, line, "<img> without width and height")
        for name in ("href", "src"):
            if name in a:
                self.refs.append((line, name, a[name] or "", tag, a))
        if "srcset" in a:
            for part in (a["srcset"] or "").split(","):
                if part.strip():
                    self.refs.append((line, "srcset", part.split()[0], tag, a))
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
        target = os.path.join(SITE, path.lstrip("/"))
    elif path:
        target = os.path.join(os.path.dirname(page_path), path)
    else:
        target = page_path
    if os.path.isdir(target):
        target = os.path.join(target, "index.html")
    return os.path.normpath(target), parts.fragment

pages = {}
for dirpath, _, files in os.walk(SITE):
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
        file, fragment = target
        if not file.startswith(SITE + os.sep) and file != SITE:
            problem(path, line, f"{value} points outside the site folder")
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

    if os.path.basename(path) == "index.html" and os.path.dirname(path) == SITE:
        canonicals = [
            value for _, _, value, tag, attrs in page.refs
            if tag == "link" and "canonical" in (attrs.get("rel") or "").lower().split()
        ]
        if canonicals != [f"{ORIGIN}/"]:
            problem(path, 1, f"needs exactly one canonical link to {ORIGIN}/")
        if not any(tag == "meta" and attrs.get("property") == "og:image"
                   for _, _, _, tag, attrs in page.refs):
            problem(path, 1, "no og:image")

for dirpath, _, files in os.walk(SITE):
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

sitemap = os.path.join(SITE, "sitemap.xml")
robots = os.path.join(SITE, "robots.txt")
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
        locs = root.findall(f"{SITEMAP_NS}url/{SITEMAP_NS}loc")
        if not locs:
            problem(sitemap, 1, "lists no page locations")
        for element in locs:
            loc = (element.text or "").strip()
            target = local_target(sitemap, loc) if loc.startswith(ORIGIN + "/") else None
            if target is None or target[0] not in pages:
                problem(sitemap, 1, f"{loc} is not a page of this site")
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
    print(f"check-site: {len(problems)} problem(s) in {SITE}")
    for p in problems:
        print(f"  {p}")
    sys.exit(1)
print(f"check-site: {len(pages)} page(s) in {os.path.relpath(SITE)} pass")
PY
