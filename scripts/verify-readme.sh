#!/usr/bin/env bash
# Runs every command in README.md, in order, against a fresh local Dayhand server with sample data,
# and checks the terminal sample at the top of the README against real output.
#
#   scripts/verify-readme.sh            # everything (the test suites and the macOS build take minutes)
#   scripts/verify-readme.sh --quick    # skip the test suites and the macOS build (reported as skipped)
#
# What it runs:
# - every line of every ```sh block, in one shell, so `cd` and variables carry over like in a terminal;
# - the `$ ` lines of the ```console sample on a second fresh server seeded with the sample tasks below,
#   comparing the output (the "Today, <date>" line is compared by shape only);
# - every inline `dayhand …` mention: `dayhand help …` as written, any other with --help.
#
# Everything happens in a temporary folder with its own HOME, npm prefix and server folders, so it touches
# neither your Dayhand login, your keychain (keys go to a file), your Claude settings nor ~/.claude/skills.
# A few lines cannot run as written here; they are changed like this, and anything not run is listed at
# the end as SKIPPED:
# - `npm i -g dayhand` installs the package packed from this checkout with `npm pack`, as npm would publish it
#   (DAYHAND_VERIFY_FROM_NPM=1 installs the published package);
# - `git clone https://github.com/maiarowsky/dayhand.git` copies this checkout's files instead
#   (DAYHAND_VERIFY_FROM_GITHUB=1 clones the real repository);
# - `dayhand server start` runs in the background with --yes on ports DAYHAND_VERIFY_PORT (default 3410)
#   and the next one, and `127.0.0.1:3211` in any line becomes that HTTP port;
# - `dayhand ui` runs under expect(1), which waits for the screen and presses q;
# - `open …/Dayhand.app` only checks that the app was built (nothing is launched);
# - `claude mcp add …` runs only when the claude CLI is installed; the macOS build only on macOS with swift.
# - `makepkg -si` (the Linux package) is not run, as it installs a system package; linux/ has its own tests.
# Needs: node 22.12+, npm, git, jq, tar; expect for `dayhand ui`.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
README="$ROOT/README.md"
QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1
PORT=${DAYHAND_VERIFY_PORT:-3410}
SITE_PORT=$((PORT + 1))

for tool in node npm git jq tar; do
  command -v "$tool" >/dev/null || { echo "verify-readme: $tool is needed" >&2; exit 2; }
done

WORK=$(mktemp -d "${TMPDIR:-/tmp}/dayhand-readme.XXXXXX")
REAL_HOME=$HOME
SKIPPED="$WORK/skipped"
: >"$SKIPPED"
cleanup() {
  local pidfile
  for pidfile in "$WORK"/server-*.pid; do
    [ -f "$pidfile" ] && kill "$(cat "$pidfile")" 2>/dev/null || true
  done
  sleep 2
  [ -n "${DAYHAND_VERIFY_KEEP:-}" ] && echo "Kept $WORK" || rm -rf "$WORK"
}
trap cleanup EXIT

# A clean environment: nothing of your own Dayhand, Claude or npm setup leaks in or gets changed.
unset DAYHAND_URL DAYHAND_API_KEY DAYHAND_PROFILE DAYHAND_CONFIG_DIR DAYHAND_SERVER_CONFIG_DIR \
  DAYHAND_CACHE_DIR DAYHAND_BACKEND_DIR DAYHAND_FORMAT HLM_URL HLM_API_KEY HELM_URL HELM_API_KEY \
  HELM_BACKEND_DIR HELM_SERVER_CONFIG_DIR CLAUDE_CONFIG_DIR
export DAYHAND_CREDENTIAL_STORE=file NO_COLOR=1
export npm_config_cache=${npm_config_cache:-$REAL_HOME/.npm}
export npm_config_prefix="$WORK/npm-global"
export PATH="$npm_config_prefix/bin:$PATH"

# ```sh lines (comments after the command dropped), ```console lines, inline `dayhand …` spans.
blocks() { awk -v kind="$1" '/^```/ { inside = ($0 == "```" kind) ? !inside : 0; next } inside' "$README"; }
sh_lines() { blocks sh | sed -e 's/[[:space:]]#.*$//' -e 's/[[:space:]]*$//' | grep -v -e '^$' -e '^#'; }
inline_mentions() { awk '/^```/ { inside = !inside; next } !inside' "$README" | grep -o '`dayhand [^`]*`' | tr -d '`' | sort -u; }

