# Issue #777: Candidate discovery config: add an explicit fetch-window surface for scheduler candidate discovery

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/777
- Branch: codex/issue-777
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 759441b34c02da7efb720145cd3c91a42f121390
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T13:35:42.384Z

## Latest Codex Summary
Checked draft PR [#789](https://github.com/TommyKammy/codex-supervisor/pull/789) after opening it. Both CI build jobs are green, there are no human or bot review findings, and the only remaining remote signal is CodeRabbit's draft-skip comment with a still-pending `CodeRabbit` status context while the PR remains draft. The worktree is otherwise clean apart from the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Checked PR `#789`; CI passed and only the draft-skipped pending CodeRabbit status remains.
State hint: draft_pr
Blocked reason: none
Tests: not run this turn; checked remote PR status after prior green `npx tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build`
Failure signature: none
Next action: keep watching PR `#789`; if the branch is ready for review, decide whether to move it out of draft or explicitly trigger the pending CodeRabbit review

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: candidate discovery needs an explicit fetch-window config plus an always-visible diagnostics line so operators can see the effective first-page-only behavior even when truncation is not currently observed.
- What changed: checked draft PR `#789` after opening it. Remote CI is now green (`build (ubuntu-latest)=SUCCESS`, `build (macos-latest)=SUCCESS`), there are no review findings, and CodeRabbit left only a draft-skip informational comment while its `CodeRabbit` status context remains `PENDING`. The branch still contains the explicit `candidateDiscoveryFetchWindow` config surface, GitHub candidate discovery honors that window, and `status`/`doctor` show `candidate_discovery fetch_window=<n> strategy=first_page_only`.
- Current blocker: none
- Next exact step: continue watching PR `#789`; if the branch is ready to leave draft, decide whether to mark it ready for review and/or explicitly trigger CodeRabbit so the pending status context no longer blocks remote readiness.
- Verification gap: no new local verification was necessary this turn because there were no code changes; remote CI is green, but PR `#789` still reports `mergeStateStatus=UNSTABLE` because the `CodeRabbit` status context is pending on the draft PR. `.codex-supervisor/replay/` remains untracked and untouched.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/config.test.ts`, `src/core/config.ts`, `src/core/types.ts`, `src/doctor.test.ts`, `src/doctor.ts`, `src/github/github-pull-request-hydrator.test.ts`, `src/github/github.test.ts`, `src/github/github.ts`, `src/pull-request-state-test-helpers.ts`, `src/review-handling.test.ts`, `src/run-once-issue-preparation.test.ts`, `src/run-once-issue-selection.test.ts`, `src/supervisor/replay-corpus-config.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-selection-readiness-summary.ts`, `src/supervisor/supervisor-status-report.ts`, `src/supervisor/supervisor-test-helpers.ts`, `src/supervisor/supervisor.ts`, `src/turn-execution-test-helpers.ts`, `src/codex/codex-policy.test.ts`, `src/codex/codex-runner.test.ts`
- Rollback concern: removing the explicit fetch-window config or the new top-level diagnostics line would return candidate discovery behavior to an implicit hard-coded detail and hide the effective first-page-only scope from operators.
- Last focused command: `gh pr view 789 --json url,isDraft,mergeStateStatus,reviewDecision,statusCheckRollup,comments,reviews`
- Last focused failure: `none`
- Last focused commands:
```bash
gh pr view 789 --json url,isDraft,mergeStateStatus,reviewDecision,statusCheckRollup,comments,reviews
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
