# Issue #917: Final evaluation visibility: surface pending and resolved pre-merge evaluation state clearly

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/917
- Branch: codex/issue-917
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 407efb7d3efe8262e59a04d51f792b2a616d860f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T01:41:22.605Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the typed pre-merge assessment snapshot already captures the right evidence, but operator-facing `status` and `explain` still need a shared observational summary that turns the current local-review artifact into pending, passed, blocked, or follow-up-eligible final-evaluation visibility.
- What changed: added `src/supervisor/supervisor-pre-merge-evaluation.ts` to derive a typed pre-merge evaluation DTO and a rendered `pre_merge_evaluation ...` status line from the current local-review artifact plus head-drift state; threaded that DTO into operator activity context so `status` and `explain` both surface the same final-evaluation state and reason; added focused coverage in `src/supervisor/supervisor-selection-status-active-status.test.ts`, `src/supervisor/supervisor-selection-issue-explain.test.ts`, and `src/supervisor/supervisor-status-model-supervisor.test.ts`, and updated typed DTO expectations in the existing supervisor status/explain tests.
- Current blocker: none
- Next exact step: commit the observational visibility change, update draft PR `#931`, and let CI confirm the targeted operator-facing status/explain coverage stays green.
- Verification gap: focused status/explain tests and `npm run build` passed after `npm ci`; `npx tsx --test src/**/*.test.ts` still reports unrelated repository-wide failures outside this issue (`src/backend/webui-dashboard-browser-smoke.test.ts` missing `playwright-core`, `src/external-review/external-review-alignment.test.ts` alignment failure, and pre-existing readiness/status expectation drift in `src/supervisor/supervisor-pr-readiness.test.ts` and `src/supervisor/supervisor-status-rendering.test.ts`).
- Files touched: `src/supervisor/supervisor-pre-merge-evaluation.ts`, `src/supervisor/supervisor-operator-activity-context.ts`, `src/supervisor/supervisor-selection-active-status.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`, `src/supervisor/supervisor-status-model.ts`, `src/supervisor/supervisor-selection-status-active-status.test.ts`, `src/supervisor/supervisor-selection-issue-explain.test.ts`, `src/supervisor/supervisor-status-model-supervisor.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-service.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; the change is observational-only and only enriches typed operator status/explain surfaces from existing local-review artifacts without changing merge gating or lifecycle state decisions.
- Last focused command: `npm ci && npm run build && npx tsx --test src/supervisor/supervisor-selection-status-active-status.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-service.test.ts`
- Last focused failure: `npx tsx --test src/**/*.test.ts` still fails in unrelated existing areas (`Cannot find module 'playwright-core'` for the browser smoke test plus pre-existing repository-wide expectation drift in readiness/status suites), but the new final-evaluation visibility coverage added in this turn passes.
- Draft PR: `#931` https://github.com/TommyKammy/codex-supervisor/pull/931
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-917/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-917/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
git branch --show-current
git log --oneline --decorate -5
rg -n "final evaluation|pre-merge|assessment-snapshot|follow-up-eligible|blocked|pending" src
sed -n '1,360p' src/supervisor/supervisor-selection-active-status.ts
sed -n '1,420p' src/supervisor/supervisor-selection-issue-explain.ts
sed -n '1,360p' src/supervisor/supervisor-status-model.ts
npx tsx --test src/supervisor/supervisor-selection-status-active-status.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts
npx tsx --test src/supervisor/supervisor-selection-status-active-status.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-service.test.ts
npx tsx --test src/**/*.test.ts
npm ci
npm run build
npx tsx --test src/supervisor/supervisor-selection-status-active-status.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-service.test.ts
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
