# Issue #1243: [codex] Add structured execution mode for localCiCommand

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1243
- Branch: codex/issue-1243
- Workspace: .
- Journal: .codex-supervisor/issues/1243/issue-journal.md
- Current phase: stabilizing
- Attempt count: 3 (implementation=3, repair=0)
- Last head SHA: 44c7115a802b44f1f1dbd8363da44a49063f8d01
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 0
- Updated at: 2026-03-31T04:14:44.968Z

## Latest Codex Summary
Reran the required local verification, pushed `codex/issue-1243`, and opened draft PR #1247 from the verified checkpoint.

Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/1247

Summary: Verified the structured local CI checkpoint again, pushed branch `codex/issue-1243`, and opened draft PR #1247
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/local-ci.test.ts src/post-turn-pull-request.test.ts src/turn-execution-publication-gate.test.ts`; `npm run build`
Next action: monitor PR #1247 checks and address any CI or review feedback from the draft PR
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `localCiCommand` should support a non-shell structured path for repo-owned entrypoints while leaving shell execution explicit and observable.
- What changed: Revalidated the existing implementation with `npx tsx --test src/local-ci.test.ts src/post-turn-pull-request.test.ts src/turn-execution-publication-gate.test.ts` and `npm run build`, pushed branch `codex/issue-1243`, and opened draft PR #1247 (`https://github.com/TommyKammy/codex-supervisor/pull/1247`).
- Current blocker: none.
- Next exact step: Watch draft PR #1247 for CI results and fix any reported failures or review feedback.
- Verification gap: No known local verification gap; required local verification passed, and remote PR checks are now pending.
- Files touched: src/core/types.ts; src/core/config.ts; src/local-ci.ts; src/setup-config-write.ts; src/setup-readiness.ts; src/local-ci.test.ts; src/config.test.ts; src/post-turn-pull-request.test.ts; src/doctor.test.ts; src/supervisor/supervisor-cycle-snapshot.test.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/supervisor/supervisor-operator-activity-context.test.ts; src/supervisor/supervisor-selection-issue-explain.test.ts
- Rollback concern: Setup/WebUI surfaces still only write string `localCiCommand` values; structured commands are supported when hand-authored in config, so future UI work should avoid overwriting object configs accidentally.
- Last focused command: gh pr create --draft --base main --head codex/issue-1243 --title "[codex] Add structured execution mode for localCiCommand" --body-file -
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
