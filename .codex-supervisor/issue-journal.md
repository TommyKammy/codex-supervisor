# Issue #937: Stale already-landed convergence misclassifies replay artifacts and blocks issue #924

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/937
- Branch: codex/issue-937
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 1f68f280a6e8ae44c558ccc09a96bd42e652cbf9
- Blocked reason: none
- Last failure signature: requirements:scope|acceptance criteria|verification
- Repeated failure signature count: 1
- Updated at: 2026-03-24T12:39:53.160Z

## Latest Codex Summary
- Reproduced the stale no-PR misclassification with focused tests, updated stale branch classification to ignore supervisor-owned replay artifacts under `.codex-supervisor/replay/`, and changed stale already-satisfied reconciliation to mark the issue `done` instead of escalating to `manual_review`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: stale no-PR branch classification was counting supervisor-owned replay output under `.codex-supervisor/replay/` as a meaningful local change, and stale reconciliation was treating `already_satisfied_on_main` as a manual-stop condition instead of a clean convergence.
- What changed: added focused regression coverage in `src/supervisor/supervisor-stale-no-pr-branch-state.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, and `src/supervisor/supervisor-execution-orchestration.test.ts`; updated `src/supervisor/supervisor.ts` so the stale no-PR classifier ignores the issue journal plus `.codex-supervisor/replay/**`; updated `src/recovery-reconciliation.ts` so `already_satisfied_on_main` converges to `done` and clears stale no-PR recovery tracking; normalized `src/supervisor/supervisor-test-helpers.ts` so default test records include `stale_stabilizing_no_pr_recovery_count: 0`.
- Current blocker: none.
- Next exact step: commit the #937 replay-artifact stale-convergence fix on `codex/issue-937`, then open or update a draft PR if none exists yet.
- Verification gap: none for the targeted stale no-PR path; focused stale branch-state, reconciliation, and orchestration tests plus `npm run build` are green after restoring local dev dependencies with `npm install`.
- Files touched: `src/recovery-reconciliation.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-stale-no-pr-branch-state.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`, `src/supervisor/supervisor-test-helpers.ts`, `.codex-supervisor/issue-journal.md`, `package-lock.json`
- Rollback concern: low; reverting would restore the stale replay-artifact misclassification and the incorrect manual-review convergence path for already-landed no-PR recovery.
- Last focused command: `npm run build`
- Last focused failure: `npm run build` initially failed with `sh: 1: tsc: not found`; resolved by running `npm install` and rerunning the build successfully.
- Draft PR: none
- Last focused commands:
```bash
sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-937/AGENTS.generated.md
sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-937/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
sed -n '380,470p' src/supervisor/supervisor.ts
sed -n '1,260p' src/supervisor/supervisor-stale-no-pr-branch-state.test.ts
sed -n '520,790p' src/supervisor/supervisor-recovery-reconciliation.test.ts
sed -n '1050,1195p' src/recovery-reconciliation.ts
npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts
npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts
npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts
npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
npm install
npm run build
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
