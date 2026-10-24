#!/bin/sh
# Runs a command as a client of a headless Weston (a real Wayland compositor without a screen) on a private
# session bus, so the tray and notification tests use the Wayland platform, as on Hyprland.
set -eu
runtime=$(mktemp -d)
chmod 700 "$runtime"
export XDG_RUNTIME_DIR="$runtime"
weston --backend=headless --renderer=pixman --socket=wayland-test --idle-time=0 >"$runtime/weston.log" 2>&1 &
weston=$!
cleanup() {
    kill "$weston" 2>/dev/null || true
    wait "$weston" 2>/dev/null || true
    rm -rf "$runtime"
}
trap cleanup EXIT
tries=0
while [ ! -S "$runtime/wayland-test" ]; do
    tries=$((tries + 1))
    if [ "$tries" -gt 100 ]; then
        echo "weston did not start:" >&2
        cat "$runtime/weston.log" >&2
        exit 1
    fi
    sleep 0.1
done
export WAYLAND_DISPLAY=wayland-test QT_QPA_PLATFORM=wayland
status=0
dbus-run-session -- "$@" || status=$?
exit "$status"
