# Issue #511: External-review misses: emit a follow-up action digest from miss analysis

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/511
- Branch: codex/issue-511
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-511
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-511/.codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: b54a208be350910d87ff0d519da03bf0a7ebabfd
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851BC62|PRRT_kwDORgvdZ851BC67
- Repeated failure signature count: 1
- Updated at: 2026-03-17T23:59:24.669Z

## Latest Codex Summary
Draft PR #518 is open for `codex/issue-511`: https://github.com/TommyKammy/codex-supervisor/pull/518. I reran the focused external-review miss tests and `npm run build`, both passed, then pushed `b54a208` to `origin/codex/issue-511`.

I updated the issue journal with the PR state, commands run, and the next handoff. Local uncommitted paths are the journal update and the pre-existing `.codex-supervisor/replay/` scratch dir. GitHub currently shows the draft PR as `UNSTABLE` because the `build (ubuntu-latest)` and `build (macos-latest)` checks are still queued.

Summary: Published commit `b54a208` as draft PR #518 after rerunning focused tests and `npm run build`
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/external-review/external-review-miss-artifact.test.ts src/external-review/external-review-miss-persistence.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor draft PR #518 and address any CI failures or review feedback

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/518#discussion_r2950129045
- Details:
  - .codex-supervisor/issue-journal.md:37 _⚠️ Potential issue_ | _🟡 Minor_ **Minor readability polish in timeline bullets.** Line 36 and Line 37 begin with very similar phrasing; slight rewording would improve scanability. <details> <summary>🧰 Tools</summary> <details> <summary>🪛 LanguageTool</summary> [style] ~36-~36: Three successive sentences begin with the same word. Consider rewording the sentence or use a thesaurus to find a synonym. Context: ...local toolchain and the rerun passed. - 2026-03-18 (JST): Added a focused reproducer in `s... (ENGLISH_WORD_REPEAT_BEGINNING_RULE) --- [style] ~37-~37: Three successive sentences begin with the same word. Consider rewording the sentence or use a thesaurus to find a synonym. Context: ...ignature: `missing-follow-up-digest`. - 2026-03-18 (JST): Implemented `external-review-mis... (ENGLISH_WORD_REPEAT_BEGINNING_RULE) </details> </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md around lines 36 - 37, The two timeline bullets referencing src/external-review/external-review-miss-persistence.test.ts and the implementation of external-review-miss-digest.ts use near-identical opening phrasing; reword them for clearer scanability by varying sentence starters and tightening wording (e.g., start one bullet with the action "Added" and the other with "Implemented" or "Persisted" and condense the details about the ENOENT failure and the digest features), while keeping the artifact name external-review-misses-head-deadbeefcafe.md and the failure signature missing-follow-up-digest intact so the entries remain unambiguous. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/external-review/external-review-miss-digest.ts:88 _⚠️ Potential issue_ | _🟠 Major_ **Do not silently drop missed findings missing a prevention target.** Line 85-Line 88 currently excludes `missed_by_local_review` findings when `preventionTarget` is `null`, which can hide misses instead of surfacing an invariant break. <details> <summary>🔧 Proposed fix</summary> ```diff - const missedFindings = args.artifact.findings.filter( - (finding): finding is ExternalReviewArtifactFinding & { preventionTarget: ExternalReviewPreventionTarget } => - finding.classification === "missed_by_local_review" && finding.preventionTarget !== null, - ); + const missedFindings = args.artifact.findings.filter( + (finding) => finding.classification === "missed_by_local_review", + ); + const missesWithoutTarget = missedFindings.filter((finding) => finding.preventionTarget === null); + if (missesWithoutTarget.length > 0) { + throw new Error( + `Found ${missesWithoutTarget.length} missed finding(s) without a prevention target in ${args.artifactPath}`, + ); + } + const typedMissedFindings = missedFindings as Array< + ExternalReviewArtifactFinding & { preventionTarget: ExternalReviewPreventionTarget } + >; ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion const missedFindings = args.artifact.findings.filter( (finding) => finding.classification === "missed_by_local_review", ); const missesWithoutTarget = missedFindings.filter((finding) => finding.preventionTarget === null); if (missesWithoutTarget.length > 0) { throw new Error( `Found ${missesWithoutTarget.length} missed finding(s) without a prevention target in ${args.artifactPath}`, ); } const typedMissedFindings = missedFindings as Array< ExternalReviewArtifactFinding & { preventionTarget: ExternalReviewPreventionTarget } >; ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/external-review/external-review-miss-digest.ts` around lines 85 - 88, The current filter for missedFindings excludes findings with classification "missed_by_local_review" when preventionTarget is null, silently dropping them; change the predicate in the missedFindings assignment to only check finding.classification === "missed_by_local_review" so null preventionTarget values are preserved, then add explicit handling where missedFindings is consumed (e.g., in the function that processes missedFindings) to surface an invariant break—either by logging an error/warning including the finding details or throwing/returning a specific error when finding.preventionTarget === null; this keeps the type narrow where safe but ensures misses with null preventionTarget are not silently ignored (refer to the missedFindings variable and any consumers that assume preventionTarget). ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the follow-up digest should keep treating missing prevention targets as an invariant break, because silently dropping malformed missed findings would hide operator work that the digest is supposed to surface.
