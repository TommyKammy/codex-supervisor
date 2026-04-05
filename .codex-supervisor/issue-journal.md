# Issue #1302: [codex] Auto-redact supervisor-owned durable journal leaks before publication and ready gates

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1302
- Branch: codex/issue-1302
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: a416af6e03166d395efccda884220b5b47834bac
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail
- Repeated failure signature count: 3
- Updated at: 2026-04-05T21:53:57.909Z

## Latest Codex Summary
The failing Ubuntu build was caused by the committed legacy issue journal snapshot still containing a literal workstation-local home path in the tracked handoff text. I reproduced the failure against the PR head, normalized the supervisor-owned journal content to portable text, reran the exact hygiene gate plus `npm run build`, committed the repair as `08b883d`, and pushed `codex/issue-1302` so PR #1307 reran CI.

Summary: Reproduced the failing PR check locally, removed the committed supervisor-owned journal path leak, reran `npm run verify:paths` plus `npm run build`, and pushed the repair commit to PR #1307.
State hint: waiting_ci
Blocked reason: none
Tests: `npm run verify:paths`; `npm run build`
Next action: watch the rerun of PR #1307 and inspect the Ubuntu build again if it still fails.
Failure signature: build (ubuntu-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1307 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1307
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/24011239602/job/70023085387

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining CI failure came from the committed legacy shared journal snapshot, not from the new gate logic itself.
- What changed: reproduced `npm run verify:paths` against the PR failure, confirmed `HEAD` still had a literal macOS user-home path in `.codex-supervisor/issue-journal.md`, rewrote the tracked supervisor-owned journal wording so the durable handoff stays portable, committed the repair as `08b883d`, and pushed `codex/issue-1302` to rerun PR #1307 checks.
- Current blocker: none.
- Next exact step: wait for the rerun of PR #1307 checks and inspect the Ubuntu job again only if it does not clear.
- Verification gap: remote Actions rerun is still pending after the follow-up push.
- Files touched: .codex-supervisor/issue-journal.md
- Rollback concern: none; this repair only normalizes supervisor-owned durable text that should already be portable.
- Last focused command: git push origin codex/issue-1302
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-04-06: Re-ran `npx tsx --test src/journal.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts` and `npm run build`; both passed before pushing and opening PR #1307.
- 2026-04-06: Reproduced the failing Ubuntu check by inspecting `gh run view 24011239602 --log-failed`; the only blocker was the committed `.codex-supervisor/issue-journal.md` line that still mentioned a macOS home path.
- 2026-04-06: Pushed `08b883d` to `codex/issue-1302`; `gh pr checks 1307` now shows both build jobs pending on Actions run `24011353906`.
