# Issue #1416: Publish sticky tracked-PR status comments for draft and ready-promotion blockers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1416
- Branch: codex/issue-1416
- Workspace: .
- Journal: .codex-supervisor/issues/1416/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 2753ceff05a151fa2fc9ce85ac3695a53aa40807
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856QtdC
- Repeated failure signature count: 1
- Updated at: 2026-04-11T00:20:54Z

## Latest Codex Summary
I re-checked the live PR review state with the `gh-address-comments` GraphQL helper and confirmed the only unresolved review thread on [#1420](https://github.com/TommyKammy/codex-supervisor/pull/1420) is the missing create-path assertion for the sticky tracked-PR status marker. The comment was valid: the draft-suppression test verified the message body but did not assert the appended `kind=status` marker that later dedupe and update paths depend on.

I added that missing assertion in [src/post-turn-pull-request.test.ts](src/post-turn-pull-request.test.ts), kept production code unchanged, and reran the focused test file successfully.

Summary: Added the missing `kind=status` create-path assertion to the draft-suppression test and reverified the modified test file.
State hint: addressing_review
Blocked reason: none
Tests: `python3 /home/tommy/.codex/plugins/cache/openai-curated/github/fb0a18376bcd9f2604047fbe7459ec5aed70c64b/skills/gh-address-comments/scripts/fetch_comments.py`; `npx tsx --test src/post-turn-pull-request.test.ts`
Next action: Let the supervisor refresh PR #1420 review state and confirm the automated thread is cleared or outdated on the new head.
Failure signature: none

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1420#discussion_r3067219031
- Details:
  - src/post-turn-pull-request.test.ts:1727 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Assert the sticky marker on the create path.** This test verifies the suppression body, but it would still pass if freshly added comments sto... url=https://github.com/TommyKammy/codex-supervisor/pull/1420#discussion_r3067219031

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining automated review feedback is a valid test-coverage gap only; production behavior is already correct, but the create path for draft-suppression comments was not asserting the sticky `kind=status` marker.
- What changed: Confirmed PR #1420 has one unresolved review thread, added the missing `kind=status` assertion to the draft-suppression test, reran `npx tsx --test src/post-turn-pull-request.test.ts` successfully, and prepared the review-fix checkpoint for PR update.
- Current blocker: none
- Next exact step: Push the review-fix checkpoint on `codex/issue-1416`, then let the supervisor re-read PR #1420 review state.
- Verification gap: none for the targeted review fix; the modified test file passed locally after the assertion was added.
- Files touched: src/post-turn-pull-request.test.ts; .codex-supervisor/issues/1416/issue-journal.md
- Rollback concern: Existing legacy `kind=host-local-blocker` comments are migrated opportunistically by updating either marker kind in place; removing that compatibility path would strand older sticky comments.
- Last focused command: npx tsx --test src/post-turn-pull-request.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
