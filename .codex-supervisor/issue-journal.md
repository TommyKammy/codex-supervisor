# Issue #1109: Close parent epics during degraded inventory reconciliation even when the parent is untracked

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1109
- Branch: codex/issue-1109
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: bf7d80e2ff84ca9015c7b76ea77693f4626e5f4d
- Blocked reason: none
- Last failure signature: degraded-parent-untracked
- Repeated failure signature count: 1
- Updated at: 2026-03-27T09:54:25Z

## Latest Codex Summary
- Degraded inventory parent-epic reconciliation now expands tracked child snapshots with referenced parent epics before evaluating auto-close candidates, and a focused prelude regression covers the previously-missed untracked parent case while preserving the tracked-parent fallback test.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: degraded parent-epic closure should load tracked child issues first, derive any referenced `Part of:` parent issue numbers from those snapshots, and fetch the missing parents before calling `findParentIssuesReadyToClose(...)`.
- What changed: updated `loadTrackedIssuesForParentEpicClosureFallback()` to parse tracked child metadata, dedupe referenced parent issue numbers not already tracked locally, fetch those parent issues, and append them to the degraded fallback issue set. Added a focused `runOnceCyclePrelude` regression where children `#1101-#1103` are tracked and closed, parent epic `#1100` is open but absent from `state.issues`, and malformed full inventory refresh still leads to a parent-closure reconciliation input that includes the fetched parent. Kept the existing tracked-parent degraded fallback test unchanged.
- Current blocker: none locally.
- Next exact step: commit the focused degraded parent-closure fix on `codex/issue-1109`; if a second pass is needed afterward, run the broader run-once or inventory-related test slice around degraded reconciliation.
- Verification gap: I have not run the full repo suite or an end-to-end supervisor loop; verification so far is focused on `runOnceCyclePrelude` plus the reconciliation suite that covers parent-epic closure behavior.
- Files touched: `src/run-once-cycle-prelude.ts`; `src/run-once-cycle-prelude.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The change only broadens degraded fallback issue loading to include referenced parent epics discovered from already-fetched tracked child snapshots; healthy full-inventory reconciliation and already-tracked parent behavior are unchanged.
- Last focused command: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`
- What changed this turn: reread the required memory files and journal, confirmed the branch head was clean for `#1109`, traced the malformed-inventory fallback in `runOnceCyclePrelude`, added a reproducing untracked-parent degraded-mode test, captured the failure, patched the fallback loader to fetch referenced parents, reran focused verification, and refreshed this journal entry.
- Exact failure reproduced this turn: when full inventory refresh failed, the degraded parent-closure fallback fetched only tracked issue numbers from `state.issues`, so closed child issues `#1101-#1103` never caused open parent epic `#1100` to be loaded or considered for automatic closure.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1109/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1109/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git branch --show-current`; `git status --short`; `git log --oneline --decorate -5`; `rg -n "findParentIssuesReadyToClose|degraded|inventory reconciliation|Part of:|parent epic|ready to close" src test`; `sed -n '660,770p' src/run-once-cycle-prelude.test.ts`; `sed -n '1230,1315p' src/recovery-reconciliation.ts`; `sed -n '1,220p' src/issue-metadata/issue-metadata.ts`; `sed -n '770,860p' src/run-once-cycle-prelude.test.ts`; `sed -n '1,260p' src/run-once-cycle-prelude.ts`; `rg -n "getIssueForParentEpicClosureFallback|loadTrackedIssuesForParentEpicClosureFallback|reconcileParentEpicClosures\\(" src/*.test.ts src/**/*.test.ts`; `sed -n '1,220p' src/issue-metadata/issue-metadata-parser.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts`; `git diff --stat`; `git diff -- src/run-once-cycle-prelude.ts src/run-once-cycle-prelude.test.ts .codex-supervisor/issue-journal.md`; `date -u +%Y-%m-%dT%H:%M:%SZ`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
