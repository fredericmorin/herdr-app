#!/bin/sh
# Claude Code with the config dir projects.json gives this folder's repo (board.claudeConfig, via
# ./config-dir.mjs) as CLAUDE_CONFIG_DIR; without one the environment is left as it is.
# Every Claude session Herdr starts on this computer goes through here: claude-new (Board Start,
# Cmd+Shift+N, New worktree), claude-fork, and programs.json's claude entry (the + menu, git-graph).
# An invalid projects.json stops here with its error rather than start Claude with the wrong config.
dir=$(node "$(dirname "$0")/config-dir.mjs" "$PWD") || exit 1
if [ -n "$dir" ]; then export CLAUDE_CONFIG_DIR="$dir"; fi
exec claude "$@"
