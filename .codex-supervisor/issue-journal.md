# Issue #937: Stale already-landed convergence misclassifies replay artifacts and blocks issue #924

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/937
- Branch: codex/issue-937
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=1, repair=3)
- Last head SHA: a3868a04349afbfe5bfd9b9faade6025a4011c70
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-24T14:04:08Z

## Latest Codex Summary
Verified the remaining CodeRabbit thread on [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts) was still valid on head `0ad332a`, because `parseGitStatusPorcelainV1Paths()` trimmed NUL-delimited porcelain path fields. Removed those `.trim()` calls so `git status --porcelain=v1 -z` paths stay byte-for-byte intact, and added a regression in [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts) that creates an untracked path named ` .codex-supervisor/replay/...` to prove leading whitespace is preserved and still treated as a meaningful workspace change.

Committed as `a3868a0` (`Preserve porcelain paths verbatim`), pushed to `origin/codex/issue-937`, and resolved CodeRabbit thread `PRRT_kwDORgvdZ852bn9D` after confirming it was outdated on the new head. PR `#945` now reports head `a3868a04349afbfe5bfd9b9faade6025a4011c70`, `mergeStateStatus=CLEAN`, all three review threads resolved, and both required build checks passing.

Summary: Removed unsafe trimming from porcelain `-z` path parsing, added a whitespace regression, pushed `a3868a0`, and cleared the remaining review thread on PR #945.
State hint: pr_open
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npm run build`
Next action: Monitor PR #945 for any fresh review activity; otherwise it is ready for merge.
Failure signature: none

## Active Failure Context
- Category: review
- Summary: No unresolved automated review threads remain on PR #945.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/945
- Details:
  - Resolved thread `PRRT_kwDORgvdZ852bn9D` after pushing `a3868a0`, which removes the porcelain-path `.trim()` calls and adds the leading-whitespace regression.
  - Current PR state: `mergeStateStatus=CLEAN`, head `a3868a04349afbfe5bfd9b9faade6025a4011c70`, review threads `PRRT_kwDORgvdZ852bKqY`, `PRRT_kwDORgvdZ852bKqh`, and `PRRT_kwDORgvdZ852bn9D` all resolved, required checks `build (ubuntu-latest)` and `build (macos-latest)` passing.

## Codex Working Notes
### Current Handoff
- Hypothesis: the review queue for issue #937 is clear; only new reviewer activity or merge handling should require follow-up.
- What changed: removed `.trim()` from `parseGitStatusPorcelainV1Paths()` in [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts) so leading/trailing whitespace in filenames is preserved; added a regression in [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts) covering an untracked path that starts with a space and visually resembles `.codex-supervisor/replay/...`; committed and pushed as `a3868a0`; resolved the last open CodeRabbit review thread.
- Current blocker: none.
- Next exact step: watch PR #945 for any new review comments or merge activity; no local code change is pending.
- Verification gap: none for the addressed review feedback; the targeted stale branch-state/orchestration tests and `npm run build` pass after removing the trim calls and adding the whitespace regression.
- Files touched: [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md), [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts), and [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts).
- Rollback concern: low; reverting this patch would reintroduce incorrect pathname normalization for porcelain `-z` output and reopen the false ignore path where a leading-space filename can masquerade as a supervisor-owned replay artifact.
- Last focused command: `npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`
- Last focused failure: none; focused tests and `npm run build` both passed after the parser change.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/945
- Last focused commands:
```bash
sed -n '1,220p' .local/memory/TommyKammy-codex-supervisor/issue-937/AGENTS.generated.md
sed -n '1,220p' .local/memory/TommyKammy-codex-supervisor/issue-937/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
sed -n '180,250p' src/supervisor/supervisor.ts
sed -n '1,260p' src/supervisor/supervisor-stale-no-pr-branch-state.test.ts
gh pr view 945 --json headRefOid,mergeStateStatus,reviewDecision,isDraft,comments,reviews
date -Iseconds -u
git diff -- src/supervisor/supervisor.ts src/supervisor/supervisor-stale-no-pr-branch-state.test.ts .codex-supervisor/issue-journal.md
npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
npm run build
git add src/supervisor/supervisor.ts src/supervisor/supervisor-stale-no-pr-branch-state.test.ts .codex-supervisor/issue-journal.md
git commit -m "Preserve porcelain paths verbatim"
git push origin codex/issue-937
gh api graphql -f query='query { repository(owner:"TommyKammy", name:"codex-supervisor") { pullRequest(number:945) { reviewThreads(first:20) { nodes { id isResolved comments(first:10) { nodes { id url body path outdated } } } } } } }'
gh api graphql -f query='mutation { resolveReviewThread(input:{threadId:"PRRT_kwDORgvdZ852bn9D"}) { thread { id isResolved } } }'
gh pr view 945 --json headRefOid,mergeStateStatus,reviewDecision,isDraft
gh api graphql -f query='query { repository(owner:"TommyKammy", name:"codex-supervisor") { pullRequest(number:945) { reviewThreads(first:20) { nodes { id isResolved } } } } }'
gh pr checks 945
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
