# Issue #937: Stale already-landed convergence misclassifies replay artifacts and blocks issue #924

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/937
- Branch: codex/issue-937
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 5 (implementation=1, repair=4)
- Last head SHA: 0d1f45dba04b28dd42e4db96e63b5046a9f35745
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852b5OS
- Repeated failure signature count: 1
- Updated at: 2026-03-24T14:21:10.682Z

## Latest Codex Summary
Removed the unsafe `.trim()` calls from porcelain `-z` path parsing in [supervisor.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-937/src/supervisor/supervisor.ts#L200) and added a regression for a leading-space replay-like path in [supervisor-stale-no-pr-branch-state.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-937/src/supervisor/supervisor-stale-no-pr-branch-state.test.ts#L214). I pushed the fix on `codex/issue-937`, then resolved the last open CodeRabbit thread on PR `#945`.

Current PR head is `0d1f45dba04b28dd42e4db96e63b5046a9f35745`. All review threads are resolved, but GitHub restarted CI on that head, so `CodeRabbit`, `build (ubuntu-latest)`, and `build (macos-latest)` are pending again. I updated the issue journal locally to reflect that post-push state and left it uncommitted so CI does not get retriggered yet; the worktree also still has the expected untracked `.codex-supervisor/replay/` directory.

Summary: Removed porcelain-path trimming, added a whitespace regression, pushed the review fix, resolved the last review thread, and PR #945 is now waiting on rerun CI
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npm run build`
Next action: Recheck PR #945 after the pending CodeRabbit and build jobs finish on head `0d1f45dba04b28dd42e4db96e63b5046a9f35745`; if they stay green and no new review appears, it is ready for merge
Failure signature: PRRT_kwDORgvdZ852b5OS

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/945#discussion_r2981868286
- Details:
  - .codex-supervisor/issue-journal.md:17 _⚠️ Potential issue_ | _🟡 Minor_ **Fix markdownlint MD038 for the leading-space filename example.** CodeRabbit flagged a journal sentence that used a literal leading-space code span for the replay-like filename example. The required fix is to render the filename with a visible-space marker, for example `␠.codex-supervisor/replay/...`, so the example still shows the leading whitespace without triggering MD038.

## Codex Working Notes
### Current Handoff
- Hypothesis: the code and review work for issue #937 is done; only the rerun checks on head `0d1f45d` need to settle.
- What changed: removed `.trim()` from `parseGitStatusPorcelainV1Paths()` in [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts) so leading/trailing whitespace in filenames is preserved; added a regression in [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts) covering an untracked path that starts with a space and visually resembles `.codex-supervisor/replay/...`; committed and pushed the fix as `a3868a0`; resolved the last open CodeRabbit review thread; then pushed the journal refresh as `0d1f45d`.
- Current blocker: none.
- Next exact step: recheck PR #945 once the pending `CodeRabbit` and build jobs finish on head `0d1f45d`.
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
