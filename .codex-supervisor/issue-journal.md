# Issue #37: Improve status visibility for local review gates

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/37
- Branch: codex/issue-37
- Workspace: /Users/tomoakikawada/Dev/codex-supervisor-worktrees/issue-37
- Journal: /Users/tomoakikawada/Dev/codex-supervisor-worktrees/issue-37/.codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2
- Last head SHA: bea53b78f1a1fe5010b1a0a9455d314ee3c5a87b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-11T15:07:52.155Z

## Latest Codex Summary
Updated `status` so local review is explicit instead of implied. The local-review line now reports `gating=yes|no`, the active policy, findings count, max severity, and whether the stored review is for the current PR head or is stale in [src/supervisor.ts](/Users/tomoakikawada/Dev/codex-supervisor-worktrees/issue-37/src/supervisor.ts). I added focused regression coverage for both a current-head blocking review and a stale stored review in [src/supervisor.test.ts](/Users/tomoakikawada/Dev/codex-supervisor-worktrees/issue-37/src/supervisor.test.ts).

I also updated the durable handoff in [.codex-supervisor/issue-journal.md](/Users/tomoakikawada/Dev/codex-supervisor-worktrees/issue-37/.codex-supervisor/issue-journal.md), committed the work as `d6f9093` and `bea53b7`, pushed `codex/issue-37`, and opened draft PR [#43](https://github.com/TommyKammy/codex-supervisor/pull/43).

Verification: `npx tsx --test src/supervisor.test.ts`, `npm run build`. A broad `npm test` run still includes an unrelated pre-existing failure in `src/review-role-detector.test.ts` about an extra `portability_reviewer` role.

Summary: Added explicit local-review gate visibility to `status`, covered it with focused tests, pushed the branch, and opened draft PR #43.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor.test.ts`; `npm run build`; broad `npm test` still has unrelated pre-existing failure in `src/review-role-detector.test.ts`
Failure signature: none
Next action: Review draft PR #43 and decide whether any additional compact status fields are still needed for local-review gating.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The current `local_review gating=... policy=... findings=... max_severity=... head=...` line is sufficient for the acceptance criteria without adding more terminal noise.
- Primary failure or risk: Full-suite verification still includes an unrelated pre-existing failure in `src/review-role-detector.test.ts` expecting older role detection output.
- Last focused command: `npx tsx -e 'import { formatDetailedStatus } from "./src/supervisor.ts"; ...'`
- Files changed: `src/supervisor.ts`, `src/supervisor.test.ts`
- Next 1-3 actions:
  1. Keep PR #43 draft until human review confirms the current status line is enough.
  2. If needed, add only narrowly scoped follow-up formatting changes.
  3. Re-run focused verification after any review-driven edits.

### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproduced the issue by adding formatter tests for `block_ready` current-head gating and stale `block_merge` review state.
- Focused verification passed with `npx tsx --test src/supervisor.test.ts` and `npm run build`.
- Reviewed the rendered formatter output directly with `npx tsx -e` and confirmed the local-review line stays compact in terminal form.
- `npm test -- --test-name-pattern="formatDetailedStatus shows|formatDetailedStatus marks"` still reports unrelated failure: `detectLocalReviewRoles adds prisma specialists for prisma repos`.
- Checkpoint commit: `d6f9093` (`Improve local review gate status output`).
- Draft PR opened: `#43` <https://github.com/TommyKammy/codex-supervisor/pull/43>.
