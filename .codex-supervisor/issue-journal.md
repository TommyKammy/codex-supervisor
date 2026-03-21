# Issue #768: Waiting PR recheck cadence: reevaluate waiting_ci faster after provider progress

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/768
- Branch: codex/issue-768
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 492e19b6de692fc996e3d8c9dab764768202f1cd
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T10:40:10Z

## Latest Codex Summary
- Added a `waiting_ci`-specific cadence selector that uses `mergeCriticalRecheckSeconds` only for fresh PR/provider-progress waits on the active issue, switched the loop runtime to re-read cadence between cycles, verified the targeted suites plus `npm run build`, committed `492e19b`, and opened draft PR `#772`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the regression is confined to loop cadence selection, because `waiting_ci` lifecycle state already records fresh PR/provider progress but the runtime always sleeps on the general cadence captured at loop startup.
- What changed: added `selectSupervisorPollIntervalMs` to keep the faster cadence limited to active `waiting_ci` records with fresh current-head progress (`review_wait_started_at`, `copilot_review_requested_observed_at`, or `provider_success_observed_at`); changed `Supervisor.pollIntervalMs()` to read the active state and pick the effective cadence; and changed the loop runtime to query cadence before each sleep instead of caching it once.
- Current blocker: none
- Next exact step: watch draft PR `#772` CI and address any review or verification feedback that appears.
- Verification gap: none in the focused suites; `.codex-supervisor/replay/` remains untracked and untouched.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/cli/supervisor-runtime.test.ts`, `src/cli/supervisor-runtime.ts`, `src/supervisor/supervisor-lifecycle.test.ts`, `src/supervisor/supervisor-lifecycle.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: reverting the runtime cadence refresh without reverting the selector would leave the `waiting_ci` recheck policy partially implemented but ineffective in long-running loop mode.
- Last focused command: `gh pr create --draft --base main --head codex/issue-768 --title "Tighten waiting_ci recheck cadence after provider progress" --body ...`
- Last focused failure: `none`
- Last focused commands:
```bash
npx tsx --test src/supervisor/supervisor-lifecycle.test.ts
npx tsx --test src/cli/supervisor-runtime.test.ts
npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts src/supervisor/supervisor-lifecycle.test.ts
npm install
npm run build
git commit -m "Tighten waiting-ci recheck cadence"
git push -u origin codex/issue-768
gh pr create --draft --base main --head codex/issue-768 --title "Tighten waiting_ci recheck cadence after provider progress" --body ...
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
