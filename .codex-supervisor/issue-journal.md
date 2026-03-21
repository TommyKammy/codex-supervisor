# Issue #768: Waiting PR recheck cadence: reevaluate waiting_ci faster after provider progress

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/768
- Branch: codex/issue-768
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 880f1c09c0ed7b9dc52e4608c522547e348a7348
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8514M_B|PRRT_kwDORgvdZ8514M_E
- Repeated failure signature count: 1
- Updated at: 2026-03-21T10:50:30.017Z

## Latest Codex Summary
Implemented the `waiting_ci` recheck change and opened draft PR [#772](https://github.com/TommyKammy/codex-supervisor/pull/772). The loop now re-evaluates cadence before each sleep, and the active issue only gets the faster merge-critical cadence when it is in `waiting_ci` with fresh current-head PR/provider progress; other states keep the normal poll interval.

Focused coverage was added in [src/supervisor/supervisor-lifecycle.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-768/src/supervisor/supervisor-lifecycle.ts), [src/supervisor/supervisor-lifecycle.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-768/src/supervisor/supervisor-lifecycle.test.ts), [src/supervisor/supervisor.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-768/src/supervisor/supervisor.ts), and [src/cli/supervisor-runtime.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-768/src/cli/supervisor-runtime.ts), with runtime regression coverage in [src/cli/supervisor-runtime.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-768/src/cli/supervisor-runtime.test.ts). I also updated the issue journal and pushed commits `492e19b` and `880f1c0`. The only remaining workspace change is the pre-existing untracked `.codex-supervisor/replay/` artifact.

Summary: Added a `waiting_ci`-specific fast recheck path for fresh PR/provider progress, refreshed loop cadence between cycles, verified locally, and opened draft PR #772
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-lifecycle.test.ts`; `npx tsx --test src/cli/supervisor-runtime.test.ts`; `npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts src/supervisor/supervisor-lifecycle.test.ts`; `npm run build`
Failure signature: none
Next action: Watch PR #772 CI and address any review or verification feedback if it appears

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/772#discussion_r2969439187
- Details:
  - src/cli/supervisor-runtime.ts:168 _⚠️ Potential issue_ | _🟠 Major_ **Re-check `shouldStop` after awaiting the cadence.** Line 165 adds a new async gap. If `SIGTERM` lands while `service.pollIntervalMs()` is pending, the handler flips `shouldStop` before `sleepController` exists, but Lines 166-167 still start a fresh sleep and delay shutdown by a full interval. <details> <summary>💡 Proposed fix</summary> ```diff if (!shouldStop) { const pollIntervalMs = await service.pollIntervalMs(); + if (shouldStop) { + break; + } sleepController = new AbortController(); - await sleep(pollIntervalMs, sleepController.signal); - sleepController = null; + try { + await sleep(pollIntervalMs, sleepController.signal); + } finally { + sleepController = null; + } } ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion const pollIntervalMs = await service.pollIntervalMs(); if (shouldStop) { break; } sleepController = new AbortController(); try { await sleep(pollIntervalMs, sleepController.signal); } finally { sleepController = null; } ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/cli/supervisor-runtime.ts` around lines 165 - 168, After awaiting service.pollIntervalMs() there's an async gap where shouldStop can be set by SIGTERM; re-check shouldStop immediately after the await and before creating a new AbortController or calling sleep. Concretely, inside the loop around service.pollIntervalMs() add an if (shouldStop) return/continue check after the await so you skip creating sleepController and calling sleep when shutdown has been requested; refer to the symbols service.pollIntervalMs(), shouldStop, sleepController, AbortController and sleep to locate and modify the logic. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/supervisor/supervisor-lifecycle.ts:50 _⚠️ Potential issue_ | _🟡 Minor_ **Require an actual head-SHA match before using the fast cadence.** Line 50 currently treats missing `*_head_sha` values as matches. That lets headless or legacy `provider_success_observed_at` / `review_wait_started_at` / `copilot_review_requested_observed_at` timestamps unlock the shorter `waiting_ci` interval even though they are not proven to belong to the current head. <details> <summary>💡 Proposed fix</summary> ```diff function progressMatchesCurrentHead( progressHeadSha: string | null | undefined, record: Pick<IssueRunRecord, "last_head_sha">, ): boolean { - return progressHeadSha === null || progressHeadSha === undefined || record.last_head_sha === null || progressHeadSha === record.last_head_sha; + return typeof record.last_head_sha === "string" && + typeof progressHeadSha === "string" && + progressHeadSha === record.last_head_sha; } ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/supervisor/supervisor-lifecycle.ts` around lines 46 - 50, The helper progressMatchesCurrentHead currently treats null/undefined progressHeadSha or record.last_head_sha as matches, which incorrectly allows fast cadence for headless/legacy events; change the logic in progressMatchesCurrentHead to require both progressHeadSha and record.last_head_sha to be non-null/defined and then compare them (i.e., return progressHeadSha !== null && progressHeadSha !== undefined && record.last_head_sha !== null && progressHeadSha === record.last_head_sha) so only an actual head-SHA equality enables the fast cadence. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining PR review feedback is valid and limited to two edge cases in the new cadence work: shutdown during the async cadence lookup gap, and headless legacy progress timestamps incorrectly qualifying for the faster `waiting_ci` cadence.
- What changed: re-checked `shouldStop` immediately after awaiting `service.pollIntervalMs()` and wrapped loop sleep cleanup in `finally`; tightened `progressMatchesCurrentHead` so fast cadence requires a real current-head SHA match; and added focused regressions for both cases.
- Current blocker: none
- Next exact step: commit and push the review fixes to PR `#772`, then resolve the automated review threads if no new feedback appears.
- Verification gap: none in the focused suites; `.codex-supervisor/replay/` remains untracked and untouched.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/cli/supervisor-runtime.test.ts`, `src/cli/supervisor-runtime.ts`, `src/supervisor/supervisor-lifecycle.test.ts`, `src/supervisor/supervisor-lifecycle.ts`
- Rollback concern: loosening the SHA guard again would let stale/headless progress accelerate `waiting_ci`, while dropping the post-await stop check would reintroduce delayed shutdowns during cadence lookup.
- Last focused command: `npm run build`
- Last focused failure: `review:PRRT_kwDORgvdZ8514M_B|PRRT_kwDORgvdZ8514M_E`
- Last focused commands:
```bash
npx tsx --test src/cli/supervisor-runtime.test.ts
npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts src/supervisor/supervisor-lifecycle.test.ts
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