# The generated script: helpers first, then one step per README line.
PRELUDE="$WORK/prelude.sh"
cat >"$PRELUDE" <<'EOF'
step() { printf '\n\033[1m$ %s\033[0m\n' "$1"; }
skip() { printf 'SKIPPED: %s (%s)\n' "$1" "$2" | tee -a "$SKIPPED"; }
copy_checkout() {
  if [ -n "${DAYHAND_VERIFY_FROM_GITHUB:-}" ]; then git clone https://github.com/maiarowsky/dayhand.git "$1"; return; fi
  mkdir -p "$1"
  git -C "$ROOT" ls-files -z -co --exclude-standard | tar -C "$ROOT" --null -T - -cf - | tar -C "$1" -xf -
}
install_package() { # `npm i -g dayhand`, into this run's own npm prefix
  if [ -n "${DAYHAND_VERIFY_FROM_NPM:-}" ]; then npm install -g dayhand; return; fi
  copy_checkout "$WORK/package"
  (cd "$WORK/package/cli" && npm ci --ignore-scripts --no-audit --no-fund >/dev/null && npm pack --silent --pack-destination "$WORK" >/dev/null)
  npm install -g "$WORK"/dayhand-*.tgz
}
start_server() { # name, port, site port: runs `dayhand server start` until the script ends
  local log="$WORK/server-$1.log"
  dayhand server start --port "$2" --site-port "$3" --yes >"$log" 2>&1 &
  echo $! >"$WORK/server-$1.pid"
  for _ in $(seq 1 180); do
    grep -q 'Stop with Ctrl+C' "$log" && { grep -m1 'Dayhand is ready' "$log"; return 0; }
    kill -0 "$(cat "$WORK/server-$1.pid")" 2>/dev/null || break
    sleep 1
  done
  echo "dayhand server start did not get ready:" >&2; tail -30 "$log" >&2; return 1
}
stop_server() { kill "$(cat "$WORK/server-$1.pid")"; rm -f "$WORK/server-$1.pid"; sleep 2; }
run_ui() {
  command -v expect >/dev/null || { skip "dayhand ui" "expect is not installed"; return 0; }
  expect -c '
    set timeout 30
    spawn dayhand ui
    expect { -ex "? help" {} timeout { puts "\ndayhand ui: no screen"; exit 1 } }
    send "q"
    expect { eof {} timeout { puts "\ndayhand ui: did not quit"; exit 1 } }
    lassign [wait] pid id oserr code
    exit $code' >"$WORK/ui.log" 2>&1 || { tail -c 2000 "$WORK/ui.log" >&2; return 1; }
  echo "(the full screen app opened and quit with q)"
}
EOF

SCRIPT="$WORK/readme.sh"
{
  echo "set -euo pipefail"
  echo "ROOT='$ROOT' WORK='$WORK' SKIPPED='$SKIPPED' QUICK=$QUICK"
  echo ". '$PRELUDE'"
  echo "mkdir -p '$WORK/home' && export HOME='$WORK/home' && cd '$WORK'"
  while IFS= read -r line; do
    run=${line//127.0.0.1:3211/127.0.0.1:$SITE_PORT}
    case "$line" in
      "npm i -g dayhand") run="install_package" ;;
      "git clone https://github.com/maiarowsky/dayhand.git") run="copy_checkout dayhand" ;;
      "dayhand server start") run="start_server readme $PORT $SITE_PORT" ;;
      "dayhand ui") run="run_ui" ;;
      "open "*Dayhand.app)
        run="if [ -x ${line#open }/Contents/MacOS/Dayhand ]; then echo '(built; not launched)'; else skip 'open the app' 'it was not built'; fi" ;;
      "claude mcp add "*)
        run="if command -v claude >/dev/null; then $run; else skip 'claude mcp add' 'the claude CLI is not installed'; fi" ;;
      *build-app.sh*)
        run="if [ \$QUICK = 1 ] || [ \"\$(uname)\" != Darwin ] || ! command -v swift >/dev/null; then skip 'macOS build' 'quick run, or no macOS with swift'; else $run; fi" ;;
      *"npm test"*) run="if [ \$QUICK = 1 ]; then skip $(printf %q "$line") 'quick run'; else $run; fi" ;;
      *"makepkg -si"*) run="skip 'Linux package' 'makepkg -si installs a system package (linux/ is tested by its own ctest)'" ;;
    esac
    printf 'step %q\n%s\n' "$line" "$run"
  done < <(sh_lines)
  echo "stop_server readme"
} >"$SCRIPT"

echo "== README commands (in $WORK)"
bash "$SCRIPT"
REPO="$WORK/dayhand"

echo
echo "== Inline mentions"
while IFS= read -r mention; do
  read -r -a words <<<"$mention"
  [ "${words[1]}" = help ] || words+=(--help)
  HOME="$WORK/home" "${words[@]}" >/dev/null
  echo "ok  $mention"
done < <(inline_mentions)

echo
echo "== Terminal sample, on a fresh server with sample tasks"
# Not `( … ) || …`: that would turn off set -e inside the subshell.
set +e
(
  set -euo pipefail
  . "$PRELUDE"
  mkdir -p "$WORK/home-sample" && export HOME="$WORK/home-sample" && cd "$REPO"
  start_server sample $((PORT + 2)) $((PORT + 3)) >/dev/null
  dayhand add "Send the invoice to Anna" --due yesterday -l work >/dev/null
  dayhand add "Call the accountant" --due "today 14:00" -l admin >/dev/null
  AGENT_KEY=$(dayhand key create claude --scope write --json | jq -r .key)
  export AGENT_KEY
  expected="$WORK/sample.expected" actual="$WORK/sample.actual"
  blocks console >"$expected"
  : >"$actual"
  while IFS= read -r line; do
    case "$line" in
      '$ '*) echo "$line" >>"$actual"; bash -c "${line#\$ }" >>"$actual" ;;
    esac
  done <"$expected"
  normalize() { sed -E 's/^Today, .*\((.*)\)$/Today, <date> (<zone>)/' "$1"; }
  diff -u <(normalize "$expected") <(normalize "$actual")
  echo "The sample matches."
  stop_server sample
)
status=$?
set -e
[ $status = 0 ] || { echo "The terminal sample does not match real output (see above)." >&2; exit 1; }

echo
if [ -s "$SKIPPED" ]; then
  echo "== Done, with these not run:"
  cat "$SKIPPED"
else
  echo "== Done: every README command ran."
fi