- What changed: tightened `external-review-miss-digest.ts` so every `missed_by_local_review` finding is inspected, the digest now throws if any missed finding arrives without a prevention target, added a focused regression test for that malformed-artifact path, and reworded the two scratchpad bullets that CodeRabbit flagged as repetitive.
- Current blocker: none
- Next exact step: push the review-fix commit to PR #518, resolve the addressed CodeRabbit threads, and watch for any follow-up review or CI movement.
- Verification gap: none locally after rerunning focused external-review artifact/persistence tests and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/external-review/external-review-miss-artifact.test.ts`, `src/external-review/external-review-miss-digest.ts`
- Rollback concern: removing the digest writer would leave the JSON artifact as the only miss-analysis output, forcing operators back to raw artifact inspection and dropping the deterministic next-action summary promised by this issue.
- Last focused command: `npx tsx --test src/external-review/external-review-miss-artifact.test.ts src/external-review/external-review-miss-persistence.test.ts`
### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
- 2026-03-18 (JST): Focused reproducer first failed in `src/external-review/external-review-miss-artifact.test.ts` because missed findings in the artifact had `preventionTarget: undefined`; failure signature: `missing-prevention-target`.
- 2026-03-18 (JST): Deterministic target precedence is `issue_comment -> issue_template`, `top_level_review -> review_prompt`, severe anchored `review_thread` misses -> `durable_guardrail`, regression-qualified `review_thread` misses -> `regression_test`, otherwise `review_prompt`.
- 2026-03-18 (JST): `npm run build` initially failed with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain and the rerun passed.
- 2026-03-18 (JST): Added a focused reproducer in `src/external-review/external-review-miss-persistence.test.ts`; it first failed with `ENOENT` for `external-review-misses-head-deadbeefcafe.md`, yielding failure signature `missing-follow-up-digest`.
- 2026-03-18 (JST): `external-review-miss-digest.ts` now persists an adjacent markdown digest with `current-head` vs `stale-head` metadata, prevention-target grouping, and one deterministic recommended next action per missed finding.
- 2026-03-18 (JST): Review repair: `buildExternalReviewMissFollowUpDigest` now throws if any `missed_by_local_review` finding reaches the digest without a prevention target, and the new artifact test locks that invariant in place.
- 2026-03-18 (JST): Pushed `codex/issue-511`, retried `gh pr create` after the initial race with branch publication, and opened draft PR #518. Current GitHub check state is `UNSTABLE` only because CI jobs are still queued.
