# Issue #1102: Publish gate: refuse supervisor-managed publication when durable artifacts fail path hygiene

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1102
- Branch: codex/issue-1102
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: dd134ad8b3b3aa828d5922c4b889e3f007e463c8
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T06:24:57.380Z

## Latest Codex Summary
Kept `6a5b43c` as the main implementation checkpoint, fixed the remaining publication-readiness gap it exposed under `npm run verify:paths`, then merged the latest `github/main` into the branch and cleaned out accidentally tracked supervisor runtime artifacts before repushing draft PR `#1107`.

The path verifier initially failed because the new regression tests and the checker help text committed literal workstation-local absolute path examples. I rewrote those fixtures to build sample paths at runtime in [`src/post-turn-pull-request.test.ts`](src/post-turn-pull-request.test.ts), [`src/run-once-issue-preparation.test.ts`](src/run-once-issue-preparation.test.ts), [`src/run-once-turn-execution.test.ts`](src/run-once-turn-execution.test.ts), and [`src/backend/webui-dashboard.test.ts`](src/backend/webui-dashboard.test.ts), and adjusted [`scripts/check-workstation-local-paths.ts`](scripts/check-workstation-local-paths.ts) so its usage/error text no longer embeds forbidden prefixes while still pointing operators at the shared exclusion list in [`src/workstation-local-paths.ts`](src/workstation-local-paths.ts).

Verification is now clean for the publication gate and for the merged branch: `npm run verify:paths`, `npx tsx --test src/workstation-local-path-detector.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts src/backend/webui-dashboard.test.ts src/ci-workflow.test.ts src/committed-guardrails.test.ts`, and `npm run build` all pass after running `npm ci`.

