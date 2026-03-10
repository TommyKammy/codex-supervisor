#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SCOPE="${1:-global}"
NPX_BIN="${NPX_BIN:-$(command -v npx)}"
CODEX_CONFIG_DIR="${CODEX_CONFIG_DIR:-${CODEX_HOME:-${HOME}/.codex}}"

if [[ -z "${NPX_BIN}" ]]; then
  echo "npx must be available on PATH" >&2
  exit 1
fi

if [[ "${SCOPE}" != "global" && "${SCOPE}" != "local" ]]; then
  echo "usage: $0 [global|local]" >&2
  exit 1
fi

ARGS=(get-shit-done-cc@latest --codex)
if [[ "${SCOPE}" == "local" ]]; then
  ARGS+=(--local)
  cd "${ROOT}"
else
  ARGS+=(--global --config-dir "${CODEX_CONFIG_DIR}")
fi

CI=1 npm_config_yes=true "${NPX_BIN}" "${ARGS[@]}"
echo "Installed GSD Codex support (${SCOPE})"
