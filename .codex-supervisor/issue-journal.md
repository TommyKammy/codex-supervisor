# Issue #507: Change-risk explainability: reuse the normalized risk decision in explain diagnostics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/507
- Branch: codex/issue-507
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-507
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-507/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: c1025d7bed1213ae9009e4923f8a465e227b16e1
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T22:52:35.679Z

## Latest Codex Summary
- Explain diagnostics now reuse the normalized change-risk status lines, including `verification_policy` for risky ambiguity blockers and both `change_classes` plus `verification_policy` for tracked blocked issues with deterministic changed files.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: explain-style diagnostics were still hand-assembling blocker text without the normalized change-risk summary, so piping explain through the existing status helpers should align operator-facing risk reasoning across status, execution policy, and explain.
- What changed: updated `src/supervisor/supervisor-selection-status.ts` so `buildIssueExplainSummary` loads the tracked workspace diff when available and emits the same `change_classes`/`verification_policy` summaries used by status; added focused regressions in `src/supervisor/supervisor-diagnostics-explain.test.ts` for a risky auth ambiguity blocker and a blocked docs-only tracked issue.
- Current blocker: none
- Next exact step: commit the explain change-risk reuse on `codex/issue-507`, then push the branch and open or update the draft PR for issue #507.
- Verification gap: none; `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts`, `npx tsx --test src/supervisor/supervisor-diagnostics.test.ts`, `npx tsx --test src/supervisor/supervisor-change-risk-status.test.ts src/issue-metadata/issue-metadata-change-risk-decision.test.ts`, and `npm run build` passed after restoring the local toolchain with `npm ci`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-selection-status.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`
- Rollback concern: reverting this change would put explain back on divergent ad hoc risk wording and drop deterministic changed-file policy context from blocked explain output.
- Last focused command: `npm run build`
### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
- 2026-03-18 (JST): Issue #507 now reuses the normalized change-risk status lines in explain diagnostics; focused reproducer first failed because explain omitted `verification_policy`/`change_classes`, then passed after wiring `buildIssueExplainSummary` through the shared status helpers. Verification: `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts`, `npx tsx --test src/supervisor/supervisor-diagnostics.test.ts`, `npx tsx --test src/supervisor/supervisor-change-risk-status.test.ts src/issue-metadata/issue-metadata-change-risk-decision.test.ts`, `npm ci`, `npm run build`.
- 2026-03-18 (JST): Review repair for PR #515 now renders tracked journal `Workspace`/`Journal` snapshot fields relative to the workspace root, adds a focused regression in `src/journal.test.ts`, and passes `npx tsx --test src/journal.test.ts` plus `npm run build`.
- 2026-03-18 (JST): Pushed `646ea24` (`Clear stale journal failure context`) to `origin/codex/issue-506` and resolved CodeRabbit thread `PRRT_kwDORgvdZ851ANbp` with `gh api graphql` after removing the stale copied failure context and restoring the inherited scratchpad tail.
- 2026-03-18 (JST): Local review repair for PR #515 removes the stale Active Failure Context copied from the resolved line-54 truncation report and restores the inherited scratchpad tail from `HEAD`; focused verification target is `git diff --check`.
- 2026-03-18 (JST): Committed and pushed `3a85dbe` (`Fix truncated journal scratchpad entry`) on `codex/issue-506`, restoring the inherited `#477` scratchpad tail plus the omitted follow-on notes and resolving CodeRabbit thread `PRRT_kwDORgvdZ851AJNQ`.
- 2026-03-18 (JST): Pushed `3458587` (`Explain verification policy in status`) to `origin/codex/issue-506` and opened draft PR #515 (`https://github.com/TommyKammy/codex-supervisor/pull/515`).
- 2026-03-18 (JST): Issue #506 now renders `verification_policy intensity=<...> driver=<source>:<classes>` in status output; focused coverage includes docs-only `changed_files` and stronger `issue_metadata` auth cases.
- 2026-03-18 (JST): Focused verification for #506 was `npx tsx --test src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-change-risk-status.test.ts`; `npm run build` initially failed with `sh: 1: tsc: not found`, `npm ci` restored the toolchain, and the rerun passed.
- 2026-03-18 (JST): Review repair for PR #508 normalized the tracked journal `Workspace`/`Journal` fields and new summary links to repo-relative paths, reduced the copied CodeRabbit failure context to a neutral summary, restored the truncated #477 scratchpad tail from `HEAD^`, and passed `git diff --check`.
- 2026-03-18 (JST): Committed `395a11c` (`Normalize change-risk decisions`), pushed `codex/issue-505`, and opened draft PR #508 (`https://github.com/TommyKammy/codex-supervisor/pull/508`).
- 2026-03-18 (JST): Added `summarizeChangeRiskDecision` so prompt/status consumers share one normalized risk decision with `issue_metadata` tie precedence, risky approval inputs, deterministic changed-file classes, and the resulting verification intensity.
- 2026-03-18 (JST): Focused reproducer for #505 was a new `issue-metadata-change-risk-decision` test asserting `auth` metadata plus docs/tests changed files should still resolve to `verificationIntensity=strong` with `higherRiskSource=issue_metadata`.
- 2026-03-18 (JST): `npm run build` first failed with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain, then the focused issue-metadata/prompt tests and `npm run build` both passed.
- 2026-03-18 (JST): Pushed `30b3066` (`Clarify journal scratchpad date basis`) to `origin/codex/issue-494` and resolved CodeRabbit thread `PRRT_kwDORgvdZ8508oYP` on PR #503 with `gh api graphql`.
- 2026-03-18 (JST): Review repair for PR #503 clarifies that scratchpad entries use the workspace-local date basis while the Supervisor Snapshot `Updated at` field remains UTC.
- 2026-03-18 (JST): `npm run build` initially failed with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain and the next `npm run build` passed.
- 2026-03-17: Pushed `codex/issue-478` to `origin` and opened draft PR #481 (`https://github.com/TommyKammy/codex-supervisor/pull/481`) after confirming there was no existing PR for the branch.
- 2026-03-17: Review repair for PR #481 adds the same per-bot removal guard to `draftSkipAt` that rate-limit warnings already used, plus a regression test for stale draft-skip comments after request removal.
- 2026-03-17: Cleaned the copied review-context links in this journal so they use repository-relative markdown targets instead of local `/home/...` paths.
- 2026-03-17: Repair verification for the stale draft-skip fix was `npx tsx --test src/github/github-review-signals.test.ts src/github/github-pull-request-hydrator.test.ts` and `npm run build`, both passing before commit `e7c4170`.
- 2026-03-17: Focused reproducer for #480 was `inferStateFromPullRequest` returning `ready_to_merge` instead of `waiting_ci` when `review_wait_started_at=2026-03-13T02:30:00Z`, `configuredBotDraftSkipAt=2026-03-13T02:25:00Z`, `currentHeadCiGreenAt=2026-03-13T02:05:00Z`, and no fresh CodeRabbit signal had arrived after ready-for-review.
- 2026-03-17: The fix reuses the refreshed review-wait window after ready-for-review for CodeRabbit draft-skip case