Summary: Added the supervisor publication path-hygiene gate, fixed tracked fixture/journal leaks so the checkpoint passes `verify:paths`, merged `github/main`, and cleaned the branch back to a reviewable draft PR state.
State hint: draft_pr
Blocked reason: none
Tests: `npm ci`; `npm run verify:paths`; `npx tsx --test src/workstation-local-path-detector.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts src/backend/webui-dashboard.test.ts src/ci-workflow.test.ts src/committed-guardrails.test.ts`; `npm run build`
Next action: watch draft PR `#1107` for CI and any review feedback on head `dd134ad`
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: supervisor-managed publication should fail closed at the publish/update seams whenever tracked durable artifacts still contain forbidden workstation-local absolute paths, and the checkpoint itself must remain publishable under the same `verify:paths` rule.
- What changed: kept the shared runtime detector/publication gates from `6a5b43c`, removed tracked literal workstation-local path fixtures from the new tests and script help text by constructing sample paths at runtime, kept exclusion guidance anchored to `src/workstation-local-paths.ts`, merged `github/main`, restored `src/backend/webui-dashboard.test.ts` to the shared default exclusion list to match the merged detector policy, and removed accidentally committed supervisor scratch artifacts.
- Current blocker: none locally.
- Next exact step: monitor PR `#1107` for CI completion and respond to any review or check failures on head `dd134ad`.
- Verification gap: no full supervisor end-to-end `runOnce` exercise yet; merged-branch verification covers `verify:paths`, the focused publish-gate/detector/guardrail suites, and `build`.
- Files touched: `scripts/check-workstation-local-paths.ts`; `src/workstation-local-paths.ts`; `src/workstation-local-path-gate.ts`; `src/run-once-issue-preparation.ts`; `src/run-once-turn-execution.ts`; `src/post-turn-pull-request.ts`; `src/run-once-issue-preparation.test.ts`; `src/run-once-turn-execution.test.ts`; `src/post-turn-pull-request.test.ts`; `src/backend/webui-dashboard.test.ts`; `src/workstation-local-path-detector.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The change is scoped to supervisor-managed publication gates and reuses the existing tracked-file detector instead of widening unrelated retry or scheduling behavior.
- Last focused command: `gh pr view 1107 --json url,mergeStateStatus,mergeable,headRefOid,isDraft`
- What changed this turn: reran the focused publish-gate suites, installed missing local dev dependencies with `npm ci`, proved the branch builds, caught that `npm run verify:paths` still failed on tracked literal path fixtures in the new tests/help text, rewrote those fixtures/help strings so the verifier passes without weakening exclusions, pushed the branch, opened draft PR `#1107`, merged the newer `github/main` after GitHub reported the PR merge state as dirty, resolved the journal/script conflicts in favor of the shared detector, restored `src/backend/webui-dashboard.test.ts` to the shared default exclusion list to match the merged detector policy, cleaned out accidentally committed supervisor scratch artifacts, and repushed the branch to a mergeable draft PR head.
- Exact failure reproduced this turn: `npm run verify:paths` failed on tracked literals in `scripts/check-workstation-local-paths.ts`, `src/post-turn-pull-request.test.ts`, `src/run-once-issue-preparation.test.ts`, `src/run-once-turn-execution.test.ts`, and pre-existing `src/backend/webui-dashboard.test.ts`, all due to committed operator-local absolute path examples.
- Commands run this turn: `sed -n '1,220p' <memory>/AGENTS.generated.md`; `sed -n '1,220p' <memory>/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -3`; `git diff --stat origin/main..HEAD`; `git diff -- .codex-supervisor/issue-journal.md`; `cat package.json`; `gh pr status`; `npx tsx --test src/workstation-local-path-detector.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts`; `ls -1`; `npm ci`; `npm run build`; `npm run verify:paths`; `git remote -v`; `nl -ba scripts/check-workstation-local-paths.ts | sed -n '1,120p'`; `nl -ba src/post-turn-pull-request.test.ts | sed -n '280,340p'`; `nl -ba src/run-once-issue-preparation.test.ts | sed -n '770,830p'`; `nl -ba src/run-once-turn-execution.test.ts | sed -n '610,670p'`; `nl -ba src/backend/webui-dashboard.test.ts | sed -n '600,640p'`; `sed -n '1,220p' src/workstation-local-paths.ts`; `sed -n '1,120p' src/post-turn-pull-request.test.ts`; `sed -n '1,120p' src/run-once-issue-preparation.test.ts`; `sed -n '1,120p' src/run-once-turn-execution.test.ts`; `sed -n '1,120p' src/backend/webui-dashboard.test.ts`; `npm run verify:paths`; `npx tsx --test src/workstation-local-path-detector.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts src/backend/webui-dashboard.test.ts`; `npm run build`; `git diff --stat`; `git push -u github codex/issue-1102`; `gh pr create --draft ...`; `gh pr view 1107 --json number,url,title,isDraft,body,headRefName,baseRefName`; `gh api repos/TommyKammy/codex-supervisor/pulls/1107 -X PATCH ...`; `git fetch github main`; `git merge --no-edit github/main`; `git diff --merge -- .codex-supervisor/issue-journal.md`; `git diff --merge -- scripts/check-workstation-local-paths.ts`; `git show 336bb4c:scripts/check-workstation-local-paths.ts`; `git show 336bb4c:.codex-supervisor/issue-journal.md`; `git add .codex-supervisor/issue-journal.md scripts/check-workstation-local-paths.ts`; `npx tsx --test src/workstation-local-path-detector.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts src/backend/webui-dashboard.test.ts src/ci-workflow.test.ts src/committed-guardrails.test.ts`; `npm run build`; `git commit -m "Merge github/main into codex/issue-1102"`; `git show --stat --oneline --name-only HEAD`; `git rm -f .codex-supervisor/pre-merge/assessment-snapshot.json .codex-supervisor/replay/decision-cycle-snapshot.json .codex-supervisor/turn-in-progress.json`; `git commit -m "Drop supervisor runtime artifacts from merge"`; `git push github codex/issue-1102`; `gh pr view 1107 --json url,mergeStateStatus,mergeable,headRefOid,isDraft`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
