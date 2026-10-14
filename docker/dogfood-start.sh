#!/usr/bin/env bash
# The dogfood container's start command. On every start it:
#   1. installs syn's working rules and agents into the config volume, only
#      where they're missing, so your later edits are never overwritten;
#   2. links the shared brain (~/.syns) into the config dir, like on the host;
#   3. starts Claude with syns' plugins (every plugin folder in the mounted
#      checkout, watched for edits), resuming
#      the most recent conversation when there is one.
# Given a command (e.g. `claude --version`, `bash`), it runs that instead.
set -euo pipefail

if [ "$#" -gt 0 ] && [ "${1#-}" = "$1" ]; then
  exec "$@"
fi

cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
syns_home="${SYNS_HOME:?pass -e SYNS_HOME=\"\$HOME/.syns\" (see the README)}"
syns_dir="${SYNS_DIR:?pass -e SYNS_DIR=\"\$HOME/Code/satoramoto/syns\" (see the README)}"

mkdir -p "$cfg/agents"
[ -e "$cfg/CLAUDE.md" ] || cp /opt/syns/templates/CLAUDE.md "$cfg/CLAUDE.md"
for agent in /opt/syns/templates/agents/*.md; do
  [ -e "$cfg/agents/${agent##*/}" ] || cp "$agent" "$cfg/agents/"
done

for name in brain.json LEXICON.md; do
  [ -e "$cfg/$name" ] || [ -L "$cfg/$name" ] || ln -s "$syns_home/$name" "$cfg/$name"
done
mkdir -p "$syns_home/scratch" "$syns_home/files"

# Every plugin folder one level down in the checkout (plugin/, syns-dashboard/,
# ...) loads, live from the mount; CLAUDE_CODE_PLUGIN_DIR_WATCH reloads edits.
export CLAUDE_CODE_PLUGIN_DIRS="$syns_dir"
args=()

# Claude keeps each working directory's conversations under projects/<dir
# with / and . as ->; resume only when this directory has one.
project="$cfg/projects/${PWD//[\/.]/-}"
if [ -n "$(find "$project" -maxdepth 1 -name '*.jsonl' -print -quit 2>/dev/null)" ]; then
  args+=(--continue)
fi

exec claude ${args[@]+"${args[@]}"} "$@"
