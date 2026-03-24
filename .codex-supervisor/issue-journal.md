# Issue #919: Final evaluation sequencing: keep downstream sibling work waiting until evaluation resolves

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/919
- Branch: codex/issue-919
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 7a5421d5224abecc816d9a2fd39ec2e72fd82484
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T04:13:36.988Z

## Latest Codex Summary
Installed the missing local dev dependencies with `npm install`, which restored both `tsc` and `playwright-core` in this worktree. The sequencing fix from `7a5421d` still passes its focused regressions, and `npm run build` is now green locally.

The prior full-suite blocker turned out to be a stale expected-file allowlist in [src/external-review/external-review-family-layout.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-919/src/external-review/external-review-family-layout.test.ts), not a sequencing regression. I updated that test to include the two current runtime modules (`external-review-miss-digest.ts` and `external-review-prevention-targets.ts`), and the full `npx tsx --test src/**/*.test.ts` run now passes.

Summary: Sequencing remains blocked on unresolved final evaluation as intended, local build/test verification is clean, and the stale external-review layout test was synchronized so the repo suite passes again
State hint: draft_pr
Blocked reason: none
Tests: `npm install`; `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-selection-readiness-summary.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`; `npm run build`; `npx tsx --test src/external-review/external-review-family-layout.test.ts`; `npx tsx --test src/**/*.test.ts`
Next action: Commit the stale layout-test sync, push `codex/issue-919`, and open a draft PR
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: sequencing currently treats `record.state === "done"` as sufficient, so downstream siblings become runnable before the predecessor's pre-merge final evaluation resolves.
- What changed: added focused regressions in `src/issue-metadata/issue-metadata.test.ts` and `src/supervisor/supervisor-selection-readiness-summary.test.ts`; introduced `isRecordDoneForSequencing()` in `src/issue-metadata/issue-metadata.ts`; updated `findBlockingIssue()`, readiness summaries, and selection/explain formatting to require a resolved final-evaluation outcome (`mergeable` or `follow_up_eligible`) before a predecessor counts as cleared; installed local dependencies; and synchronized `src/external-review/external-review-family-layout.test.ts` with the current runtime modules so the full suite passes again.
- Current blocker: none.
- Next exact step: commit the layout-test sync, push `codex/issue-919`, and open a draft PR for the sequencing fix.
- Verification gap: none locally; focused sequencing tests, `npm run build`, the external-review layout test, and the full test suite are green in this workspace.
- Files touched: `src/issue-metadata/issue-metadata.ts`, `src/issue-metadata/issue-metadata.test.ts`, `src/supervisor/supervisor-selection-readiness-summary.ts`, `src/supervisor/supervisor-selection-readiness-summary.test.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`, `src/external-review/external-review-family-layout.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low to moderate; reverting would let downstream sibling work start while the predecessor is still pending or blocked in final evaluation, and diagnostics would again disagree with actual sequencing behavior.
- Last focused command: `npx tsx --test src/**/*.test.ts`
- Last focused failure: none
- Draft PR: none
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-919/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-919/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
sed -n '1,260p' src/issue-metadata/issue-metadata.ts
sed -n '1,280p' src/supervisor/supervisor-selection-readiness-summary.ts
npx tsx --test src/issue-metadata/issue-metadata.test.ts
npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts
npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-selection-readiness-summary.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts
npx tsx --test src/**/*.test.ts
npm run build
npm install
npx tsx --test src/external-review/external-review-family-layout.test.ts
npx tsx --test src/**/*.test.ts
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
