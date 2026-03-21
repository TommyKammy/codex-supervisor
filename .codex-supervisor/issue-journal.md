# Issue #786: Backend commands MVP: expose only existing safe supervisor mutations over HTTP

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/786
- Branch: codex/issue-786
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=1, repair=3)
- Last head SHA: 6898b72ac3f9784bb64e3a5af5091f4a77d68074
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-21T19:41:57Z

## Latest Codex Summary
Updated `.codex-supervisor/issue-journal.md` to replace the remaining committed absolute filesystem link with the repo-relative target [src/backend/supervisor-http-server.test.ts](src/backend/supervisor-http-server.test.ts#L266), which addresses the valid CodeRabbit portability finding without changing backend behavior or tests.

Focused verification confirmed the summary link resolves repo-relatively, and I committed and pushed the fix as `6898b72`. I then resolved CodeRabbit thread `PRRT_kwDORgvdZ8516Cux`; both current CodeRabbit threads on PR #796 now report `isResolved: true`. The only remaining local dirt is the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Replaced the journal's last absolute link, pushed `6898b72`, and resolved the remaining CodeRabbit review thread
State hint: waiting_ci
Blocked reason: none
Tests: `sed -n '13,24p' .codex-supervisor/issue-journal.md`; `rg -n '^Updated \`.codex-supervisor/issue-journal.md\` to replace the remaining committed absolute filesystem link with the repo-relative target \\[src/backend/supervisor-http-server.test.ts\\]\\(src/backend/supervisor-http-server.test.ts#L266\\)' .codex-supervisor/issue-journal.md`; `gh api graphql -f query='query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes { id isResolved comments(first: 1) { nodes { author { login } } } } } } } }' -F owner=TommyKammy -F repo=codex-supervisor -F number=796`
Failure signature: none
Next action: Monitor PR #796 for CI completion or any new review feedback

## Active Failure Context
- Category: review
- Summary: No unresolved automated review threads remain after the journal-link fix was pushed and the thread was resolved.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/796#discussion_r2970047143
- Details:
  - The finding on `.codex-supervisor/issue-journal.md:17` was valid. Commit `6898b72` replaced the committed absolute path with a repo-relative link, `git push origin codex/issue-786` updated PR #796, `resolveReviewThread` marked `PRRT_kwDORgvdZ8516Cux` resolved, and a follow-up GraphQL query confirmed both current CodeRabbit threads are resolved.

## Codex Working Notes
### Current Handoff
- Hypothesis: no further local code or docs changes are needed unless CI or a new review comment surfaces.
- What changed: replaced the committed summary link target with the repo-relative path `src/backend/supervisor-http-server.test.ts#L266`, committed and pushed that fix as `6898b72`, resolved CodeRabbit thread `PRRT_kwDORgvdZ8516Cux`, and confirmed both current CodeRabbit threads on PR #796 are resolved.
- Current blocker: none
- Next exact step: monitor PR #796 for CI completion or any new review feedback.
- Verification gap: no known automated gap for this docs-only review fix.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: keep the HTTP command surface narrow and transport-level only; do not add loop control or any new mutation authority before the backend/UI MVP is stabilized.
- Last focused command: `gh api graphql -f query='query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes { id isResolved comments(first: 1) { nodes { author { login } } } } } } } }' -F owner=TommyKammy -F repo=codex-supervisor -F number=796`
- Last focused failure: `none`
- Last focused commands:
```bash
sed -n '13,24p' .codex-supervisor/issue-journal.md
rg -n '^Updated `.codex-supervisor/issue-journal.md` to replace the remaining committed absolute filesystem link with the repo-relative target \[src/backend/supervisor-http-server.test.ts\]\(src/backend/supervisor-http-server.test.ts#L266\)' .codex-supervisor/issue-journal.md
git push origin codex/issue-786
gh api graphql -f query='mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } } }' -F threadId=PRRT_kwDORgvdZ8516Cux
gh api graphql -f query='query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes { id isResolved comments(first: 1) { nodes { author { login } } } } } } } }' -F owner=TommyKammy -F repo=codex-supervisor -F number=796
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- `npm ci` was required locally because `npm run build` initially failed with `sh: 1: tsc: not found`.
- The new backend tests cover the intended allowlist and keep `loop` blocked at the HTTP layer with `404`.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/796
- Review fix on 2026-03-22: CodeRabbit thread `PRRT_kwDORgvdZ8515_nW` was valid; `createStubService()` could reach `args!` in the prune/reset stubs. Guarding those counters keeps the helper safe when called without tracking state.
- Review fix on 2026-03-22: CodeRabbit thread `PRRT_kwDORgvdZ8516Cux` is valid; the journal summary used a worktree-local absolute path that would not resolve on GitHub. Converting that committed link to a repo-relative target preserves the record and fixes the portability issue.
- Review state on 2026-03-22: after pushing `6898b72`, GraphQL confirmed both current CodeRabbit review threads on PR #796 are resolved.
- Updated at: 2026-03-21T19:41:57Z
