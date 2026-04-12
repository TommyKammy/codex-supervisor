#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TMUX_SESSION_NAME="${TMUX_SESSION_NAME:-codex-supervisor-loop}"
CONFIG_PATH="${CODEX_SUPERVISOR_CONFIG:-${ROOT}/supervisor.config.json}"
CODEX_SUPERVISOR_LAUNCHER="${CODEX_SUPERVISOR_LAUNCHER:-tmux}"
CODEX_SUPERVISOR_TMUX_SESSION="${CODEX_SUPERVISOR_TMUX_SESSION:-${TMUX_SESSION_NAME}}"
TMUX_BIN="${TMUX_BIN:-$(command -v tmux || true)}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
NPM_BIN="${NPM_BIN:-$(command -v npm || true)}"
PATH_VALUE="${PATH}"

shell_quote() {
  printf '%q' "$1"
}

if [[ -z "${TMUX_BIN}" ]]; then
  echo "tmux must be available on PATH" >&2
  exit 1
fi

if "${TMUX_BIN}" has-session -t "${TMUX_SESSION_NAME}" >/dev/null 2>&1; then
  echo "codex-supervisor loop tmux session already running: ${TMUX_SESSION_NAME}"
  exit 0
fi

if [[ -z "${NODE_BIN}" || -z "${NPM_BIN}" ]]; then
  echo "node and npm must be available on PATH" >&2
  exit 1
fi

SESSION_COMMAND="$(
  printf 'cd %s && env PATH=%s NODE_BIN=%s NPM_BIN=%s CODEX_SUPERVISOR_CONFIG=%s CODEX_SUPERVISOR_LAUNCHER=%s CODEX_SUPERVISOR_TMUX_SESSION=%s /bin/bash %s' \
    "$(shell_quote "${ROOT}")" \
    "$(shell_quote "${PATH_VALUE}")" \
    "$(shell_quote "${NODE_BIN}")" \
    "$(shell_quote "${NPM_BIN}")" \
    "$(shell_quote "${CONFIG_PATH}")" \
    "$(shell_quote "${CODEX_SUPERVISOR_LAUNCHER}")" \
    "$(shell_quote "${CODEX_SUPERVISOR_TMUX_SESSION}")" \
    "$(shell_quote "${ROOT}/scripts/run-loop.sh")"
)"

"${TMUX_BIN}" new-session -d -s "${TMUX_SESSION_NAME}" "${SESSION_COMMAND}"
echo "Started codex-supervisor loop tmux session: ${TMUX_SESSION_NAME}"
