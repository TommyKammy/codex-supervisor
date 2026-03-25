# Issue #995: Orphan cleanup config safety: replace ambiguous negative grace behavior with explicit validated semantics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/995
- Branch: codex/issue-995
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 6056bba5209f39e9733de599a438c88852bc41e6
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T13:39:00.000Z

## Latest Codex Summary
- Reproduced that `loadConfigSummary()` treated `cleanupOrphanedWorkspacesAfterHours: -1` as ready config, which silently disabled recent-workspace protection by making orphan prune age checks always pass. Fixed the config semantics by rejecting negative orphan grace values during config load and failing fast in runtime orphan evaluation if an invalid negative is injected programmatically, then pushed `codex/issue-995` and opened draft PR [#1013](https://github.com/TommyKammy/codex-supervisor/pull/1013).

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the unsafe behavior lived at config ingestion, where `cleanupOrphanedWorkspacesAfterHours` accepted any finite negative value and later caused orphan prune grace checks to behave like "prune immediately".
- What changed: added a focused `src/config.test.ts` regression asserting negative orphan grace values are invalid; updated `src/core/config.ts` to reject negative `cleanupOrphanedWorkspacesAfterHours`; hardened `src/recovery-reconciliation.ts` to fail fast on invalid negative runtime values; and updated `src/supervisor/supervisor-execution-cleanup.test.ts` fixtures to use explicit non-negative orphan grace values instead of the old ambiguous `-1`.
- Current blocker: none.
- Next exact step: wait for review or CI feedback on PR #1013 and address any follow-up if it appears.
- Verification gap: none on the intended slice; `npx tsx --test src/config.test.ts src/doctor.test.ts src/recovery-reconciliation.test.ts` and `npm run build` are green after `npm ci`.
- Files touched: `src/config.test.ts`, `src/core/config.ts`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-execution-cleanup.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the behavior change is intentionally narrow to orphan-cleanup config validation and a defensive runtime assertion.
- Last focused command: `npm run build`
- Exact failure reproduced: `npx tsx --test src/config.test.ts` failed because `loadConfigSummary()` returned `status === "ready"` for `cleanupOrphanedWorkspacesAfterHours: -1` instead of flagging it as invalid config.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-995/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-995/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "cleanupOrphanedWorkspacesAfterHours|orphan grace|negative|sentinel|cleanupDoneWorkspacesAfterHours|maxDoneWorkspaces" src`; `sed -n '520,620p' src/core/config.ts`; `sed -n '1,260p' src/config.test.ts`; `sed -n '150,230p' src/recovery-reconciliation.ts`; `sed -n '720,820p' src/supervisor/supervisor-execution-cleanup.test.ts`; `sed -n '100,220p' src/doctor.test.ts`; `sed -n '1,180p' src/recovery-reconciliation.test.ts`; `sed -n '600,670p' src/recovery-reconciliation.ts`; `sed -n '1,140p' src/turn-execution-test-helpers.ts`; `sed -n '400,720p' src/supervisor/supervisor-execution-cleanup.test.ts`; `npx tsx --test src/config.test.ts`; `npx tsx --test src/config.test.ts`; `npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts`; `npm ci`; `npx tsx --test src/config.test.ts src/doctor.test.ts src/recovery-reconciliation.test.ts`; `npm run build`; `git add ...`; `git commit -m "Validate orphan cleanup grace config"`; `git push -u origin codex/issue-995`; `gh pr create --draft --base main --head codex/issue-995 --title "Validate orphan cleanup grace config" ...`; `gh pr view 1013 --json number,state,url,isDraft,headRefName,baseRefName,title`.
- PR status: draft PR open at `https://github.com/TommyKammy/codex-supervisor/pull/1013`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
