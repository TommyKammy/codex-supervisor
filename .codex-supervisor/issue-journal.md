# Issue #916: Final evaluation artifact: capture a typed pre-merge assessment snapshot from current evidence

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/916
- Branch: codex/issue-916
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 9a1eb6c54ebf50610e1048fe75cd5909eeeec720
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T01:15:33Z

## Latest Codex Summary
Added a typed pre-merge assessment snapshot artifact that captures current PR, checks, review-thread, local-review, and supervisor-state evidence without changing merge decisions yet. The new writer lives in [src/supervisor/pre-merge-assessment-snapshot.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-916/src/supervisor/pre-merge-assessment-snapshot.ts) and is called from [src/run-once-issue-preparation.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-916/src/run-once-issue-preparation.ts) alongside the existing replay snapshot so every hydrated PR context now emits `.codex-supervisor/pre-merge/assessment-snapshot.json`.

Focused coverage was added in [src/supervisor/pre-merge-assessment-snapshot.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-916/src/supervisor/pre-merge-assessment-snapshot.test.ts), and [src/run-once-issue-preparation.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-916/src/run-once-issue-preparation.test.ts) now verifies the preparation flow writes the new artifact. Focused tests passed, `npm run build` initially failed because `node_modules` was missing in this worktree, `npm ci` restored the toolchain, and the build passed on rerun.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining gap for `#916` belongs in the supervisor layer, not `src/local-review`; the supervisor should persist a typed pre-merge assessment artifact that snapshots current PR, CI, review, local-review, and record state so later gate logic can consume normalized evidence instead of parsing status strings.
- What changed: added `src/supervisor/pre-merge-assessment-snapshot.ts` to build and write `.codex-supervisor/pre-merge/assessment-snapshot.json`; the snapshot stores raw PR/check/review-thread evidence, typed summaries for checks/reviews/local-review gating, the current supervisor record slice, and the saved local-review JSON artifact when present; wired the writer into `prepareIssueExecutionContext()` for open, merged, and closed PR hydration paths without changing lifecycle outcomes; added focused coverage in `src/supervisor/pre-merge-assessment-snapshot.test.ts` and updated `src/run-once-issue-preparation.test.ts` to assert the new artifact write.
- Current blocker: none
- Next exact step: review the final diff, commit the pre-merge assessment snapshot checkpoint, and update draft PR `#930` if the branch is ready to publish.
- Verification gap: focused artifact/preparation coverage and `npm run build` passed; the full repository test suite was not rerun in this turn.
- Files touched: `src/supervisor/pre-merge-assessment-snapshot.ts`, `src/supervisor/pre-merge-assessment-snapshot.test.ts`, `src/run-once-issue-preparation.ts`, `src/run-once-issue-preparation.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; the change is observational-only and adds a new persisted artifact plus write calls, but it does not alter PR lifecycle state inference or merge readiness decisions.
- Last focused command: `npm ci && npm run build && npx tsx --test src/supervisor/pre-merge-assessment-snapshot.test.ts src/run-once-issue-preparation.test.ts`
- Last focused failure: `npm run build` first failed with `sh: 1: tsc: not found` because `node_modules` was missing in this worktree; `npm ci` restored the local toolchain and the rerun passed.
- Draft PR: `#930` https://github.com/TommyKammy/codex-supervisor/pull/930
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-916/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-916/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
git branch --show-current
git log --oneline --decorate -5
sed -n '1,260p' src/supervisor/pre-merge-assessment-snapshot.ts
sed -n '1,260p' src/supervisor/pre-merge-assessment-snapshot.test.ts
sed -n '1,520p' src/run-once-issue-preparation.ts
sed -n '1,560p' src/run-once-issue-preparation.test.ts
npx tsx --test src/supervisor/pre-merge-assessment-snapshot.test.ts src/run-once-issue-preparation.test.ts
npm run build
test -d node_modules && echo present || echo missing
npm ci
npm run build
npx tsx --test src/supervisor/pre-merge-assessment-snapshot.test.ts src/run-once-issue-preparation.test.ts
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
