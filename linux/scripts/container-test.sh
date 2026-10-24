#!/bin/sh
# Builds Dayhand for Linux and runs its tests in an Arch Linux container, for a machine that is not Arch (a Mac).
# Extra arguments go to ctest, e.g. `scripts/container-test.sh -R tst_dates`.
#
#   DAYHAND_CONTAINER_BUILD   build folder on the host (default: linux/build-container, ignored by git)
#   DAYHAND_CONTAINER_IMAGE   image to use or build from scripts/arch.Dockerfile (default: dayhand-linux-qt-build:local)
#   DAYHAND_CONTAINER_CPUS    CPUs the container may use (default: 4)
#   DAYHAND_CMAKE_ARGS        extra CMake arguments, e.g. -DDAYHAND_BUILD_APP=OFF
#   DAYHAND_SNAPSHOT_DIR      host folder for the window pictures tst_app saves (default: none are saved)
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
build=${DAYHAND_CONTAINER_BUILD:-$here/build-container}
image=${DAYHAND_CONTAINER_IMAGE:-dayhand-linux-qt-build:local}
cpus=${DAYHAND_CONTAINER_CPUS:-4}
mkdir -p "$build"
snapshots=
if [ -n "${DAYHAND_SNAPSHOT_DIR:-}" ]; then
    mkdir -p "$DAYHAND_SNAPSHOT_DIR"
    snapshots="-v $DAYHAND_SNAPSHOT_DIR:/snapshots -e DAYHAND_SNAPSHOT_DIR=/snapshots"
fi
if ! docker image inspect "$image" >/dev/null 2>&1; then
    docker build --platform linux/amd64 -t "$image" -f "$here/scripts/arch.Dockerfile" "$here/scripts"
fi
exec docker run --rm --platform linux/amd64 --cpus "$cpus" --memory 6g \
    -v "$here:/src:ro" -v "$build:/build" $snapshots -e QT_QPA_PLATFORM=offscreen -e "CMAKE_ARGS=${DAYHAND_CMAKE_ARGS:-}" \
    "$image" sh -c '
        set -e
        nice -n 15 cmake -S /src -B /build -G Ninja -DCMAKE_BUILD_TYPE=Debug $CMAKE_ARGS
        nice -n 15 cmake --build /build -j 4
        cd /build && nice -n 15 ctest --output-on-failure "$@"
    ' sh "$@"
