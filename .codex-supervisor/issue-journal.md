# Issue #512: External-review misses: surface unresolved follow-up actions in status output

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/512
- Branch: codex/issue-512
- Workspace: ./ (repo root)
- Journal: ./.codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 128102838e744838734c5a0f7798fa17709b7dca
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851BSWa|PRRT_kwDORgvdZ851BSWd|PRRT_kwDORgvdZ851BSWh
- Repeated failure signature count: 1
- Updated at: 2026-03-18T00:35:08.760Z

## Latest Codex Summary
Draft PR [#519](https://github.com/TommyKammy/codex-supervisor/pull/519) is open on `codex/issue-512`, backed by the implementation commit `dcb4c41` and the journal update commit `1281028`. The issue journal at [.codex-supervisor/issue-journal.md](./.codex-supervisor/issue-journal.md) now reflects the passing verification and PR state.

Local verification was green:
- `npx tsx --test src/external-review/external-review-miss-persistence.test.ts src/supervisor/supervisor-diagnostics-external-review-follow-up.test.ts src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts`
- `npm run build`

The only remaining local noise is untracked workspace data in `.codex-supervisor/replay/`, which I left untouched.

Summary: Pushed `codex/issue-512`, opened draft PR #519 for the status follow-up summary change, and updated the issue journal with the verified handoff state.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/external-review/external-review-miss-persistence.test.ts src/supervisor/supervisor-diagnostics-external-review-follow-up.test.ts src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor draft PR #519 and address any CI or review feedback that arrives.

## Active Failure Context
- Category: review
- Summary: 3 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/519#discussion_r2950210799
- Details:
  - .codex-supervisor/issue-journal.md: top-of-file workspace metadata and the latest journal self-link used machine-local absolute paths; switch them to `./`-style repo-relative paths so the committed journal stays portable for other contributors.
  - src/supervisor/supervisor-diagnostics-external-review-follow-up.test.ts:39 _⚠️ Potential issue_ | _🟠 Major_ **The stale-head regression test is a false positive.** Line 153 checks `/external_review_follow_up=/`, but the emitted line is `external_review_follow_up unresolved=...`, so this assertion still passes when the stale status leaks through. The fixture on Lines 29-32 also keeps the miss-analysis and active-head SHAs identical, which is not how `buildExternalReviewMissFollowUpDigest` represents a stale digest. <details> <summary>Suggested fix</summary> ```diff - assert.doesNotMatch(status, /external_review_follow_up=/); + assert.doesNotMatch(status, /\bexternal_review_follow_up\b/); ``` Also make the stale fixture write different miss-analysis and active-head SHA values so it mirrors the real digest format. </details> Also applies to: 99-153 <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/supervisor/supervisor-diagnostics-external-review-follow-up.test.ts` around lines 13 - 39, The test is a false positive because it asserts /external_review_follow_up=/ while the emitted line is "external_review_follow_up unresolved=...", and the stale fixture currently sets miss-analysis and active PR head SHAs identical; update the stale fixture in writeExternalReviewDigest (and any use of buildExternalReviewMissFollowUpDigest) so when headStatus === "stale-head" the miss-analysis head SHA and active PR head SHA are different (e.g., "deadbeefcafebabe" vs "feedfacecafef00d"), and change the test assertion to match the actual emitted token by asserting for "external_review_follow_up unresolved=" (or a regex like /external_review_follow_up\s+unresolved=/) instead of /external_review_follow_up=/ so the test fails when stale status leaks through. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/supervisor/supervisor-status-rendering.ts:235 _⚠️ Potential issue_ | _🟠 Major_ **Filter the digest against the live head before treating it as actionable.** Line 220 only trusts the digest's serialized `headStatus`, but that value is frozen when the digest is written. After a new commit, an old digest can still say `current-head` and keep surfacing stale follow-up debt in `status`. `buildDurableGuardrailStatusLine` already does a live-head check on Lines 141-145; this helper needs the same guard. <details> <summary>Suggested direction</summary> ```diff export async function buildExternalReviewFollowUpStatusLine(args: { - activeRecord: Pick<IssueRunRecord, "external_review_misses_path">; + activeRecord: Pick< + IssueRunRecord, + "external_review_misses_path" | "external_review_head_sha" | "last_head_sha" + >; + currentHeadSha: string | null; }): Promise<string | null> { const missesPath = args.activeRecord.external_review_misses_path; if (!missesPath) { return null; } + + const currentHeadSha = args.currentHeadSha ?? args.activeRecord.last_head_sha; + if (!currentHeadSha || args.activeRecord.external_review_head_sha !== currentHeadSha) { + return null; + } ``` Then pass `pr?.headRefOid ?? args.activeRecord.last_head_sha` from `src/supervisor/supervisor-selection-status.ts`. </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/supervisor/supervisor-status-rendering.ts` around lines 201 - 235, buildExternalReviewFollowUpStatusLine currently trusts summary.headStatus from the on-disk digest and can surface stale follow-ups; update it to perform the same live-head check as buildDurableGuardrailStatusLine by comparing the digest's recorded head to the repository's current head before treating it as actionable. Modify buildExternalReviewFollowUpStatusLine to accept (or compute) the live head SHA (use the value passed from supervisor-selection-status: pr?.headRefOid ?? args.activeRecord.last_head_sha), and after reading parseExternalReviewMissFollowUpDigest(digest) verify the digest head matches that live head SHA (and only proceed if they match and summary.headStatus === "current-head"). Keep existing ENOENT behavior and the actionCounts logic intact (functions/ids to locate: buildExternalReviewFollowUpStatusLine, parseExternalReviewMissFollowUpDigest, externalReviewMissFollowUpDigestPath, and the caller in supervisor-selection-status). ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the compact `external_review_follow_up` status line is only actionable when the record head, live head, and digest head metadata all agree on the current PR head; stale digests and stale record pointers must be suppressed even if the digest still says `current-head`.
- What changed: parsed miss-analysis and active-PR head SHAs out of the follow-up digest, gated `buildExternalReviewFollowUpStatusLine()` on a live head SHA from `supervisor-selection-status`, tightened the stale-head status reproducer to use mismatched digest SHAs plus a real token-level assertion, and sanitized the tracked journal paths to repo-relative form.
- Current blocker: none
- Next exact step: commit the review-fix patch, push `codex/issue-512`, and resolve the remaining PR #519 review threads.
- Verification gap: none locally after rerunning the focused external-review/status tests and `npm run build`.
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
- 2026-03-18 (JST): Reran `npx tsx --test src/external-review/external-review-miss-persistence.test.ts src/supervisor/supervisor-diagnostics-external-review-follow-up.test.ts src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts` and `npm run build`; both passed on commit `dcb4c41`.
- 2026-03-18 (JST): Pushed `codex/issue-512` and opened draft PR #519 (`https://github.com/TommyKammy/codex-supervisor/pull/519`).
- 2026-03-18 (JST): Review repair: `buildExternalReviewFollowUpStatusLine()` now requires the live head SHA plus digest SHAs to match `external_review_head_sha` before surfacing follow-up debt, the stale-head reproducer now uses mismatched digest/live SHAs and asserts on the emitted token, and the issue journal paths were rewritten to repo-relative form.
- 2026-03-18 (JST): Verified review repairs with `npx tsx --test src/external-review/external-review-miss-persistence.test.ts src/supervisor/supervisor-diagnostics-external-review-follow-up.test.ts src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts` and `npm run build`.
