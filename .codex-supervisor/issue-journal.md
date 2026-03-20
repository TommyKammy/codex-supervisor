# Issue #717: JSON corruption recovery: add an explicit operator acknowledgement/reset path

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/717
- Branch: codex/issue-717
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: ee721191858fcfa58f46f37736ff9673de9f65b7
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T14:16:19.000Z

## Latest Codex Summary
- Added a dedicated `reset-corrupt-json-state` operator command that only clears the JSON quarantine marker shape, preserves the quarantined payload path for auditability, and rejects clean/non-marker state instead of becoming a generic state editor. Focused CLI/runtime/state-store verification and `npm run build` passed after restoring local dev dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #717 needs a dedicated state-level operator recovery command, not another per-issue mutation, and the narrowest safe implementation is a JSON-backend-only reset that only accepts the exact quarantine marker produced by the loader.
- What changed: added `reset-corrupt-json-state` to the CLI/runtime surface, introduced a structured JSON reset result DTO, and wired `Supervisor.resetCorruptJsonState()` through the existing supervisor lock. Implemented `StateStore.resetCorruptJsonState()` behind the JSON load lock so it only rewrites the state file when the current contents are the quarantine marker shape (`activeIssueNumber=null`, no issues, JSON parse-error findings, matching `json_state_quarantine.marker_file`), leaving the quarantined `.corrupt.*` payload in place for auditability.
- Current blocker: none
- Next exact step: stage the CLI/runtime/state-store/journal changes, commit the dedicated reset-path checkpoint, and then decide whether to add end-to-end supervisor coverage before opening/updating a draft PR.
- Verification gap: none locally after `npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/core/state-store.test.ts` and `npm run build`.
- Files touched: `src/core/types.ts`, `src/cli/parse-args.ts`, `src/cli/parse-args.test.ts`, `src/cli/entrypoint.test.ts`, `src/cli/supervisor-runtime.ts`, `src/cli/supervisor-runtime.test.ts`, `src/core/state-store.ts`, `src/core/state-store.test.ts`, `src/supervisor/supervisor-mutation-report.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this patch removes the only supported operator reset path for quarantined JSON state, forcing hosts back to manual file surgery despite fail-closed corruption diagnostics and marker preservation.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-717/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-717/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `rg -n "json_state_quarantine|load_findings|corrupt|quarantine|acknowledge|reset|state-store|state\\.json" src`; `sed -n '1,280p' src/core/state-store.ts`; `sed -n '1,360p' src/core/state-store.test.ts`; `sed -n '1,320p' src/cli/entrypoint.test.ts`; `sed -n '1,360p' src/cli/supervisor-runtime.test.ts`; `rg -n "runRecoveryAction|requeue|acknowledge|reset|doctor|status|parseArgs|command: \\\"" src`; `sed -n '1,320p' src/cli/supervisor-runtime.ts`; `sed -n '840,980p' src/supervisor/supervisor.ts`; `sed -n '1,240p' src/cli/parse-args.ts`; `sed -n '1,240p' src/supervisor/supervisor-mutation-report.ts`; `sed -n '1,220p' src/supervisor/supervisor-service.ts`; `sed -n '1,220p' src/cli/parse-args.test.ts`; `npx tsx --test src/cli/parse-args.test.ts src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/core/state-store.test.ts`; `npm install`; `npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/core/state-store.test.ts`; `npm run build`; `git status --short`; `git diff -- src/core/types.ts src/cli/parse-args.ts src/cli/parse-args.test.ts src/cli/entrypoint.ts src/cli/entrypoint.test.ts src/cli/supervisor-runtime.ts src/cli/supervisor-runtime.test.ts src/core/state-store.ts src/core/state-store.test.ts src/supervisor/supervisor-mutation-report.ts src/supervisor/supervisor-service.ts src/supervisor/supervisor.ts`; `date -u +"%Y-%m-%dT%H:%M:%S.000Z"`; `git rev-parse HEAD`
### Scratchpad
- 2026-03-20 (JST): Added a focused parser/runtime/state-store test slice for `reset-corrupt-json-state`, implemented the JSON-backend-only reset path behind the supervisor run lock and the per-file JSON load lock, confirmed one successful marker reset and one rejected non-marker path, restored missing local dev dependencies with `npm install`, and reran the issue verification plus `npm run build` successfully.
- 2026-03-20 (JST): Re-read the required memory files/journal, confirmed the branch only carried commit `f5d969e` plus the journal delta, reran `npx tsx --test src/core/state-store.test.ts src/doctor.test.ts` and `npm run build` successfully, and prepared the branch for push plus draft PR creation.
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
