# Issue #1324: [codex] Make local-review follow-up issue creation advisory by default

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1324
- Branch: codex/issue-1324
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 7832804cbd8e4668199f7cc359fa3f4d12dd4106
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ855KwY5
- Repeated failure signature count: 1
- Updated at: 2026-04-07T02:54:50.880Z

## Latest Codex Summary
Published the existing checkpoint as draft PR [#1325](https://github.com/TommyKammy/codex-supervisor/pull/1325) from `codex/issue-1324` and updated the issue journal to reflect the published state and next step. No implementation changes were needed beyond the already-committed work in `7832804`; the worktree still has local supervisor artifacts and the journal modification as expected.

Summary: Pushed `codex/issue-1324`, opened draft PR #1325 for the verified checkpoint, and updated the issue journal with the published state.
State hint: draft_pr
Blocked reason: none
Tests: Not rerun this turn; existing verified checkpoint covers `npx tsx --test src/post-turn-pull-request.test.ts src/local-review/index.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts`; `npx tsx --test src/config.test.ts --test-name-pattern='default local review settings|follow-up issue creation opt-in'`; `npm run build`
Next action: Wait for CI/review on draft PR #1325 and address any feedback or failures.
Failure signature: PRRT_kwDORgvdZ855KwY5

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1325#discussion_r3042639080
- Details:
  - src/post-turn-pull-request.ts:263 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Strip legacy `Execution order:` lines from copied verification blocks.** Older source issues can still have `Execution order: ...` written di... url=https://github.com/TommyKammy/codex-supervisor/pull/1325#discussion_r3042639080

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining review thread is valid; the local patch now strips legacy inline `Execution order:` metadata from copied `## Verification` blocks so opt-in follow-up issues cannot carry stale scheduling metadata alongside the canonical `## Execution order` section.
- What changed: Extended `isIssueSchedulingMetadataLine` in `src/post-turn-pull-request.ts` to treat `Execution order:` as scheduling metadata using the same trimmed, case-insensitive matching path as the other inherited scheduling fields; tightened the opt-in follow-up issue test in `src/post-turn-pull-request.test.ts` so the source issue includes a legacy inline `Execution order: 1 of 1` line and the generated follow-up issue body is asserted not to preserve it.
- Current blocker: none
- Next exact step: Commit the review fix, push `codex/issue-1324`, and let PR #1325 pick up the updated head for re-review.
- Verification gap: none locally after rerunning the focused post-turn PR tests and a fresh build.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`
- Rollback concern: Low; the behavioral change is isolated to follow-up issue creation after local review and defaults fail closed to no GitHub mutation.
- Last focused commands: `npx tsx --test src/post-turn-pull-request.test.ts`; `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
