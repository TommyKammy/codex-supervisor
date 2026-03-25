# Issue #961: Stale failed PR reconciliation bug: reclassify failed records when the live PR is now blocked

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/961
- Branch: codex/issue-961
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: dd1e5c782fc385f19d69295bc6693985cde6c939
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T03:57:40.423Z

## Latest Codex Summary
- Reproduced the stale failed tracked-PR reconciliation gap with focused `failed -> blocked/manual_review` and `failed -> blocked/verification` tests, then updated stale failed PR reconciliation to reuse live PR lifecycle blocker/failure semantics so restarted supervisors reclassify stale failed records into blocked with fresh `blocked_reason` and failure context. Focused reconciliation/policy/status tests and `npm run build` passed after restoring missing local dev dependencies with `npm ci`. Draft PR `#983` is open.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `reconcileStaleFailedIssueStates()` was explicitly skipping live tracked PRs whose refreshed lifecycle inferred `blocked`, so stale failed records kept generic failure metadata instead of being reclassified to blocked with the live PR blocker reason.
- What changed: added focused regressions in `src/supervisor/supervisor-recovery-reconciliation.test.ts` for stale `failed -> blocked/manual_review` and `failed -> blocked/verification` recovery, then updated `src/recovery-reconciliation.ts` and `src/supervisor/supervisor.ts` so stale failed tracked-PR reconciliation reuses live PR lifecycle inputs to populate blocked state, `blocked_reason`, and fresh failure context/signature metadata.
- Current blocker: none.
- Exact failure reproduced: `reconcileStaleFailedIssueStates` left the record in `failed` when the live tracked PR inferred `blocked`, reproducing as `actual=failed expected=blocked` in the new focused recovery reconciliation tests.
- Commands run: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/pull-request-state-policy.test.ts src/supervisor/supervisor-selection-status-active-status.test.ts`; `npm ci`; `npm run build`.
- Next exact step: monitor CI and review feedback on draft PR `#983`, then address any reported failures or review comments.
- Verification gap: none in the requested local scope after rerunning the focused reconciliation/policy/status tests and build.
- Files touched: `src/recovery-reconciliation.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only affects stale failed tracked-PR reconciliation and now aligns that recovery path with the existing live PR lifecycle blocker/failure semantics.
- Last focused command: `npm run build`
- PR status: draft PR `#983` is open at `https://github.com/TommyKammy/codex-supervisor/pull/983`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
