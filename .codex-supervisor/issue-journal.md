# Issue #553: Recovery visibility: surface the latest recovery reason in status output

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/553
- Branch: codex/issue-553
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: a0a2f35b8a5dce01c2c587b852a4ea2a04c0263a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T15:11:47.259Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: status rendering already surfaced `latest_recovery`, but it was still dumping the full persisted `code: explanation` string into `reason=...`, which was noisier than intended for normal CLI status output.
- What changed: added a focused status regression for an active recovered issue, introduced `formatLatestRecoveryStatusLine(...)` so status output splits persisted recovery metadata into compact `reason=<code>` and `detail=<stored explanation>` fields, and updated the active/idle status tests to assert the new rendering.
- Current blocker: none
- Next exact step: monitor draft PR #570 and respond to any review or CI feedback.
- Verification gap: broader full-suite verification has not been run.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-detailed-status-assembly.ts`, `src/supervisor/supervisor-status-model.ts`, `src/supervisor/supervisor-status-model-supervisor.test.ts`, `src/supervisor/supervisor-status-rendering.test.ts`, `src/supervisor/supervisor-status-rendering-supervisor.test.ts`
- Rollback concern: reverting the formatter would bring back the raw `code: explanation` recovery string in normal status output, making the latest recovery line harder to scan during triage.
- Last focused command: `npx tsx --test src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Pushed `codex/issue-553` and opened draft PR #570 for the compact latest-recovery status rendering change.
- 2026-03-19 (JST): Added a focused repro in `src/supervisor/supervisor-status-rendering.test.ts` for an active recovered record whose `last_recovery_reason` was rendered as a raw `tracked_pr_head_advanced: ...` string; implemented compact `reason=` / `detail=` status rendering via `formatLatestRecoveryStatusLine(...)`; reran focused status + recovery tests and `npm run build` after restoring local dependencies with `npm install`.
- 2026-03-18 (JST): Reran the focused recovery/lifecycle tests and `npm run build`, pushed `codex/issue-552`, and opened draft PR #569.
- 2026-03-18 (JST): Added a narrow repro in `src/supervisor/supervisor-recovery-reconciliation.test.ts` for a failed record with `repeated_failure_signature_count=3` that resumes after tracked PR `#191` advances from `head-old-191` to `head-new-191`; the initial focused failure was `last_recovery_reason === null`.
- 2026-03-18 (JST): Implemented deterministic tracked-PR resume recovery reasons in `src/recovery-reconciliation.ts`, distinguishing head-advance resumptions from same-head fresh-facts resumptions, and persisted them with `applyRecoveryEvent(...)`.
- 2026-03-18 (JST): `npm run build` initially failed with `sh: 1: tsc: not found`; ran `npm install` to restore the local toolchain, then reran focused tests and the build successfully.
