# Issue #885: Local CI visibility: persist and surface the latest pre-PR verification result

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/885
- Branch: codex/issue-885
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0028afa11b61b958d6167df67d63e68f4e3f8685
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T15:23:48Z

## Latest Codex Summary
- Persisted concise latest local-CI results on issue records, surfaced typed `localCiStatus` in status/explain activity context and replay snapshots, and added readable `local_ci_result` lines to status/explain output.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue `#885` was missing a durable, operator-visible latest local-CI result because the supervisor only persisted the configured contract and transient failure context, not the latest pass/fail summary tied to the issue record.
- What changed: added optional `latest_local_ci_result` metadata to `IssueRunRecord`; updated `runLocalCiGate` to return concise pass/fail result summaries; persisted the latest result on all three local-CI gate paths in `src/run-once-issue-preparation.ts`, `src/run-once-turn-execution.ts`, and `src/post-turn-pull-request.ts`; projected that state into typed `localCiStatus` activity context in `src/supervisor/supervisor-operator-activity-context.ts`; surfaced it through status/explain text rendering and replay snapshots in `src/supervisor/supervisor-detailed-status-assembly.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`, and `src/supervisor/supervisor-cycle-snapshot.ts`; and added focused regressions plus fixture updates in the supervisor status/explain/replay tests and supporting service/http tests.
- Current blocker: none
- Next exact step: review the diff, then commit the local-CI visibility change on `codex/issue-885` and open or update the draft PR if needed.
- Verification gap: none on the requested issue verification surface.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.test.ts`, `src/core/types.ts`, `src/local-ci.ts`, `src/post-turn-pull-request.test.ts`, `src/post-turn-pull-request.ts`, `src/run-once-issue-preparation.ts`, `src/run-once-turn-execution.ts`, `src/supervisor/supervisor-cycle-snapshot.test.ts`, `src/supervisor/supervisor-cycle-snapshot.ts`, `src/supervisor/supervisor-detailed-status-assembly.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-operator-activity-context.ts`, `src/supervisor/supervisor-selection-issue-explain.test.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`, `src/supervisor/supervisor-service.test.ts`
- Rollback concern: low; the behavior change is additive and concise, but partially reverting the persistence without the typed status projection would leave stale or missing operator visibility.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts`
- Last focused failure: `npm run build` initially failed with `sh: 1: tsc: not found` because this worktree had no installed `node_modules`; running `npm install` restored the declared dev dependency and the build then passed.
- Last focused commands:
```bash
sed -n '1,220p' <LOCAL_MEMORY_ROOT>/TommyKammy-codex-supervisor/issue-885/AGENTS.generated.md
sed -n '1,260p' <LOCAL_MEMORY_ROOT>/TommyKammy-codex-supervisor/issue-885/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "local-ci|localCi|verification" src .codex-supervisor -g '*.ts' -g '*.md'
sed -n '1,220p' src/local-ci.ts
sed -n '330,390p' src/run-once-issue-preparation.ts
sed -n '418,455p' src/run-once-turn-execution.ts
sed -n '245,285p' src/post-turn-pull-request.ts
sed -n '1,320p' src/supervisor/supervisor-operator-activity-context.ts
sed -n '1,320p' src/supervisor/supervisor-selection-issue-explain.ts
sed -n '1,320p' src/supervisor/supervisor-cycle-snapshot.ts
apply_patch
npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts
npx tsx --test src/local-ci.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts
cat package.json
npm ls typescript --depth=0
npm install
npm run build
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
