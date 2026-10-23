#!/bin/sh
# Builds Dayhand.app into macos/dist/ from the Swift package: a release build of the Dayhand product, the
# Info.plist from Bundle/, and the resource bundles SwiftPM made. Local use only: the app is not signed with a
# Developer ID, not notarized and not packed into a DMG (see docs/macos.md for what distribution still needs).
#
#   scripts/build-app.sh            # release build into dist/Dayhand.app
#   DAYHAND_CONFIGURATION=debug scripts/build-app.sh
#
# Builds run under `nice` and one at a time on this machine (the shared lock of the iOS and macOS builds).
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CONFIGURATION=${DAYHAND_CONFIGURATION:-release}
VERSION=${DAYHAND_VERSION:-0.1.0}
BUILD_NUMBER=${DAYHAND_BUILD:-$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 1)}
LOCK=${DAYHAND_BUILD_LOCK:-/private/tmp/mussh-ios-build.lock}
APP="$ROOT/dist/Dayhand.app"

cd "$ROOT"
nice -n 15 lockf "$LOCK" swift build -c "$CONFIGURATION" --product Dayhand
BIN_DIR=$(swift build -c "$CONFIGURATION" --show-bin-path)

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/Dayhand" "$APP/Contents/MacOS/Dayhand"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD_NUMBER/" Bundle/Info.plist > "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# SwiftPM's generated accessor looks for a package's resources next to the app (Bundle.main.bundleURL), so the
# bundles go there. A signed build needs them in Contents/Resources instead, which is part of the signing work.
for bundle in "$BIN_DIR"/*.bundle; do
  [ -e "$bundle" ] || continue
  cp -R "$bundle" "$APP/"
done

plutil -lint "$APP/Contents/Info.plist" >/dev/null
echo "Built $APP ($VERSION, build $BUILD_NUMBER, $CONFIGURATION)"
echo "Run: open \"$APP\""
