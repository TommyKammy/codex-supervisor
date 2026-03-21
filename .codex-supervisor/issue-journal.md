# Issue #711: Trust enforcement: gate autonomous execution on explicit trusted-input or safer-mode policy

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/711
- Branch: codex/issue-711
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 3ae8a753a483fb57b1f1da672c917cce486777f3
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T06:07:49Z

## Latest Codex Summary
- Added a narrow safer-mode trust gate for autonomous execution. Unlabeled GitHub-authored issue/review input now blocks before reservation handoff, while `trusted-input` issues remain runnable and readiness/status output reports the decision explicitly.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: enforcement belonged in issue selection, not deep in the Codex runner, so safer-mode trust gating could fail closed before consuming a turn and still surface a deterministic operator-facing reason.
- What changed: added `src/supervisor/supervisor-trust-gate.ts` with a narrow `trusted-input` label rule. `resolveRunnableIssueContext()` now blocks safer-mode autonomous execution when `trustMode=untrusted_or_mixed` and `executionSafetyMode=operator_gated` unless the issue has the `trusted-input` label, while trusted-repo mode or explicit unsafe override still allow execution. Readiness and explain/status paths now report `blocked_by=trust_gate:trusted-input-required` and still treat previously trust-gated records as selectable once the issue becomes trusted.
- Current blocker: none
- Next exact step: review the diff, commit the trust-gate checkpoint on `codex/issue-711`, and open or update a draft PR if needed.
- Verification gap: none in the implemented scope after installing local dev dependencies in this worktree.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/run-once-issue-selection.ts`, `src/run-once-issue-selection.test.ts`, `src/supervisor/supervisor-trust-gate.ts`, `src/supervisor/supervisor-selection-readiness-summary.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`
- Rollback concern: removing the selection-stage trust gate or readiness/explain wiring would silently restore autonomous execution for untrusted GitHub-authored issue/review input in `operator_gated` safer mode.
- Last focused command: `npx tsx --test src/run-once-issue-selection.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts && npm run build`
- Last focused failure: `npm run build` initially failed with `sh: 1: tsc: not found` before running `npm install` in this worktree.
- Last focused commands:
```bash
npx tsx --test src/run-once-issue-selection.test.ts
npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts
npx tsx --test src/run-once-issue-selection.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
npm run build
npm install
git status --short
git diff -- src/run-once-issue-selection.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor-trust-gate.ts src/supervisor/supervisor-selection-readiness-summary.ts src/supervisor/supervisor-selection-issue-explain.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts .codex-supervisor/issue-journal.md
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
