# Issue #725: Orphan cleanup docs: define preservation rules and explicit prune expectations

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/725
- Branch: codex/issue-725
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 1687069f7b72b7988663a43bbc89257c7ecd57fd
- Blocked reason: none
- Last failure signature: docs-orphan-cleanup-contract-missing
- Repeated failure signature count: 0
- Updated at: 2026-03-20T19:59:57Z

## Latest Codex Summary
- Added a narrow docs regression test for orphan-cleanup guidance, reproduced the gap when `src/execution-safety-docs.test.ts` failed because the docs did not define orphaned workspaces, updated `README.md`, `docs/architecture.md`, `docs/getting-started.md`, and `docs/configuration.md` to distinguish tracked done cleanup from explicit orphan pruning with preservation rules for locked, recent, and manually kept workspaces, and verified with `npx tsx --test src/execution-safety-docs.test.ts` plus `npm run build`.

## Active Failure Context
- Reproduced before the doc edits with `npx tsx --test src/execution-safety-docs.test.ts --test-name-pattern="workspace cleanup docs distinguish tracked done cleanup from explicit orphan pruning"` failing on `expected README.md to mention orphan workspaces`.

## Codex Working Notes
### Current Handoff
- Hypothesis: The issue is documentation drift, not runtime behavior: the repo needs one explicit orphan-cleanup contract across the top-level docs, plus a regression test that prevents architecture from implying orphan cleanup is the same as delayed cleanup for tracked `done` workspaces.
- What changed: re-read the required memory files and journal, inspected the current orphan-cleanup wording across the requested docs, added a focused assertion to `src/execution-safety-docs.test.ts`, reproduced the gap once dependencies were installed, then updated the four docs to define orphaned workspaces, preservation rules, and explicit prune expectations.
- Current blocker: none
- Next exact step: review the final diff, commit the docs and test updates, and open or update the draft PR for issue #725 if needed.
- Verification gap: full repo test suite was not rerun; verification this turn is the focused docs test file and `npm run build`.
- Files touched: `src/execution-safety-docs.test.ts`, `README.md`, `docs/architecture.md`, `docs/getting-started.md`, `docs/configuration.md`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting the doc updates would restore the previous ambiguity where orphan cleanup could be misread as implicit delayed cleanup for tracked `done` workspaces.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-725/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-725/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
rg -n "orphan|cleanup|prune|worktree" README.md docs/architecture.md docs/getting-started.md docs/configuration.md
sed -n '1,260p' README.md
sed -n '1,260p' docs/getting-started.md
sed -n '1,260p' docs/architecture.md
sed -n '1,260p' docs/configuration.md
sed -n '1,220p' src/getting-started-docs.test.ts
sed -n '1,260p' src/execution-safety-docs.test.ts
sed -n '1,260p' src/readme-docs.test.ts
npm install
npx tsx --test src/execution-safety-docs.test.ts --test-name-pattern="workspace cleanup docs distinguish tracked done cleanup from explicit orphan pruning"
npx tsx --test src/execution-safety-docs.test.ts
npm run build
git status --short --branch
git diff -- README.md docs/architecture.md docs/getting-started.md docs/configuration.md src/execution-safety-docs.test.ts
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
