# Operator Dashboard

Use this guide when you want the local WebUI for `codex-supervisor`.

The dashboard is an operator surface over the same `SupervisorService` boundary that the CLI uses. It is not a separate backend, and it is not allowed to read the state file, worktrees, `gh`, or `codex` directly from the browser.

## Start the WebUI

Run the local server against the same supervisor config you use for `run-once`, `loop`, and `status`:

```bash
node dist/index.js web --config /path/to/supervisor.config.json
```

The server binds to `127.0.0.1:4310` and serves:

- the local operator dashboard
- typed JSON endpoints for status, doctor, explain, and issue-lint
- an SSE stream for live supervisor events

## What the dashboard is for

Use the dashboard when you want:

- the current operator state without advancing the loop
- issue detail and readiness context in one view
- live event visibility through the SSE stream
- the current safe command surface without leaving the browser

Keep using the CLI when you want:

- shell scripting or automation around supervisor commands
- the replay or replay-corpus workflows
- direct access to text output for debugging or logs

## Current safe command surface

The dashboard currently exposes only the same narrow safe commands that the CLI exposes:

- `run-once`
- `requeue`
- `prune-orphaned-workspaces`
- `reset-corrupt-json-state`

These commands still go through the backend service boundary. The browser does not mutate the state file directly.

## Panel expectations

At a high level:

- `Status`: current operator-facing status, warnings, and readiness context
- `Doctor`: host and state diagnostics
- `Issue details`: focused details for the currently selected or inspected issue
- `Operator actions`: the safe command surface and the latest command result
- `Live events`: recent SSE events from the supervisor
- `Operator timeline`: recent commands, refreshes, and correlated live supervisor events

The dashboard should favor current operator decisions and visibility over long historical dumps. Historical tracked-state browsing should live in dedicated history-oriented surfaces rather than overwhelming the main status and issue-detail panels.

## Browser smoke suite

For a lightweight browser-level verification pass, run:

```bash
npm run test:webui-smoke
```

The smoke harness uses `playwright-core` with a local Chrome/Chromium binary against an in-process dashboard fixture.

If the browser executable is not discoverable as `google-chrome`, `google-chrome-stable`, `chromium`, or `chromium-browser`, set:

```bash
CHROME_BIN=/path/to/browser
```

## Related docs

- [Getting started](./getting-started.md)
- [Configuration reference](./configuration.md)
- [Architecture](./architecture.md)
