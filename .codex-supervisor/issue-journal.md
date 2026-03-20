# Issue #736: Hydration provenance visibility: surface cached-vs-fresh PR hydration results

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/736
- Branch: codex/issue-736
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: implementing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 7b082dc5f206c15ce0fca8b26722b84b599ea5d3
- Blocked reason: none
- Last failure signature: build-env-missing-tsc
- Repeated failure signature count: 0
- Updated at: 2026-03-21T00:05:00.000Z

## Latest Codex Summary
- Added PR hydration provenance visibility by marking hydrated pull requests as `fresh` or `cached` and surfacing that signal in detailed status output.
- Covered the new signal with focused hydrator and status-rendering tests, then verified the representative lifecycle and doctor suites.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: a small PR-level provenance field is enough for this issue because later behavior changes can reuse it without changing any action paths now.
- What changed: added `hydrationProvenance` to hydrated pull requests, set it deterministically to `fresh` or `cached` in the GitHub PR hydrator, and rendered it as `pr_hydration provenance=...` in detailed supervisor status output.
- Current blocker: none
- Next exact step: commit this focused visibility change, then open or update the draft PR if one is needed for issue #736.
- Verification gap: none on code; `npm run build` initially failed only because `node_modules/.bin/tsc` was missing before `npm ci`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/core/types.ts`, `src/github/github-pull-request-hydrator.ts`, `src/github/github-pull-request-hydrator.test.ts`, `src/supervisor/supervisor-detailed-status-assembly.ts`, `src/supervisor/supervisor-status-rendering-supervisor.test.ts`
- Rollback concern: removing the provenance field would drop the only deterministic operator-visible cached-vs-fresh hydration signal needed by later action-path issues.
- Last focused command: `npm run build`
- Last focused failure: `build-env-missing-tsc`
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-736/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-736/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
rg -n "GitHubPullRequestHydrator|hydrate\\(|hydration" src/github src/supervisor src/doctor.ts src -g '!**/*.test.ts'
npx tsx --test src/github/github-pull-request-hydrator.test.ts
npx tsx --test src/supervisor/supervisor-status-rendering-supervisor.test.ts
npx tsx --test src/github/github-pull-request-hydrator.test.ts src/supervisor/supervisor-lifecycle.test.ts src/doctor.test.ts
npm ci
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
