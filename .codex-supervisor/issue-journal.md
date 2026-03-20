# Issue #700: Safe mutations: add narrow explicit supervisor commands for operator recovery actions

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/700
- Branch: codex/issue-700
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 67c59b96439a758477261cb2b0e25802a4ef7cac
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T18:46:32+09:00

## Latest Codex Summary
Opened draft PR #705 for the already-implemented narrow explicit `requeue <issueNumber>` supervisor command on `codex/issue-700`.

The command parses through the CLI/runtime, returns a structured JSON mutation result from [src/supervisor/supervisor-mutation-report.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-700/src/supervisor/supervisor-mutation-report.ts), and is backed by a conservative helper in [src/recovery-reconciliation.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-700/src/recovery-reconciliation.ts) that only requeues inactive `blocked`/`failed` issues with no tracked PR. Active reservations and tracked-PR work are rejected explicitly. Wiring landed in [src/cli/parse-args.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-700/src/cli/parse-args.ts), [src/cli/supervisor-runtime.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-700/src/cli/supervisor-runtime.ts), [src/supervisor/supervisor-service.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-700/src/supervisor/supervisor-service.ts), and [src/supervisor/supervisor.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-700/src/supervisor/supervisor.ts), with focused coverage in the CLI/runtime and recovery tests.

Re-ran the requested focused verification successfully, pushed `codex/issue-700` to `origin`, and opened draft PR [#705](https://github.com/TommyKammy/codex-supervisor/pull/705). A first `gh pr create` attempt failed immediately after push with a stale GitHub comparison error (`Head sha can't be blank` / `No commits between main and codex/issue-700`), but `gh api repos/TommyKammy/codex-supervisor/compare/main...codex/issue-700` confirmed the diff and the retry succeeded. The unrelated untracked `.codex-supervisor/replay/` directory is still present and untouched.

Summary: Pushed the explicit safe `requeue` supervisor command and opened draft PR #705 after passing focused tests and `npm run build`.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/cli/parse-args.test.ts src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`; `npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`
Failure signature: none
Next action: monitor PR #705, wait for CI, and address any review or failure feedback on `codex/issue-700`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe mutation surface for issue #700 is a dedicated `requeue` runtime command backed by a conservative helper that only requeues inactive blocked/failed issues with no tracked PR and rejects everything else explicitly.
- What changed: extended `CliOptions`, `parseArgs(...)`, and the supervisor runtime to accept `requeue <issueNumber>`, added `SupervisorMutationResultDto` plus JSON rendering for transport-friendly command output, and implemented `runRecoveryAction("requeue", ...)` through `requeueIssueForOperator(...)`. The helper records a recovery reason, clears stale failure/blocking fields, and rejects unsafe cases like active reservations or tracked-PR work. Added focused parser, entrypoint, runtime, and recovery tests for one successful safe mutation and one rejected unsafe mutation. Pushed the branch to `origin/codex/issue-700` and opened draft PR #705.
- Current blocker: none
- Next exact step: watch PR #705 for CI or review feedback and address any follow-up on `codex/issue-700`.
- Verification gap: none in the requested local scope after the focused runtime/recovery tests and `npm run build` passed.
- Files touched: `src/cli/entrypoint.test.ts`, `src/cli/parse-args.test.ts`, `src/cli/parse-args.ts`, `src/cli/supervisor-runtime.test.ts`, `src/cli/supervisor-runtime.ts`, `src/core/types.ts`, `src/recovery-reconciliation.ts`, `src/supervisor/index.ts`, `src/supervisor/supervisor-mutation-report.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the explicit operator recovery command surface and force future adapters back toward ambiguous state edits.
- Last focused command: `gh pr view 705 --json number,title,state,isDraft,url,baseRefName,headRefName`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-700/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-700/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -n 8`; `git branch -vv`; `git remote -v`; `gh pr status`; `gh pr list --head codex/issue-700 --state all --json number,title,state,isDraft,headRefName,baseRefName,url`; `npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`; `git push -u origin codex/issue-700`; `gh pr create --draft --base main --head codex/issue-700 --title 'Add explicit supervisor recovery requeue command' ...`; `git fetch origin`; `git rev-parse HEAD origin/main origin/codex/issue-700`; `git log --oneline --decorate --graph --max-count=6 HEAD origin/main origin/codex/issue-700`; `gh api repos/TommyKammy/codex-supervisor/compare/main...codex/issue-700`; `gh pr create --draft --base main --head codex/issue-700 --title 'Add explicit supervisor recovery requeue command' ...`; `gh pr view 705 --json number,title,state,isDraft,url,baseRefName,headRefName`; `date -Iseconds`
### Scratchpad
- 2026-03-20 (JST): Re-ran the requested focused verification for issue #700, pushed `codex/issue-700` to `origin`, and opened draft PR #705 (`https://github.com/TommyKammy/codex-supervisor/pull/705`). The first `gh pr create` immediately after push failed with a stale GitHub ref-comparison error (`Head sha can't be blank`, `No commits between main and codex/issue-700`), but `gh api repos/TommyKammy/codex-supervisor/compare/main...codex/issue-700` showed the expected single-commit diff and the retry succeeded.
- 2026-03-20 (JST): Reproduced issue #700 by adding focused tests for a missing `requeue` supervisor runtime command; implemented a structured `SupervisorMutationResultDto`, runtime JSON rendering, and a conservative `requeueIssueForOperator(...)` helper that only requeues inactive blocked/failed issues with no tracked PR and explicitly rejects active tracked-PR work. Verification passed with `npx tsx --test src/cli/parse-args.test.ts src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`, `npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
