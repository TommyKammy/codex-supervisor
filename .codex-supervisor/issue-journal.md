# Issue #1264: [codex] Fix remaining release-blocking browser smoke regressions

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1264
- Branch: codex/issue-1264
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: e64bec8de17b131baea5f1e858c135331ff0c0f6
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail
- Repeated failure signature count: 1
- Updated at: 2026-03-31T14:01:33.889Z

## Latest Codex Summary
Updated [src/backend/webui-dashboard-browser-smoke.test.ts](src/backend/webui-dashboard-browser-smoke.test.ts) so the WebUI smoke harness no longer hard-fails when `CHROME_BIN` is unset on macOS. It now keeps the explicit env override, keeps the existing PATH lookup, and falls back to standard local Chrome/Chromium app-bundle paths under `/Applications` and `$HOME/Applications`. I also added a focused resolver regression test in the same file.

The targeted smoke suite now passes locally without any environment override, `npm run build` passes, and the checkpoint is pushed on `codex/issue-1264` with draft PR #1269 open: https://github.com/TommyKammy/codex-supervisor/pull/1269. CI is currently running on that PR.

Summary: Restored browser smoke execution by fixing Chrome discovery fallback in the smoke harness, verified locally, pushed the branch, and opened draft PR #1269.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts`; `npm run build`
Next action: Watch PR #1269 CI on macOS and Ubuntu, then address any fallout or move the draft toward review once checks finish.
Failure signature: build (ubuntu-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1269 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1269
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23800368842/job/69358801268

## Codex Working Notes
### Current Handoff
- Hypothesis: the Ubuntu CI failure is no longer a live browser-smoke regression. The current blocker is `npm run verify:paths`, which rejects workstation-local absolute paths introduced by the new resolver regression test fixture.
- What changed: inspected PR #1269's failing Actions log with `gh` and the bundled CI inspector, confirmed `build (ubuntu-latest)` failed in `npm run verify:paths`, and reproduced that failure locally. The only remaining findings were macOS workstation-style absolute path literals in `src/backend/webui-dashboard-browser-smoke.test.ts`, so I replaced that fixture `HOME` value with `/tmp/example-home` while keeping the resolver assertions unchanged. Re-ran `npm run verify:paths`, `npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts`, and `npm run build`; all now pass locally.
- Current blocker: none.
- Next exact step: commit the focused verify-paths repair, push `codex/issue-1264`, and recheck PR #1269 until the Ubuntu CI job reruns cleanly.
- Verification gap: local verification covered the repo path-policy check, the targeted browser smoke suite, and a full TypeScript build. I did not run the repo-wide `npm test` glob because this issue is still scoped to the smoke harness plus its supporting test fixture.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-smoke.test.ts`.
- Rollback concern: low. This turn only changes a regression-test fixture value and the journal handoff; runtime behavior is unchanged.
- Last focused command: `npm run build`
- What changed this turn: read the required memory files and the issue journal, used `gh` plus the bundled CI inspector to inspect PR #1269, reproduced the Ubuntu `verify:paths` failure locally, patched the new resolver test fixture to avoid a forbidden workstation-local path literal, and reran the focused local verifiers successfully.
- Exact failure reproduced this turn: `npm run verify:paths` failed with `Forbidden workstation-local absolute path references found` because the new resolver regression test fixture used a macOS workstation-style absolute home path.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `gh auth status`; `git branch --show-current && git status --short && git log --oneline --decorate -5`; `python3 <redacted-local-path> --repo . --pr 1269 --json`; `gh pr checks 1269 --json name,state,bucket,link,startedAt,completedAt,workflow`; `sed -n '1,220p' src/workstation-local-paths.ts`; `nl -ba src/backend/webui-dashboard-browser-smoke.test.ts | sed -n '240,310p'`; `nl -ba .codex-supervisor/issue-journal.md | sed -n '24,44p'`; `npm run verify:paths`; `rg -n "function resolveChromeExecutable|resolveChromeExecutable\\(" src/backend/webui-dashboard-browser-smoke.test.ts`; `sed -n '150,235p' src/backend/webui-dashboard-browser-smoke.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts`; `npm run build`; `rg -n '<workstation-path-pattern>' .codex-supervisor/issue-journal.md`; `git status --short`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
