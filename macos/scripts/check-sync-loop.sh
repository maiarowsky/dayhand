#!/bin/sh
# Runs the release app signed in to a server that never answers, so the sync loop waits out its adaptive poll again
# and again, and fails if the app ends before the time is up or the loop did not turn. Release builds once aborted
# at the end of that wait (`swift_task_dealloc`, "freed pointer was not the last allocation", macOS 0.2.1), which
# neither `swift test` nor a debug build shows.
#
#   scripts/check-sync-loop.sh                # builds dist/Dayhand.app first, then runs it for 950 seconds
#   DAYHAND_APP=<path>/Dayhand.app DAYHAND_CHECK_SECONDS=1250 scripts/check-sync-loop.sh
#
# The app's window opens while it runs. Your app and data stay untouched: a temporary copy uses a separate bundle id
# for notifications and preferences, whose defaults domain is deleted on cleanup. The database is a temporary folder,
# and a small library loaded only into this process answers the Keychain for Dayhand's own item with a made-up sign-in
# to a local port that accepts and closes every connection (other Keychain items go to the Keychain as usual; nothing is saved).
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SECONDS_TO_RUN=${DAYHAND_CHECK_SECONDS:-950}
# Allow for a hidden/background window; active failures retry at 60 seconds.
POLL_SECONDS=300
CHECK_BUNDLE_ID=io.github.maiarowsky.dayhand.check-sync-loop
APP=${DAYHAND_APP:-}
if [ -z "$APP" ]; then
  DAYHAND_CONFIGURATION=release "$ROOT/scripts/build-app.sh"
  APP="$ROOT/dist/Dayhand.app"
fi

WORK=$(mktemp -d)
APP_PID=""
SERVER_PID=""
cleanup() {
  if [ -n "$APP_PID" ]; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  [ -z "$SERVER_PID" ] || kill "$SERVER_PID" 2>/dev/null || true
  defaults delete "$CHECK_BUNDLE_ID" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

ditto "$APP" "$WORK/Dayhand.app"
APP="$WORK/Dayhand.app"
plutil -replace CFBundleIdentifier -string "$CHECK_BUNDLE_ID" "$APP/Contents/Info.plist"

cat > "$WORK/keychain.c" <<'EOF'
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <stdlib.h>
#include <string.h>

static int isDayhand(CFDictionaryRef query) {
    CFTypeRef service = query ? CFDictionaryGetValue(query, kSecAttrService) : NULL;
    return service && CFGetTypeID(service) == CFStringGetTypeID()
        && CFStringCompare((CFStringRef)service, CFSTR("io.github.maiarowsky.dayhand"), 0) == kCFCompareEqualTo;
}
static OSStatus copyMatching(CFDictionaryRef query, CFTypeRef *result) {
    if (!isDayhand(query)) return SecItemCopyMatching(query, result);
    const char *json = getenv("DAYHAND_CHECK_CREDENTIAL");
    if (result) *result = CFDataCreate(NULL, (const UInt8 *)json, (CFIndex)strlen(json));
    return errSecSuccess;
}
static OSStatus update(CFDictionaryRef query, CFDictionaryRef attributes) {
    return isDayhand(query) ? errSecSuccess : SecItemUpdate(query, attributes);
}
static OSStatus add(CFDictionaryRef attributes, CFTypeRef *result) {
    return isDayhand(attributes) ? errSecSuccess : SecItemAdd(attributes, result);
}
static OSStatus delete(CFDictionaryRef query) {
    return isDayhand(query) ? errSecSuccess : SecItemDelete(query);
}
__attribute__((used)) static const struct { const void *with; const void *instead; } interposed[]
    __attribute__((section("__DATA,__interpose"))) = {
    { (const void *)copyMatching, (const void *)SecItemCopyMatching },
    { (const void *)update, (const void *)SecItemUpdate },
    { (const void *)add, (const void *)SecItemAdd },
    { (const void *)delete, (const void *)SecItemDelete },
};
EOF
clang -dynamiclib -framework Security -framework CoreFoundation "$WORK/keychain.c" -o "$WORK/keychain.dylib"

# The server that never answers: it takes each connection, notes it and closes it.
python3 -I -c '
import socket, sys
server = socket.socket()
server.bind(("127.0.0.1", 0))
server.listen(16)
print(server.getsockname()[1], flush=True)
while True:
    connection, _ = server.accept()
    connection.close()
    print("connection", flush=True)
' > "$WORK/server.log" &
SERVER_PID=$!
PORT=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  PORT=$(head -n 1 "$WORK/server.log")
  [ -z "$PORT" ] || break
  sleep 1
done
[ -n "$PORT" ] || { echo "The local server did not start." >&2; exit 1; }

mkdir "$WORK/data"
URL="http://127.0.0.1:$PORT"
DAYHAND_DATA_DIR="$WORK/data" \
DYLD_INSERT_LIBRARIES="$WORK/keychain.dylib" \
DAYHAND_CHECK_CREDENTIAL="{\"serverUrl\":\"$URL\",\"convexUrl\":\"$URL\",\"deviceId\":\"check\",\"deviceName\":\"check\",\"deviceToken\":\"check\"}" \
  "$APP/Contents/MacOS/Dayhand" > "$WORK/app.log" 2>&1 &
APP_PID=$!

elapsed=0
while [ "$elapsed" -lt "$SECONDS_TO_RUN" ] && kill -0 "$APP_PID" 2>/dev/null; do
  sleep 1
  elapsed=$((elapsed + 1))
done
if ! kill -0 "$APP_PID" 2>/dev/null; then
  status=0
  wait "$APP_PID" || status=$?
  APP_PID=""
  echo "FAIL: Dayhand ended after ${elapsed} s with status $status while the sync loop was waiting:" >&2
  cat "$WORK/app.log" >&2
  exit 1
fi

# A round reaches the server at the start and after every poll: one connection per poll at least, three at most needed.
rounds=$(grep -c connection "$WORK/server.log" || true)
wanted=$((SECONDS_TO_RUN / POLL_SECONDS))
[ "$wanted" -le 3 ] || wanted=3
if [ "$rounds" -lt "$wanted" ]; then
  echo "FAIL: Dayhand ran for ${SECONDS_TO_RUN} s but reached the server only $rounds times; the sync loop did not turn." >&2
  exit 1
fi
echo "OK: Dayhand ran for ${SECONDS_TO_RUN} s with the sync loop polling a server that does not answer ($rounds connections)."
