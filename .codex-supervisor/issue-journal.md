# Issue #882: Local CI contract: define the repo-owned pre-PR verification model

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/882
- Branch: codex/issue-882
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 64542f22893ee0c7c6847310620d122a620441d8
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T12:58:17.042Z

## Latest Codex Summary
- Documented a repo-owned local CI contract for pre-PR verification in the canonical getting-started/configuration docs, added a focused docs regression to lock the contract language, reproduced the gap with that new test, and passed the requested docs verification plus `npm run build` after restoring missing local npm dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #882 was a docs-contract gap rather than a runtime bug; the repo needed an explicit written contract stating that pre-PR local verification is repo-owned, supervisor-invoked, backward-compatible when absent, and not derived from workflow YAML.
- What changed: added a focused docs regression in `src/getting-started-docs.test.ts`, documented the repo-owned local CI contract in `docs/getting-started.md`, and added a matching policy note in `docs/configuration.md`.
- Current blocker: none
- Next exact step: commit the docs/test checkpoint on `codex/issue-882`, then open or update the draft PR if needed.
- Verification gap: none on the requested issue verification surface.
- Files touched: `.codex-supervisor/issue-journal.md`, `docs/configuration.md`, `docs/getting-started.md`, `src/getting-started-docs.test.ts`
- Rollback concern: low; the change is documentation plus a focused docs regression and does not alter supervisor runtime behavior.
- Last focused command: `npm run build`
- Last focused failure: `npm run build` initially failed with `sh: 1: tsc: not found` because this worktree was missing local npm dependencies; `npm install` restored the toolchain and the rerun passed.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-882/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-882/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "local CI|ci:local|verify:pre-pr|pre-PR|workflow-YAML|workflow YAML|verification entrypoint|local verification|pre PR|pre-pr" README.md docs src -g '*.md' -g '*.ts'
sed -n '1,260p' src/readme-docs.test.ts
sed -n '1,260p' src/getting-started-docs.test.ts
sed -n '1,260p' README.md
sed -n '1,320p' docs/getting-started.md
sed -n '1,260p' docs/local-review.md
sed -n '1,260p' docs/configuration.md
sed -n '1,260p' docs/agent-instructions.md
sed -n '1,260p' supervisor.config.example.json
apply_patch
npx tsx --test src/getting-started-docs.test.ts
apply_patch
npx tsx --test src/getting-started-docs.test.ts
npx tsx --test src/readme-docs.test.ts src/getting-started-docs.test.ts
npm run build
npm install
npm run build
git diff -- src/getting-started-docs.test.ts docs/getting-started.md docs/configuration.md .codex-supervisor/issue-journal.md
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
