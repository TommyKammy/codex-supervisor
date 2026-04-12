#!/usr/bin/env bash
set -euo pipefail

TMUX_SESSION_NAME="${TMUX_SESSION_NAME:-codex-supervisor-loop}"
TMUX_BIN="${TMUX_BIN:-$(command -v tmux || true)}"

if [[ -z "${TMUX_BIN}" ]]; then
  echo "tmux must be available on PATH" >&2
  exit 1
fi

if ! "${TMUX_BIN}" has-session -t "${TMUX_SESSION_NAME}" >/dev/null 2>&1; then
  echo "codex-supervisor loop tmux session is not running: ${TMUX_SESSION_NAME}"
  exit 0
fi

"${TMUX_BIN}" kill-session -t "${TMUX_SESSION_NAME}"
echo "Stopped codex-supervisor loop tmux session: ${TMUX_SESSION_NAME}"
