# Issue #707: Trust boundary docs: define GitHub-authored text as an explicit execution-safety boundary

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/707
- Branch: codex/issue-707
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: c8697222a47977dc6b236b4bc36480764098a66f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T11:04:13.307Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe fix for issue #707 is a docs-only checkpoint backed by one focused regression test that proves the trust-boundary wording exists across the English reference set.
- What changed: added `src/execution-safety-docs.test.ts` to reproduce the missing guidance first, then updated `README.md`, `docs/architecture.md`, `docs/getting-started.md`, `docs/agent-instructions.md`, `docs/issue-metadata.md`, and `docs/configuration.md` so they explicitly treat GitHub-authored issue/review text as execution input, call out the current `--dangerously-bypass-approvals-and-sandbox` posture, and require a trusted repo plus trusted authors before enabling autonomous execution. Installed local dev dependencies with `npm install` so `npm run build` could run in this worktree.
- Current blocker: none
- Next exact step: stage the docs/test checkpoint for issue #707, commit it on `codex/issue-707`, and open or update the issue branch PR if needed.
- Verification gap: none in the requested local scope after the focused docs tests and `npm run build` passed.
- Files touched: `README.md`, `docs/agent-instructions.md`, `docs/architecture.md`, `docs/configuration.md`, `docs/getting-started.md`, `docs/issue-metadata.md`, `src/execution-safety-docs.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the explicit execution-safety trust model and allow the docs to drift back to implying GitHub-authored execution inputs are safe by default.
- Last focused command: `date -Iseconds`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-707/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-707/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `sed -n '1,260p' README.md`; `sed -n '1,260p' docs/getting-started.md`; `rg -n "trust boundary|sandbox|approval|issue metadata|agent instructions|getting-started|README|architecture" -g '!dist' .`; `sed -n '1,220p' src/readme-docs.test.ts`; `sed -n '1,220p' src/getting-started-docs.test.ts`; `sed -n '1,220p' src/agent-instructions-docs.test.ts`; `sed -n '1,260p' docs/architecture.md`; `sed -n '1,260p' docs/agent-instructions.md`; `sed -n '1,260p' docs/issue-metadata.md`; `sed -n '1,260p' docs/configuration.md`; `npx tsx --test src/readme-docs.test.ts src/getting-started-docs.test.ts src/agent-instructions-docs.test.ts`; `npx tsx --test src/execution-safety-docs.test.ts`; `npm install`; `npx tsx --test src/execution-safety-docs.test.ts src/readme-docs.test.ts src/getting-started-docs.test.ts src/agent-instructions-docs.test.ts`; `npm run build`; `git status --short`; `date -Iseconds`
### Scratchpad
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
