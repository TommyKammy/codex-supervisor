# Issue #1011: Execution-safety docs guard: extend orphan-cleanup negative wording checks across every contract doc

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1011
- Branch: codex/issue-1011
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 73565d4059f646b6289e12b159abc678be3c1523
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T17:54:10.160Z

## Latest Codex Summary
- Tightened `src/execution-safety-docs.test.ts` so the orphan-cleanup negative wording guard now applies across `README.md`, `docs/architecture.md`, `docs/getting-started.md`, and `docs/configuration.md` instead of only checking `docs/configuration.md`.
- Reproduced the gap first by running `npx tsx --test src/execution-safety-docs.test.ts`, then added the narrowest failing assertion and refined the regex to reject only wording that positively implies automatic/background orphan pruning without flagging compliant `background_prune=false` or `does not ... background cleanup` text.
- Installed repo dependencies with `npm install` because the first `npm run build` failed with `tsc: not found`; after that, both the focused test and `npm run build` passed locally.
- Published branch `codex/issue-1011` and opened draft PR `#1029`: `https://github.com/TommyKammy/codex-supervisor/pull/1029`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the execution-safety docs suite covered orphan-cleanup positive wording across all contract docs, but its negative wording guard only protected `docs/configuration.md`, leaving the other contract docs unpinned against accidental wording drift toward automatic/background orphan pruning.
- What changed: extended the negative orphan-pruning wording assertion in `src/execution-safety-docs.test.ts` so every relevant contract doc is checked, while keeping the existing architecture-specific stale-cleanup guard and the configuration-specific explicit eligibility contract assertion.
- Current blocker: none locally.
- Next exact step: watch draft PR `#1029` for CI or review feedback and respond if needed.
- Verification gap: none for the requested local commands after installing dependencies.
- Files touched: `src/execution-safety-docs.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only tightens doc-contract tests and does not affect runtime behavior.
- Last focused command: `npm run build`
- Exact failure reproduced: before the checkpoint, `npx tsx --test src/execution-safety-docs.test.ts` passed even though only `docs/configuration.md` had a negative orphan-cleanup wording assertion; `README.md`, `docs/architecture.md`, and `docs/getting-started.md` had no equivalent regression guard.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1011/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1011/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "orphan|cleanup|prun|background|automatic" src/execution-safety-docs.test.ts src -g '!dist'`; `sed -n '1,260p' src/execution-safety-docs.test.ts`; `sed -n '1,260p' README.md`; `sed -n '1,260p' docs/getting-started.md`; `sed -n '1,260p' docs/architecture.md`; `sed -n '1,260p' docs/configuration.md`; `npx tsx --test src/execution-safety-docs.test.ts`; `rg -n "orphan|prune|background|automatic|done workspace|tracked done" README.md docs/architecture.md docs/getting-started.md docs/configuration.md`; `nl -ba src/execution-safety-docs.test.ts | sed -n '105,175p'`; `npm run build`; `npm install`; `git diff -- src/execution-safety-docs.test.ts .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `gh pr status`; `rg -n -i "automatic orphan|orphan.*automatic|background orphan" docs/configuration.md README.md docs/getting-started.md docs/architecture.md`; `node - <<'NODE' ... NODE`.
- PR status: draft PR `#1029` is open at `https://github.com/TommyKammy/codex-supervisor/pull/1029`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
