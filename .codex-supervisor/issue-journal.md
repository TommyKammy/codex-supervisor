# Issue #671: Model routing: surface local-review model routing in operator-visible output

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/671
- Branch: codex/issue-671
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: f08ea336211cc3edd8e6915532056eb661d32369
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T23:19:31.505Z

## Latest Codex Summary
Artifact visibility is in place. Local-review summaries now include a concise `Model routing` section, and the JSON artifact stores deterministic routing metadata per role and verifier: `target`, `model`, and `reasoningEffort`. The routing is derived from the existing execution policy in [`src/local-review/finalize.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-671/src/local-review/finalize.ts), rendered in [`src/local-review/artifacts.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-671/src/local-review/artifacts.ts), and covered by the new focused regression in [`src/local-review/artifacts.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-671/src/local-review/artifacts.test.ts). I also narrowed the config typing in [`src/codex/codex-policy.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-671/src/codex/codex-policy.ts) so artifact routing can be derived without full-config casts.

Checkpoint commit `f08ea33` is now pushed on `origin/codex/issue-671`, and draft PR #676 is open at `https://github.com/TommyKammy/codex-supervisor/pull/676`. Focused tests passed, and `npm run build` passed after restoring local dev dependencies with `npm install`. The only remaining workspace noise is the pre-existing untracked `.codex-supervisor/replay/` directory.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining issue-671 gap after #670 is visibility, not routing itself. Operators can now route generic local-review roles differently, but the saved local-review artifact never recorded which execution target/model path each role actually used.
- What changed: added deterministic routing derivation in `finalizeLocalReview(...)`, stored `routing={target,model,reasoningEffort}` on each artifact role report plus the verifier report, and added a `## Model routing` section to the Markdown artifact. Also narrowed `resolveCodexExecutionPolicy(...)` to the config fields it actually consumes so artifact routing can be derived without fake full-config casts.
- Current blocker: none
- Next exact step: watch CI and respond to any review feedback on draft PR #676.
- Verification gap: none for the scoped issue work. Focused local-review artifact/finalize/result/status/policy tests passed, and `npm run build` passed after restoring local dev dependencies with `npm install`.
- Files touched: `src/codex/codex-policy.ts`, `src/local-review/types.ts`, `src/local-review/finalize.ts`, `src/local-review/artifacts.ts`, `src/local-review/artifacts.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the only deterministic artifact record of which model path each local-review role and verifier actually used, forcing operators back to inference/guesswork after routing changes from #670.
- Last focused command: `git push -u origin codex/issue-671`; `gh pr create --draft --base main --head codex/issue-671 --title "Surface local-review model routing in artifacts" ...`
### Scratchpad
- 2026-03-20 (JST): Pushed `codex/issue-671` to `origin/codex/issue-671` and opened draft PR #676 (`https://github.com/TommyKammy/codex-supervisor/pull/676`) after the focused artifact/finalize/result/status/policy tests and `npm run build` were already green locally.
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
