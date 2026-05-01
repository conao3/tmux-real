#!/usr/bin/env bash

set -eu

set_default() {
  local name="$1"
  local value="$2"

  if [ -z "$(tmux show-option -gqv "$name")" ]; then
    tmux set-option -gq "$name" "$value"
  fi
}

set_default "@tmux-real-interval-minutes" "60"
set_default "@tmux-real-jitter-minutes" "15"
set_default "@tmux-real-grace-seconds" "120"
set_default "@tmux-real-gh-path" "gh"
set_default "@tmux-real-redact-patterns" ""
set_default "@tmux-real-exclude-sessions" ""
set_default "@tmux-real-exclude-windows" ""
set_default "@tmux-real-exclude-panes" ""

