# Issue #958: CodeRabbit starter profile bug: replace the shipped live repoSlug with a fail-fast placeholder

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/958
- Branch: codex/issue-958
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 21eb277fd3f4be796e264240c495b6e3036e3fb5
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T02:33:24.438Z

## Latest Codex Summary
Changed the shipped CodeRabbit starter profile to fail fast by replacing its `repoSlug` with an intentionally non-loadable placeholder, added a focused regression in [src/config.test.ts](src/config.test.ts), and updated the setup docs in [README.md](README.md), [docs/getting-started.md](docs/getting-started.md), and [docs/configuration.md](docs/configuration.md) to describe the profile as a starting point that must be customized before use. I also aligned the Japanese docs and updated the issue journal, then committed the checkpoint as `21eb277` (`Make CodeRabbit starter profile fail fast`).

Verification passed with `npx tsx --test src/config.test.ts` and `npm run build`. I had to run `npm ci` first because `tsc` was missing from local `node_modules`. The worktree is ahead by one commit; only the local untracked `.codex-supervisor/pre-merge/` and `.codex-supervisor/replay/` directories remain outside the commit.

Pushed `codex/issue-958` to `origin` and opened draft PR [#980](https://github.com/TommyKammy/codex-supervisor/pull/980). Initial PR metadata reports `mergeStateStatus=UNSTABLE`, so the next supervisor action is to watch CI and review feedback on that draft PR.

Summary: CodeRabbit starter profile now uses a fail-fast `repoSlug` placeholder, with focused regression coverage and docs updated to require customization before first run.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/config.test.ts`; `npm ci`; `npm run build`
Next action: open or update the issue PR for `codex/issue-958` and continue with review/CI follow-up if needed
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the shipped CodeRabbit starter profile still allowed a syntactically valid `repoSlug`, so copying it without customization could pass config parsing instead of failing fast and forcing the operator to set the managed repository explicitly.
- What changed: added a focused shipped-config regression in `src/config.test.ts`; changed `supervisor.config.coderabbit.json` to use the invalid placeholder `REPLACE_WITH_OWNER_AND_REPO`; updated `README.md`, `docs/getting-started.md`, `docs/configuration.md`, `docs/getting-started.ja.md`, and `docs/README.ja.md` so the starter profile is described as a starting point that must be customized before first run.
- Current blocker: none.
- Next exact step: monitor draft PR `#980` for CI results and review feedback, then address any reported failures on `codex/issue-958`.
- Verification gap: none in the requested local scope after rerunning the focused config test and build.
- Files touched: `src/config.test.ts`, `supervisor.config.coderabbit.json`, `README.md`, `docs/getting-started.md`, `docs/configuration.md`, `docs/getting-started.ja.md`, `docs/README.ja.md`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change is limited to starter-profile defaults, docs, and a focused regression test.
- Last focused command: `npx tsx --test src/config.test.ts`
- PR status: draft PR `#980` is open at `https://github.com/TommyKammy/codex-supervisor/pull/980`; initial `mergeStateStatus` is `UNSTABLE`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
