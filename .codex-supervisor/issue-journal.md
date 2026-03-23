# Issue #886: Local CI setup guidance: show how repos adopt the pre-PR verification contract

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/886
- Branch: codex/issue-886
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 34806d2dfbd15b8b8006b28715333ab788c5d74d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T15:54:52Z

## Latest Codex Summary
- Added local-CI adoption guidance to setup/docs surfaces so operators can see whether the repo-owned pre-PR verification contract is configured and why that affects PR publication behavior.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing acceptance surface for `#886` was not backend data but operator guidance. `SetupReadinessReport` already carried `localCiContract`, yet the setup shell did not render it and `docs/getting-started.md` did not connect setup/readiness guidance to the local-CI contract's PR-blocking behavior.
- What changed: added focused setup-shell regressions in `src/backend/webui-dashboard.test.ts` to prove the missing local-CI guidance; rendered a dedicated "Local CI contract" panel in `src/backend/webui-setup-page.ts` and `src/backend/webui-setup-browser-script.ts`; and tightened `docs/getting-started.md` plus `src/getting-started-docs.test.ts` so the typed setup/readiness contract includes `localCiContract`, explains that setup/WebUI should surface configured-vs-missing status, and states that failing configured local CI blocks PR publication and ready-for-review promotion.
- Current blocker: none
- Next exact step: review the diff, commit the setup/docs local-CI guidance update on `codex/issue-886`, and open or update the draft PR if needed.
- Verification gap: none on the requested issue verification surface after restoring `node_modules` in this worktree.
- Files touched: `.codex-supervisor/issue-journal.md`, `docs/getting-started.md`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-setup-browser-script.ts`, `src/backend/webui-setup-page.ts`, `src/getting-started-docs.test.ts`
- Rollback concern: low; the behavior is additive doc/UI guidance, and reverting it would mainly remove operator visibility into when repo-owned local CI affects PR publication.
- Last focused command: `npx tsx --test src/getting-started-docs.test.ts src/readme-docs.test.ts src/backend/supervisor-http-server.test.ts`
- Last focused failure: `npm run build` failed with `sh: 1: tsc: not found` before verification because this worktree had no installed `node_modules`; `npm install` restored the declared dev dependencies and the build then passed.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-886/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-886/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "local CI|local-ci|local_ci|pre-PR|verification contract|GitHub Actions|workflow" README.md docs/getting-started.md src/getting-started-docs.test.ts src/readme-docs.test.ts src/backend/supervisor-http-server.test.ts src -g '*.md' -g '*.ts'
sed -n '1,260p' README.md
sed -n '1,320p' docs/getting-started.md
sed -n '1,260p' src/getting-started-docs.test.ts
sed -n '1,260p' src/readme-docs.test.ts
sed -n '1,320p' src/backend/supervisor-http-server.test.ts
rg -n "setup readiness|SetupReadiness|local CI contract|local_ci|localCi|reviewProvider|hostReadiness|providerPosture" src docs -g '*.ts' -g '*.md'
sed -n '1,320p' src/setup-readiness.ts
sed -n '1,320p' src/backend/supervisor-http-server.ts
sed -n '1,320p' src/supervisor/supervisor-service.ts
sed -n '240,420p' src/backend/webui-setup-browser-script.ts
sed -n '1660,2055p' src/backend/webui-dashboard.test.ts
sed -n '246,390p' src/doctor.test.ts
sed -n '430,760p' src/backend/webui-dashboard-browser-smoke.test.ts
sed -n '1,320p' src/backend/webui-setup-page.ts
apply_patch
npx tsx --test src/getting-started-docs.test.ts src/backend/webui-dashboard.test.ts
cat package.json
npm ls typescript --depth=0
npm install
npm run build
npx tsx --test src/getting-started-docs.test.ts src/readme-docs.test.ts src/backend/supervisor-http-server.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
