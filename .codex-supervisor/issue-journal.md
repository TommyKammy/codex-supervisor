# Issue #767: Merge latency config: add a dedicated recheck cadence for merge-critical PR states

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/767
- Branch: codex/issue-767
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 5ec4a3cf16c49c0a02a587d4fbb8b7649e156564
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T08:38:09.096Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #767 only needed a narrow config-surface change, because the scheduler already has a global poll cadence and the acceptance criteria explicitly exclude applying a faster merge-critical loop yet.
- What changed: added optional `mergeCriticalRecheckSeconds` parsing with conservative integer validation and disabled fallback semantics; added shared cadence diagnostics summarization; surfaced cadence visibility in `doctor` and `status`; and added focused tests in `src/config.test.ts`, `src/doctor.test.ts`, and `src/supervisor/supervisor-diagnostics-status-selection.test.ts`.
- Current blocker: none
- Next exact step: commit the config/visibility change, then open or update the branch PR if one is not already present.
- Verification gap: `npm run build` initially failed only because local dependencies were missing and was re-run successfully after `npm ci`; the untracked `.codex-supervisor/replay/` workspace artifact remains present but was not touched.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/config.test.ts`, `src/core/config.ts`, `src/core/types.ts`, `src/doctor.test.ts`, `src/doctor.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-status-report.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: removing the cadence-summary helper or the new renderer lines would drop the explicit visibility promised by issue #767 even though runtime polling behavior would still fall back safely.
- Last focused command: `npm run build`
- Last focused failure: `none`
- Last focused commands:
```bash
npx tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
npm ci
npm run build
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
