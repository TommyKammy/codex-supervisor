# Issue #1415: Add sticky tracked-PR status comment publisher abstraction

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1415
- Branch: codex/issue-1415
- Workspace: .
- Journal: .codex-supervisor/issues/1415/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 0735f41c63a1e8b31932bb0fa461d416e0bbc968
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856QkMo|PRRT_kwDORgvdZ856QkMt
- Repeated failure signature count: 1
- Updated at: 2026-04-10T23:49:51.845Z

## Latest Codex Summary
Addressed both open CodeRabbit findings on PR [#1419](https://github.com/TommyKammy/codex-supervisor/pull/1419) without widening scope. The tracked-PR sticky comment update path now uses a REST-compatible issue-comment `databaseId` from the GraphQL review surface, and owned-comment reuse now requires `viewerDidAuthor` so a copied marker on someone else's comment falls back to posting a fresh supervisor-owned sticky comment instead of attempting an unauthorized update.

Focused verification passed cleanly after the review fix: `npx tsx --test src/github/github.test.ts src/post-turn-pull-request.test.ts` and `npm run build`. I also added regression coverage for both the numeric update path and the uneditable-marker fallback before updating this journal.

Summary: Fixed the tracked-PR sticky comment review findings by using comment database IDs and editable-only ownership checks
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/github/github.test.ts src/post-turn-pull-request.test.ts`; `npm run build`
Next action: commit the review fix, push `codex/issue-1415`, and update PR #1419 for another review pass
Failure signature: PRRT_kwDORgvdZ856QkMo|PRRT_kwDORgvdZ856QkMt

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1419#discussion_r3067169661
- Details:
  - src/github/github-mutations.ts:143 summary=_⚠️ Potential issue_ | _🔴 Critical_ 🧩 Analysis chain 🏁 Script executed: Repository: TommyKammy/codex-supervisor Length of output: 3906 --- **Query `databaseId` for PR issue c... url=https://github.com/TommyKammy/codex-supervisor/pull/1419#discussion_r3067169661
  - src/post-turn-pull-request.ts:231 summary=_⚠️ Potential issue_ | _🟠 Major_ **Don't treat marker-only matches as "owned" comments.** `findOwnedTrackedPrStatusComment()` matches any PR conversation comment that contains ... url=https://github.com/TommyKammy/codex-supervisor/pull/1419#discussion_r3067169666

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining review blockers were real. The restart-safe sticky-comment update path was using GraphQL node IDs against a REST PATCH endpoint, and marker-only matching could select comments the current actor could not edit.
- What changed: Extended the PR comment review surface to include `databaseId` and `viewerDidAuthor`, changed `GitHubClient.updateIssueComment()` to require the numeric database ID, and tightened tracked-PR sticky comment reuse so only editable marked comments are reused. Added a regression test for update-via-databaseId and another for the fallback create path when a marker exists on an uneditable comment.
- Current blocker: none.
- Next exact step: commit and push the review fix, then refresh PR #1419 so the unresolved automated threads can be re-evaluated.
- Verification gap: none for the scoped issue verification; broader full-suite coverage not run this turn.
- Files touched: src/github/github.ts; src/github/github-mutations.ts; src/github/github.test.ts; src/post-turn-pull-request.ts; src/post-turn-pull-request.test.ts
- Rollback concern: The marker format now defines ownership for tracked PR host-local blocker comments; changing it later would strand older sticky comments unless migration or fallback matching is added.
- Last focused command: `npm run build`
### Scratchpad
- 2026-04-11: Focused commands run for the review fix: `npx tsx --test src/github/github.test.ts src/post-turn-pull-request.test.ts`; `npm run build`
