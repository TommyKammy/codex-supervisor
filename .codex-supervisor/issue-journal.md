# Issue #775: Candidate discovery docs: define first-page limit and operator expectations

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/775
- Branch: codex/issue-775
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 3adaf5410844078ab5965b8edbfa035122b02477
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T11:50:12.899Z

## Latest Codex Summary
- Added a focused docs reproducer for the missing candidate-discovery wording, then updated the operator docs to state that runnable selection is currently limited to the first fetched page of matching open issues instead of the entire backlog.
- Focused verification passed for `src/getting-started-docs.test.ts`, the requested `src/config.test.ts src/doctor.test.ts` suites, and `npm run build` after restoring local dependencies with `npm ci` because this worktree initially had no `node_modules/.bin/tsc`.
- Checkpoint committed as `9860500` (`Document first-page candidate discovery limit`) and pushed to draft PR `#779`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: operator docs still implied full-backlog readiness selection even though `listCandidateIssues()` only fetches the first GitHub candidate page (`gh issue list --limit 100`) before sorting and choosing a runnable issue.
- What changed: added a focused docs assertion that failed on the missing first-page disclosure, then updated `docs/getting-started.md`, `docs/getting-started.ja.md`, and `docs/issue-metadata.md` to describe the first-page discovery limit, backlog-truncation impact, and the right operator expectation when backlog order looks wrong.
- Current blocker: none
- Next exact step: watch draft PR `#779` and address any review, wording, or CI feedback if it appears.
- Verification gap: none in the targeted suites or build; `.codex-supervisor/replay/` remains untracked and untouched.
- Files touched: `.codex-supervisor/issue-journal.md`, `docs/getting-started.md`, `docs/getting-started.ja.md`, `docs/issue-metadata.md`, `src/config.test.ts`, `src/getting-started-docs.test.ts`
- Rollback concern: removing the first-page wording would make the docs overstate scheduler completeness again and hide the current backlog-truncation behavior from operators.
- Last focused command: `npm run build`
- Last focused failure: `candidate-discovery-first-page-docs`
- Last focused commands:
```bash
npx tsx --test src/getting-started-docs.test.ts
npx tsx --test src/config.test.ts src/doctor.test.ts
npm ci
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
