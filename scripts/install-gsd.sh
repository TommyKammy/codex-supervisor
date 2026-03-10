#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCOPE="${1:-global}"
TARGET_REPO="${2:-${PWD}}"
NPX_BIN="${NPX_BIN:-$(command -v npx)}"
CODEX_CONFIG_DIR="${CODEX_CONFIG_DIR:-${CODEX_HOME:-${HOME}/.codex}}"
GSD_PACKAGE_SPEC="${GSD_PACKAGE_SPEC:-get-shit-done-cc@1.22.4}"

if [[ -z "${NPX_BIN}" ]]; then
  echo "npx must be available on PATH" >&2
  exit 1
fi

if [[ "${SCOPE}" != "global" && "${SCOPE}" != "local" ]]; then
  echo "usage: $0 [global|local] [target_repo_for_local_install]" >&2
  exit 1
fi

ARGS=("${GSD_PACKAGE_SPEC}" --codex)
if [[ "${SCOPE}" == "local" ]]; then
  ARGS+=(--local)
  cd "${TARGET_REPO}"
else
  ARGS+=(--global --config-dir "${CODEX_CONFIG_DIR}")
fi

CI=1 npm_config_yes=true "${NPX_BIN}" "${ARGS[@]}"
echo "Installed GSD Codex support (${SCOPE})"
