# Issue #1081: Expose GitHub REST and GraphQL rate-limit telemetry in supervisor status surfaces

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1081
- Branch: codex/issue-1081
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 173a787e09be429ff88c5ff18a00e063ff45966b
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ853FVQv
- Repeated failure signature count: 1
- Updated at: 2026-03-26T17:15:20Z

## Latest Codex Summary
Implemented and stabilized the status-surface telemetry slice for GitHub rate limits. The branch now exposes typed REST and GraphQL budget data in the supervisor status DTO, renders `github_rate_limit` lines in detailed status output, and has focused regression coverage in [src/github/github.test.ts](src/github/github.test.ts) and [src/supervisor/supervisor-diagnostics-status-selection.test.ts](src/supervisor/supervisor-diagnostics-status-selection.test.ts). I pushed the branch and opened draft PR [#1087](https://github.com/TommyKammy/codex-supervisor/pull/1087).

The work is committed as `30536a5` for the implementation and `173a787` for the journal/PR-state update. The only remaining local changes are untracked supervisor runtime artifacts under `.codex-supervisor/`, not source edits.

Summary: Added GitHub REST/GraphQL rate-limit telemetry to supervisor status surfaces, verified the related regression path, and opened draft PR #1087
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/github/github.test.ts --test-name-pattern="fetches REST and GraphQL rate-limit telemetry"`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts --test-name-pattern="GitHub REST and GraphQL rate-limit telemetry"`; `npm run build`; `npm run test:malformed-inventory-regressions`
Next action: Watch draft PR #1087 checks and address any CI or review feedback
Failure signature: PRRT_kwDORgvdZ853FVQv

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1087#discussion_r2996444310
- Details:
  - src/supervisor/supervisor.ts:1000 _⚠️ Potential issue_ | _🟠 Major_ **Fetch rate-limit telemetry after the rest of the status reads.** This snapshot is taken before `buildReadinessSummary(...)` / `loadActiveIssueStatusSnapshot(...)`, so the returned budgets can be stale by the requests used to build the same status response. Near the limit that can misreport a budget as `low` instead of `exhausted` (or `healthy` instead of `low`). Move the `getRateLimitTelemetry()` read to the end of each branch, including the inactive error path, so operators see the post-status budget they actually have left. <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/supervisor/supervisor.ts` around lines 983 - 1000, The github rate-limit telemetry is being read too early (before buildReadinessSummary/loadActiveIssueStatusSnapshot) causing stale budget reporting; move the getRateLimitTelemetry() invocation (use githubWithRateLimitTelemetry.getRateLimitTelemetry when present) to the end of each branch—after buildReadinessSummary(...) and loadActiveIssueStatusSnapshot(...) and also in the inactive/error path—so githubRateLimit and githubRateLimitWarning are set only after the status snapshot is built; keep the same error handling (catch setting githubRateLimitWarning = error instanceof Error ? error.message : String(error)) and preserve use of renderGitHubRateLimitLine for the final githubRateLimitLines. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the open review finding is valid because `statusReport()` was sampling GitHub rate-limit telemetry before inactive selection work and active issue status reads, so near-limit status output could lag behind the requests used to build it.
- What changed: moved GitHub rate-limit telemetry collection behind a local `loadGitHubRateLimitStatus()` helper that now runs immediately before each `statusReport()` return path, preserving warning handling and rendered `github_rate_limit` lines; added focused inactive/active call-order coverage in `src/supervisor/supervisor-diagnostics-status-selection.test.ts`.
- Current blocker: none locally.
- Next exact step: commit and push this review fix to PR `#1087`, then reply on the CodeRabbit thread with the ordering change and focused regression coverage.
- Verification gap: full `npm test` has not been rerun this turn; `npm run build` and focused status telemetry regressions are green.
- Files touched: `src/supervisor/supervisor.ts`; `src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The change only moves when telemetry is fetched within `statusReport()` and adds ordering assertions.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts --test-name-pattern="statusReport exposes GitHub REST and GraphQL rate-limit telemetry in typed and rendered status surfaces|statusReport fetches GitHub rate-limit telemetry after inactive selection reads|statusReport fetches GitHub rate-limit telemetry after active issue reads"`
- What changed this turn: reread the required memory files and journal, confirmed the review finding against the live `statusReport()` control flow, deferred telemetry fetches to the end of inactive and active status branches, added call-order tests, and reran focused verification plus `npm run build`.
- Exact failure reproduced this turn: code inspection confirmed `getRateLimitTelemetry()` was called before `buildReadinessSummary(...)`, `buildSelectionWhySummary(...)`/`buildSelectionSummary(...)`, and `loadActiveIssueStatusSnapshot(...)`; an initial version of the inactive ordering test also showed that `why=true` performs two separate selection-summary GitHub read passes before telemetry is fetched.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1081/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1081/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short`; `rg -n "getRateLimitTelemetry|githubRateLimit|buildReadinessSummary|loadActiveIssueStatusSnapshot|renderGitHubRateLimitLine" src/supervisor/supervisor.ts src/supervisor/supervisor-status-report.ts src/github/github.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `sed -n '930,1070p' src/supervisor/supervisor.ts`; `sed -n '1070,1255p' src/supervisor/supervisor.ts`; `nl -ba src/supervisor/supervisor.ts | sed -n '975,1245p'`; `sed -n '1,240p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `sed -n '240,520p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `sed -n '1,260p' src/supervisor/supervisor-test-helpers.ts`; `sed -n '1,260p' src/supervisor/supervisor-selection-readiness-summary.ts`; `sed -n '1,260p' src/supervisor/supervisor-selection-active-status.ts`; `apply_patch ...`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts --test-name-pattern="rate-limit telemetry|fetches GitHub rate-limit telemetry after inactive selection reads|fetches GitHub rate-limit telemetry after active issue reads"`; `npm run build`; `git diff --check`; `apply_patch ...`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts --test-name-pattern="statusReport exposes GitHub REST and GraphQL rate-limit telemetry in typed and rendered status surfaces|statusReport fetches GitHub rate-limit telemetry after inactive selection reads|statusReport fetches GitHub rate-limit telemetry after active issue reads"`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
