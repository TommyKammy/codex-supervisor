# Issue #714: JSON corruption docs: define explicit corruption handling and operator recovery expectations

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/714
- Branch: codex/issue-714
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: fb9b02cac165584ba22207b6e5c48fa4f7de5b02
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T11:38:33.102Z

## Latest Codex Summary
- Added a focused docs regression in `src/execution-safety-docs.test.ts` that reproduced the missing missing-vs-corrupted JSON state contract, then updated `README.md`, `docs/architecture.md`, `docs/getting-started.md`, and `docs/configuration.md` so the English operator docs now state that missing JSON state is the only empty bootstrap case, corrupted JSON state is a recovery event, corrupted state is not a durable recovery point until explicitly handled, and operators should use `status`/`doctor` plus an explicit acknowledgement or reset instead of treating corruption as silent recovery.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe fix for issue #714 is a docs-only checkpoint backed by one focused regression test that proves the English operator docs distinguish missing JSON state from corrupted JSON state and document the explicit operator recovery path.
- What changed: extended `src/execution-safety-docs.test.ts` with a focused corruption-handling assertion set that initially failed on missing wording in `README.md`, then updated `README.md`, `docs/architecture.md`, `docs/getting-started.md`, and `docs/configuration.md` so they now say missing JSON state can bootstrap from empty, corrupted JSON state is a recovery event rather than a normal empty-state bootstrap case, corrupted state is not a durable recovery point until explicitly handled, and operators should use `status`/`doctor` plus an explicit acknowledgement or reset.
- Current blocker: none
- Next exact step: commit this docs checkpoint on `codex/issue-714`, push the branch, and open a draft PR so CI can validate the documentation build and wording.
- Verification gap: none for the docs checkpoint after `npx tsx --test src/execution-safety-docs.test.ts` and `npm run build` passed locally; only PR/CI verification remains.
- Files touched: `README.md`, `docs/architecture.md`, `docs/configuration.md`, `docs/getting-started.md`, `src/execution-safety-docs.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would restore docs that blur missing-state bootstrap with corrupted-state recovery and leave operators without explicit acknowledgement/reset guidance.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-714/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-714/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `sed -n '1,240p' src/execution-safety-docs.test.ts`; `sed -n '1,240p' README.md`; `sed -n '1,260p' docs/getting-started.md`; `sed -n '1,260p' docs/architecture.md`; `sed -n '1,260p' docs/configuration.md`; `sed -n '260,420p' src/doctor.ts`; `sed -n '680,880p' src/supervisor/supervisor.ts`; `npx tsx --test src/execution-safety-docs.test.ts`; `npm install`; `npm run build`; `gh pr status`; `date -Iseconds`
### Scratchpad
- 2026-03-20 (JST): Added a focused docs regression for the missing JSON corruption contract, confirmed the new assertion failed first, then updated the English operator docs so they consistently say corrupted JSON state is a recovery event requiring explicit acknowledgement/reset and `status`/`doctor` triage before reuse.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
