# Issue #918: Final evaluation gate: block merge completion until the pre-merge assessment resolves cleanly

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/918
- Branch: codex/issue-918
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 559aabdc4850e2416b9cb1afdc9d775b88d4ef74
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T02:36:14.802Z

## Latest Codex Summary
Implemented the final-evaluation gate and committed it as `559aabd` (`Gate merge completion on final evaluation resolution`).

The change persists pre-merge final-evaluation outcomes on the issue record, uses those outcomes to block both draft-to-ready and ready-to-merge transitions for unresolved or blocked `block_merge` reviews, and still allows `follow_up_eligible` assessments to proceed. I also updated the affected readiness and status-rendering tests and recorded the turn in the issue journal.

Verification: `npm ci`, `npm run build`, `npx tsx --test src/pull-request-state-policy.test.ts src/supervisor/supervisor-pr-readiness.test.ts`, `npx tsx --test src/supervisor/supervisor-status-rendering-supervisor.test.ts src/supervisor/supervisor-status-rendering.test.ts src/pull-request-state-policy.test.ts src/supervisor/supervisor-pr-readiness.test.ts`, and `npx tsx --test src/**/*.test.ts`. The full suite now has one remaining unrelated failure in `src/external-review/external-review-family-layout.test.ts`, which still expects an older external-review module list.

Summary: Added durable final-evaluation gating for merge progression, committed as `559aabd`, and reduced full-suite failures to one unrelated external-review layout test.
State hint: local_review
Blocked reason: none
Tests: `npm ci`; `npm run build`; `npx tsx --test src/pull-request-state-policy.test.ts src/supervisor/supervisor-pr-readiness.test.ts`; `npx tsx --test src/supervisor/supervisor-status-rendering-supervisor.test.ts src/supervisor/supervisor-status-rendering.test.ts src/pull-request-state-policy.test.ts src/supervisor/supervisor-pr-readiness.test.ts`; `npx tsx --test src/**/*.test.ts` (1 unrelated failure remains)
Next action: push `codex/issue-918` and update the draft PR with the verification note that only `src/external-review/external-review-family-layout.test.ts` remains failing and is unrelated
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: merge gating now needs to read a durable current-head final-evaluation outcome from the issue record so synchronous PR lifecycle decisions can distinguish unresolved, blocked, and follow-up-eligible local-review results without re-reading artifacts.
- What changed: added persisted pre-merge final-evaluation fields to `IssueRunRecord` plus state-store normalization; recorded final-evaluation outcome/counts when local review runs; changed `localReviewBlocksReady` and `localReviewBlocksMerge` so `block_merge` requires a resolved current-head final evaluation and allows only `mergeable` or `follow_up_eligible`; guarded `handlePostTurnMergeAndCompletion` so stale `ready_to_merge` records still refuse auto-merge when the final evaluation is unresolved or blocked; updated focused lifecycle/policy tests plus affected status-rendering expectations to reflect the stricter gate.
- Current blocker: none
- Next exact step: monitor draft PR `#933` and either address review/CI feedback or, if the unrelated external-review layout failure needs cleanup on this branch, decide explicitly whether to follow it up separately.
- Verification gap: issue-relevant focused tests and `npm run build` now pass after `npm ci`; the full suite is down to one unrelated existing failure in `src/external-review/external-review-family-layout.test.ts`.
- Files touched: `src/core/types.ts`, `src/core/state-store.ts`, `src/review-handling.ts`, `src/post-turn-pull-request.ts`, `src/supervisor/supervisor.ts`, `src/pull-request-state-policy.test.ts`, `src/supervisor/supervisor-pr-readiness.test.ts`, `src/supervisor/supervisor-status-rendering-supervisor.test.ts`, `src/supervisor/supervisor-status-rendering.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: moderate-low; the change alters merge gating behavior for `block_merge` local review by requiring a current-head resolved final evaluation, so rollback would reopen the path where blocked or unresolved assessments can still mark PRs ready or enable auto-merge.
- Last focused command: `npm ci && npm run build && npx tsx --test src/pull-request-state-policy.test.ts src/supervisor/supervisor-pr-readiness.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts src/supervisor/supervisor-status-rendering.test.ts && npx tsx --test src/**/*.test.ts`
- Last focused failure: `npx tsx --test src/**/*.test.ts` now fails only at `src/external-review/external-review-family-layout.test.ts` because the expected runtime module list is stale (`external-review-miss-digest.ts` and `external-review-prevention-targets.ts` are present but not reflected in the test).
- Draft PR: `#933` https://github.com/TommyKammy/codex-supervisor/pull/933
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-918/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-918/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
git branch --show-current
git log --oneline --decorate -5
npm ci
npm run build
npx tsx --test src/pull-request-state-policy.test.ts src/supervisor/supervisor-pr-readiness.test.ts
npx tsx --test src/supervisor/supervisor-status-rendering-supervisor.test.ts src/supervisor/supervisor-status-rendering.test.ts src/pull-request-state-policy.test.ts src/supervisor/supervisor-pr-readiness.test.ts
npx tsx --test src/**/*.test.ts
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
