# Issue #1081: Expose GitHub REST and GraphQL rate-limit telemetry in supervisor status surfaces

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1081
- Branch: codex/issue-1081
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: eef2c311bc710c9707e3e123c83bda221c1f4bb2
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-26T17:17:13Z

## Latest Codex Summary
Addressed the remaining review feedback on the GitHub rate-limit telemetry slice. `Supervisor.statusReport()` now fetches telemetry after inactive selection reads and active issue status reads, so the reported REST/GraphQL budgets reflect the post-status snapshot rather than a stale pre-read sample.

The review fix is committed as `eef2c31`, pushed to `codex/issue-1081`, and the CodeRabbit thread `PRRT_kwDORgvdZ853FVQv` is resolved. Focused regression coverage in [src/supervisor/supervisor-diagnostics-status-selection.test.ts](src/supervisor/supervisor-diagnostics-status-selection.test.ts) now asserts the inactive and active call ordering directly.

Summary: Deferred status rate-limit telemetry reads until after branch-specific status work, pushed the review fix, and resolved the remaining automated thread on PR #1087
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts --test-name-pattern="statusReport exposes GitHub REST and GraphQL rate-limit telemetry in typed and rendered status surfaces|statusReport fetches GitHub rate-limit telemetry after inactive selection reads|statusReport fetches GitHub rate-limit telemetry after active issue reads"`; `npm run build`
Next action: Confirm PR #1087 has no remaining unresolved review threads and wait for any follow-up review or CI signal
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the open review finding is valid because `statusReport()` was sampling GitHub rate-limit telemetry before inactive selection work and active issue status reads, so near-limit status output could lag behind the requests used to build it.
- What changed: moved GitHub rate-limit telemetry collection behind a local `loadGitHubRateLimitStatus()` helper that now runs immediately before each `statusReport()` return path, preserving warning handling and rendered `github_rate_limit` lines; added focused inactive/active call-order coverage in `src/supervisor/supervisor-diagnostics-status-selection.test.ts`; committed the review fix as `eef2c31`, pushed `codex/issue-1081`, and resolved CodeRabbit thread `PRRT_kwDORgvdZ853FVQv`.
- Current blocker: none locally.
- Next exact step: watch PR `#1087` for any follow-up review or CI signal now that the remaining automated thread is resolved.
- Verification gap: full `npm test` has not been rerun this turn; `npm run build` and focused status telemetry regressions are green.
- Files touched: `src/supervisor/supervisor.ts`; `src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The change only moves when telemetry is fetched within `statusReport()` and adds ordering assertions.
- Last focused command: `gh api graphql -f query='mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { isResolved } } }' -F threadId=PRRT_kwDORgvdZ853FVQv`
- What changed this turn: reread the required memory files and journal, confirmed the review finding against the live `statusReport()` control flow, deferred telemetry fetches to the end of inactive and active status branches, added call-order tests, reran focused verification plus `npm run build`, pushed commit `eef2c31`, and resolved the remaining automated review thread on PR `#1087`.
- Exact failure reproduced this turn: code inspection confirmed `getRateLimitTelemetry()` was called before `buildReadinessSummary(...)`, `buildSelectionWhySummary(...)`/`buildSelectionSummary(...)`, and `loadActiveIssueStatusSnapshot(...)`; an initial version of the inactive ordering test also showed that `why=true` performs two separate selection-summary GitHub read passes before telemetry is fetched.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1081/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1081/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short`; `rg -n "getRateLimitTelemetry|githubRateLimit|buildReadinessSummary|loadActiveIssueStatusSnapshot|renderGitHubRateLimitLine" src/supervisor/supervisor.ts src/supervisor/supervisor-status-report.ts src/github/github.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `sed -n '930,1070p' src/supervisor/supervisor.ts`; `sed -n '1070,1255p' src/supervisor/supervisor.ts`; `nl -ba src/supervisor/supervisor.ts | sed -n '975,1245p'`; `sed -n '1,240p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `sed -n '240,520p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `sed -n '1,260p' src/supervisor/supervisor-test-helpers.ts`; `sed -n '1,260p' src/supervisor/supervisor-selection-readiness-summary.ts`; `sed -n '1,260p' src/supervisor/supervisor-selection-active-status.ts`; `apply_patch ...`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts --test-name-pattern="rate-limit telemetry|fetches GitHub rate-limit telemetry after inactive selection reads|fetches GitHub rate-limit telemetry after active issue reads"`; `npm run build`; `git diff --check`; `apply_patch ...`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts --test-name-pattern="statusReport exposes GitHub REST and GraphQL rate-limit telemetry in typed and rendered status surfaces|statusReport fetches GitHub rate-limit telemetry after inactive selection reads|statusReport fetches GitHub rate-limit telemetry after active issue reads"`; `git add src/supervisor/supervisor.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts .codex-supervisor/issue-journal.md && git commit -m "Defer status rate-limit telemetry until final snapshot"`; `git push origin codex/issue-1081`; `gh api graphql -f query='mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { isResolved } } }' -F threadId=PRRT_kwDORgvdZ853FVQv`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git rev-parse HEAD`.
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
