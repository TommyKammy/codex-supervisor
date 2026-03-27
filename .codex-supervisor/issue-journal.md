# Issue #1102: Publish gate: refuse supervisor-managed publication when durable artifacts fail path hygiene

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1102
- Branch: codex/issue-1102
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 6a5b43c640278ac53d9a4a008adc32af73399f21
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T06:24:57.380Z

## Latest Codex Summary
Kept `6a5b43c` as the main implementation checkpoint and fixed the remaining publication-readiness gap it exposed under `npm run verify:paths`.

The path verifier initially failed because the new regression tests and the checker help text committed literal workstation-local absolute path examples. I rewrote those fixtures to build sample paths at runtime in [`src/post-turn-pull-request.test.ts`](src/post-turn-pull-request.test.ts), [`src/run-once-issue-preparation.test.ts`](src/run-once-issue-preparation.test.ts), [`src/run-once-turn-execution.test.ts`](src/run-once-turn-execution.test.ts), and [`src/backend/webui-dashboard.test.ts`](src/backend/webui-dashboard.test.ts), and adjusted [`scripts/check-workstation-local-paths.ts`](scripts/check-workstation-local-paths.ts) so its usage/error text no longer embeds forbidden prefixes while still pointing operators at the shared exclusion list in [`src/workstation-local-paths.ts`](src/workstation-local-paths.ts).

Verification is now clean for the publication gate and for the repo-level hygiene check: `npm run verify:paths`, `npx tsx --test src/workstation-local-path-detector.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts src/backend/webui-dashboard.test.ts`, and `npm run build` all pass after running `npm ci`.

Summary: Fixed tracked literal path fixtures so the new publication-gate checkpoint also passes `verify:paths`, and restored a clean buildable/publishable branch state.
State hint: stabilizing
Blocked reason: none
Tests: `npm ci`; `npm run verify:paths`; `npx tsx --test src/workstation-local-path-detector.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts src/backend/webui-dashboard.test.ts`; `npm run build`
Next action: commit the path-fixture hygiene follow-up, push `codex/issue-1102`, and open the draft PR
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: supervisor-managed publication should fail closed at the publish/update seams whenever tracked durable artifacts still contain forbidden workstation-local absolute paths, and the checkpoint itself must remain publishable under the same `verify:paths` rule.
- What changed: kept the shared runtime detector/publication gates from `6a5b43c`, then removed tracked literal workstation-local path fixtures from the new tests and script help text by constructing sample paths at runtime and keeping exclusion guidance anchored to `src/workstation-local-paths.ts`.
- Current blocker: none locally.
- Next exact step: redact the remaining absolute memory-file references from this journal entry, rerun `verify:paths`, and open the draft PR for supervisor pickup.
- Verification gap: no full supervisor end-to-end `runOnce` exercise yet; focused publish-gate/runtime tests, `verify:paths`, and `build` are green.
- Files touched: `scripts/check-workstation-local-paths.ts`; `src/workstation-local-paths.ts`; `src/workstation-local-path-gate.ts`; `src/run-once-issue-preparation.ts`; `src/run-once-turn-execution.ts`; `src/post-turn-pull-request.ts`; `src/run-once-issue-preparation.test.ts`; `src/run-once-turn-execution.test.ts`; `src/post-turn-pull-request.test.ts`; `src/backend/webui-dashboard.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The change is scoped to supervisor-managed publication gates and reuses the existing tracked-file detector instead of widening unrelated retry or scheduling behavior.
- Last focused command: `npm run build`
- What changed this turn: reran the focused publish-gate suites, installed missing local dev dependencies with `npm ci`, proved the branch builds, caught that `npm run verify:paths` still failed on tracked literal path fixtures in the new tests/help text, then rewrote those fixtures/help strings so the verifier passes without weakening exclusions.
- Exact failure reproduced this turn: `npm run verify:paths` failed on tracked literals in `scripts/check-workstation-local-paths.ts`, `src/post-turn-pull-request.test.ts`, `src/run-once-issue-preparation.test.ts`, `src/run-once-turn-execution.test.ts`, and pre-existing `src/backend/webui-dashboard.test.ts`, all due to committed operator-local absolute path examples.
- Commands run this turn: `sed -n '1,220p' <memory>/AGENTS.generated.md`; `sed -n '1,220p' <memory>/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -3`; `git diff --stat origin/main..HEAD`; `git diff -- .codex-supervisor/issue-journal.md`; `cat package.json`; `gh pr status`; `npx tsx --test src/workstation-local-path-detector.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts`; `ls -1`; `npm ci`; `npm run build`; `npm run verify:paths`; `git remote -v`; `nl -ba scripts/check-workstation-local-paths.ts | sed -n '1,120p'`; `nl -ba src/post-turn-pull-request.test.ts | sed -n '280,340p'`; `nl -ba src/run-once-issue-preparation.test.ts | sed -n '770,830p'`; `nl -ba src/run-once-turn-execution.test.ts | sed -n '610,670p'`; `nl -ba src/backend/webui-dashboard.test.ts | sed -n '600,640p'`; `sed -n '1,220p' src/workstation-local-paths.ts`; `sed -n '1,120p' src/post-turn-pull-request.test.ts`; `sed -n '1,120p' src/run-once-issue-preparation.test.ts`; `sed -n '1,120p' src/run-once-turn-execution.test.ts`; `sed -n '1,120p' src/backend/webui-dashboard.test.ts`; `npm run verify:paths`; `npx tsx --test src/workstation-local-path-detector.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts src/backend/webui-dashboard.test.ts`; `npm run build`; `git diff --stat`; `git push -u github codex/issue-1102`; `gh pr create --draft ...`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
