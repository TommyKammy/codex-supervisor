# Issue #1071: Harden full inventory transport without collapsing distinct failure classes

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1071
- Branch: codex/issue-1071
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 598f2c036852e33a2d183e9aa5e7c036d7b57950
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T23:54:52Z

## Latest Codex Summary
The implementation checkpoint remains `598f2c0` (`Harden full inventory transport fallback`): `GitHubClient.listAllIssues()` only uses the REST full-inventory fallback for malformed array-shaped `gh issue list` JSON, while transport-shaped primary failures remain fatal and fallback transport failures stay attributable.

This turn restored local dev dependencies with `npm ci`, reran the issue-focused regressions, and verified `npm run build`. The focused transport coverage still passes. `npm test` now runs with the installed toolchain but fails later in the existing browser-smoke suite instead of on missing dependencies.

Summary: Restored local verification, confirmed the inventory hardening checkpoint still passes focused coverage and build, and isolated the remaining broad-suite failure to the browser-smoke path rather than this inventory transport change.
State hint: draft_pr
Blocked reason: none
Tests: `npm ci` (passed); `npx tsx --test src/github/github.test.ts src/run-once-cycle-prelude.test.ts` (passed); `npm run build` (passed); `npm test` (failed in `src/backend/webui-dashboard-browser-smoke.test.ts` after ~31s: `browser smoke loads the read-only dashboard against the live HTTP fixture`)
Next action: push `codex/issue-1071`, open a draft PR for the verified inventory transport checkpoint, and carry the unrelated browser-smoke suite failure as follow-up context unless review shows it is newly introduced.
Failure signature: browser_smoke_dashboard_fixture_timeout

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `listAllIssues()` was still treating any `gh issue list` parse failure as fallback-eligible, which collapses some primary transport failures into the same path as malformed payloads and can return silent success when the primary transport actually failed.
- What changed: added a JSON-array shape gate in `GitHubClient.listAllIssues()` so only malformed full-inventory payloads that still look like the expected array output can fall back to REST pagination; transport-shaped non-JSON output now throws the primary failure directly. Added focused regression coverage for transport-shaped stdout staying fatal and for preserving both primary parse failure and fallback transport failure details.
- Current blocker: none.
- Next exact step: push `codex/issue-1071`, open the draft PR for commit `598f2c0`, and note that only the unrelated browser-smoke suite is still failing in broad verification.
- Verification gap: full `npm test` still fails in `src/backend/webui-dashboard-browser-smoke.test.ts` with `browser smoke loads the read-only dashboard against the live HTTP fixture` timing out after roughly 31 seconds. Focused inventory regressions and `npm run build` now pass with local dependencies installed.
- Files touched: `.codex-supervisor/issue-journal.md`; `src/github/github.test.ts`; `src/github/github.ts`
- Rollback concern: low. The new guard only narrows when the full-inventory fallback is allowed; the main risk is being too strict and surfacing a malformed-but-recoverable payload as fatal.
- Last focused command: `npx tsx --test src/github/github.test.ts src/run-once-cycle-prelude.test.ts`
- What changed this turn: reread the required memory files and journal, confirmed the branch already contains checkpoint commit `598f2c0`, restored local dependencies with `npm ci`, reran focused inventory regressions, reran `npm run build`, checked `npm test`, and prepared the branch for draft-PR publication.
- Exact failure reproduced this turn: `npm test` now reaches `src/backend/webui-dashboard-browser-smoke.test.ts` and reports `browser smoke loads the read-only dashboard against the live HTTP fixture` failing after about 31 seconds; the inventory transport regressions continue to pass.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1071/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1071/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -n 6`; `sed -n '1,220p' package.json`; `ls -1`; `gh pr status`; `test -d node_modules && echo present || echo absent`; `sed -n '1,240p' <github-yeet-skill>`; `git branch -vv`; `npm ci`; `npx tsx --test src/github/github.test.ts src/run-once-cycle-prelude.test.ts`; `npm run build`; `npm test`; `sed -n '1,260p' src/backend/webui-dashboard-browser-smoke.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts`; `which google-chrome || true`; `which chromium || true`; `printenv CHROME_BIN || true`; `timeout 45s npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts`; `git remote get-url origin`; `gh auth status`; `git diff -- .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git branch --show-current`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
