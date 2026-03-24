# Issue #925: Post-merge audit analysis: summarize recurring review, recovery, and failure patterns

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/925
- Branch: codex/issue-925
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 71a3dce2bf1dca056f9a4105a816266392d880c9
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T10:20:41Z

## Latest Codex Summary
The advisory-only post-merge audit summary implementation remains at commit `71a3dce` (`Summarize recurring post-merge audit patterns`), and this turn turned that green checkpoint into a reviewable branch artifact by pushing `codex/issue-925` and opening draft PR #941 (`Summarize recurring post-merge audit patterns`): https://github.com/TommyKammy/codex-supervisor/pull/941

I did not change runtime code in this turn. Local verification for the shipped commit remains the previously green `npx tsx --test src/**/*.test.ts` and `npm run build`; this turn focused on branch/PR state and journal hygiene. The only intended untracked path remains `.codex-supervisor/replay/`.

Summary: Pushed `codex/issue-925` and opened draft PR #941 for the existing post-merge audit summary checkpoint
State hint: draft_pr
Blocked reason: none
Tests: not rerun this turn; existing green verification for `71a3dce` is `npx tsx --test src/**/*.test.ts` and `npm run build`
Next action: monitor PR #941, address review or CI feedback if any appears
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: persisted post-merge audit artifacts already captured the raw review, recovery, and failure signals needed for recurring-pattern analysis, but there was no typed aggregate that operators could query without manually inspecting individual JSON files.
- What changed: added `src/supervisor/post-merge-audit-summary.ts` to scan persisted post-merge audit artifacts, aggregate recurring review root causes plus failure and recovery taxonomy patterns, and emit a typed advisory-only summary; exposed that summary via the new `summarize-post-merge-audits` CLI/runtime/service path; added focused coverage in `src/supervisor/post-merge-audit-summary.test.ts`, `src/supervisor/post-merge-audit-summary-runtime.test.ts`, `src/cli/parse-args.test.ts`, and `src/cli/entrypoint.test.ts`.
- Current blocker: none.
- Next exact step: monitor draft PR #941 and address any review or CI feedback against `codex/issue-925`.
- Verification gap: none for the shipped code at `71a3dce`; this turn did not modify runtime behavior, so I relied on the existing green `src/**/*.test.ts` and `npm run build` results for that commit.
- Files touched: `src/supervisor/post-merge-audit-summary.ts`, `src/supervisor/post-merge-audit-summary.test.ts`, `src/supervisor/post-merge-audit-summary-runtime.test.ts`, `src/cli/parse-args.ts`, `src/cli/parse-args.test.ts`, `src/cli/entrypoint.test.ts`, `src/cli/supervisor-runtime.ts`, `src/core/types.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; reverting would only remove a read-only analysis surface and leave the persisted audit artifacts intact.
- Last focused command: `gh pr create --draft --base main --head codex/issue-925 --title "Summarize recurring post-merge audit patterns" --body ...`
- Last focused failure: none
- Draft PR: #941 https://github.com/TommyKammy/codex-supervisor/pull/941
- Last focused commands:
```bash
git diff -- .codex-supervisor/issue-journal.md
git remote -v
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
git status -sb
gh pr status
git show --stat --oneline --decorate HEAD
git push -u origin codex/issue-925
gh pr create --draft --base main --head codex/issue-925 --title "Summarize recurring post-merge audit patterns" --body ...
gh pr view 941 --json number,title,url,isDraft,headRefName,baseRefName
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
