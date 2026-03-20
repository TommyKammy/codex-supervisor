# Issue #720: Workspace restore docs: define local-branch, remote-branch, and bootstrap precedence

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/720
- Branch: codex/issue-720
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 57e01ce44c2aa0277088bd70c01b898d0a381e69
- Blocked reason: none
- Last failure signature: docs_workspace_restore_precedence_missing
- Repeated failure signature count: 0
- Updated at: 2026-03-20T15:46:45Z

## Latest Codex Summary
- Added a focused docs regression for workspace-restore precedence, reproduced the missing contract in the English docs, then updated `README.md`, `docs/architecture.md`, `docs/getting-started.md`, and `docs/configuration.md` so they consistently say `ensureWorkspace()` should prefer an existing local issue branch first, then an existing remote issue branch, and only then bootstrap from `origin/<defaultBranch>` as the fallback. Focused docs verification passed, and `npm run build` passed after installing local dependencies in this worktree.

## Active Failure Context
- Resolved in this turn: the docs implied bootstrap from `origin/<defaultBranch>` without defining the intended local-branch then remote-branch restore precedence.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #720 is a docs-only checkpoint and is now locally verified; the next supervisor step is to commit this docs/test slice and open or update a draft PR if one does not already exist.
- What changed: added a focused docs regression in `src/execution-safety-docs.test.ts`, reproduced the missing workspace restore contract, then updated the English operator docs so they consistently document the intended precedence of local issue branch restore, remote issue branch restore, and fallback bootstrap from `origin/<defaultBranch>`.
- Current blocker: none
- Next exact step: commit the docs/test checkpoint on `codex/issue-720`, then open or update the draft PR and watch CI.
- Verification gap: none locally after `npx tsx --test src/execution-safety-docs.test.ts` and `npm run build`.
- Files touched: `README.md`; `docs/architecture.md`; `docs/configuration.md`; `docs/getting-started.md`; `src/execution-safety-docs.test.ts`; `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this patch would remove the operator-facing restore contract and reintroduce documentation that can be read as “missing local branch means bootstrap from `origin/<defaultBranch>`,” which is the ambiguity this issue is meant to eliminate before runtime changes land.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-720/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-720/context-index.md`; `sed -n '1,360p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "workspace|restore|bootstrap|default branch|local branch|remote branch|worktree" README.md docs src test package.json`; `rg --files | rg "test|spec|docs"`; `cat package.json`; `sed -n '1,220p' src/readme-docs.test.ts`; `sed -n '1,220p' src/getting-started-docs.test.ts`; `sed -n '1,220p' README.md`; `sed -n '1,260p' docs/getting-started.md`; `sed -n '1,220p' docs/architecture.md`; `sed -n '1,220p' docs/configuration.md`; `sed -n '1,240p' src/core/workspace.ts`; `rg -n "ensureWorkspace\\(|worktree add|origin/main|origin/<defaultBranch>|branchPrefix|issue branch" src`; `sed -n '1,220p' src/execution-safety-docs.test.ts`; `sed -n '1,220p' src/agent-instructions-docs.test.ts`; `npx tsx --test src/execution-safety-docs.test.ts`; `git diff -- README.md docs/getting-started.md docs/architecture.md docs/configuration.md src/execution-safety-docs.test.ts`; `npm install`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`
### Scratchpad
- 2026-03-21 (JST): Added a focused docs regression for workspace restore precedence, reproduced that the English docs did not mention local-branch restore or remote-branch restore before bootstrap, then updated `README.md`, `docs/architecture.md`, `docs/getting-started.md`, and `docs/configuration.md` so they consistently define local issue branch -> remote issue branch -> fallback bootstrap from `origin/<defaultBranch>`; `npx tsx --test src/execution-safety-docs.test.ts` and `npm run build` passed after `npm install`.
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
