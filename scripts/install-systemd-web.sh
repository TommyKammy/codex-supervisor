#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
UNIT_TEMPLATE="${ROOT}/systemd/codex-supervisor-web.service.template"
UNIT_TARGET="${HOME}/.config/systemd/user/codex-supervisor-web.service"
LOG_DIR="${ROOT}/.local/logs"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
NPM_BIN="${NPM_BIN:-$(command -v npm)}"
PATH_VALUE="${PATH}"

if [[ -z "${NODE_BIN}" || -z "${NPM_BIN}" ]]; then
  echo "node and npm must be available on PATH" >&2
  exit 1
fi

mkdir -p "${HOME}/.config/systemd/user" "${LOG_DIR}"
sed \
  -e "s|__ROOT__|${ROOT}|g" \
  -e "s|__PATH__|${PATH_VALUE}|g" \
  -e "s|__NODE__|${NODE_BIN}|g" \
  -e "s|__NPM__|${NPM_BIN}|g" \
  "${UNIT_TEMPLATE}" > "${UNIT_TARGET}"

systemctl --user daemon-reload
systemctl --user enable --now codex-supervisor-web.service

echo "Installed and started codex-supervisor-web.service"
