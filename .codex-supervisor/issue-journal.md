# Issue #556: Replay corpus promotion: add a dedicated CLI entry path

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/556
- Branch: codex/issue-556
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 31cf0220c064207a30787f287afc47150b89e77a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T15:51:26.098Z

## Latest Codex Summary
- Added a dedicated `replay-corpus-promote` CLI entry that promotes a captured replay snapshot into a canonical corpus case via the existing promotion path.
- Added focused parser and end-to-end CLI coverage for the new entry path and verified the promoted case replays cleanly.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: replay-corpus promotion was already implemented in `promoteCapturedReplaySnapshot(...)`, but there was no dedicated CLI command to invoke it directly, so operators had no supported entry path.
- What changed: added a focused CLI repro in `src/index.test.ts` for a dedicated promotion command, then implemented `replay-corpus-promote <snapshotPath> <caseId> [corpusPath]` in `parseArgs(...)` and `main()` to call `promoteCapturedReplaySnapshot(...)`.
- Current blocker: none
- Next exact step: commit the verified CLI promotion change set, then open or update a draft PR for issue #556.
- Verification gap: broader full-suite verification has not been run beyond the focused CLI/replay tests and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/core/types.ts`, `src/index.ts`, `src/index.test.ts`
- Rollback concern: removing `replay-corpus-promote` from the CLI would restore the previous gap where captured replay snapshots could only be promoted through internal-only code paths.
- Last focused command: `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
