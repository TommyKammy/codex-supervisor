# Issue #1329: Add config and validation for same-PR local-review follow-up repair

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1329
- Branch: codex/issue-1329
- Workspace: .
- Journal: .codex-supervisor/issues/1329/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: ef8404d0d043ad8daab82e52e73f1fc24c2bd67f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-07T12:07:54.670Z

## Latest Codex Summary
- Added `localReviewFollowUpRepairEnabled` to the typed config and loader with a default of `false`, plus fail-closed validation that rejects enabling it together with `localReviewFollowUpIssueCreationEnabled`.
- Added focused config coverage for the new default, explicit opt-in, mutual-exclusion failure, and shipped example defaults.
- Updated configuration and local-review docs plus shipped example configs to document same-PR repair versus explicit follow-up issue creation.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: This issue is isolated to config/documentation plumbing; a narrow config test should reproduce the missing same-PR repair surface and the lack of fail-closed validation.
- What changed: Added `localReviewFollowUpRepairEnabled` to `SupervisorConfig` and `loadConfig`, reject configs that also enable `localReviewFollowUpIssueCreationEnabled`, extended `src/config.test.ts`, and updated shipped config examples plus local-review docs to keep the new flag explicitly off by default.
- Current blocker: none
- Next exact step: Create a checkpoint commit on `codex/issue-1329`, then open or update a draft PR if the supervisor loop wants an early checkpoint published.
- Verification gap: No runtime routing change tests were needed here because this child issue only adds config and validation; broader same-PR repair behavior remains for later child issues.
- Files touched: src/core/types.ts; src/core/config.ts; src/config.test.ts; supervisor.config.example.json; supervisor.config.copilot.json; supervisor.config.codex.json; supervisor.config.coderabbit.json; docs/examples/atlaspm.supervisor.config.example.json; docs/configuration.md; docs/local-review.md; docs/examples/atlaspm.md; docs/getting-started.md
- Rollback concern: Low. The new field defaults to `false`, and the only behavior change is fail-closed rejection of an invalid double-opt-in config.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
