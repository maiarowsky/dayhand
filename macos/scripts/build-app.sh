#!/bin/sh
# Builds Dayhand.app into macos/dist/ from the Swift package: a release build of the Dayhand product, the
# Info.plist from Bundle/, Sparkle.framework, and the resource bundles SwiftPM made. Local use only: the app is not
# signed with a Developer ID, not notarized and not packed into a DMG (see docs/macos.md for what distribution
# still needs).
#
#   scripts/build-app.sh            # release build into dist/Dayhand.app
#   DAYHAND_CONFIGURATION=debug scripts/build-app.sh
#
# Updates (docs/macos.md#updates): the app checks DAYHAND_APPCAST_URL (by default the appcast of the project's
# GitHub Releases) only when DAYHAND_SPARKLE_PUBLIC_KEY holds the public EdDSA key of the release key pair. Without
# it, which is the default, the app never checks and Settings says updates are not available in this build.
#
# Builds run under `nice` and one at a time on this machine (the shared lock of the iOS and macOS builds).
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CONFIGURATION=${DAYHAND_CONFIGURATION:-release}
VERSION=${DAYHAND_VERSION:-0.2.0}
BUILD_NUMBER=${DAYHAND_BUILD:-$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 1)}
LOCK=${DAYHAND_BUILD_LOCK:-/private/tmp/mussh-ios-build.lock}
APPCAST_URL=${DAYHAND_APPCAST_URL:-https://github.com/maiarowsky/helm/releases/download/dayhand-macos-appcast/appcast.xml}
SPARKLE_PUBLIC_KEY=${DAYHAND_SPARKLE_PUBLIC_KEY:-}
APP="$ROOT/dist/Dayhand.app"

if [ -n "$SPARKLE_PUBLIC_KEY" ] && [ "$(printf '%s' "$SPARKLE_PUBLIC_KEY" | base64 -D 2>/dev/null | wc -c | tr -d ' ')" != 32 ]; then
  echo "DAYHAND_SPARKLE_PUBLIC_KEY is not a public EdDSA key (32 bytes in base64, as generate_keys prints it)." >&2
  exit 1
fi

cd "$ROOT"
nice -n 15 lockf "$LOCK" swift build -c "$CONFIGURATION" --product Dayhand
BIN_DIR=$(swift build -c "$CONFIGURATION" --show-bin-path)

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APP/Contents/Frameworks"
cp "$BIN_DIR/Dayhand" "$APP/Contents/MacOS/Dayhand"
# The binary finds it through its rpath @executable_path/../Frameworks (Package.swift).
ditto "$BIN_DIR/Sparkle.framework" "$APP/Contents/Frameworks/Sparkle.framework"
PLIST="$APP/Contents/Info.plist"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD_NUMBER/" Bundle/Info.plist > "$PLIST"
plutil -replace SUFeedURL -string "$APPCAST_URL" "$PLIST"
if [ -n "$SPARKLE_PUBLIC_KEY" ]; then
  plutil -replace SUPublicEDKey -string "$SPARKLE_PUBLIC_KEY" "$PLIST"
else
  plutil -remove SUPublicEDKey "$PLIST"
fi
printf 'APPL????' > "$APP/Contents/PkgInfo"

# SwiftPM's generated accessor looks for a package's resources next to the app (Bundle.main.bundleURL), so the
# bundles go there. A signed build needs them in Contents/Resources instead, which is part of the signing work.
for bundle in "$BIN_DIR"/*.bundle; do
  [ -e "$bundle" ] || continue
  cp -R "$bundle" "$APP/"
done

plutil -lint "$APP/Contents/Info.plist" >/dev/null
echo "Built $APP ($VERSION, build $BUILD_NUMBER, $CONFIGURATION, updates $([ -n "$SPARKLE_PUBLIC_KEY" ] && echo "from $APPCAST_URL" || echo off))"
echo "Run: open \"$APP\""
