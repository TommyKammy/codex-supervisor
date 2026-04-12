#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

printf '%s\n' \
  'direct launchd loop install is unsupported on macOS.' \
  'The supported macOS loop host is tmux.' \
  'Start the loop with: ./scripts/start-loop-tmux.sh' \
  'Stop the loop with: ./scripts/stop-loop-tmux.sh' \
  'If you need launchd on macOS, use it only for the WebUI launcher path: ./scripts/install-launchd-web.sh' \
  >&2
exit 1
