# Issue #884: Local CI execution gate: run configured pre-PR verification before PR publication

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/884
- Branch: codex/issue-884
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 79c88b1d7b6b84be21e5b3988db135ea0baef9fd
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T14:11:36Z

## Latest Codex Summary
- Added a shared local CI gate before draft PR creation and draft-to-ready promotion, blocked those transitions with a verification reason on non-zero local CI, added focused regressions for the creation and promotion boundaries, restored local dependencies with `npm install`, and passed the requested verification.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining gap is at the PR publication boundary itself, so every repo-owned path that can open or publish a PR needs the same optional `localCiCommand` gate rather than additional config-surface work.
- What changed: added `src/local-ci.ts` as a shared gate runner, invoked it before draft PR creation in `src/run-once-issue-preparation.ts` and `src/run-once-turn-execution.ts`, invoked it before draft-to-ready promotion in `src/post-turn-pull-request.ts`, and added focused regressions in `src/run-once-turn-execution.test.ts`, `src/post-turn-pull-request.test.ts`, and `src/supervisor/supervisor-execution-orchestration.test.ts`.
- Current blocker: none
- Next exact step: commit the local CI publication gate changes on `codex/issue-884`, then open or update the draft PR for issue #884.
- Verification gap: none on the requested issue verification surface.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/local-ci.ts`, `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`, `src/run-once-issue-preparation.ts`, `src/run-once-turn-execution.ts`, `src/run-once-turn-execution.test.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`
- Rollback concern: medium-low; the gate is opt-in but sits on all PR publication paths, so partial rollback would risk leaving one publication path ungated and inconsistent with the others.
- Last focused command: `npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`
- Last focused failure: `npm run build` initially failed with `sh: 1: tsc: not found` because dependencies were absent in this worktree; `npm install` restored the toolchain and the requested verification passed afterward.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-884/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-884/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "localCiCommand|publish|markPullRequestReady|createPullRequest|draft_pr|verification" src -g '*.ts'
sed -n '1,420p' src/post-turn-pull-request.ts
sed -n '1,520p' src/run-once-turn-execution.ts
sed -n '300,420p' src/run-once-issue-preparation.ts
sed -n '1,340p' src/post-turn-pull-request.test.ts
sed -n '1,760p' src/supervisor/supervisor-execution-orchestration.test.ts
apply_patch
npx tsx --test src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
npm run build
npm install
npx tsx --test src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
npm run build
npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
```
