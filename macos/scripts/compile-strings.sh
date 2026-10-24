#!/bin/sh
# Compiles the string catalog (Sources/DayhandLocalization/Localizable.xcstrings) into the .lproj folders the package
# ships (Sources/DayhandLocalization/Resources). SwiftPM copies a catalog into the bundle without compiling it, so the
# compiled files are kept in the repository; run this after every change to the catalog. `swift test` fails while
# they are out of date (LocalizationTests).
#
#   scripts/compile-strings.sh
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CATALOG="$ROOT/Sources/DayhandLocalization/Localizable.xcstrings"
OUT="$ROOT/Sources/DayhandLocalization/Resources"

rm -rf "$OUT"
mkdir -p "$OUT"
xcrun xcstringstool compile "$CATALOG" --output-directory "$OUT"
echo "Compiled $(find "$OUT" -name '*.lproj' | wc -l | tr -d ' ') languages into $OUT"
