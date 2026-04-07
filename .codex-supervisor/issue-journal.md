# Issue #1326: [codex] Document local-review follow-up issue creation as an opt-in flag

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1326
- Branch: codex/issue-1326
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: ff02ebdde0ebb65d975c0138514acb28f17a53c3
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-07T03:11:37.023Z

## Latest Codex Summary
- Added explicit `localReviewFollowUpIssueCreationEnabled: false` coverage to shipped example configs and documented the flag as an opt-in local-review setting in the config and local-review docs.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The runtime default already existed; the missing discoverability gap was that shipped example configs and operator-facing docs did not surface `localReviewFollowUpIssueCreationEnabled` as an explicit opt-in flag.
- What changed: Added a focused `src/config.test.ts` assertion that all shipped example configs carry `localReviewFollowUpIssueCreationEnabled: false`; updated starter/example JSON configs plus `docs/configuration.md`, `docs/local-review.md`, `docs/getting-started.md`, and `docs/examples/atlaspm.md` to document the explicit false default and opt-in behavior.
- Current blocker: none
- Next exact step: Commit the verified docs/example-config change set on `codex/issue-1326` and proceed to PR/draft PR handling if requested by the supervisor loop.
- Verification gap: none for the scoped docs/example-config change; focused test and full build both passed locally.
- Files touched: src/config.test.ts; supervisor.config.example.json; supervisor.config.copilot.json; supervisor.config.codex.json; supervisor.config.coderabbit.json; docs/examples/atlaspm.supervisor.config.example.json; docs/configuration.md; docs/local-review.md; docs/getting-started.md; docs/examples/atlaspm.md
- Rollback concern: low; changes are limited to docs/example-config discoverability plus a focused regression test.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
