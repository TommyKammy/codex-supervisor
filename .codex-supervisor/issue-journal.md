# Issue #457: CodeRabbit settled wait: add regression coverage for CI-green immediate-merge races

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/457
- Branch: codex/issue-457
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: e71bee58108618cc64ffc23d33fe13de27e268f1
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ850x8eI
- Repeated failure signature count: 1
- Updated at: 2026-03-17T07:32:38.341Z

## Latest Codex Summary
Addressed the remaining CodeRabbit review finding on PR #460 by sanitizing the committed journal metadata. The journal now uses repo-relative `Workspace` and `Journal` entries, and the saved review context no longer repeats absolute local paths with the username embedded.

No code or test fixtures changed in this turn. I left the existing focused verification results in place and limited this repair to the journal content that triggered the review thread.

Summary: Sanitized the issue journal to remove absolute local paths and prepared the branch for a small review-fix update on PR #460.
State hint: local_review_fix
Blocked reason: none
Tests: not run; journal-only review fix
Failure signature: none
Next action: Commit the journal-only review fix, push `codex/issue-457`, and resolve the remaining CodeRabbit thread on PR #460.

## Active Failure Context
- Category: review
- Summary: CodeRabbit flagged absolute local paths in the journal snapshot; the local fix replaces them with repo-relative values and removes repeated absolute-path text from the journal copy.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/460#discussion_r2944877540
- Details:
  - `.codex-supervisor/issue-journal.md` now records `Workspace: .` and `Journal: .codex-supervisor/issue-journal.md` so the committed journal is portable and does not expose local usernames.

## Codex Working Notes
### Current Handoff
- Hypothesis: CodeRabbit can emit later review-thread comments with missing `originalCommitOid`; those comments are still safe to treat as current-head activity only when a stronger CodeRabbit current-head observation already exists.
- What changed: Added focused review-signal and hydrator tests for weakly anchored CodeRabbit review comments, including a stale-head negative case; updated `inferConfiguredBotCurrentHeadObservedAt` to extend `currentHeadObservedAt` only for later CodeRabbit comments lacking `originalCommitOid` after a prior strong current-head observation. This turn also sanitized the issue journal metadata to remove absolute local paths called out in review.
- Current blocker: none
- Next exact step: Commit the journal-only review fix, push `codex/issue-457`, and resolve the remaining CodeRabbit thread on PR #460.
- Verification gap: none for the focused review-signal, pull-request-state, supervisor lifecycle, hydrator, and build checks requested by the issue; no additional verification is needed for this journal-only repair.
- Files touched: src/github/github-review-signals.ts; src/github/github-review-signals.test.ts; src/github/github-pull-request-hydrator.test.ts; .codex-supervisor/issue-journal.md
- Rollback concern: The weak-anchor extension is intentionally limited to CodeRabbit-authored review-thread comments that happen after a strong current-head observation; broadening that rule to other bots or comments without the prior observation would risk promoting stale history.
- Last focused command: rg -n '^- (Workspace|Journal):' .codex-supervisor/issue-journal.md
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproducing signature before the fix: `currentHeadObservedAt` stayed at the earlier summary-only current-head review and did not advance to a later CodeRabbit review-thread comment with `originalCommitOid: null`.
- Verification commands: `npx tsx --test src/github/github-review-signals.test.ts`; `npx tsx --test src/pull-request-state.test.ts`; `npx tsx --test src/supervisor/supervisor-lifecycle.test.ts`; `npm ci`; `npx tsx --test src/github/github-pull-request-hydrator.test.ts`; `npm run build`; `rg -n '^- (Workspace|Journal):' .codex-supervisor/issue-journal.md`.
