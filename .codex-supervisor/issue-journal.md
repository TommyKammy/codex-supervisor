# Issue #786: Backend commands MVP: expose only existing safe supervisor mutations over HTTP

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/786
- Branch: codex/issue-786
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=1, repair=3)
- Last head SHA: b66b7b304adedc92113e1308ed6218b252f73ecb
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8516G0B|PRRT_kwDORgvdZ8516G0C|PRRT_kwDORgvdZ8516IOy
- Repeated failure signature count: 1
- Updated at: 2026-03-21T19:53:25.680Z

## Latest Codex Summary
Applied the remaining journal-only review fixes locally. The verification
transcript now uses a fenced `bash` block instead of chained inline code, and
the embedded review transcript is summarized as normal Markdown so the recorded
CodeRabbit excerpts no longer rely on single-line pseudo-fences.

I also verified that the future-date review note is a timezone false positive:
the journal snapshot uses UTC, while commits `6898b72` and `b66b7b3` were both
created on `2026-03-22` in JST. The only remaining local dirt is the
pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Applied the remaining valid journal-only markdown fixes and verified
the date-review comment is a timezone false positive
State hint: local_review_fix
Blocked reason: none
Tests:
```bash
git show -s --format='%H %cI %s' 6898b72
git show -s --format='%H %cI %s' b66b7b3
npx --yes markdownlint-cli2 .codex-supervisor/issue-journal.md
gh api graphql -f query='query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes { id isResolved isOutdated path comments(first: 20) { nodes { databaseId url body author { login } } } } } } } }' -F owner=TommyKammy -F repo=codex-supervisor -F number=796
```
Failure signature: PRRT_kwDORgvdZ8516G0B|PRRT_kwDORgvdZ8516G0C|PRRT_kwDORgvdZ8516IOy
Next action: Commit and push this journal-only follow-up, then reconcile the
remaining CodeRabbit review threads on PR #796

## Active Failure Context
- Category: review
- Summary: 3 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/796#discussion_r2970071273
- Details:
  - `.codex-supervisor/issue-journal.md:24` thread
    `PRRT_kwDORgvdZ8516IOy` is valid. The previous `Tests:` entry chained inline
    code spans while the `rg` pattern contained literal backticks, which
    triggered `markdownlint` rule `MD038/no-space-in-code`. The verification
    commands now live in a fenced `bash` block.
  - `.codex-supervisor/issue-journal.md:33` thread
    `PRRT_kwDORgvdZ8516G0B` is valid. The embedded review transcript had been
    flattened into a single line with inline pseudo-fences, which also produced
    `MD038` noise. The journal now records the same finding as normal Markdown
    summary text instead of one-line pseudo-fenced content.
  - `.codex-supervisor/issue-journal.md:62-64` thread
    `PRRT_kwDORgvdZ8516G0C` is not valid. The journal snapshot timestamp is in
    UTC, but commits `6898b72` and `b66b7b3` were created on `2026-03-22` in
    JST, so the scratchpad dates are already accurate and remain unchanged.

## Codex Working Notes
### Current Handoff
- Hypothesis: the only remaining actionable review feedback is the journal
  formatting lint, while the date-review note is a timezone false positive.
- What changed: reformatted the journal verification transcript into a fenced
  `bash` block, replaced the one-line embedded review transcript with condensed
  Markdown summaries, and verified the `2026-03-22` scratchpad notes against
  the actual commit timestamps for `6898b72` and `b66b7b3`.
- Current blocker: none
- Next exact step: commit, push, and reconcile the remaining review threads on
  PR #796.
- Verification gap: no known automated gap beyond reconciling the invalid
  timezone-based review thread.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: keep the HTTP command surface narrow and transport-level only; do not add loop control or any new mutation authority before the backend/UI MVP is stabilized.
- Last focused command: `npx --yes markdownlint-cli2 .codex-supervisor/issue-journal.md`
- Last focused failure: `MD038/no-space-in-code at .codex-supervisor/issue-journal.md:24 and :33 before this edit`
- Last focused commands:
```bash
git show -s --format='%H %cI %s' 6898b72
git show -s --format='%H %cI %s' b66b7b3
npx --yes markdownlint-cli2 .codex-supervisor/issue-journal.md
gh api graphql -f query='query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes { id isResolved isOutdated path comments(first: 20) { nodes { databaseId url body author { login } } } } } } } }' -F owner=TommyKammy -F repo=codex-supervisor -F number=796
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- `npm ci` was required locally because `npm run build` initially failed with `sh: 1: tsc: not found`.
- The new backend tests cover the intended allowlist and keep `loop` blocked at the HTTP layer with `404`.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/796
- Timezone note: `Updated at` is recorded in UTC, but scratchpad notes may cite
  the same event in local JST.
- Review fix on 2026-03-22: CodeRabbit thread `PRRT_kwDORgvdZ8515_nW` was valid; `createStubService()` could reach `args!` in the prune/reset stubs. Guarding those counters keeps the helper safe when called without tracking state.
- Review fix on 2026-03-22: CodeRabbit thread `PRRT_kwDORgvdZ8516Cux` is valid; the journal summary used a worktree-local absolute path that would not resolve on GitHub. Converting that committed link to a repo-relative target preserves the record and fixes the portability issue.
- Review state on 2026-03-22: after pushing `6898b72`, GraphQL confirmed both current CodeRabbit review threads on PR #796 are resolved.
- Updated at: 2026-03-21T19:41:57Z
