# Issue #512: External-review misses: surface unresolved follow-up actions in status output

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/512
- Branch: codex/issue-512
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-512
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-512/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 8012118f335233610bfac8d8effe6e60305ecdd5
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T00:09:45.908Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `status` should read the markdown follow-up digest adjacent to `external_review_misses_path`, surface only current-head unresolved actions, and ignore stale-head digests even when the miss artifact path remains on the record.
- What changed: added a focused `Supervisor.status()` reproducer for current-head vs stale-head follow-up digests, taught status snapshot/rendering code to parse digest head status and grouped action counts into a compact `external_review_follow_up` line, and extended nearby status rendering/model tests for the new summary line.
- Current blocker: none
- Next exact step: commit the status follow-up summary change on `codex/issue-512`, then open or update the branch PR if needed.
- Verification gap: none locally after rerunning focused external-review/status tests and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/external-review/external-review-miss-digest.ts`, `src/supervisor/supervisor-diagnostics-external-review-follow-up.test.ts`, `src/supervisor/supervisor-selection-status.ts`, `src/supervisor/supervisor-status-model-supervisor.test.ts`, `src/supervisor/supervisor-status-model.ts`, `src/supervisor/supervisor-status-rendering.test.ts`, `src/supervisor/supervisor-status-rendering.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: dropping the digest-backed status summary would put external-review learning debt back behind artifact inspection, defeating the operator-facing status requirement for this issue.
- Last focused command: `npx tsx --test src/external-review/external-review-miss-persistence.test.ts src/supervisor/supervisor-diagnostics-external-review-follow-up.test.ts src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts`
### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
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
