# Issue #716: JSON corruption quarantine: preserve corrupt state instead of silently falling back to empty state

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/716
- Branch: codex/issue-716
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 5778e7aa79e04cb3478e50cdd1d336e87af71d43
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T12:50:41.388Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe fix is to quarantine only parse-corrupted JSON state during `StateStore.load()`, replace the original `state.json` with a deterministic marker that carries the persisted corruption finding and quarantine path, and leave SQLite behavior unchanged.
- What changed: added a focused reproducer in `src/core/state-store.test.ts`, confirmed the pre-fix failure where `state.json` stayed corrupt, then updated `src/core/state-store.ts` so JSON parse errors rename the bad file to `state.json.corrupt.<timestamp>`, write a recovery marker back to the configured state path, and persist `load_findings` plus `json_state_quarantine` metadata for later inspection. Added matching type support in `src/core/types.ts` and a read-only doctor regression in `src/doctor.test.ts` to verify diagnostics remain explicit after quarantine.
- Current blocker: none
- Next exact step: review the diff, commit the quarantine change on `codex/issue-716`, and open/update the draft PR if needed.
- Verification gap: none locally after `npx tsx --test src/core/state-store.test.ts src/doctor.test.ts` and `npm run build`.
- Files touched: `src/core/state-store.ts`, `src/core/state-store.test.ts`, `src/core/types.ts`, `src/doctor.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: removing the marker-writing path would restore the unsafe behavior where corrupted JSON remains at the live state path and later recovery loses the preserved durable artifact location.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-716/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-716/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `sed -n '1,260p' src/core/state-store.test.ts`; `sed -n '1,420p' src/core/state-store.ts`; `sed -n '1,260p' src/doctor.test.ts`; `sed -n '1,260p' src/doctor.ts`; `sed -n '1,260p' src/core/types.ts`; `sed -n '260,320p' src/supervisor/supervisor.ts`; `npx tsx --test src/core/state-store.test.ts`; `npx tsx --test src/core/state-store.test.ts src/doctor.test.ts`; `npm run build`; `npm install`; `git status --short`; `date -Iseconds`; `git rev-parse HEAD`
### Scratchpad
- 2026-03-20 (JST): Added a focused JSON quarantine reproducer, confirmed the loader left malformed `state.json` in place, then changed JSON state loading to move the corrupt file aside, write a deterministic marker back to `state.json`, and preserve the quarantine path through `load_findings` plus `json_state_quarantine`; focused verification and `npm run build` passed after installing local dev dependencies with `npm install`.
- 2026-03-20 (JST): Validated CodeRabbit thread `PRRT_kwDORgvdZ851s71w`, added missing `t.after(...)` cleanup to the corruption-status fixture test, and reran `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts` plus `npm run build` successfully.
- 2026-03-20 (JST): Re-ran the focused verification set plus `npm run build`, pushed `codex/issue-715` to `origin/codex/issue-715`, and opened draft PR #741 (`status: surface JSON corruption diagnostics`).
- 2026-03-20 (JST): Added a focused status regression for invalid JSON state, reproduced the omission where status only printed normal empty-state lines, then appended explicit `state_diagnostic` and `state_load_finding` lines for JSON `load_findings` so corruption is visible in status without changing loader semantics.
- 2026-03-20 (JST): Added a focused docs regression for the missing JSON corruption contract, confirmed the new assertion failed first, then updated the English operator docs so they consistently say corrupted JSON state is a recovery event requiring explicit acknowledgement/reset and `status`/`doctor` triage before reuse.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
