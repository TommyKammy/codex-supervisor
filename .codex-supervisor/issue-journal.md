# Issue #1037: Harden full issue inventory loading beyond a single gh issue list JSON parse

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1037
- Branch: codex/issue-1037
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 39589a1ef5253f4f4e98d8f86c77decb6eb41e04
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T03:45:43Z

## Latest Codex Summary
- Added a malformed-JSON regression test for `GitHubClient.listAllIssues()`, implemented paginated REST fallback for full issue inventory loading, ran focused inventory/explain tests plus `npm run build`, and opened draft PR `#1041`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `GitHubClient.listAllIssues()` still has a single-host-parse failure mode even after the prelude degradation work, so malformed `gh issue list --json ...` stdout can still collapse full inventory loading instead of retrying through a bounded alternate transport.
- What changed: added a focused `GitHubClient.listAllIssues()` regression test that injects malformed `gh issue list` JSON and requires paginated REST inventory fallback; implemented a bounded `gh api repos/{owner}/{repo}/issues` fallback that preserves issue metadata, excludes pull-request rows, and continues past the 500-item CLI limit.
- Current blocker: none locally.
- Next exact step: monitor draft PR `#1041` and address any review or CI feedback on the full inventory fallback path.
- Verification gap: none for the focused regression coverage and `npm run build`; broader suite coverage remains optional.
- Files touched: `src/github/github.ts`, `src/github/github.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change is isolated to full-inventory transport fallback and one synthetic regression fixture.
- Last focused command: `gh pr create --draft --base main --head codex/issue-1037 --title "Issue #1037: harden full issue inventory loading" --body ...`
- Exact failure reproduced: `GitHubClient.listAllIssues()` threw `Failed to parse JSON from gh issue list: Bad control character in string literal in JSON at position 27 (line 1 column 28)` when `gh issue list` stdout contained malformed JSON, with no alternate inventory transport attempt.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1037/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1037/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -5`; `rg -n "listAllIssues|gh issue list|inventory_refresh_failure|runOnceCyclePrelude" src`; `sed -n '1,260p' src/github/github.ts`; `sed -n '1,280p' src/run-once-cycle-prelude.test.ts`; `rg -n "GitHubClient|listAllIssues\\(" src/*.test.ts src/github src | head -n 200`; `sed -n '1,260p' src/github/github.test.ts`; `sed -n '1,260p' src/github/github-transport.ts`; `rg -n "listAllIssues\\(|all issues|issues\\[[0-9]+\\]|sortCandidateIssues|createdAt.localeCompare|updatedAt.localeCompare" src | head -n 250`; `sed -n '100,220p' src/supervisor/supervisor-selection-readiness-summary.ts`; `sed -n '150,270p' src/supervisor/supervisor-selection-issue-explain.ts`; `sed -n '1,220p' src/core/utils.ts`; `sed -n '260,420p' src/github/github.test.ts`; `npx tsx --test src/github/github.test.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts`; `npm run build`; `npm ci`; `npm run build`; `git status --short`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git diff -- src/github/github.ts src/github/github.test.ts .codex-supervisor/issue-journal.md`.
- PR status: draft PR `#1041` open at https://github.com/TommyKammy/codex-supervisor/pull/1041 targeting `main` from `codex/issue-1037`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
