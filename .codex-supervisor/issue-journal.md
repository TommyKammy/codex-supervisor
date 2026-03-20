# Issue #689: Issue metadata docs: document that child issues should not depend directly on their Epic

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/689
- Branch: codex/issue-689
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 78208c1e0ee7d5a4ea18fb1ac0d90d059eb9718b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T05:25:10.023Z

## Latest Codex Summary
- Added concise epic/child scheduling guidance to `docs/issue-metadata.md`, including a recommended `Part of + sibling Depends on` example and a discouraged `Depends on: <Epic>` example. Tightened `src/config.test.ts` to require that guidance, verified the focused docs assertion, restored local dev dependencies with `npm install`, and reran `npm run build` successfully.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe fix for #689 is a docs-only update in `docs/issue-metadata.md`, backed by a focused regression in the existing docs coverage, because current scheduler behavior already treats `Part of + Execution order` as the epic/child sequencing mechanism.
- What changed: tightened `src/config.test.ts` so the issue-metadata docs must mention that child issues use `Part of: #42` for epic association, must not use `Depends on: #42` when `#42` is only the parent epic, and must include recommended/discouraged examples. Updated `docs/issue-metadata.md` with that rule and a concise `Epic / child pattern` section showing the preferred `Part of: #42` plus sibling `Depends on: #41` pattern and the discouraged `Depends on: #42` anti-pattern.
- Current blocker: none
- Next exact step: review the final diff for concision, then commit the docs/test checkpoint on `codex/issue-689` and prepare/update the draft PR if needed.
- Verification gap: none for the requested acceptance criteria. The focused docs regression and `npm run build` both passed locally after restoring dev dependencies with `npm install`.
- Files touched: `docs/issue-metadata.md`, `src/config.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the explicit operator guidance that prevents child issues from being blocked on their parent epic via `Depends on: <Epic>`, leaving the docs inconsistent with current scheduler behavior.
- Last focused commands: `npx tsx --test src/config.test.ts --test-name-pattern "getting started links to focused configuration and local review references"`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-20 (JST): Reproduced #689 by tightening the issue-metadata docs assertion in `src/config.test.ts`; the new check failed because `docs/issue-metadata.md` did not yet explain that child issues should use `Part of` for epic association and should not depend directly on the epic. Added a concise `Epic / child pattern` section with recommended/discouraged examples, reran the focused assertion, restored local dev dependencies with `npm install` because `tsc` was missing in this worktree, and then reran `npm run build` successfully.
- 2026-03-20 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851okoy` by making the long-reconciliation warning boundary strict (`>` only) and extending the diagnostics test to keep the exact five-minute case non-warning; focused verification passed with `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build`.
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
