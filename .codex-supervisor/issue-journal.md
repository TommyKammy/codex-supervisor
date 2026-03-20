# Issue #707: Trust boundary docs: define GitHub-authored text as an explicit execution-safety boundary

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/707
- Branch: codex/issue-707
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 8954c70141672647e34848860207abff76643f7b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T11:17:40.610Z

## Latest Codex Summary
Added a focused regression in [src/execution-safety-docs.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-707/src/execution-safety-docs.test.ts) and updated the English safety/docs surfaces in [README.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-707/README.md), [docs/architecture.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-707/docs/architecture.md), [docs/getting-started.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-707/docs/getting-started.md), [docs/agent-instructions.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-707/docs/agent-instructions.md), [docs/issue-metadata.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-707/docs/issue-metadata.md), and [docs/configuration.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-707/docs/configuration.md) to make the GitHub-authored trust boundary explicit and to state the current `--dangerously-bypass-approvals-and-sandbox` posture plainly. I also updated the issue journal in [.codex-supervisor/issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-707/.codex-supervisor/issue-journal.md) and committed the checkpoint as `8954c70` (`Document GitHub trust boundary for autonomous turns`).

Verification passed with `npx tsx --test src/execution-safety-docs.test.ts src/readme-docs.test.ts src/getting-started-docs.test.ts src/agent-instructions-docs.test.ts` and `npm run build`. The only remaining local dirt is the pre-existing untracked `.codex-supervisor/replay/` directory, which I left untouched.

Summary: Added a focused docs regression and documented GitHub-authored issue/review text as an explicit autonomous-execution trust boundary across the English docs; committed as `8954c70`.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/execution-safety-docs.test.ts src/readme-docs.test.ts src/getting-started-docs.test.ts src/agent-instructions-docs.test.ts`; `npm run build`
Failure signature: none
Next action: open or update the issue branch PR for commit `8954c70` and move this docs checkpoint into review/CI

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe fix for issue #707 is a docs-only checkpoint backed by one focused regression test that proves the trust-boundary wording exists across the English reference set.
- What changed: pushed commit `8954c70` on `codex/issue-707`, opened draft PR [#712](https://github.com/TommyKammy/codex-supervisor/pull/712), and kept the docs-only checkpoint from the prior turn intact. That checkpoint added `src/execution-safety-docs.test.ts` to reproduce the missing guidance first, then updated `README.md`, `docs/architecture.md`, `docs/getting-started.md`, `docs/agent-instructions.md`, `docs/issue-metadata.md`, and `docs/configuration.md` so they explicitly treat GitHub-authored issue/review text as execution input, call out the current `--dangerously-bypass-approvals-and-sandbox` posture, and require a trusted repo plus trusted authors before enabling autonomous execution.
- Current blocker: none
- Next exact step: monitor PR #712 for CI and review feedback, then address any wording follow-up if reviewers want tighter trust-boundary phrasing.
- Verification gap: none for the docs checkpoint itself after the focused docs tests and `npm run build` passed; this turn did not rerun tests because it only pushed the verified commit and opened the draft PR.
- Files touched: `README.md`, `docs/agent-instructions.md`, `docs/architecture.md`, `docs/configuration.md`, `docs/getting-started.md`, `docs/issue-metadata.md`, `src/execution-safety-docs.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the explicit execution-safety trust model and allow the docs to drift back to implying GitHub-authored execution inputs are safe by default.
- Last focused command: `gh pr view 712 --json number,url,isDraft,headRefName,baseRefName,state`
- Last focused commands: `sed -n '1,220p' .codex-supervisor/issue-journal.md`; `git status --short && git rev-parse --abbrev-ref HEAD && git rev-parse HEAD`; `gh pr status`; `git branch -vv`; `git remote -v`; `git log --oneline --decorate -n 5`; `git push -u origin codex/issue-707`; `gh pr create --draft --base main --head codex/issue-707 --title "docs: define GitHub-authored execution trust boundary" --body ...`; `gh pr view 712 --json number,url,isDraft,headRefName,baseRefName,state`; `date -Iseconds`
### Scratchpad
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
