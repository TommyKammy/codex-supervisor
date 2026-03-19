# Issue #660: State-store visibility: surface captured corruption findings in diagnostics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/660
- Branch: codex/issue-660
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: waiting_ci
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 918c34df1b5e91f07e6d1199fb8ed4f975dbd83d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T06:08:55+09:00

## Latest Codex Summary
Draft PR #667 is open at https://github.com/TommyKammy/codex-supervisor/pull/667 on `codex/issue-660`, and review fix commit `918c34d` (`Bound doctor corruption detail output`) is now pushed to the branch. I also resolved CodeRabbit thread `PRRT_kwDORgvdZ851k4pw` after the remote branch updated cleanly. The worktree is clean aside from the pre-existing untracked `.codex-supervisor/replay/` directory, which I left untouched.

Summary: Fixed and pushed the bounded `doctor` detail rendering review issue, added a focused oversized-SQLite regression, reran the scoped verification, and resolved the matching PR thread.
State hint: waiting_ci
Blocked reason: none
Tests: Passed `npx tsx --test src/doctor.test.ts` and `npm run build`
Failure signature: none
Next action: Watch PR #667 for CI on commit `918c34d` and handle any new review or check failures.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining operator-facing gap is boundedness, not capture. `doctorCheckForLoadFindings(...)` currently renders every captured `load_finding`, so a heavily corrupted SQLite state file can flood the report and violate the concise/representative diagnostic goal called out in review thread `PRRT_kwDORgvdZ851k4pw`.
- What changed: validated that CodeRabbit report against the current implementation, then updated [`src/doctor.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-660/src/doctor.ts) to cap rendered load-finding details at five entries and append a deterministic omission summary for the remainder. Added a focused regression in [`src/doctor.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-660/src/doctor.test.ts) that seeds six malformed SQLite rows and asserts the report keeps the first five findings, emits `state_load_finding_omitted count=1`, and excludes the sixth row detail.
- Current blocker: none
- Next exact step: watch PR #667 for CI on `918c34d` and respond if any new review comments or check failures appear.
- Verification gap: none for the scoped review fix; I reran focused `src/doctor.test.ts` plus `npm run build`. I did not rerun `src/core/state-store.test.ts` because this review change only touches `doctor` detail rendering and its focused regression.
- Files touched: `src/doctor.ts`, `src/doctor.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would restore unbounded `doctor_detail` output for large corruption sets, making operator diagnostics noisy and potentially hiding the actionable first findings.
- Last focused command: `git push origin codex/issue-660`; `gh api graphql -f query='mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { isResolved } } }' -F threadId=PRRT_kwDORgvdZ851k4pw`
### Scratchpad
- 2026-03-20 (JST): Pushed review fix commit `918c34d` (`Bound doctor corruption detail output`) to `codex/issue-660` and resolved CodeRabbit thread `PRRT_kwDORgvdZ851k4pw` via `gh api graphql` after the branch update landed.
- 2026-03-20 (JST): Validated CodeRabbit thread `PRRT_kwDORgvdZ851k4pw` as a real boundedness bug in `doctorCheckForLoadFindings(...)`; capped rendered finding details to five entries with a deterministic omission summary, added a focused oversized-SQLite regression in `src/doctor.test.ts`, and passed `npx tsx --test src/doctor.test.ts` plus `npm run build`.
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
