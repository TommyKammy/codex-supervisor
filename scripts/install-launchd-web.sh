#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLIST_TEMPLATE="${ROOT}/launchd/io.codex.supervisor.web.plist.template"
PLIST_TARGET="${HOME}/Library/LaunchAgents/io.codex.supervisor.web.plist"
LOG_DIR="${ROOT}/.local/logs"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
NPM_BIN="${NPM_BIN:-$(command -v npm || true)}"
PATH_VALUE="${PATH}"

escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'
}

if [[ -z "${NODE_BIN}" || -z "${NPM_BIN}" ]]; then
  echo "node and npm must be available on PATH" >&2
  exit 1
fi

UID_VALUE="$(id -u)"
mkdir -p "${HOME}/Library/LaunchAgents" "${LOG_DIR}"
ROOT_ESCAPED="$(escape_sed_replacement "${ROOT}")"
PATH_ESCAPED="$(escape_sed_replacement "${PATH_VALUE}")"
NODE_ESCAPED="$(escape_sed_replacement "${NODE_BIN}")"
NPM_ESCAPED="$(escape_sed_replacement "${NPM_BIN}")"
sed \
  -e "s|__ROOT__|${ROOT_ESCAPED}|g" \
  -e "s|__PATH__|${PATH_ESCAPED}|g" \
  -e "s|__NODE__|${NODE_ESCAPED}|g" \
  -e "s|__NPM__|${NPM_ESCAPED}|g" \
  "${PLIST_TEMPLATE}" > "${PLIST_TARGET}"

launchctl bootout "gui/${UID_VALUE}" "${PLIST_TARGET}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${UID_VALUE}" "${PLIST_TARGET}"
launchctl enable "gui/${UID_VALUE}/io.codex.supervisor.web"
launchctl kickstart -k "gui/${UID_VALUE}/io.codex.supervisor.web"

echo "Installed and started io.codex.supervisor.web"
