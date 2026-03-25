# Issue #959: CodeRabbit starter profile bug: preserve the default `Epic:` skip policy unless intentionally overridden

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/959
- Branch: codex/issue-959
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f3ca635315f536cc9549adbc43f70b53885fad7a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T02:59:30.753Z

## Latest Codex Summary
- Added a focused regression in `src/config.test.ts` that asserts the shipped CodeRabbit starter profile preserves `skipTitlePrefixes: ["Epic:"]`; reran the targeted config and issue-selection tests; restored local dependencies with `npm ci`; reran `npm run build` successfully; committed the checkpoint as `63b2dfd` (`Test CodeRabbit Epic skip policy`); pushed `codex/issue-959`; and opened draft PR `#981` at `https://github.com/TommyKammy/codex-supervisor/pull/981`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the live starter config already preserves `skipTitlePrefixes: ["Epic:"]`, but the branch lacked a shipped-profile regression test proving the CodeRabbit starter keeps the default `Epic:` skip policy aligned with runtime defaults and selection behavior.
- What changed: added a focused shipped-config regression in `src/config.test.ts` that asserts `supervisor.config.coderabbit.json` preserves `skipTitlePrefixes: ["Epic:"]`. No config or docs changes were needed because the shipped profile and docs already matched the intended policy on this branch.
- Current blocker: none.
- Next exact step: monitor CI and review feedback on draft PR `#981`, then address any reported failures or review comments.
- Verification gap: none in the requested local scope after rerunning the focused config test, runnable selection test, and build.
- Files touched: `src/config.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change is limited to a focused regression test and journal notes.
- Last focused command: `npm run build`
- PR status: draft PR `#981` is open at `https://github.com/TommyKammy/codex-supervisor/pull/981`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
