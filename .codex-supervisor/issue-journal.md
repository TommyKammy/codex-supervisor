# Issue #1061: Allow one bounded follow-up repair turn after partial configured-bot review progress

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1061
- Branch: codex/issue-1061
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 91a34db8121eb5748f84ae59b2eaef15c44adc85
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail
- Repeated failure signature count: 1
- Updated at: 2026-03-26T11:19:55Z

## Latest Codex Summary
I reproduced the failing `ubuntu-latest` check locally from PR `#1066` and confirmed it was not a TypeScript build break. The failure came from `npm run test:malformed-inventory-regressions`, where [`src/supervisor/supervisor-pr-review-blockers.test.ts`](src/supervisor/supervisor-pr-review-blockers.test.ts) still expected the pre-change manual-review status text instead of the new `without measurable progress` wording emitted by the bounded same-head follow-up implementation. I updated that stale expectation, reran the failing regression bundle, reran the focused issue-1061 tests, and reran `npm run build`.

The journal is updated in [`issue-journal.md`](.codex-supervisor/issue-journal.md) alongside the test repair so the branch can be committed and pushed back to draft PR `#1066`.

Summary: Reproduced the failing Ubuntu CI check, fixed the stale manual-review status expectation in the regression, and reverified the repair locally.
State hint: repairing_ci
Blocked reason: none
Tests: `npm run test:malformed-inventory-regressions`; `npx tsx --test src/pull-request-state-thread-reprocessing.test.ts src/turn-execution-orchestration.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm run build`
Next action: commit and push the test repair to `codex/issue-1061`, then wait for PR `#1066` CI to rerun
Failure signature: build (ubuntu-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1066 still shows the earlier failing `ubuntu-latest` check until the repaired branch is pushed and CI reruns.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1066
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23591411395/job/68697299661

## Codex Working Notes
### Current Handoff
- Hypothesis: the CI failure is a stale assertion left behind by the wording change in the manual-review failure context, not a behavior regression in the bounded same-head follow-up logic itself.
- What changed: updated the `failure_context` expectation in `src/supervisor/supervisor-pr-review-blockers.test.ts` so the regression matches the current `without measurable progress and now require manual attention` status text emitted by the no-progress escalation path.
- Current blocker: none locally; waiting to push the repair and rerun PR CI.
- Next exact step: commit the repaired test and journal update, push `codex/issue-1061`, and confirm PR `#1066` starts a fresh checks run.
- Verification gap: broader full-suite verification is still outstanding; this turn covered the exact failing regression bundle, the focused issue-1061 tests, and `npm run build`.
- Files touched: `src/supervisor/supervisor-pr-review-blockers.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The code path did not change; this is a test expectation realignment to the already-shipped wording.
- Last focused command: `npm run test:malformed-inventory-regressions`
- What changed this turn: reproduced the failing Ubuntu job locally, patched the stale status assertion, reran the failing regression command, reran the focused same-head follow-up tests, and reran `npm run build`.
- Exact failure reproduced this turn: `AssertionError [ERR_ASSERTION]` in `src/supervisor/supervisor-pr-review-blockers.test.ts:156` because the test expected `...after processing on the current head and now require manual attention.` while the status output now includes `without measurable progress`.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `gh run view 23591411395 --job 68697299661 --log`; `npm run build`; `sed -n '120,200p' src/supervisor/supervisor-pr-review-blockers.test.ts`; `npm run test:malformed-inventory-regressions`; `git fetch origin main`; `git rev-parse HEAD origin/main`; `git merge-base HEAD origin/main`; `git log --oneline --decorate -n 5 --graph --all`; `rg -n "without measurable progress|remain unresolved after processing on the current head" src`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `apply_patch ...`; `npx tsx --test src/pull-request-state-thread-reprocessing.test.ts src/turn-execution-orchestration.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`.
- PR status: draft PR open: `#1066` (`https://github.com/TommyKammy/codex-supervisor/pull/1066`); local repair is ready to push.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local
