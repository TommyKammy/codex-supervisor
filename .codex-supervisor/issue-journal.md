# Issue #1081: Expose GitHub REST and GraphQL rate-limit telemetry in supervisor status surfaces

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1081
- Branch: codex/issue-1081
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 30536a513110fae5fdf30b251ab6a7c843713f71
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T16:59:26Z

## Latest Codex Summary
Added typed GitHub rate-limit telemetry to the supervisor status path, committed it as `30536a5`, pushed `codex/issue-1081`, and opened draft PR `#1087` against `main`.

`GitHubClient` now reads `gh api rate_limit` once and maps both REST/core and GraphQL budgets into a typed DTO, while `statusReport()` includes both the structured `githubRateLimit` field and rendered `github_rate_limit` lines in detailed status output. Focused coverage lives in [github.test.ts](src/github/github.test.ts) and [supervisor-diagnostics-status-selection.test.ts](src/supervisor/supervisor-diagnostics-status-selection.test.ts).

Tests run: `npx tsx --test src/github/github.test.ts --test-name-pattern="fetches REST and GraphQL rate-limit telemetry"`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts --test-name-pattern="GitHub REST and GraphQL rate-limit telemetry"`; `npm run build`; `npm run test:malformed-inventory-regressions`.

Summary: Added GitHub REST/GraphQL rate-limit telemetry to supervisor status DTOs and rendered status lines, verified the related regression suite, and opened draft PR `#1087`.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/github/github.test.ts --test-name-pattern="fetches REST and GraphQL rate-limit telemetry"`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts --test-name-pattern="GitHub REST and GraphQL rate-limit telemetry"`; `npm run build`; `npm run test:malformed-inventory-regressions`
Next action: Watch PR `#1087` checks and respond to review or CI feedback if anything regresses.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing work for this issue was narrow status-surface wiring, not broader supervisor flow changes; a single lightweight `gh api rate_limit` read can provide both REST and GraphQL budgets without adding a high-churn request pattern.
- What changed: added typed GitHub rate-limit budget types, implemented `GitHubClient.getRateLimitTelemetry()`, threaded the telemetry into `Supervisor.statusReport()`, rendered `github_rate_limit` lines for both REST and GraphQL in detailed status output, committed the slice as `30536a5`, and opened draft PR `#1087` (`https://github.com/TommyKammy/codex-supervisor/pull/1087`).
- Current blocker: none locally.
- Next exact step: monitor PR `#1087` checks and address any CI or review feedback.
- Verification gap: full `npm test` has not been run this turn; focused GitHub/status telemetry suites, `npm run build`, and `npm run test:malformed-inventory-regressions` are green.
- Files touched: `src/core/types.ts`; `src/github/github.ts`; `src/github/github.test.ts`; `src/supervisor/supervisor-status-report.ts`; `src/supervisor/supervisor.ts`; `src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low to medium. Status-reporting now performs an extra `gh api rate_limit` read; if that proves too noisy in practice, the fetch point or warning behavior may need adjustment.
- Last focused command: `gh pr view 1087 --json url,isDraft,mergeStateStatus,headRefName,headRefOid,baseRefName`
- What changed this turn: reread the required memory files and journal, reviewed the existing telemetry diff, reran focused verification plus the malformed-inventory regression suite, committed the implementation as `30536a5`, pushed `codex/issue-1081`, and opened draft PR `#1087`.
- Exact failure reproduced this turn: none; this was a stabilization pass over already-implemented telemetry work.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1081/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1081/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git diff --stat`; `git diff -- src/core/types.ts src/github/github.ts src/github/github.test.ts src/supervisor/supervisor-status-report.ts src/supervisor/supervisor.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts .codex-supervisor/issue-journal.md`; `gh pr status`; `cat package.json`; `rg -n "githubRateLimit|github_rate_limit|getRateLimitTelemetry|GitHubRateLimitTelemetry" src -g '*.ts'`; `git diff --check`; `git branch -vv`; `npx tsx --test src/github/github.test.ts --test-name-pattern="fetches REST and GraphQL rate-limit telemetry"`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts --test-name-pattern="GitHub REST and GraphQL rate-limit telemetry"`; `npm run build`; `npm run test:malformed-inventory-regressions`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git add src/core/types.ts src/github/github.ts src/github/github.test.ts src/supervisor/supervisor-status-report.ts src/supervisor/supervisor.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts .codex-supervisor/issue-journal.md && git commit -m "Expose GitHub rate-limit telemetry in status"`; `git status --short`; `git push -u origin codex/issue-1081`; `gh pr create --draft --base main --head codex/issue-1081 --title "Issue #1081: expose GitHub rate-limit telemetry in supervisor status" --body ...`; `git rev-parse HEAD`; `gh pr view 1087 --json url,isDraft,mergeStateStatus,headRefName,headRefOid,baseRefName`; `git status --short --branch`; `apply_patch ...`.
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
