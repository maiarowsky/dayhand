#!/usr/bin/env bash
# Renders the raster images of the dayhand.dev page (site/) from their SVG sources with headless Chrome:
#   site/og-image.svg            -> site/public/og-image.png (1200 x 630, the social preview)
#   design/icon/dayhand-icon.svg -> site/public/apple-touch-icon.png (180 x 180)
# Run it after changing either SVG and commit the PNGs. CHROME overrides the browser path.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CHROME=${CHROME:-}
if [ -z "$CHROME" ]; then
  for candidate in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1 || [ -x "$candidate" ]; then CHROME=$candidate; break; fi
  done
fi
[ -n "$CHROME" ] || { echo "render-site-images: Chrome or Chromium is needed (set CHROME)" >&2; exit 2; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/dayhand-site-images.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

# render <svg> <width> <height> <png>: draws the SVG at exactly that size, with no page margin.
render() {
  local svg=$1 width=$2 height=$3 png=$4
  cat >"$WORK/page.html" <<EOF
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;overflow:hidden}img{display:block;width:${width}px;height:${height}px}</style>
<img src="file://$svg" alt="">
EOF
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --user-data-dir="$WORK/profile" --window-size="$width,$height" \
    --screenshot="$png" "file://$WORK/page.html" >/dev/null 2>&1
  [ -s "$png" ] || { echo "render-site-images: Chrome wrote no $png" >&2; exit 1; }
  echo "wrote ${png#"$ROOT"/}"
}

render "$ROOT/site/og-image.svg" 1200 630 "$ROOT/site/public/og-image.png"
render "$ROOT/design/icon/dayhand-icon.svg" 180 180 "$ROOT/site/public/apple-touch-icon.png"
