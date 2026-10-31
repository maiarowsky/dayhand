#!/bin/sh
# Herdr may launch plugins with only the system PATH, without shell startup files.
# Keep that PATH first, then try fnm (default version first), user-local and Homebrew bins.
for bin in \
  "${FNM_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/fnm}/aliases/default/bin" \
  "$HOME/Library/Application Support/fnm/aliases/default/bin" \
  "${FNM_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/fnm}"/node-versions/*/installation/bin \
  "$HOME/Library/Application Support/fnm"/node-versions/*/installation/bin \
  "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin
do
  if [ -d "$bin" ]; then
    PATH="$PATH:$bin"
  fi
done
export PATH

exec node "$(dirname "$0")/dayhand-herdr.mjs" "$@"
