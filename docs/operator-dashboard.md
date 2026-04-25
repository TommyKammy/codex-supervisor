# Operator Dashboard

Use this guide when you want the local WebUI for `codex-supervisor`.

The dashboard is an operator surface over the same `SupervisorService` boundary that the CLI uses. It is not a separate backend, and it is not allowed to read the state file, worktrees, `gh`, or `codex` directly from the browser.

The WebUI does not own the background loop and does not create a loop run mode. Status and doctor panels show the observable loop runtime marker for the configured supervisor service; launcher-backed WebUI restart support applies only to the WebUI process.

## Start the WebUI

Run the local server against the same supervisor config you use for `run-once`, `loop`, and `status`:

```bash
CODEX_SUPERVISOR_WEBUI_MUTATION_TOKEN=choose-a-long-random-token \
node dist/index.js web --config /path/to/supervisor.config.json
```

The server binds to `127.0.0.1:4310` and serves:

- the local operator dashboard
- typed JSON endpoints for status, doctor, explain, and issue-lint
- an SSE stream for live supervisor events

## Local mutation auth

Read-only WebUI routes stay available on localhost without extra auth, but every mutating `POST` route now requires both:

- the `X-Codex-Supervisor-Mutation-Token` header with the exact value from `CODEX_SUPERVISOR_WEBUI_MUTATION_TOKEN`
- a localhost request shape, including a localhost `Host` header and a same-origin localhost `Origin` header when the caller is a browser

Threat model:

- binding to `127.0.0.1` is not enough for mutation safety on its own
- a different browser page, local script, or other localhost-reachable process must not be able to trigger supervisor mutations just because it can reach the port
- the shared mutation token is the explicit operator proof for local mutation requests

Operator flow:

1. choose a long random token before starting `node dist/index.js web`
2. keep that token local to the operator session
3. on the first write action from `/setup` or `/dashboard`, enter the token when the browser prompts for it

For direct local scripts that intentionally call a mutating WebUI endpoint, send the same header explicitly. If the env var is unset, mutating routes fail closed and the WebUI stays effectively read-only.

## Launcher-managed restart

Managed restart is only meaningful when the WebUI itself runs under a launcher-backed entrypoint that can safely relaunch it.

For direct local sessions such as:

```bash
node dist/index.js web --config /path/to/supervisor.config.json
```

the setup flow must stay manual, because the browser should not terminate an unmanaged local process.

If you want launcher-managed restart for the WebUI, use the dedicated WebUI launchers instead of the loop service:

```bash
./scripts/install-launchd-web.sh
./scripts/install-systemd-web.sh
```

Those launchers start `scripts/run-web.sh`, which enables the managed restart capability for launcher-backed WebUI sessions while keeping the existing loop launcher path separate.

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

For first-time issue authoring, a good operator pattern is:

1. run `node dist/index.js issue-lint <issue-number> --config /path/to/supervisor.config.json`
2. open the WebUI to inspect the same issue in `Issue details`
3. use `Doctor` only if the issue looks correct but the loop still behaves unexpectedly

Beginner rule of thumb:

- if `Issue details` shows `execution_ready=no`, `missing_required=...`, or `metadata_errors=...`, fix the GitHub issue body
- if `Doctor` shows `doctor_check name=github_auth status=fail`, `doctor_check name=codex_cli status=fail`, or `doctor_check name=state_file status=fail`, fix the host or config
- if `Doctor` shows `doctor_warning kind=config ...`, fix the supervisor config rather than the issue body

Read the local CI posture the same way:

- `No repo-owned local CI contract is configured.` No canonical repo-owned local gate is active, so local CI is not blocking PR publication yet.
- `Repo-owned local CI candidate exists but localCiCommand is unset.` The repo already defines a likely entrypoint, but codex-supervisor will not run it until `localCiCommand` is configured. This warning is advisory only.
- `Repo-owned local CI candidate was intentionally dismissed; localCiCommand remains unset and non-blocking.` An operator acknowledged the detected candidate and intentionally left local CI unset for this profile.
- `Repo-owned local CI contract is configured.` The configured command is now the active fail-closed gate. When configured local CI fails, PR publication stays blocked and ready-for-review promotion stays blocked until the repo-owned command passes again.

