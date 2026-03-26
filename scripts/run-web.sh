#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${ROOT}/.local/logs"
CONFIG_PATH="${CODEX_SUPERVISOR_CONFIG:-${ROOT}/supervisor.config.json}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
NPM_BIN="${NPM_BIN:-$(command -v npm)}"

if [[ -z "${NODE_BIN}" || -z "${NPM_BIN}" ]]; then
  echo "node and npm must be available on PATH" >&2
  exit 1
fi

mkdir -p "${LOG_DIR}"
cd "${ROOT}"

export npm_config_yes="${npm_config_yes:-true}"
export CI="${CI:-1}"
export CODEX_SUPERVISOR_MANAGED_RESTART="${CODEX_SUPERVISOR_MANAGED_RESTART:-1}"
export CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER="${CODEX_SUPERVISOR_MANAGED_RESTART_LAUNCHER:-custom}"
"${NPM_BIN}" run build
exec "${NODE_BIN}" "${ROOT}/dist/index.js" web --config "${CONFIG_PATH}"
