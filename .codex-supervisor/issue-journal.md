# Issue #1264: [codex] Fix remaining release-blocking browser smoke regressions

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1264
- Branch: codex/issue-1264
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: cfa082799f7e41b2c4b66e5b6093d7e73b50f6d9
- Blocked reason: none
- Last failure signature: handoff-missing
- Repeated failure signature count: 1
- Updated at: 2026-03-31T13:34:03.272Z

## Latest Codex Summary
- Reproduced the remaining browser-smoke blocker as harness-level Chrome discovery failure on macOS, taught the smoke harness to resolve local Chrome/Chromium app bundles when `CHROME_BIN` and PATH lookups are absent, added resolver regression coverage, and verified the smoke suite plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining release-blocking browser smoke failures on `main` were not flow regressions inside the dashboard itself; the harness had become too strict about browser discovery and now failed before any smoke flow could execute in macOS worktrees unless `CHROME_BIN` was set manually.
- What changed: reproduced the blocker locally, confirmed every browser smoke flow passed once `CHROME_BIN` pointed at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, then updated `src/backend/webui-dashboard-browser-smoke.test.ts` so `resolveChromeExecutable` trims `CHROME_BIN`, keeps the existing PATH lookup, and falls back to standard macOS Google Chrome/Chromium app-bundle paths under `/Applications` and `$HOME/Applications`. Added a focused resolver regression test covering explicit env override, PATH resolution, and macOS app-bundle fallback. Committed the fix as `38b8027` (`[codex] Fix WebUI browser smoke Chrome discovery`), pushed `codex/issue-1264`, and opened draft PR #1269.
- Current blocker: none.
- Next exact step: watch draft PR #1269, confirm the macOS and Ubuntu CI jobs pass with the new browser-discovery fallback, and address any review or CI fallout if it appears.
- Verification gap: local verification covered the targeted browser smoke suite and a full TypeScript build. I did not run the repo-wide `npm test` glob because this issue is scoped to the WebUI smoke harness and the targeted verifier already exercises the affected flows end-to-end in a real browser.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-smoke.test.ts`.
- Rollback concern: low. The runtime-facing change is limited to test-harness browser executable discovery, and the added regression test constrains the fallback order.
- Last focused command: `gh pr view 1269 --json number,url,isDraft,headRefName,baseRefName,mergeStateStatus,statusCheckRollup`
- What changed this turn: read the required memory files, noticed the journal handoff had stale notes from another issue, verified `codex/issue-1264` was still identical to `main`, reproduced the smoke-suite blocker as missing Chrome discovery without `CHROME_BIN`, patched the harness fallback logic, reran the smoke suite successfully without any environment override, committed the fix, pushed the branch, and opened draft PR #1269.
- Exact failure reproduced this turn: `npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts` failed all five smoke flows immediately with `Error: Set CHROME_BIN to a local Chrome/Chromium executable for the WebUI smoke test.` from `resolveChromeExecutable` before the dashboard fixture loaded.
- Commands run this turn: `sed -n '1,220p' /Users/tomoakikawada/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1264/AGENTS.generated.md`; `sed -n '1,220p' /Users/tomoakikawada/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1264/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git branch --show-current && git status --short`; `git log --oneline --decorate -8`; `git diff --stat origin/main...HEAD`; `git diff --name-only origin/main...HEAD`; `rg -n "read-only|safe command|first-run|effective-save|launcher-managed|restart" src/backend/webui-dashboard-browser-smoke.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts`; `which chromium chromium-browser google-chrome google-chrome-stable chrome || true`; `ls -1 /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome /Applications/Chromium.app/Contents/MacOS/Chromium 2>/dev/null || true`; `fd -HI "(chrome|chromium)$" "$HOME/Library/Caches/ms-playwright" /Applications 2>/dev/null | head -n 40`; `CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts`; `sed -n '1,260p' src/backend/webui-dashboard-browser-smoke.test.ts`; `git show 054b8cd -- src/backend/webui-dashboard-browser-smoke.test.ts`; `rg -n "CHROME_BIN|resolveChromeExecutable|chromium.launch|playwright-core" -S src test .`; `cat package.json`; `npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts`; `npm run build`; `git status --short`; `git diff -- src/backend/webui-dashboard-browser-smoke.test.ts`; `git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true`; `git ls-files --stage .codex-supervisor/issue-journal.md`; `git add src/backend/webui-dashboard-browser-smoke.test.ts .codex-supervisor/issue-journal.md && git commit -m "[codex] Fix WebUI browser smoke Chrome discovery"`; `git push -u origin codex/issue-1264`; `gh pr create --draft --base main --head codex/issue-1264 --title "[codex] Fix remaining release-blocking browser smoke regressions" --body ...`; `git status --short`; `gh pr view 1269 --json number,url,isDraft,headRefName,baseRefName,mergeStateStatus,statusCheckRollup`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
