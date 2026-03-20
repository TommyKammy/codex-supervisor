# Issue #721: Workspace restore visibility: surface whether recovery used local, remote, or bootstrap source

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/721
- Branch: codex/issue-721
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 53d010d64c4b7af18876994308cf35734470de4a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T16:09:16.338Z

## Latest Codex Summary
- Added a narrow workspace-restore visibility slice: `ensureWorkspace()` now returns deterministic restore metadata, issue preparation persists the restore source/ref for active records, and status output surfaces `workspace_restore ...` so operators can see whether a recreated workspace came from a local branch or default-branch bootstrap. Focused restore/preparation/status tests passed, the requested issue test set passed, `npm run build` passed after installing local dependencies in this worktree, and draft PR #746 is now open for the checkpoint.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest viable fix is to keep restore semantics unchanged, but make `ensureWorkspace()` return typed restore metadata that can be persisted on the issue record and surfaced in operator status output.
- What changed: added a focused Git-backed regression in `src/core/workspace.test.ts` to reproduce the missing restore-source signal, updated `src/core/workspace.ts` so `ensureWorkspace()` reports deterministic restore metadata for existing-workspace/local-branch/bootstrap paths, threaded that metadata through `prepareIssueExecutionContext(...)`, and rendered a `workspace_restore source=... ref=...` line in active detailed status output.
- Current blocker: none
- Next exact step: watch CI on draft PR #746 and address any fallout, especially if wider type consumers need the new optional restore metadata handled explicitly.
- Verification gap: remote-branch restore metadata is typed but still not exercised because this issue deliberately does not change restore semantics yet.
- Files touched: `src/core/types.ts`; `src/core/workspace.ts`; `src/core/workspace.test.ts`; `src/run-once-issue-preparation.ts`; `src/run-once-issue-preparation.test.ts`; `src/run-once-issue-selection.ts`; `src/supervisor/supervisor.ts`; `src/supervisor/supervisor-detailed-status-assembly.ts`; `src/supervisor/supervisor-status-rendering.test.ts`; `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this patch would remove the only deterministic, persisted restore-source signal for recreated workspaces and make it harder for operators/tests to tell whether the supervisor reused a local issue branch or bootstrapped from `origin/<defaultBranch>`.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-721/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-721/context-index.md`; `sed -n '1,360p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "ensureWorkspace\\(|restore|bootstrap|remote branch|local branch|worktree add|origin/<defaultBranch>|restoreSource|recovery" src`; `sed -n '1,260p' src/core/workspace.ts`; `sed -n '1,320p' src/run-once-issue-preparation.test.ts`; `sed -n '1,260p' src/run-once-issue-preparation.ts`; `sed -n '1,260p' src/core/types.ts`; `sed -n '1,260p' src/supervisor/supervisor-cycle-snapshot.ts`; `sed -n '1,280p' src/supervisor/supervisor-status-rendering.test.ts`; `sed -n '1,240p' src/supervisor/supervisor-detailed-status-assembly.ts`; `npx tsx --test src/core/workspace.test.ts`; `npx tsx --test src/core/workspace.test.ts src/run-once-issue-preparation.test.ts src/supervisor/supervisor-status-rendering.test.ts`; `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor.test.ts`; `npm install`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`
### Scratchpad
- 2026-03-21 (JST): Committed `Surface workspace restore source`, pushed `codex/issue-721`, and opened draft PR #746 (`https://github.com/TommyKammy/codex-supervisor/pull/746`); the unrelated untracked `.codex-supervisor/replay/` directory remains untouched.
- 2026-03-21 (JST): Added a focused Git-backed regression for workspace restore visibility, reproduced that `ensureWorkspace()` dropped restore provenance entirely, then implemented deterministic restore metadata (`existing_workspace`/`local_branch`/typed bootstrap placeholder) that is persisted on prepared issue records and surfaced as `workspace_restore source=... ref=...` in detailed status; `npx tsx --test src/core/workspace.test.ts src/run-once-issue-preparation.test.ts src/supervisor/supervisor-status-rendering.test.ts`, `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor.test.ts`, and `npm run build` passed after `npm install`.
- 2026-03-21 (JST): Reverified the fail-closed checkpoint with the issue test set and `npm run build`, pushed `codex/issue-718`, and opened draft PR #744 so the branch now has a tracked review artifact; the unrelated untracked `.codex-supervisor/replay/` directory remains untouched.
- 2026-03-21 (JST): Added focused fail-closed regressions for quarantined JSON state, reproduced that `runOnce()` still reached issue selection, `requeue` still mutated against the forced-empty fallback, and `loop` kept sleeping after a fail-closed result, then implemented a narrow supervisor/runtime gate that blocks execution-changing commands until `reset-corrupt-json-state` and reran the issue verification plus `npm run build` successfully after `npm install`.
- 2026-03-20 (JST): Added a focused status regression for invalid JSON state, reproduced the omission where status only printed normal empty-state lines, then appended explicit `state_diagnostic` and `state_load_finding` lines for JSON `load_findings` so corruption is visible in status without changing loader semantics.
- 2026-03-20 (JST): Added a focused docs regression for the missing JSON corruption contract, confirmed the new assertion failed first, then updated the English operator docs so they consistently say corrupted JSON state is a recovery event requiring explicit acknowledgement/reset and `status`/`doctor` triage before reuse.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
