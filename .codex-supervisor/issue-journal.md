# Issue #937: Stale already-landed convergence misclassifies replay artifacts and blocks issue #924

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/937
- Branch: codex/issue-937
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: ce245115e0ecb8c7302516bd574a5ab243ac1177
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852bKqY|PRRT_kwDORgvdZ852bKqh
- Repeated failure signature count: 1
- Updated at: 2026-03-24T13:43:39Z

## Latest Codex Summary
Addressed both open automated review threads locally. The stale no-PR classifier in [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts) now reads `git status --porcelain=v1 -z` and only ignores a workspace-status entry when every path in that entry is supervisor-owned, which closes the replay-to-code rename gap. Added a focused regression in [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts) to keep replay-to-code renames classified as meaningful local changes, and scrubbed machine-local paths from [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md).

Focused verification passed on the local review-fix tree: `npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts` and `npm run build`. The only intentional local artifact remains the untracked `.codex-supervisor/replay/` directory.

Summary: Patched replay-artifact status parsing for rename safety, added a focused regression test, and removed machine-local journal paths.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npm run build`
Next action: Commit and push the review-fix branch update, then recheck PR #945 review threads and CI on the new head.
Failure signature: PRRT_kwDORgvdZ852bKqY|PRRT_kwDORgvdZ852bKqh

## Active Failure Context
- Category: review
- Summary: 2 automated review thread(s) addressed locally; PR #945 still needs the new head pushed and reevaluated.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/945#discussion_r2981612639
- Details:
  - .codex-supervisor/issue-journal.md: machine-local absolute links and command examples were rewritten as portable repo-relative references or plain filenames.
  - src/supervisor/supervisor.ts: workspace-status parsing now uses porcelain `-z` entries and only ignores replay/journal artifacts when every path in a rename/copy entry stays inside the supervisor-owned set; replay-to-code renames remain meaningful and keep the branch `recoverable`.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review risk was limited to workspace-status parsing for rename/copy entries and the checked-in journal's machine-local paths; both are now fixed locally and ready to push.
- What changed: switched stale no-PR workspace-status inspection in [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts) from line-based `git status --short` parsing to porcelain `-z` parsing; treat rename/copy entries as ignored only when every path involved is the issue journal or within `.codex-supervisor/replay/`; added a replay-to-code rename regression in [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts); replaced machine-local absolute links and memory-file command paths in [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md) with portable references.
- Current blocker: none.
- Next exact step: commit and push `codex/issue-937`, then recheck PR #945 so GitHub reevaluates the addressed review threads on the new head.
- Verification gap: none for the addressed review feedback; the targeted stale branch-state/orchestration tests and `npm run build` all pass after the parser change and journal scrub.
- Files touched: [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md), [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts), and [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts).
- Rollback concern: low; reverting this review-fix patch would reopen the replay-to-code rename false-negative and restore the non-portable journal paths, while leaving the original stale no-PR already-landed fix in a review-blocked state.
- Last focused command: `npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`
- Last focused failure: none; focused tests and `npm run build` both passed after the parser change.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/945
- Last focused commands:
```bash
sed -n '1,220p' .local/memory/TommyKammy-codex-supervisor/issue-937/AGENTS.generated.md
sed -n '1,220p' .local/memory/TommyKammy-codex-supervisor/issue-937/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
sed -n '380,500p' src/supervisor/supervisor.ts
sed -n '1,260p' src/supervisor/supervisor-stale-no-pr-branch-state.test.ts
npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
npm run build
rg -n '/home/' .codex-supervisor/issue-journal.md
git diff -- src/supervisor/supervisor.ts src/supervisor/supervisor-stale-no-pr-branch-state.test.ts .codex-supervisor/issue-journal.md
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
