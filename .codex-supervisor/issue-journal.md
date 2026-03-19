# Issue #660: State-store visibility: surface captured corruption findings in diagnostics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/660
- Branch: codex/issue-660
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: fc628fba763deaa0864798ec13c5653bdc8a166c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T20:56:42.057Z

## Latest Codex Summary
Implemented the `doctor` diagnostics slice in [src/doctor.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-660/src/doctor.ts) so the read-only loader now preserves/captures `load_findings` for invalid JSON state files and malformed SQLite issue rows, and the `state_file` check surfaces those findings as concise deterministic detail lines. That also stops `worktrees` from failing on recovered JSON-corruption loads when the state can safely degrade to empty.

Added focused regressions in [src/doctor.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-660/src/doctor.test.ts) covering one surfaced JSON case and one surfaced SQLite case, pushed branch `codex/issue-660`, and opened draft PR #667: https://github.com/TommyKammy/codex-supervisor/pull/667. Checkpoint commit: `fc628fb` (`Surface state corruption findings in doctor diagnostics`). I left the unrelated untracked `.codex-supervisor/replay/` directory alone.

Summary: Surfaced structured JSON and SQLite state corruption findings through `doctor` state-file diagnostics and committed the focused fix.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/doctor.test.ts`; `npx tsx --test src/core/state-store.test.ts`; `npm install`; `npm run build`
Failure signature: none
Next action: Open or update the draft PR for `codex/issue-660` with commit `fc628fb`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the operator-facing gap was in `doctor`, not state capture. `loadStateReadonlyForDoctor(...)` still threw on corrupt JSON and skipped malformed SQLite rows without reporting them through `state_file`, so operators only saw generic parse failures or silent success instead of the structured corruption findings already modeled in `load_findings`.
- What changed: reproduced the gap with new focused `doctor` regressions for one JSON corruption case and one SQLite malformed-row case. Updated [`src/doctor.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-660/src/doctor.ts) so the doctor-only loader returns recovered empty state plus structured `load_findings` for invalid JSON, captures malformed SQLite issue rows as `load_findings`, and translates those findings into deterministic `state_file` diagnostic details. The JSON corruption case now keeps `worktrees` operating on recovered empty state while `state_file` fails with surfaced finding details; the SQLite malformed-row case now warns through `state_file` and includes a surfaced detail line for the corrupted row.
- Current blocker: none
- Next exact step: watch draft PR #667 for CI and review feedback, then address any issues that appear.
- Verification gap: none for the scoped acceptance criteria; I reran focused `src/doctor.test.ts`, focused `src/core/state-store.test.ts`, and `npm run build`. I did not rerun the full repository test suite because the issue guidance asked for focused diagnostics/state-store coverage plus build.
- Files touched: `src/doctor.ts`, `src/doctor.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would restore the current visibility gap where doctor output hides structured JSON/SQLite corruption findings behind either a generic parse failure or a silent SQLite success path.
- Last focused command: `git push -u origin codex/issue-660`; `gh pr create --draft --base main --head codex/issue-660 --title "Surface state corruption findings in diagnostics" --body ...`
### Scratchpad
- 2026-03-20 (JST): Pushed `codex/issue-660` and opened draft PR #667 (`https://github.com/TommyKammy/codex-supervisor/pull/667`) after the focused doctor/state-store verification and build had already passed locally.
- 2026-03-20 (JST): Validated CodeRabbit thread `PRRT_kwDORgvdZ851kRrS` as a real bug: malformed SQLite rows could yield only `load_findings`, after which `loadFromSqlite()` returned fallback empty/bootstrap state without those findings. Fixed the fallback path, added a dedicated regression for the empty-state case, and reran `npx tsx --test src/core/state-store.test.ts` plus `npm run build` successfully.
- 2026-03-19 (JST): Pushed `codex/issue-559` and opened draft PR #582 (`https://github.com/TommyKammy/codex-supervisor/pull/582`) after the focused hinting slice passed local verification.
- 2026-03-19 (JST): Reproduced issue #559 with a focused `replay-corpus-promote` regression that expected advisory hints for `stale-head-prevents-merge` but only saw the existing explicit-case-id guidance and suggestions. Fixed it by adding deterministic `deriveReplayCorpusPromotionWorthinessHints(...)` coverage for stale-head safety, provider waits, and retry escalation, then surfacing those hints in both CLI suggestion mode and successful promotion summaries. Focused verification passed with `npx tsx --test src/index.test.ts --test-name-pattern "replay-corpus-promote"`, `npx tsx --test src/supervisor/replay-corpus.test.ts --test-name-pattern "PromotionWorthinessHints|promoteCapturedReplaySnapshot|checked-in safety case bundles|runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches"`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
