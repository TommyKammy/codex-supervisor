# Issue #1111: Prevent artificial PR merge conflicts from the shared committed issue journal path

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1111
- Branch: codex/issue-1111
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 5122d7b36360507d7c0a2ff26c2ce900aefa6010
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail|build (macos-latest):fail
- Repeated failure signature count: 2
- Updated at: 2026-03-27T10:37:09.576Z

## Latest Codex Summary
Draft PR is open at https://github.com/TommyKammy/codex-supervisor/pull/1112 on `codex/issue-1111`. I pushed the existing fix, then followed the repo policy when GitHub marked the PR `DIRTY`: fetching `github/main` and merging it reproduced a conflict only in `.codex-supervisor/issue-journal.md`, while the implementation files auto-merged. That live reproduction matches the issue’s root problem.

I resolved the journal conflict, reran the focused verification ring, committed the merge resolution and final journal handoff, and pushed through `5122d7b`. The branch is clean apart from untracked supervisor runtime artifacts under `.codex-supervisor/`. GitHub now reports the draft PR as `UNSTABLE` rather than `DIRTY`, so the immediate shared-journal conflict is cleared and the PR is waiting on GitHub’s mergeability/check refresh.

Summary: Opened draft PR #1112, reproduced the artificial shared-journal conflict by merging latest `main`, resolved it, reran focused tests, and pushed the updated branch through `5122d7b`.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/journal.test.ts src/run-once-issue-preparation.test.ts src/core/workspace.test.ts src/supervisor/replay-corpus-config.test.ts src/supervisor/replay-corpus-promotion.test.ts src/index.test.ts`; `npx tsx --test src/run-once-issue-selection.test.ts src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/replay-corpus-runner.test.ts src/supervisor/supervisor-cycle-replay.test.ts`
Next action: Monitor draft PR #1112 for mergeability/CI refresh and address any review or check failures if they appear.
Failure signature: build (ubuntu-latest):fail|build (macos-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1112 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1112
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23642200557/job/68865395187
  - build (macos-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23642200557/job/68865395179

## Codex Working Notes
### Current Handoff
- Hypothesis: PR #1112 is failing because the pushed journal snapshot still contained raw workstation-local absolute paths and `classifyStaleStabilizingNoPrBranchState(...)` now needs `issue_number` in its narrowed journal-context type after the issue-scoped journal-path refactor.
- What changed: inspected the failing Actions jobs, confirmed Ubuntu failed `npm run verify:paths` on committed redacted-local-path journal entries while macOS failed `npm run build` on `src/supervisor/supervisor.ts(490)` with `TS2339`, normalized the durable journal content in the tracked handoff file, and widened the narrowed supervisor journal-context type to include `issue_number`.
- Current blocker: none locally.
- Next exact step: monitor the fresh GitHub Actions run on PR #1112 for commit `8e0732e` and only reopen code changes if the new build jobs fail with a different signature.
- Verification gap: I have not run the full repository suite or an end-to-end supervisor publication flow; verification for this repair covers `npm run verify:paths`, `npm run build`, and the two focused regression rings that cover journal normalization, workspace conflict reproduction, replay-corpus behavior, issue selection, and stale no-PR branch classification.
- Files touched: `src/supervisor/supervisor.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The code change only restores `issue_number` to a narrowed helper type that already uses that field, and the journal delta is durable-content normalization plus updated handoff notes.
- Last focused command: `gh pr checks 1112`
- What changed this turn: reread the required memory files and journal, inspected PR #1112’s failing Actions jobs with `gh`, reproduced the failure split locally after `npm ci`, verified the tracked journal content against `verify:paths`, patched the narrowed supervisor journal-context type to carry `issue_number`, reran the focused verification ring successfully, committed the repair as `8e0732e` (`Fix CI regressions for issue-scoped journal path`), pushed `codex/issue-1111`, and confirmed GitHub queued fresh build jobs for the new head.
- Exact failure reproduced this turn: `gh run view 23642200557 --job 68865395187 --log` showed `npm run verify:paths` failing on committed workstation-local absolute-path entries in `.codex-supervisor/issue-journal.md`, `gh run view 23642200557 --job 68865395179 --log` showed `npm run build` failing with `src/supervisor/supervisor.ts(490,87): error TS2339`, local `npm run build` reproduced the same TypeScript failure until the type patch was applied, and after pushing `8e0732e` the replacement GitHub Actions run `23642505483` started with both build jobs pending.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' <redacted-local-path>`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `gh auth status`; `git status --short --branch`; `python3 <redacted-local-path> --repo . --pr 1112`; `gh pr checks 1112`; `gh run view 23642200557 --json name,workflowName,conclusion,status,url,event,headBranch,headSha,jobs`; `gh run view 23642200557 --job 68865395187 --log`; `gh run view 23642200557 --job 68865395179 --log`; `sed -n '450,530p' src/supervisor/supervisor.ts`; `rg -n "issue_number|journal_path|workspace" src/supervisor/supervisor.ts src -g '!dist'`; `npm run verify:paths`; `npm run build`; `nl -ba .codex-supervisor/issue-journal.md | sed -n '36,52p'`; `sed -n '240,320p' src/supervisor/supervisor.ts`; `sed -n '220,340p' src/core/journal.ts`; `cat package.json`; `sed -n '1510,1555p' src/supervisor/supervisor.ts`; `rg -n "normalizeDurableIssueJournalContent|normalizeDurableJournalText|redacted-local-path|Commands run this turn|Verification gap" src .codex-supervisor/issue-journal.md`; `sed -n '340,620p' src/core/journal.ts`; `rg -n "<workstation-local-prefix>" .codex-supervisor/issue-journal.md src/journal.test.ts src/core/journal.ts`; `git show 5122d7b:.codex-supervisor/issue-journal.md | rg -n "<workstation-local-prefix>"`; `git show 5122d7b:.codex-supervisor/issue-journal.md | nl -ba | sed -n '36,52p'`; `npm ci`; `npm run verify:paths`; `npm run build`; `npx tsx --test src/journal.test.ts src/run-once-issue-preparation.test.ts src/core/workspace.test.ts src/supervisor/replay-corpus-config.test.ts src/supervisor/replay-corpus-promotion.test.ts src/index.test.ts`; `npx tsx --test src/run-once-issue-selection.test.ts src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/replay-corpus-runner.test.ts src/supervisor/supervisor-cycle-replay.test.ts`; `git status --short`; `git diff -- src/supervisor/supervisor.ts .codex-supervisor/issue-journal.md`; `date -u +%Y-%m-%dT%H:%M:%SZ`; `git add src/supervisor/supervisor.ts .codex-supervisor/issue-journal.md`; `git commit -m "Fix CI regressions for issue-scoped journal path"`; `git push github codex/issue-1111`; `git rev-parse HEAD`; `gh pr view 1112 --json url,isDraft,mergeStateStatus,headRefOid,headRefName,baseRefName`; `gh pr checks 1112`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
