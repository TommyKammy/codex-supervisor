# Issue #1081: Expose GitHub REST and GraphQL rate-limit telemetry in supervisor status surfaces

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1081
- Branch: codex/issue-1081
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: b729d0ed2fd92c99d7cc9b9b24273e30fed7f4cb
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T16:58:29.099Z

## Latest Codex Summary
Added typed GitHub rate-limit telemetry to the supervisor status path. `GitHubClient` now reads `gh api rate_limit` once and maps both REST/core and GraphQL budgets into a typed DTO, and `statusReport()` includes both the structured `githubRateLimit` field and rendered `github_rate_limit` lines in detailed status output. The main changes are in [types.ts](src/core/types.ts), [github.ts](src/github/github.ts), [supervisor-status-report.ts](src/supervisor/supervisor-status-report.ts), and [supervisor.ts](src/supervisor/supervisor.ts).

I added focused regression coverage for both the client parser and the status DTO/rendering behavior in [github.test.ts](src/github/github.test.ts) and [supervisor-diagnostics-status-selection.test.ts](src/supervisor/supervisor-diagnostics-status-selection.test.ts). I also updated the issue journal at [issue-journal.md](.codex-supervisor/issue-journal.md).

Tests run: `npx tsx --test src/github/github.test.ts --test-name-pattern="fetches REST and GraphQL rate-limit telemetry"`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts --test-name-pattern="GitHub REST and GraphQL rate-limit telemetry"`; `npm run build`.

Summary: Added GitHub REST/GraphQL rate-limit telemetry to supervisor status DTOs and rendered status lines, with focused client and status regression tests.
State hint: implementing
Blocked reason: none
Tests: `npx tsx --test src/github/github.test.ts --test-name-pattern="fetches REST and GraphQL rate-limit telemetry"`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts --test-name-pattern="GitHub REST and GraphQL rate-limit telemetry"`; `npm run build`
Next action: Review the diff and commit this focused status-telemetry slice if it looks correct.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing work for this issue was narrow status-surface wiring, not broader supervisor flow changes; a single lightweight `gh api rate_limit` read can provide both REST and GraphQL budgets without adding a high-churn request pattern.
- What changed: added typed GitHub rate-limit budget types, implemented `GitHubClient.getRateLimitTelemetry()`, threaded the telemetry into `Supervisor.statusReport()`, and rendered `github_rate_limit` lines for both REST and GraphQL in detailed status output.
- Current blocker: none locally.
- Next exact step: review the diff, then commit this telemetry slice once satisfied with the focused verification coverage.
- Verification gap: full `npm test` has not been run this turn; focused GitHub/status telemetry suites and `npm run build` are green.
- Files touched: `src/core/types.ts`; `src/github/github.ts`; `src/github/github.test.ts`; `src/supervisor/supervisor-status-report.ts`; `src/supervisor/supervisor.ts`; `src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low to medium. Status-reporting now performs an extra `gh api rate_limit` read; if that proves too noisy in practice, the fetch point or warning behavior may need adjustment.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts --test-name-pattern="GitHub REST and GraphQL rate-limit telemetry"`
- What changed this turn: reproduced the missing DTO/rendering behavior with a focused failing status test, implemented the telemetry fetch/render path, added a GitHub client parser regression test, and reran focused verification plus a TypeScript build.
- Exact failure reproduced this turn: `statusReport()` returned `githubRateLimit === undefined` and rendered no `github_rate_limit` lines even when the GitHub client exposed REST/GraphQL budget data.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "rate.?limit|graphql|rest" src test docs -g '*.ts' -g '*.tsx' -g '*.md'`; `rg -n "status surface|status dto|status output|SupervisorStatus|status" src test -g '*.ts' -g '*.tsx'`; `rg --files src test`; `sed -n '1,260p' src/supervisor/supervisor-status-model.ts`; `sed -n '1,320p' src/supervisor/supervisor-detailed-status-assembly.ts`; `sed -n '1,340p' src/supervisor/supervisor-status-rendering.ts`; `sed -n '1,260p' src/supervisor/supervisor-status-report.ts`; `rg -n "rate_limit|rateLimit|remaining|resetAt|x-ratelimit|resources" src/core src/github src/supervisor -g '*.ts'`; `sed -n '1,320p' src/core/types.ts`; `sed -n '1,260p' src/supervisor/supervisor-status-model-supervisor.test.ts`; `sed -n '1,420p' src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `sed -n '260,420p' src/core/types.ts`; `sed -n '1,260p' src/supervisor/supervisor-selection-status.ts`; `sed -n '1,340p' src/supervisor/index.ts`; `rg -n "queryStatus\\(|SupervisorStatusDto|detailedStatusLines|renderSupervisorStatusDto|build.*StatusDto|status dto" src/supervisor src/backend src/cli -g '*.ts'`; `sed -n '1,360p' src/supervisor/supervisor-service.ts`; `sed -n '1,340p' src/cli/supervisor-runtime.ts`; `sed -n '940,1185p' src/supervisor/supervisor.ts`; `sed -n '1,260p' src/github/github.ts`; `sed -n '1,340p' src/supervisor/supervisor-selection-active-status.ts`; `sed -n '1,260p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `rg -n "renderSupervisorStatusDto|SupervisorStatusDto|rate limit telemetry|rate_limit" src/*test.ts src/supervisor -g '*.test.ts' -g '*.ts'`; `cat package.json`; `npm test -- --test-name-pattern="GitHub REST and GraphQL rate-limit telemetry"`; `ls`; `test -d node_modules && echo yes || echo no`; `test -f package-lock.json && echo yes || echo no`; `npm ci`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts --test-name-pattern="GitHub REST and GraphQL rate-limit telemetry"`; `node -e 'console.log(new Date(1774572300*1000).toISOString()); console.log(new Date(1774572000*1000).toISOString())'`; `npx tsx --test src/github/github.test.ts --test-name-pattern="fetches REST and GraphQL rate-limit telemetry"`; `npm run build`; `git status --short`; `git diff -- src/core/types.ts src/github/github.ts src/github/github.test.ts src/supervisor/supervisor-status-report.ts src/supervisor/supervisor.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `apply_patch ...`.
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
