# Issue #1109: Close parent epics during degraded inventory reconciliation even when the parent is untracked

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1109
- Branch: codex/issue-1109
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: resolving_conflict
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: d88736c06be8d7b019c9f3605ee4ffaf3277b7b2
- Blocked reason: none
- Last failure signature: dirty:d88736c06be8d7b019c9f3605ee4ffaf3277b7b2
- Repeated failure signature count: 1
- Updated at: 2026-03-27T10:05:53.168Z

## Latest Codex Summary
The implementation checkpoint is unchanged at [`d88736c`](https://github.com/TommyKammy/codex-supervisor/commit/d88736c06be8d7b019c9f3605ee4ffaf3277b7b2), which updates [src/run-once-cycle-prelude.ts](src/run-once-cycle-prelude.ts) and [src/run-once-cycle-prelude.test.ts](src/run-once-cycle-prelude.test.ts) so degraded reconciliation fetches referenced untracked parent epics before evaluating closure. I ran a broader local verification pass after restoring pinned dev dependencies with `npm ci`, pushed `codex/issue-1109`, and opened draft PR `#1110`: https://github.com/TommyKammy/codex-supervisor/pull/1110

The only local dirt left is the expected unstaged supervisor scratch state plus the refreshed [issue journal](.codex-supervisor/issue-journal.md). I did not stage or commit those scratch changes.

Summary: Verified `d88736c`, pushed `codex/issue-1109`, and opened draft PR `#1110` for the degraded untracked-parent epic closure fix.
State hint: draft_pr
Blocked reason: none
Tests: `npm ci`; `npm run build`; `npm run test:malformed-inventory-regressions`
Next action: Wait for PR review/CI on `#1110` or address follow-up feedback if it arrives.
Failure signature: dirty:d88736c06be8d7b019c9f3605ee4ffaf3277b7b2

## Active Failure Context
- Category: conflict
- Summary: PR #1110 has merge conflicts and needs a base-branch integration pass.
- Command or source: git fetch origin && git merge origin/<default-branch>
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1110
- Details:
  - mergeStateStatus=DIRTY

## Codex Working Notes
### Current Handoff
- Hypothesis: degraded parent-epic closure should load tracked child issues first, derive any referenced `Part of:` parent issue numbers from those snapshots, and fetch the missing parents before calling `findParentIssuesReadyToClose(...)`.
- What changed: updated `loadTrackedIssuesForParentEpicClosureFallback()` to parse tracked child metadata, dedupe referenced parent issue numbers not already tracked locally, fetch those parent issues, and append them to the degraded fallback issue set. Added a focused `runOnceCyclePrelude` regression where children `#1101-#1103` are tracked and closed, parent epic `#1100` is open but absent from `state.issues`, and malformed full inventory refresh still leads to a parent-closure reconciliation input that includes the fetched parent. Kept the existing tracked-parent degraded fallback test unchanged.
- Current blocker: none locally.
- Next exact step: monitor draft PR `#1110` for CI or review feedback and respond if anything regresses.
- Verification gap: I have not run the full repo suite or an end-to-end supervisor loop; verification now covers a TypeScript build plus the targeted malformed-inventory regression slice that exercises this degraded reconciliation path.
- Files touched: `src/run-once-cycle-prelude.ts`; `src/run-once-cycle-prelude.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The change only broadens degraded fallback issue loading to include referenced parent epics discovered from already-fetched tracked child snapshots; healthy full-inventory reconciliation and already-tracked parent behavior are unchanged.
- Last focused command: `gh pr create --draft --base main --head codex/issue-1109 --title "[codex] Close untracked parent epics during degraded reconciliation" --body-file <tempfile>`
- What changed this turn: reread the required memory files and journal, confirmed the committed fix was already on `d88736c`, restored pinned dependencies with `npm ci`, ran `npm run build` and `npm run test:malformed-inventory-regressions`, pushed `codex/issue-1109` to the `github` remote, opened draft PR `#1110`, and refreshed this journal entry.
- Exact failure reproduced this turn: none; this turn was a stabilization/publish pass on top of the existing committed fix.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,240p' <redacted-local-path>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short`; `git log --oneline --decorate -5`; `git branch --show-current`; `rg -n "run-once-cycle-prelude|recovery-reconciliation|inventory" src --glob "*.test.ts"`; `cat package.json`; `npm run build`; `npm run test:malformed-inventory-regressions`; `ls -1`; `test -d node_modules && echo present || echo missing`; `test -f package-lock.json && echo lockfile-present || echo no-lockfile`; `npm ci`; `sed -n '1,240p' <redacted-local-path>`; `gh --version`; `gh auth status`; `git status -sb`; `git remote -v`; `gh repo view --json nameWithOwner,defaultBranchRef,url`; `git ls-remote --heads origin codex/issue-1109`; `git ls-remote --heads github codex/issue-1109`; `git push -u github codex/issue-1109`; `gh pr create --draft --base main --head codex/issue-1109 --title "[codex] Close untracked parent epics during degraded reconciliation" --body-file <tempfile>`; `date -u +%Y-%m-%dT%H:%M:%SZ`; `gh pr view 1110 --json url,number,title,isDraft,headRefName,baseRefName>`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
