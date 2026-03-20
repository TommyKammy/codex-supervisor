# Issue #716: JSON corruption quarantine: preserve corrupt state instead of silently falling back to empty state

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/716
- Branch: codex/issue-716
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 5 (implementation=2, repair=3)
- Last head SHA: 4439da2cb71b38833cbc6d47daf6e230148aa74f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-20T13:46:57.000Z

## Latest Codex Summary
Patched [state-store.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-716/src/core/state-store.ts) so JSON `load()` calls serialize per state file, quarantine attempts use a unique marker temp path per attempt, and concurrent loads cannot observe the rename gap or move an already-installed marker into a bogus `.corrupt.*` file. Added a deterministic concurrent-load regression plus the existing marker-install failure coverage updates in [state-store.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-716/src/core/state-store.test.ts).

Verification passed with `npx tsx --test src/core/state-store.test.ts src/doctor.test.ts` and `npm run build`. The code/test fix is committed as `4439da2` (`Serialize JSON quarantine loads`), and the unrelated untracked `.codex-supervisor/replay/` directory remains untouched.

Summary: Addressed the remaining JSON quarantine concurrency review fix locally and refreshed the journal to match the actual branch state
State hint: local_review_fix
Blocked reason: none
Tests: `npx tsx --test src/core/state-store.test.ts src/doctor.test.ts`; `npm run build`
Failure signature: none
Next action: push the updated branch for PR #742, resolve the remaining CodeRabbit threads, and watch CI on the new head

## Active Failure Context
- Category: review
- Summary: 0 unresolved automated review thread(s) remain after applying the local review fix; branch should return to CI once the updated head is pushed.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/742#discussion_r2965835335
- Details:
  - .codex-supervisor/issue-journal.md:34 resolved by making the Active Failure Context consistent with the latest summary and the waiting-for-CI handoff.
  - src/core/state-store.ts:203 resolved by serializing JSON `load()` calls per state file and giving each quarantine attempt a unique `.quarantine.<attempt>.tmp` marker path.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review work was the shared JSON quarantine temp-path race, and the narrow fix is to serialize JSON loads per state file while keeping the quarantine contract unchanged for single-call loads.
- What changed: wrapped JSON `load()` in a per-file in-process lock, switched quarantine marker temp files from a shared `state.json.quarantine.tmp` path to a unique `.quarantine.<attempt>.tmp` path, and kept the existing rollback behavior when marker installation fails. Added a deterministic concurrent-load regression in `src/core/state-store.test.ts` and updated the marker-install failure test so it matches the new temp-path pattern.
- Current blocker: none
- Next exact step: push the updated head for PR #742, resolve review threads `PRRT_kwDORgvdZ851t_Pu` and `PRRT_kwDORgvdZ851t_Px`, and watch CI for follow-up failures.
- Verification gap: none locally after `npx tsx --test src/core/state-store.test.ts src/doctor.test.ts` and `npm run build`.
- Files touched: `src/core/state-store.ts`, `src/core/state-store.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this patch would reintroduce the concurrent-load window where a second JSON `load()` can see the quarantine rename gap as a missing state or move an already-installed marker into the wrong `.corrupt.*` file.
- Last focused command: `git commit -m "Serialize JSON quarantine loads"`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-716/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-716/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `rg -n "buildJsonQuarantineMarkerTempPath|quarantineCorruptJsonState|json_state_quarantine|quarantine.tmp|attempt" src/core/state-store.ts`; `sed -n '1,260p' src/core/state-store.ts`; `sed -n '340,460p' src/core/state-store.ts`; `sed -n '1,320p' src/core/state-store.test.ts`; `git diff -- src/core/state-store.ts src/core/state-store.test.ts`; `npx tsx --test src/core/state-store.test.ts src/doctor.test.ts`; `npm run build`; `git status --short`; `git rev-parse HEAD`; `date -u +"%Y-%m-%dT%H:%M:%S.000Z"`; `git add src/core/state-store.ts src/core/state-store.test.ts`; `git commit -m "Serialize JSON quarantine loads"`
### Scratchpad
- 2026-03-20 (JST): Re-read the required memory files, found that the journal overstated the branch state, then fixed the remaining JSON quarantine concurrency race by serializing JSON loads per file and using a unique quarantine marker temp path per attempt. Added a deterministic concurrent-load regression plus the updated marker-install failure matcher, verified with `npx tsx --test src/core/state-store.test.ts src/doctor.test.ts` and `npm run build`, and committed the code/test fix as `4439da2`.
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
