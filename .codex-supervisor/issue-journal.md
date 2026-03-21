# Issue #776: Candidate discovery visibility: warn when selection may be truncated by the first-page fetch window

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/776
- Branch: codex/issue-776
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: a5da9d2f80c5897f35c340aed78a3ca4b03162af
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T12:37:42Z

## Latest Codex Summary
Pushed commit `a5da9d2` to `origin/codex/issue-776` and opened draft PR `#788` (`https://github.com/TommyKammy/codex-supervisor/pull/788`). The PR body was corrected via `gh api` after `gh pr edit` hit a GraphQL project-cards deprecation error. `.codex-supervisor/replay/` remains untracked and untouched.

Summary: Pushed the verified candidate-discovery warning checkpoint and opened draft PR `#788`
State hint: waiting_ci
Blocked reason: none
Tests: no new code verification this turn; reused previous green results from `npx tsx --test src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build`
Failure signature: none
Next action: Monitor draft PR `#788` for CI and review feedback; address any failures if they appear

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `status` and `doctor` need an explicit operator-facing warning when the first-page candidate fetch window can hide additional matching open issues, so operators can distinguish “no runnable issue” from incomplete discovery.
- What changed: pushed commit `a5da9d2` to `origin/codex/issue-776`, opened draft PR `#788`, and corrected the PR body via `gh api` after `gh pr edit` failed with a GraphQL project-cards deprecation error.
- Current blocker: none
- Next exact step: watch draft PR `#788` CI/review feedback and address any failures or comments.
- Verification gap: no new code changes after the prior green targeted suite/build; this turn only pushed/opened the PR and corrected PR metadata. `.codex-supervisor/replay/` remains untracked and untouched.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/core/types.ts`, `src/doctor.test.ts`, `src/doctor.ts`, `src/github/github.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-selection-readiness-summary.ts`
- Rollback concern: removing the probe or warning would re-hide first-page truncation and make operators misread incomplete candidate discovery as definitive scheduler state.
- Last focused command: `gh api repos/TommyKammy/codex-supervisor/pulls/788 -X PATCH --raw-field body=...`
- Last focused failure: `none`
- Last focused commands:
```bash
git push -u origin codex/issue-776
gh pr create --draft --base main --head codex/issue-776 --title "Warn when candidate discovery may be truncated by the first-page fetch window" --body ...
gh api repos/TommyKammy/codex-supervisor/pulls/788 -X PATCH --raw-field body=...
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
