# Issue #1144: Promote fail-closed persisted artifact identity validation before post-merge follow-up promotion

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1144
- Branch: codex/issue-1144
- Workspace: .
- Journal: .codex-supervisor/issues/1144/issue-journal.md
- Current phase: waiting_ci
- Attempt count: 8 (implementation=2, repair=6)
- Last head SHA: 8b58d35d80604ae73e7e1bf6ed10ca9926556b39
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail
- Repeated failure signature count: 1
- Updated at: 2026-03-28T01:27:28Z

## Latest Codex Summary
Reproduced PR #1147's failing Ubuntu build from Actions run `23674219411`, confirmed `npm run verify:paths` was rejecting workstation-local absolute-path references in this journal's committed `Last focused commands` entry, and finalized the journal redaction so the path guard now passes locally. I reran `npm run build`, committed the journal-only repair as `8b58d35`, and pushed `github/codex/issue-1144` so the PR can rerun against the cleaned durable artifact.

Summary: Reproduced the Ubuntu CI failure, removed the committed workstation-local paths from the journal, and verified the repair locally.
State hint: waiting_ci
Blocked reason: none
Tests: `gh pr checks 1147`; `gh run view 23674219411 --log-failed`; `npm run verify:paths`; `npm run build`
Next action: Watch PR #1147 for a clean rerun of `build (ubuntu-latest)` on commit `8b58d35`, then address any remaining review-thread bookkeeping if needed.
Failure signature: build (ubuntu-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1147 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1147
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23674219411/job/68973994332

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining CI failure is a journal-only hygiene regression, not a code-path regression. PR #1147's committed journal still contained workstation-local absolute memory-file paths, so `verify:paths` failed before the rest of the Ubuntu build could proceed.
- What changed: Reproduced the failing `verify:paths` job from Actions run `23674219411`, kept the path-redacted `Last focused commands` journal entry, refreshed the handoff to match the CI root cause, and reran `npm run verify:paths` plus `npm run build` locally after the journal-only repair.
- Current blocker: none
- Next exact step: Watch PR #1147 until `build (ubuntu-latest)` reruns against `8b58d35`, then resolve or reply to any remaining automated review threads only if they are still current.
- Verification gap: This turn only changed the issue journal. I reran `npm run verify:paths` and `npm run build`, but I did not rerun the earlier focused persisted-artifact regression tests because the source files under `src/` were unchanged.
- Files touched: .codex-supervisor/issues/1144/issue-journal.md
- Rollback concern: Reverting this repair would reintroduce forbidden workstation-local absolute paths into a committed durable artifact and immediately break `verify:paths` again on Linux runners.
- Last focused command:
- Last focused commands: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' .codex-supervisor/issues/1144/issue-journal.md`; `gh pr checks 1147`; `gh run view 23674219411 --log-failed`; `rg -n 'redacted-local-path|workstation-local' .codex-supervisor/issues/1144/issue-journal.md`; `npm run verify:paths`; `npm run build`
### Scratchpad
- 2026-03-28: Re-checked the two remaining CodeRabbit comments before editing. The unresolved-count complaint is stale because the current journal now lists two unresolved threads without any embedded "Addressed in commit" entry; only the `github/main` brand-capitalization comment still required a local change.
- 2026-03-28: The current CI failure is from `verify:paths`, not from the persisted-artifact implementation. The failing Ubuntu log points directly to previously committed workstation-local absolute paths in this journal, and the redacted worktree now passes that guard locally.
- Keep this section short. The supervisor may compact older notes automatically.
