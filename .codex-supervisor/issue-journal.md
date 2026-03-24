# Issue #918: Final evaluation gate: block merge completion until the pre-merge assessment resolves cleanly

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/918
- Branch: codex/issue-918
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 5c8f95547ab22406d1448fe6e84e2a966f5e36f8
- Blocked reason: none
- Last failure signature: external-review-family-layout-module-list-drift
- Repeated failure signature count: 1
- Updated at: 2026-03-24T03:00:10Z

## Latest Codex Summary
Addressed the three automated review findings on draft PR [#933](https://github.com/TommyKammy/codex-supervisor/pull/933). `block_ready` now requires a fresh local review only when local review is enabled, the post-turn merge recheck carries the refreshed PR snapshot through state updates and execution metrics, and generated memory artifacts plus this journal no longer embed operator-local absolute paths.

Added focused regression coverage for stale review heads, refreshed merge snapshots, generated memory path rendering, and local-review status output under enabled gating. The branch head remains `5c8f955`; only the untracked local `.codex-supervisor/replay/` output is outside the tracked changes.

Summary: Addressed PR `#933` review feedback and normalized tracked/generated path rendering
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/review-handling.test.ts src/pull-request-state-policy.test.ts src/supervisor/supervisor-pr-readiness.test.ts src/core/memory.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-model.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm run build`; `npx tsx --test src/**/*.test.ts` still fails only in unrelated `src/external-review/external-review-family-layout.test.ts`
Next action: commit the review fixes, push `codex/issue-918`, and resolve the PR `#933` review threads
Failure signature: external-review-family-layout-module-list-drift

## Active Failure Context
- Category: verification
- Summary: Full-suite verification still has one unrelated existing failure outside issue #918.
- Reference: src/external-review/external-review-family-layout.test.ts
- Details:
  - The expected runtime module list is stale.
  - Runtime now includes `external-review-miss-digest.ts` and `external-review-prevention-targets.ts`.

## Codex Working Notes
### Current Handoff
- Hypothesis: the PR review findings are resolved on this branch; only the longstanding unrelated external-review layout test remains outside issue #918 scope.
- What changed: tightened `localReviewBlocksReady` so stale or missing reviews block the ready transition only when local review is enabled; carried refreshed PR snapshots through `handlePostTurnMergeAndCompletion` state/metrics updates; rendered generated memory artifact paths relative to the workspace; updated readiness and status regression coverage to match the enabled-gating contract; redacted operator-local paths from this tracked journal.
- Current blocker: none
- Next exact step: commit these review fixes, push `codex/issue-918`, and resolve the PR `#933` review threads.
- Verification gap: `npm run build` and the issue-relevant targeted suites pass; full `src/**/*.test.ts` still fails only at unrelated `src/external-review/external-review-family-layout.test.ts`.
- Files touched: `src/core/memory.ts`, `src/core/memory.test.ts`, `src/pull-request-state-policy.test.ts`, `src/review-handling.ts`, `src/review-handling.test.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-pr-readiness.test.ts`, `src/supervisor/supervisor-status-model-supervisor.test.ts`, `src/supervisor/supervisor-status-model.test.ts`, `src/supervisor/supervisor-status-rendering-supervisor.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low-moderate; reverting would reopen the stale-review ready transition, stale-head merge race, and operator-local path leakage in tracked/generated artifacts.
- Last focused command: `npx tsx --test src/**/*.test.ts`
- Last focused failure: `npx tsx --test src/**/*.test.ts` now fails only at `src/external-review/external-review-family-layout.test.ts` because the expected runtime module list is stale (`external-review-miss-digest.ts` and `external-review-prevention-targets.ts` are present but not reflected in the test).
- Draft PR: `#933` https://github.com/TommyKammy/codex-supervisor/pull/933
- Last focused commands:
```bash
sed -n '1,220p' ../../codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-918/AGENTS.generated.md
sed -n '1,260p' ../../codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-918/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
sed -n '1,220p' src/review-handling.ts
sed -n '740,860p' src/supervisor/supervisor.ts
sed -n '1,220p' src/core/memory.ts
npx tsx --test src/review-handling.test.ts src/pull-request-state-policy.test.ts src/supervisor/supervisor-pr-readiness.test.ts src/core/memory.test.ts
npx tsx --test src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-model.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts
npm run build
npx tsx --test src/**/*.test.ts
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
