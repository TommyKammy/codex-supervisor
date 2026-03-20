# Issue #721: Workspace restore visibility: surface whether recovery used local, remote, or bootstrap source

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/721
- Branch: codex/issue-721
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 86e5a2e1222722ee3e2220609a7363b816cf93e1
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851wejt
- Repeated failure signature count: 1
- Updated at: 2026-03-20T16:26:15.156Z

## Latest Codex Summary
Implemented the restore-visibility slice and kept restore semantics unchanged. `ensureWorkspace()` now returns deterministic restore metadata, issue preparation persists it on the active record, and detailed status shows `workspace_restore source=... ref=...` so operators can tell whether a recreated workspace came from a local branch or bootstrap. I added a Git-backed regression for the workspace layer plus focused preparation/status coverage.

Key files: [src/core/workspace.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-721/src/core/workspace.ts), [src/core/workspace.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-721/src/core/workspace.test.ts), [src/run-once-issue-preparation.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-721/src/run-once-issue-preparation.ts), [src/supervisor/supervisor-detailed-status-assembly.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-721/src/supervisor/supervisor-detailed-status-assembly.ts), [src/supervisor/supervisor-status-rendering.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-721/src/supervisor/supervisor-status-rendering.test.ts). I updated the journal, committed the work, pushed `codex/issue-721`, and opened draft PR #746: https://github.com/TommyKammy/codex-supervisor/pull/746

Verification passed with:
`npx tsx --test src/core/workspace.test.ts src/run-once-issue-preparation.test.ts src/supervisor/supervisor-status-rendering.test.ts`
`npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor.test.ts`
`npm run build`

Summary: Added deterministic workspace restore source metadata, surfaced it in status, committed/pushed the change, and opened draft PR #746.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/core/workspace.test.ts src/run-once-issue-preparation.test.ts src/supervisor/supervisor-status-rendering.test.ts`; `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor.test.ts`; `npm run build`
Failure signature: none
Next action: Watch CI on draft PR #746 and address any fallout from the new optional restore metadata surfaces.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/746#discussion_r2966699304
- Details:
  - src/run-once-issue-preparation.ts:212 _⚠️ Potential issue_ | _🟠 Major_ **Restore metadata may be lost when workspace status is re-fetched downstream.** The `workspaceStatus` is augmented with `restoreSource` and `restoreRef` here, but in `hydratePullRequestContext` (line 247), when `remoteBranchExists && remoteAhead > 0`, the status is re-fetched via `getWorkspaceStatus()` which does not include these fields: ```typescript nextWorkspaceStatus = await getWorkspaceStatus(args.workspacePath, args.record.branch, args.config.defaultBranch); ``` This causes the restore metadata to be lost from `nextWorkspaceStatus`, leading to inconsistent status output in that code path. <details> <summary>Proposed fix: preserve restore metadata when re-fetching status</summary> ```diff if (nextWorkspaceStatus.remoteBranchExists && nextWorkspaceStatus.remoteAhead > 0) { await pushBranch(args.workspacePath, args.record.branch, true); - nextWorkspaceStatus = await getWorkspaceStatus(args.workspacePath, args.record.branch, args.config.defaultBranch); + nextWorkspaceStatus = { + ...(await getWorkspaceStatus(args.workspacePath, args.record.branch, args.config.defaultBranch)), + restoreSource: nextWorkspaceStatus.restoreSource, + restoreRef: nextWorkspaceStatus.restoreRef, + }; } ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/run-once-issue-preparation.ts` around lines 208 - 212, When re-fetching status in hydratePullRequestContext (the nextWorkspaceStatus assigned from getWorkspaceStatus), preserve the restore metadata by copying restoreSource and restoreRef into nextWorkspaceStatus (sourced from ensuredWorkspace.restore or the original workspaceStatus) so those fields are not lost; update the code path that does nextWorkspaceStatus = await getWorkspaceStatus(...) to augment the returned object with restoreSource and restoreRef (matching the original augmentation done when creating workspaceStatus). ``` </details> <!-- fingerprinting:phantom:poseidon:ocelot --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: CodeRabbit's remaining review thread is valid because `hydratePullRequestContext(...)` refreshes `WorkspaceStatus` after a push and drops the previously attached `restoreSource`/`restoreRef` metadata from the prepared workspace context.
- What changed: added `withWorkspaceRestoreMetadata(...)` in `src/run-once-issue-preparation.ts`, used it both when first hydrating workspace status and when re-fetching status after `pushBranch(...)`, and added a focused regression in `src/run-once-issue-preparation.test.ts` that exercises the remote-ahead refresh path and asserts the restore metadata survives into the returned status and replay snapshot.
- Current blocker: none
- Next exact step: commit this review fix, push `codex/issue-721`, and clear the remaining PR #746 review thread.
- Verification gap: `remote_branch` restore metadata is still only typed, not behaviorally exercised, because this issue does not change restore semantics or add a remote-restore fixture.
- Files touched: `src/run-once-issue-preparation.ts`; `src/run-once-issue-preparation.test.ts`; `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this patch would reintroduce inconsistent restore-source visibility specifically on the `remoteAhead > 0` refresh path, which is exactly the operator-visible status regression called out in PR review.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-721/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-721/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `sed -n '1,340p' src/run-once-issue-preparation.ts`; `rg -n "restoreSource|restoreRef|getWorkspaceStatus\\(|hydratePullRequestContext|remoteAhead > 0|nextWorkspaceStatus" src/run-once-issue-preparation.ts src/run-once-issue-preparation.test.ts src/core/types.ts`; `sed -n '1,420p' src/run-once-issue-preparation.test.ts`; `sed -n '300,360p' src/core/types.ts`; `sed -n '340,460p' src/run-once-issue-preparation.ts`; `git diff -- src/run-once-issue-preparation.ts src/run-once-issue-preparation.test.ts`; `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor.test.ts`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`
### Scratchpad
- 2026-03-21 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851wejt` by preserving `restoreSource`/`restoreRef` when `hydratePullRequestContext(...)` re-fetches workspace status after pushing a remote-ahead branch; added a focused regression for that refresh path and reran `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor.test.ts` plus `npm run build`, all passing.
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
