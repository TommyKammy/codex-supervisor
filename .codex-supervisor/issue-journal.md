# Issue #1102: Publish gate: refuse supervisor-managed publication when durable artifacts fail path hygiene

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1102
- Branch: codex/issue-1102
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bf7d80e2ff84ca9015c7b76ea77693f4626e5f4d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T06:09:05.592Z

## Latest Codex Summary
- Added a supervisor publication gate that runs the tracked durable-artifact workstation-local path check before branch publication, draft PR creation, and draft-to-ready PR updates. Shared the detector logic between the repo script and runtime gate, and added focused regression coverage for preparation, post-turn execution, and post-turn PR transitions.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: supervisor-managed publication should fail closed at the publish/update seams whenever tracked durable artifacts still contain forbidden workstation-local absolute paths, using the same tracked-file detector as `npm run verify:paths`.
- What changed: extracted the workstation-local path detector into shared runtime code, updated `scripts/check-workstation-local-paths.ts` to use it, and added publication gates in `prepareIssueExecutionContext()`, `executeCodexTurnPhase()`, and `handlePostTurnPullRequestTransitionsPhase()`. Added focused regression tests covering blocked draft-PR creation, blocked existing-PR branch publication, blocked draft-to-ready promotion, and the detector script path.
- Current blocker: none locally.
- Next exact step: review the staged diff and commit this publication-gate checkpoint on `codex/issue-1102`; if another pass is needed afterward, exercise a supervisor `runOnce` path that hits the new existing-PR publication gate with a real worktree.
- Verification gap: I did not run a full supervisor end-to-end loop. `npm run build` could not run in this workspace because `tsc` is not installed locally.
- Files touched: `scripts/check-workstation-local-paths.ts`; `src/workstation-local-paths.ts`; `src/workstation-local-path-gate.ts`; `src/run-once-issue-preparation.ts`; `src/run-once-turn-execution.ts`; `src/post-turn-pull-request.ts`; `src/run-once-issue-preparation.test.ts`; `src/run-once-turn-execution.test.ts`; `src/post-turn-pull-request.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The change is scoped to supervisor-managed publication gates and reuses the existing tracked-file detector instead of widening unrelated retry or scheduling behavior.
- Last focused command: `npx tsx --test src/workstation-local-path-detector.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts`
- What changed this turn: reread the required memory files and journal, reproduced that `prepareIssueExecutionContext()` still reached `createPullRequest()` with a tracked `/home/...` leak, extracted the detector into shared code, wired path-hygiene gates into the three publication seams, updated the path-check script to reuse the shared detector, added focused regression tests, and reran the affected suites.
- Exact failure reproduced this turn: `prepareIssueExecutionContext()` attempted supervisor-managed publication for a workspace whose tracked `docs/guide.md` contained `/home/alice/dev/private-repo`, proving the path hygiene check was not enforced at runtime before push/PR publication.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' <redacted-local-path>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short`; `git branch --show-current`; `git log --oneline --decorate -3`; `rg -n "path hygiene|absolute path|workstation-local|durable artifact|publish|publication|push|PR update|pull request update|forbidden.*path|pathHygiene|hygiene" src test . -g'*.ts'`; `rg --files src test | rg 'supervisor|publish|pull-request|path|hygiene|artifact|durable|journal|handoff'`; `sed -n '1,240p' scripts/check-workstation-local-paths.ts`; `sed -n '1,260p' src/workstation-local-path-detector.test.ts`; `rg -n "pushBranch|createPullRequest|updatePullRequest|draft PR|publish.*PR|publication" src/supervisor src/run-once-turn-execution.ts src/post-turn-pull-request.ts -g'*.ts'`; `sed -n '300,520p' src/supervisor/supervisor-execution-orchestration.test.ts`; `sed -n '1,360p' src/supervisor/supervisor.ts`; `rg -n "verify:paths|check-workstation-local-paths|workstation-local|local path" src/supervisor src/run-once-turn-execution.ts src -g'*.ts'`; `cat package.json`; `sed -n '1,420p' src/run-once-issue-preparation.ts`; `sed -n '360,560p' src/run-once-issue-preparation.ts`; `sed -n '420,620p' src/run-once-turn-execution.ts`; `sed -n '360,470p' src/post-turn-pull-request.ts`; `sed -n '1,260p' src/supervisor/supervisor-test-helpers.ts`; `sed -n '1,260p' src/post-turn-pull-request.test.ts`; `sed -n '1,80p' src/run-once-issue-preparation.test.ts`; `sed -n '660,840p' src/run-once-issue-preparation.test.ts`; `npx tsx --test src/run-once-issue-preparation.test.ts`; `sed -n '1,120p' src/post-turn-pull-request.ts`; `sed -n '220,340p' src/post-turn-pull-request.ts`; `npx tsx --test src/run-once-issue-preparation.test.ts`; `npx tsx --test src/post-turn-pull-request.test.ts`; `sed -n '300,510p' src/run-once-turn-execution.test.ts`; `npx tsx --test src/run-once-turn-execution.test.ts`; `npx tsx --test src/workstation-local-path-detector.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts`; `npm run build`; `npx tsc -p tsconfig.json`; `git diff --stat`; `git status --short`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