Read the release-readiness posture separately:

- `doctor_release_readiness_gate posture=advisory` means the release-readiness checklist is visible but cannot block PR publication, merge readiness, loop operation, or release publication.
- `doctor_release_readiness_gate posture=block_release_publication` means the repo explicitly opted in with `releaseReadinessGate: block_release_publication`. It can block release publication only and does not change local CI, issue verification, PR publication, merge readiness, or loop behavior.

If local CI is configured, remember that the config can now use either:

- structured execution mode for an explicit executable plus arguments
- explicit shell mode for a deliberately shell-driven command
- a legacy shell-string config kept only for backward compatibility

Use the [Configuration reference](./configuration.md) when you need to confirm which execution mode is active or when a local CI failure looks like a workspace toolchain problem instead of a repo command failure.

## Current safe command surface

The dashboard currently exposes only the same narrow safe commands that the CLI exposes:

- `run-once`
- `requeue`
- `prune-orphaned-workspaces`
- `reset-corrupt-json-state`

These commands still go through the backend service boundary. The browser does not mutate the state file directly, and each command now requires the local mutation token described above.

## Panel expectations

At a high level:

- `Status`: current operator-facing status, warnings, and readiness context
- `Doctor`: host and state diagnostics
- `Issue details`: focused details for the currently selected or inspected issue, including the same issue-lint posture you should trust before calling an issue runnable
- `Operator actions`: the safe command surface and the latest command result
- `Live events`: recent SSE events from the supervisor
- `Operator timeline`: recent commands, refreshes, and correlated live supervisor events

The dashboard should favor current operator decisions and visibility over long historical dumps. Historical tracked-state browsing should live in dedicated history-oriented surfaces rather than overwhelming the main status and issue-detail panels.

## Read `Issue details` and `Doctor` together

Use the two panels for different questions:

- `Issue details` answers "is this issue body runnable?"
- `Doctor` answers "is the host, auth, config, or state unhealthy?"

Representative `Issue details` / `issue-lint` signals:

- `missing_required=scope, acceptance criteria, verification`
  Add those sections to the issue body.
- `metadata_errors=depends on must appear exactly once; execution order must appear exactly once; parallelizable must appear exactly once`
  Remove duplicate scheduling lines and keep one valid declaration per field.
- `metadata_errors=depends on duplicates parent epic #900; remove it and keep only real blocking issues`
  Keep `Part of: #900` for the epic and move only real prerequisites into `Depends on:`.

Representative `Doctor` signals:

- `doctor_check name=github_auth status=fail`
  Re-authenticate `gh` on the host.
- `doctor_check name=codex_cli status=fail`
  Install `codex` or fix `codexBinary` in config.
- `doctor_check name=state_file status=fail`
  Inspect or repair local state before trusting more runs.
- `doctor_warning kind=config detail=Active config still uses legacy shared issue journal path ...`
  Update the config to the issue-scoped journal path.

Practical split:

1. If `Issue details` is red, repair the issue first.
2. If `Issue details` is clean but `Doctor` is red or warns, repair host/config/state next.
3. If both look clean and selection still surprises you, inspect `Status` or run `explain <issue-number>`.

In short: `Issue details` tells you when to fix the issue first, and `Doctor` tells you when to repair host/config/state next.

Use that same split when local CI is involved:

- If `Issue details` is red because `issue-lint` reports missing sections or malformed metadata, fix the GitHub issue body first.
- If `Issue details` is clean but `Doctor` or setup/readiness shows `Repo-owned local CI candidate exists but localCiCommand is unset.`, decide whether to adopt the repo script by updating supervisor config; this is not an issue-authoring failure.
- If setup/readiness shows `Repo-owned local CI candidate was intentionally dismissed`, leave it alone unless you now want to adopt the repo command as the fail-closed local CI gate.
- If `Issue details` is clean and the configured local CI gate fails, repair the repo or host until the configured command passes again.

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
