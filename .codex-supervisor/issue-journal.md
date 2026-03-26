# Issue #1064: Run focused managed-restart and launcher-wiring regressions in CI

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1064
- Branch: codex/issue-1064
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: f42178839f6fd52153a1af8fd3d78a87a65fba45
- Blocked reason: none
- Last failure signature: handoff-missing
- Repeated failure signature count: 1
- Updated at: 2026-03-26T12:34:45Z

## Latest Codex Summary
- Added a dedicated `npm run test:managed-restart-regressions` target and wired it into the Ubuntu CI lane.
- Tightened launcher asset assertions to check the exact managed-restart variables and added shell-script regressions for the explicit missing-binary path under `set -euo pipefail`.
- Fixed `scripts/install-launchd-web.sh` so the `id -u` lookup happens after the node/npm availability guard.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the repo already had the core managed-restart regression coverage, but CI was missing a dedicated target and the launcher asset checks were still loose enough to miss exact wiring regressions.
- What changed: added `test:managed-restart-regressions` in `package.json`; wired it into `.github/workflows/ci.yml`; extended `src/ci-workflow.test.ts`; tightened `src/managed-restart-launcher-assets.test.ts` to assert exact variables and to execute the WebUI launcher scripts with a PATH that omits node/npm; moved `UID_VALUE="$(id -u)"` in `scripts/install-launchd-web.sh` below the explicit node/npm guard.
- Current blocker: none locally.
- Next exact step: commit this checkpoint, push `codex/issue-1064`, and open/update the PR so GitHub Actions runs the new focused regression target.
- Verification gap: none for the issue acceptance criteria. Local verification covered the new focused regression target and `npm run build`.
- Files touched: `package.json`, `.github/workflows/ci.yml`, `src/ci-workflow.test.ts`, `src/managed-restart-launcher-assets.test.ts`, `scripts/install-launchd-web.sh`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The code change is limited to launcher-script guard ordering; the rest is focused test and CI wiring.
- Last focused command: `npm run test:managed-restart-regressions`
- What changed this turn: found that `codex/issue-1064` was still at `main`, reused the existing restart/dashboard/server tests via a dedicated npm target, added missing-binary launcher-script regressions, and wired the target into the Ubuntu CI lane.
- Exact failure reproduced this turn: the first draft of the new shell regression used an empty PATH and exposed that `dirname` disappears too; the final test now uses a temporary PATH containing only the shell helpers needed before the node/npm guard.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1064/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1064/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate --graph -n 12`; `git diff --stat origin/main...HEAD`; `git diff --name-only origin/main...HEAD`; `gh pr view 1066 --json number,title,state,isDraft,headRefName,baseRefName,statusCheckRollup,url`; `rg -n "managed restart|managed-restart|restart acceptance|launcher|set -euo pipefail|test:malformed-inventory-regressions|webui" package.json src .github`; `sed -n '1,220p' package.json`; `sed -n '1,260p' .github/workflows/ci.yml`; `sed -n '1,220p' src/managed-restart-launcher-assets.test.ts`; `sed -n '2440,2525p' src/backend/webui-dashboard.test.ts`; `sed -n '1260,1425p' src/backend/supervisor-http-server.test.ts`; `sed -n '1,220p' src/ci-workflow.test.ts`; `sed -n '1,240p' scripts/run-web.sh`; `sed -n '1,260p' scripts/install-systemd-web.sh`; `sed -n '1,260p' scripts/install-launchd-web.sh`; `sed -n '1,240p' launchd/io.codex.supervisor.web.plist.template`; `sed -n '1,240p' systemd/codex-supervisor-web.service.template`; `sed -n '1,220p' src/managed-restart.test.ts`; `apply_patch ...`; `npx tsx --test src/managed-restart-launcher-assets.test.ts`; `npx tsx --test src/ci-workflow.test.ts`; `npm run test:managed-restart-regressions`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
- PR status: no PR for `codex/issue-1064` yet.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local
