# Issue #1080: Contain GitHub rate-limit failures without freezing active review progression

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1080
- Branch: codex/issue-1080
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 2f9d5c6f7bfa1510fde21f003f463c695e895e78
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail|build (macos-latest):fail
- Repeated failure signature count: 1
- Updated at: 2026-03-26T16:18:19Z

## Latest Codex Summary
Implemented rate-limit containment for broad inventory refreshes. `gh issue list` failures that match GitHub primary or secondary rate limits now degrade explicitly as `classification=rate_limited`, the supervisor status text includes `kind=rate_limited`, and `GitHubClient.listAllIssues()` no longer falls through to paginated REST inventory when the primary inventory payload is already rate-limited. Active tracked PR review progression stays covered under the degraded prelude path.

Added focused regressions for transport classification, prelude degradation, the no-fallback inventory case, and active tracked PR reevaluation under rate limit. The checkpoint is committed as `2f9d5c6` and pushed on `codex/issue-1080`. Draft PR: `#1086` <https://github.com/TommyKammy/codex-supervisor/pull/1086>.

Summary: Contained rate-limited inventory refresh failures by classifying them distinctly, preventing REST fallback hammering, and keeping active review progression available under degraded mode.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/github/github.test.ts`; `npx tsx --test src/github/github-transport.test.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts`
Next action: Extend coverage to any remaining rate-limited hydration paths or move the draft PR into review once that scope is confirmed.
Failure signature: build (ubuntu-latest):fail|build (macos-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1086 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1086
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23605054238/job/68745400566
  - build (macos-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23605054238/job/68745400646

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining CI failure is fixture drift in `src/run-once-cycle-prelude.test.ts`, not a runtime regression in the new rate-limit containment path. The test record still reflects an older `IssueRunRecord` shape.
- What changed: removed stale `last_run_at` from the rate-limited prelude fixture and added the now-required `last_error: null` field so the test matches the current `IssueRunRecord` contract.
- Current blocker: none.
- Next exact step: commit the CI repair, push `codex/issue-1080`, and let PR #1086 rerun the build checks against the corrected test fixture.
- Verification gap: full `npm test` has not been run; `npm run build` and the focused rate-limit regression suites are green locally.
- Files touched: `.codex-supervisor/issue-journal.md`; `src/run-once-cycle-prelude.test.ts`.
- Rollback concern: low. This repair only updates test data to match the current persisted record shape; runtime code is unchanged.
- Last focused command: `npm run build`
- What changed this turn: reread the required memory files and journal, fetched the failing PR check logs, reproduced the CI TypeScript failure locally after installing dependencies, fixed the stale `IssueRunRecord` fixture fields in the rate-limited prelude regression, and reran the local build plus focused rate-limit verification.
- Exact failure reproduced this turn: `npm run build` failed with `TS2353` because the fixture still set `last_run_at`, then failed with `TS2741` because the same fixture omitted required `last_error`.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1080/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1080/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `gh pr checks 1086`; `gh run view 23605054238 --log-failed`; `sed -n '1,240p' package.json`; `sed -n '520,610p' src/run-once-cycle-prelude.test.ts`; `rg -n "type IssueRunRecord|interface IssueRunRecord|IssueRunRecord" src/core src | head -n 40`; `npm run build`; `sed -n '211,280p' src/core/types.ts`; `ls -1`; `test -d node_modules && echo present || echo missing`; `rg -n "last_run_at" src`; `sed -n '1,120p' src/core/state-store.test.ts`; `git diff -- src/run-once-cycle-prelude.test.ts`; `apply_patch ...`; `npm ci`; `npx tsx --test src/github/github-transport.test.ts src/github/github.test.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts`; `sed -n '510,575p' src/run-once-cycle-prelude.test.ts`; `sed -n '1,90p' src/run-once-cycle-prelude.test.ts`; `apply_patch ...`; `npx tsx --test src/run-once-cycle-prelude.test.ts`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git status --short`; `git diff -- src/run-once-cycle-prelude.test.ts .codex-supervisor/issue-journal.md`.
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
