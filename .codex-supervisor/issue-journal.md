# Issue #952: Observational artifact safety: keep metrics and audit writes non-gating across execution and reconciliation paths

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/952
- Branch: codex/issue-952
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 425ed1b08b1ec1b4f17b53da77192ef95ca6ed54
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T21:26:24Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: execution and reconciliation already route observational metrics and post-merge audit persistence through non-gating wrappers; the issue needs focused regressions proving merged-convergence outcomes stay `done` even when post-merge audit persistence fails.
- What changed: added `prepareIssueExecutionContext keeps merged-PR convergence done when audit persistence fails` in `src/run-once-issue-preparation.test.ts` and `reconcileTrackedMergedButOpenIssues keeps merged convergence done when audit persistence fails` in `src/supervisor/supervisor-recovery-reconciliation.test.ts`; each test forces the audit artifact path to fail by pointing `localReviewArtifactDir` at a file, then asserts the warning is logged while the intended `done` outcome and cleanup still happen.
- Current blocker: none.
- Next exact step: commit the focused regression coverage, open or update the draft PR for `codex/issue-952`, and watch for CI/review feedback.
- Verification gap: none in the requested scope; `npx tsx --test src/run-once-turn-execution.test.ts src/run-once-issue-preparation.test.ts src/recovery-reconciliation.test.ts src/supervisor/post-merge-audit-artifact.test.ts src/supervisor/execution-metrics-run-summary.test.ts` and `npm run build` both passed after running `npm ci` to restore local dev dependencies.
- Files touched: `src/run-once-issue-preparation.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the patch only adds regression coverage and does not change runtime behavior.
- Last focused command: `npm run build`
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
