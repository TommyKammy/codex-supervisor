# Issue #513: External-review misses: reuse follow-up action reasoning in explain diagnostics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/513
- Branch: codex/issue-513
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-513
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-513/.codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: fcd29449abc8129dce74a30408432c982096fea4
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851Bh3U|PRRT_kwDORgvdZ851Bh3e
- Repeated failure signature count: 1
- Updated at: 2026-03-18T10:07:00+09:00

## Latest Codex Summary
Pushed review-fix commit `a90c2db` to [PR #520](https://github.com/TommyKammy/codex-supervisor/pull/520). `explain` now builds `external_review_follow_up` directly from the tracked record plus a best-effort PR head lookup in [src/supervisor/supervisor-selection-status.ts](../src/supervisor/supervisor-selection-status.ts), so missing `getChecks` or unresolved-thread APIs no longer suppress the shared digest-backed summary. The explain regression in [src/supervisor/supervisor-diagnostics-explain.test.ts](../src/supervisor/supervisor-diagnostics-explain.test.ts) now omits those unrelated GitHub stubs to lock the behavior in.

I also rewrote the live journal summary links to repo-relative paths in [.codex-supervisor/issue-journal.md](issue-journal.md), then resolved the two CodeRabbit review threads after the push. Focused verification passed with `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-diagnostics-external-review-follow-up.test.ts` and `npm run build`. The only remaining workspace noise is the pre-existing untracked `.codex-supervisor/replay/`.

Summary: Pushed the explain follow-up review fix, tightened the focused regression, fixed the journal links, and resolved both bot review threads on PR #520.
State hint: pr_open
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-diagnostics-external-review-follow-up.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor PR #520 for any fresh review or CI follow-up after the `a90c2db` review-fix push.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `explain` should not synthesize its own external-review miss narrative; when a tracked issue has a current-head follow-up digest, it should surface the same compact digest-backed summary that `status` already trusts.
- What changed: `buildExplainExternalReviewFollowUpSummary()` now bypasses `loadActiveIssueStatusSnapshot()` and calls the shared digest renderer directly using the tracked record plus a best-effort PR head SHA, the explain regression no longer stubs `resolvePullRequestForBranch`/`getChecks`/`getUnresolvedReviewThreads`, the live latest-summary journal links are repo-relative, and the two CodeRabbit review threads were resolved after the `a90c2db` push.
- Current blocker: none
- Next exact step: monitor PR #520 for any new review or CI follow-up after the resolved-thread push.
- Verification gap: none locally after rerunning the focused explain/follow-up suites and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `src/supervisor/supervisor-selection-status.ts`
- Rollback concern: if `explain` stops reusing the shared follow-up summary, operators get divergent miss-to-prevention stories between `status` and `explain`, which is the regression this issue closes.
- Last focused command: `npm run build`
### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
- 2026-03-18 (JST): Pushed review-fix commit `a90c2db` to `origin/codex/issue-513` and resolved CodeRabbit threads `PRRT_kwDORgvdZ851Bh3U` and `PRRT_kwDORgvdZ851Bh3e` with `gh api graphql`.
- 2026-03-18 (JST): Review repair: `buildExplainExternalReviewFollowUpSummary()` no longer depends on `loadActiveIssueStatusSnapshot()` or `getChecks`/`getUnresolvedReviewThreads`; the explain regression now omits those stubs, and focused explain/follow-up tests plus `npm run build` passed.
- 2026-03-18 (JST): Focused reproducer first failed in `src/external-review/external-review-miss-artifact.test.ts` because missed findings in the artifact had `preventionTarget: undefined`; failure signature: `missing-prevention-target`.
- 2026-03-18 (JST): Deterministic target precedence is `issue_comment -> issue_template`, `top_level_review -> review_prompt`, severe anchored `review_thread` misses -> `durable_guardrail`, regression-qualified `review_thread` misses -> `regression_test`, otherwise `review_prompt`.
- 2026-03-18 (JST): `npm run build` initially failed with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain and the rerun passed.
- 2026-03-18 (JST): Added a focused reproducer in `src/external-review/external-review-miss-persistence.test.ts`; it first failed with `ENOENT` for `external-review-misses-head-deadbeefcafe.md`, yielding failure signature `missing-follow-up-digest`.
- 2026-03-18 (JST): `external-review-miss-digest.ts` now persists an adjacent markdown digest with `current-head` vs `stale-head` metadata, prevention-target grouping, and one deterministic recommended next action per missed finding.
- 2026-03-18 (JST): Review repair: `buildExternalReviewMissFollowUpDigest` now throws if any `missed_by_local_review` finding reaches the digest without a prevention target, and the new artifact test locks that invariant in place.
- 2026-03-18 (JST): Pushed `codex/issue-511`, retried `gh pr create` after the initial race with branch publication, and opened draft PR #518. Current GitHub check state is `UNSTABLE` only because CI jobs are still queued.
- 2026-03-18 (JST): Pushed review-fix commit `c7b7a45` and resolved CodeRabbit threads `PRRT_kwDORgvdZ851BC62` and `PRRT_kwDORgvdZ851BC67` after focused verification passed.
- 2026-03-18 (JST): Added `src/supervisor/supervisor-diagnostics-external-review-follow-up.test.ts`; the first focused run failed because `status` emitted only `external_review_misses_path` and no compact follow-up summary, yielding failure signature `missing-status-follow-up-summary`.
- 2026-03-18 (JST): `status` now parses the adjacent external-review follow-up digest, emits `external_review_follow_up unresolved=... actions=...` only for `current-head`, and ignores `stale-head` digests.
- 2026-03-18 (JST): Focused external-review/status tests passed before build, then `npm run build` failed once with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain and the rerun passed.
- 2026-03-18 (JST): Reran `npx tsx --test src/external-review/external-review-miss-persistence.test.ts src/supervisor/supervisor-diagnostics-external-review-follow-up.test.ts src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts` and `npm run build`; both passed on commit `dcb4c41`.
- 2026-03-18 (JST): Pushed `codex/issue-512` and opened draft PR #519 (`https://github.com/TommyKammy/codex-supervisor/pull/519`).
- 2026-03-18 (JST): Review repair: `buildExternalReviewFollowUpStatusLine()` now requires the live head SHA plus digest SHAs to match `external_review_head_sha` before surfacing follow-up debt, the stale-head reproducer now uses mismatched digest/live SHAs and asserts on the emitted token, and the issue journal paths were rewritten to repo-relative form.
- 2026-03-18 (JST): Verified review repairs with `npx tsx --test src/external-review/external-review-miss-persistence.test.ts src/supervisor/supervisor-diagnostics-external-review-follow-up.test.ts src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts` and `npm run build`.
- 2026-03-18 (JST): Added `src/supervisor/supervisor-diagnostics-explain.test.ts` coverage for a current-head actionable follow-up digest; the first focused run failed because `explain` returned only selection fields and omitted `external_review_follow_up`, yielding failure signature `missing-explain-follow-up-summary`.
- 2026-03-18 (JST): `buildIssueExplainSummary()` now reuses `loadActiveIssueStatusSnapshot()` to append the same digest-backed `external_review_follow_up unresolved=... actions=...` line that `status` emits when the GitHub client can resolve active review state.
- 2026-03-18 (JST): `npm run build` first failed with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain, the rerun passed, and the focused explain/follow-up suites stayed green after the typing fix.
- 2026-03-18 (JST): Pushed `codex/issue-513` to `origin`, opened draft PR #520 (`https://github.com/TommyKammy/codex-supervisor/pull/520`), and confirmed the initial PR state is `UNSTABLE` only because the CI build jobs are still running.
