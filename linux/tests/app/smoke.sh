#!/bin/sh
# The real dayhand-qt on Wayland: it starts in the tray, a second copy hands `--quick-add` and `--background` over
# and exits at once, and the QML loads without warnings. Usage: smoke.sh <path to dayhand-qt>
set -eu
app=$1
data=$(mktemp -d)
log="$data/dayhand-qt.log"
export DAYHAND_DATA_DIR="$data" DAYHAND_CREDENTIALS=memory QT_QUICK_BACKEND=software
"$app" --background >"$log" 2>&1 &
running=$!
cleanup() {
    kill "$running" 2>/dev/null || true
    wait "$running" 2>/dev/null || true
    rm -rf "$data"
}
trap cleanup EXIT
socket="$XDG_RUNTIME_DIR/dayhand-qt-$(id -u).socket"
tries=0
while [ ! -S "$socket" ]; do
    tries=$((tries + 1))
    if [ "$tries" -gt 150 ]; then
        echo "dayhand-qt did not start:" >&2
        cat "$log" >&2
        exit 1
    fi
    sleep 0.1
done
timeout 5 "$app" --quick-add
timeout 5 "$app" --background
timeout 5 "$app" 'dayhand://pair?url=https%3A%2F%2Fexample.convex.site&code=ABCD-EFGH-JKMN'
sleep 1
kill -0 "$running"
test -f "$data/dayhand.sqlite"
if grep -E "qrc:|QML|Error|error" "$log" >&2; then
    echo "dayhand-qt printed the warnings above" >&2
    exit 1
fi
"$app" --version
