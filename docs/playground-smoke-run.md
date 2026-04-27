# Playground Smoke Run

Use this path for a first supervised pass in a sandbox repository before you point `codex-supervisor` at production work.

This guide is intentionally short. It gives a new operator one execution-ready sample issue, the minimum command sequence, and the boundary between sandbox-only practice and production trust posture.

## Sandbox-only posture

Run the playground against a disposable repository or fork where it is acceptable for Codex to create a branch, edit files, and open a draft PR. Keep production repo automation safety settings out of this playground profile.

Sandbox-only assumptions:

- the repository contains throwaway work or a harmless tutorial file
- the GitHub issue author is you or another trusted test author
- branch names, worktree paths, and local state can be discarded after the smoke run
- the sample issue changes one small file and has no external secrets, deploy steps, or production data access
- review-provider settings can be disabled or pointed at a test-only provider profile

Production posture is stricter:

- use only a trusted repo with trusted GitHub authors
- keep branch protection, CI, and review-provider settings aligned with the real repository
- validate the issue body with `issue-lint` before `run-once`
- keep sandbox-only config, tokens, and state files separate from production profiles
- do not infer trust from repo names, issue prose, comments, or nearby config

## Create a sandbox config

From the `codex-supervisor` repo:

```bash
git clone <codex-supervisor-repo-url> <codex-supervisor-root>
cd <codex-supervisor-root>
npm install
npm run build
cp supervisor.config.example.json supervisor.config.playground.json
```

Edit `supervisor.config.playground.json` for the sandbox repository:

- set `repoPath` to the local sandbox repo clone
- set `repoSlug` to the sandbox GitHub repository, for example `owner/repo`
- set `workspaceRoot` to a disposable worktree directory
- set `codexBinary` to the `codex` executable available on this host
- keep `trustMode` and `executionSafetyMode` explicit
- omit production-only review-provider or auto-merge settings unless the sandbox intentionally tests them

Use one variable for the rest of the smoke run:

```bash
export CODEX_SUPERVISOR_CONFIG=<supervisor-config-path>
```

## Sample issue body

Create one GitHub issue in the sandbox repo, add the `codex` label, and paste this body. Replace only the file name or wording needed for the sandbox repo.

<!-- playground-smoke-sample-issue:start -->
```md
## Summary
Add a tiny playground note so the first supervised pass has a harmless file change.

## Scope
- create or update one sandbox-only Markdown note
- keep production configuration, secrets, and automation settings unchanged

Depends on: none
Parallelizable: No

## Execution order
1 of 1

## Acceptance criteria
- the sandbox note exists and says it was created by the playground smoke run
- no production config, secret, or automation profile is changed

## Verification
- `npm run build`
```
<!-- playground-smoke-sample-issue:end -->

This is a standalone `1 of 1` issue, so it intentionally has no `Part of:` line. Use `Part of: #...` only when the issue is a sequenced child under a real parent tracker.

## Smoke commands

Run the commands from the `codex-supervisor` repo after the sandbox issue exists.

```bash
node dist/index.js help
node dist/index.js doctor --config <supervisor-config-path>
node dist/index.js status --config <supervisor-config-path> --why
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
node dist/index.js run-once --config <supervisor-config-path> --dry-run
node dist/index.js run-once --config <supervisor-config-path>
node dist/index.js status --config <supervisor-config-path> --why
```

Equivalent environment-variable form:

```bash
node dist/index.js issue-lint <issue-number> --config "$CODEX_SUPERVISOR_CONFIG"
node dist/index.js run-once --config "$CODEX_SUPERVISOR_CONFIG" --dry-run
node dist/index.js run-once --config "$CODEX_SUPERVISOR_CONFIG"
```

Readiness expectations:

- `doctor` should report host and config blockers before Codex runs
- `status --why` should show the selected issue or why selection is blocked
- `issue-lint` must report the sample issue as execution-ready before `run-once`
- `run-once --dry-run` should explain one supervised cycle without running Codex
- `run-once` should create or update only the sandbox worktree and branch for that issue

Stop after one successful `run-once`. Inspect the sandbox repository, issue journal, and any draft PR before starting a background loop.

## After the smoke run

Keep the playground profile separate. For production, return to [Getting started](./getting-started.md) and the [Configuration reference](./configuration.md), then validate the real repo profile with:

```bash
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
node dist/index.js doctor --config <supervisor-config-path>
node dist/index.js status --config <supervisor-config-path> --why
```

Only start the loop after a real production issue body, config, CI posture, and review-provider posture are all explicit.
