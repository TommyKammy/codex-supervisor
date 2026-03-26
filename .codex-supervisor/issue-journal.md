# Issue #1038: Contain malformed gh issue list inventory failures without freezing active review progression

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1038
- Branch: codex/issue-1038
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: dded39618c064751added6bc480afee914e6dbf3
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T01:47:49.487Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `runOnceCyclePrelude` freezes review progression because it treats malformed `gh issue list` JSON as a fatal prerequisite for every cycle, even when the active tracked issue can still be re-evaluated safely via tracked PR lookups.
- What changed: added a persisted `inventory_refresh_failure` degraded-state marker, contained malformed full-inventory refresh failures inside `runOnceCyclePrelude`, allowed the active tracked-issue merged/open fast path to continue with fallback issue hydration, blocked unrelated new issue selection while degraded, and surfaced the degraded inventory warning in status/explain output.
- Current blocker: none locally.
- Next exact step: monitor draft PR `#1040` and address any review or CI feedback for the degraded-inventory containment change.
- Verification gap: none for the requested focused tests and `npm run build` after installing dependencies locally with `npm ci`.
- Files touched: `src/core/types.ts`, `src/core/state-store.ts`, `src/inventory-refresh-state.ts`, `src/run-once-cycle-prelude.ts`, `src/run-once-cycle-prelude.test.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-status-report.ts`, `src/supervisor/supervisor-selection-readiness-summary.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: medium-low; the behavior change is concentrated in prelude ordering and persisted state metadata, so rollback would mainly need to remove the `inventory_refresh_failure` field and degraded-mode short-circuiting if it caused stale warnings to stick unexpectedly.
- Last focused command: `gh pr view 1040 --json number,isDraft,state,url,headRefName,baseRefName`
- Exact failure reproduced: `runOnceCyclePrelude` aborted the whole cycle when `listAllIssues()` threw `Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1`, which would otherwise block reevaluating an active tracked issue in `waiting_ci` and leave no explicit persisted degraded-inventory warning.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1038/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1038/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "gh issue list|issue list|runOnceCyclePrelude|inventory|degraded" src .`; `rg --files src | rg "test|spec|status|explain|inventory|issue"`; `sed -n '1,260p' src/run-once-cycle-prelude.ts`; `sed -n '1,260p' src/run-once-cycle-prelude.test.ts`; `sed -n '1,220p' src/github/github.ts`; `sed -n '1,260p' src/run-once-issue-selection.ts`; `rg -n "activeIssueNumber|last_failure_context|blocked_reason|inventory" src/core/types.ts src/supervisor src/index.ts src/*.ts`; `sed -n '1,260p' src/core/types.ts`; `sed -n '1280,1395p' src/supervisor/supervisor.ts`; `sed -n '1,260p' src/supervisor/supervisor-status-model.ts`; `sed -n '1,280p' src/supervisor/supervisor-detailed-status-assembly.ts`; `sed -n '1,260p' src/supervisor/supervisor-selection-issue-explain.ts`; `sed -n '1,260p' src/supervisor/supervisor-selection-status.ts`; `sed -n '1,260p' src/supervisor/supervisor-status-report.ts`; `sed -n '1,260p' src/core/state-store.ts`; `sed -n '1,240p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `sed -n '1,260p' src/supervisor/supervisor-diagnostics-explain.test.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts`; `npm run build`; `test -f package-lock.json && echo lockfile-present || echo no-lockfile`; `test -x node_modules/.bin/tsc && echo tsc-present || echo tsc-missing`; `sed -n '1,220p' package.json`; `npm ci`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git diff -- src/core/state-store.ts src/core/types.ts src/inventory-refresh-state.ts src/run-once-cycle-prelude.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor.ts src/supervisor/supervisor-status-report.ts src/supervisor/supervisor-selection-readiness-summary.ts src/supervisor/supervisor-selection-issue-explain.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`; `git add .codex-supervisor/issue-journal.md src/core/state-store.ts src/core/types.ts src/inventory-refresh-state.ts src/run-once-cycle-prelude.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor.ts src/supervisor/supervisor-status-report.ts src/supervisor/supervisor-selection-readiness-summary.ts src/supervisor/supervisor-selection-issue-explain.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`; `git commit -m "Issue #1038: contain malformed inventory refresh failures"`; `git push -u origin codex/issue-1038`; `gh pr create --draft --base main --head codex/issue-1038 --title "Issue #1038: contain malformed inventory refresh failures" --body ...`; `git status --short --branch`; `gh pr view 1040 --json number,isDraft,state,url,headRefName,baseRefName`.
- PR status: draft PR `#1040` open at https://github.com/TommyKammy/codex-supervisor/pull/1040 targeting `main` from `codex/issue-1038`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
