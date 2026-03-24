# Issue #918: Final evaluation gate: block merge completion until the pre-merge assessment resolves cleanly

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/918
- Branch: codex/issue-918
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 57baed67a982ec62992a3f79f1b573d9b212e67c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T02:15:42.563Z

## Latest Codex Summary
- Persisted pre-merge final-evaluation outcomes onto issue records and used them to gate both draft-to-ready and ready-to-merge transitions so unresolved or blocked final evaluations cannot advance merge flow while `follow_up_eligible` still proceeds.

## Active Failure Context
- `npx tsx --test src/**/*.test.ts` still fails in an unrelated pre-existing area: `src/external-review/external-review-family-layout.test.ts` expects an older runtime module list and is missing `external-review-miss-digest.ts` plus `external-review-prevention-targets.ts`.

## Codex Working Notes
### Current Handoff
- Hypothesis: merge gating now needs to read a durable current-head final-evaluation outcome from the issue record so synchronous PR lifecycle decisions can distinguish unresolved, blocked, and follow-up-eligible local-review results without re-reading artifacts.
- What changed: added persisted pre-merge final-evaluation fields to `IssueRunRecord` plus state-store normalization; recorded final-evaluation outcome/counts when local review runs; changed `localReviewBlocksReady` and `localReviewBlocksMerge` so `block_merge` requires a resolved current-head final evaluation and allows only `mergeable` or `follow_up_eligible`; guarded `handlePostTurnMergeAndCompletion` so stale `ready_to_merge` records still refuse auto-merge when the final evaluation is unresolved or blocked; updated focused lifecycle/policy tests plus affected status-rendering expectations to reflect the stricter gate.
- Current blocker: none
- Next exact step: commit the final-evaluation gate change, push `codex/issue-918`, and update the draft PR with the verification note that the only remaining full-suite failure is the unrelated external-review family layout drift.
- Verification gap: issue-relevant focused tests and `npm run build` now pass after `npm ci`; the full suite is down to one unrelated existing failure in `src/external-review/external-review-family-layout.test.ts`.
- Files touched: `src/core/types.ts`, `src/core/state-store.ts`, `src/review-handling.ts`, `src/post-turn-pull-request.ts`, `src/supervisor/supervisor.ts`, `src/pull-request-state-policy.test.ts`, `src/supervisor/supervisor-pr-readiness.test.ts`, `src/supervisor/supervisor-status-rendering-supervisor.test.ts`, `src/supervisor/supervisor-status-rendering.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: moderate-low; the change alters merge gating behavior for `block_merge` local review by requiring a current-head resolved final evaluation, so rollback would reopen the path where blocked or unresolved assessments can still mark PRs ready or enable auto-merge.
- Last focused command: `npm ci && npm run build && npx tsx --test src/pull-request-state-policy.test.ts src/supervisor/supervisor-pr-readiness.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts src/supervisor/supervisor-status-rendering.test.ts && npx tsx --test src/**/*.test.ts`
- Last focused failure: `npx tsx --test src/**/*.test.ts` now fails only at `src/external-review/external-review-family-layout.test.ts` because the expected runtime module list is stale (`external-review-miss-digest.ts` and `external-review-prevention-targets.ts` are present but not reflected in the test).
- Draft PR: `#931` https://github.com/TommyKammy/codex-supervisor/pull/931
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
