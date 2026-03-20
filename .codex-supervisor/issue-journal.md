# Issue #700: Safe mutations: add narrow explicit supervisor commands for operator recovery actions

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/700
- Branch: codex/issue-700
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: 1e68bab8a2a761d2d63cf2e3f22608d7b209066e
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851rIo0|PRRT_kwDORgvdZ851rIo1|PRRT_kwDORgvdZ851rIo5
- Repeated failure signature count: 1
- Updated at: 2026-03-20T19:04:18+09:00

## Latest Codex Summary
Applied local review fixes for the three open CodeRabbit threads on PR [#705](https://github.com/TommyKammy/codex-supervisor/pull/705). The requeue mutation now preserves retry/failure budgets while returning a structured `previousRecordSnapshot`, `runRecoveryAction(...)` now takes the supervisor run lock before loading or mutating state, and the journal now uses repo-relative/local-agnostic paths instead of machine-local links.

Focused verification passed with `npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build`. The only remaining local dirt is the pre-existing untracked `.codex-supervisor/replay/` directory, which I left untouched.

Summary: Applied the PR #705 review fixes locally by preserving requeue retry/failure budgets, guarding recovery mutations with the supervisor run lock, and cleaning machine-local journal paths.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Failure signature: none
Next action: commit and push the review-fix patch to PR #705, then resolve the addressed review threads.

## Active Failure Context
- Category: review
- Summary: Addressed the 3 automated review findings locally; no remaining local verification failures.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/705#discussion_r2964859771
- Details:
  - `.codex-supervisor/issue-journal.md`: replaced machine-local absolute paths with repo-relative/local-agnostic references so collaborators do not see stale `/home/...` links.
  - `src/recovery-reconciliation.ts`: `requeueIssueForOperator(...)` now preserves failure signatures, failure context, and retry/repeat counters while still clearing transient reservation/review metadata, and it returns a structured `previousRecordSnapshot` for audit-friendly transport output.
  - `src/supervisor/supervisor.ts`: `runRecoveryAction(...)` now acquires the supervisor run lock before loading or mutating state, and `src/supervisor/supervisor-diagnostics-status-selection.test.ts` covers the lock-denied path.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe mutation surface for issue #700 is a dedicated `requeue` runtime command backed by a conservative helper that only requeues inactive blocked/failed issues with no tracked PR and rejects everything else explicitly.
- What changed: addressed the PR #705 review follow-up by extending `SupervisorMutationResultDto` with a structured `previousRecordSnapshot`, changing `requeueIssueForOperator(...)` to preserve retry/failure budgets and signatures while clearing only transient reservation/review metadata, and taking the supervisor run lock inside `runRecoveryAction("requeue", ...)`. Added focused runtime/recovery assertions for the snapshot payload and a supervisor test that proves recovery mutations are rejected while the run lock is held.
- Current blocker: none
- Next exact step: commit and push this review-fix patch to `codex/issue-700`, then resolve the addressed PR #705 review threads.
- Verification gap: none in the requested local scope after the focused runtime/recovery tests and `npm run build` passed.
- Files touched: `src/cli/supervisor-runtime.test.ts`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-mutation-report.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the explicit operator recovery command surface and force future adapters back toward ambiguous state edits.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' <memory>/AGENTS.generated.md`; `sed -n '1,220p' <memory>/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `sed -n '240,360p' src/recovery-reconciliation.ts`; `sed -n '780,860p' src/supervisor/supervisor.ts`; `sed -n '1,240p' src/supervisor/supervisor-mutation-report.ts`; `sed -n '1,260p' src/supervisor/supervisor-recovery-reconciliation.test.ts`; `sed -n '1,220p' src/core/state-store.ts`; `sed -n '1,220p' src/cli/supervisor-runtime.test.ts`; `sed -n '1,220p' src/supervisor/supervisor-test-helpers.ts`; `sed -n '320,380p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `git status --short`; `git diff -- src/recovery-reconciliation.ts src/supervisor/supervisor.ts src/supervisor/supervisor-mutation-report.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/cli/supervisor-runtime.test.ts`; `rg -n "previousRecordSnapshot|SupervisorMutationResultDto|outcome: \"mutated\"|outcome: \"rejected\"" src -g '!dist'`; `npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`; `date -Iseconds`
### Scratchpad
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
