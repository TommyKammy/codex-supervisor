# Issue #919: Final evaluation sequencing: keep downstream sibling work waiting until evaluation resolves

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/919
- Branch: codex/issue-919
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 4a88f0cb74cd46f36f2e773aa9e3c7ff27943a19
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T03:57:35.228Z

## Latest Codex Summary
- Added a focused regression proving that downstream execution-order siblings were becoming runnable when the predecessor record was already `done` but its pre-merge final evaluation had not resolved.
- Fixed sequencing to treat a record as cleared only when it is `done` and either has no local-review evaluation state at all or its final evaluation outcome is resolved (`mergeable` or `follow_up_eligible`). Updated readiness and selection diagnostics to use the same predicate so explainability matches runnable selection.
- Focused sequencing tests pass. Full `npx tsx --test src/**/*.test.ts` still has unrelated environment/repo failures: missing `playwright-core` for `src/backend/webui-dashboard-browser-smoke.test.ts`, and a pre-existing `src/external-review/external-review-family-layout.test.ts` mismatch. `npm run build` is blocked locally because `tsc` is not installed in this worktree.

## Active Failure Context
- Category: blocked
- Summary: Full verification is not currently clean in this workspace because required local tooling and one unrelated repo-wide layout expectation are missing.
- Details:
  - `npm run build` fails with `sh: 1: tsc: not found`.
  - `npx tsx --test src/**/*.test.ts` fails in `src/backend/webui-dashboard-browser-smoke.test.ts` because `playwright-core` is not installed.
  - `npx tsx --test src/**/*.test.ts` also fails in `src/external-review/external-review-family-layout.test.ts` due to an existing file-layout expectation mismatch unrelated to sequencing.

## Codex Working Notes
### Current Handoff
- Hypothesis: sequencing currently treats `record.state === "done"` as sufficient, so downstream siblings become runnable before the predecessor's pre-merge final evaluation resolves.
- What changed: added focused regressions in `src/issue-metadata/issue-metadata.test.ts` and `src/supervisor/supervisor-selection-readiness-summary.test.ts`; introduced `isRecordDoneForSequencing()` in `src/issue-metadata/issue-metadata.ts`; updated `findBlockingIssue()`, readiness summaries, and selection/explain formatting to require a resolved final-evaluation outcome (`mergeable` or `follow_up_eligible`) before a predecessor counts as cleared.
- Current blocker: local environment is missing `tsc` and `playwright-core`; full suite also reports an unrelated `external-review-family-layout` mismatch.
- Next exact step: commit this sequencing fix, then either install the missing local toolchain or rerun verification in CI/another prepared workspace to separate the unrelated full-suite failures from this issue.
- Verification gap: repo-wide `npm run build` and the full test command are not fully green in this workspace because of the unrelated/tooling failures listed above.
- Files touched: `src/issue-metadata/issue-metadata.ts`, `src/issue-metadata/issue-metadata.test.ts`, `src/supervisor/supervisor-selection-readiness-summary.ts`, `src/supervisor/supervisor-selection-readiness-summary.test.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low to moderate; reverting would let downstream sibling work start while the predecessor is still pending or blocked in final evaluation, and diagnostics would again disagree with actual sequencing behavior.
- Last focused command: `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-selection-readiness-summary.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`
- Last focused failure: `buildReadinessSummary` incorrectly reported `execution_order_satisfied` while predecessor `#91` had `state=done` but `pre_merge_evaluation_outcome=null`
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
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
