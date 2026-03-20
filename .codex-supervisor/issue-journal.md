# Issue #716: JSON corruption quarantine: preserve corrupt state instead of silently falling back to empty state

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/716
- Branch: codex/issue-716
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: pr_open
- Attempt count: 4 (implementation=4, repair=0)
- Last head SHA: 024abd38f1171ad2c4c6909728f1a8a2b22fd0d5
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T13:06:57.000Z

## Latest Codex Summary
Implemented the JSON quarantine path in [`src/core/state-store.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-716/src/core/state-store.ts). On JSON parse corruption, the loader now moves the unreadable `state.json` aside to a timestamped `state.json.corrupt.*` file, writes a recovery marker back to the configured state path, and persists both `load_findings` and structured `json_state_quarantine` metadata so later status/doctor runs still point operators at the preserved artifact. I added the new state shape in [`src/core/types.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-716/src/core/types.ts).

The reproducer and focused coverage are in [`src/core/state-store.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-716/src/core/state-store.test.ts) and [`src/doctor.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-716/src/doctor.test.ts). I updated the journal, checkpointed the work as commits `f5d969e` (`Quarantine corrupt JSON state files`) and `024abd3` (`Update issue 716 journal state`), reran the focused verification set successfully, pushed `codex/issue-716` to `origin`, and opened draft PR #742 (`Quarantine corrupt JSON state files`). `npm run build` initially failed earlier because `tsc` was not installed in this worktree, so I ran `npm install` and reran the build successfully. There is still an unrelated untracked `.codex-supervisor/replay/` directory in the worktree that I left untouched.

Summary: Quarantined corrupt JSON state into a preserved side file and replaced the live state path with a deterministic recovery marker that keeps diagnostics explicit.
State hint: implementing
Blocked reason: none
Tests: `npx tsx --test src/core/state-store.test.ts src/doctor.test.ts`; `npm run build`
Failure signature: none
Next action: watch PR #742 for CI and review feedback, then address anything reported

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe fix is to quarantine only parse-corrupted JSON state during `StateStore.load()`, replace the original `state.json` with a deterministic marker that carries the persisted corruption finding and quarantine path, and leave SQLite behavior unchanged.
- What changed: added a focused reproducer in `src/core/state-store.test.ts`, confirmed the pre-fix failure where `state.json` stayed corrupt, then updated `src/core/state-store.ts` so JSON parse errors rename the bad file to `state.json.corrupt.<timestamp>`, write a recovery marker back to the configured state path, and persist `load_findings` plus `json_state_quarantine` metadata for later inspection. Added matching type support in `src/core/types.ts` and a read-only doctor regression in `src/doctor.test.ts` to verify diagnostics remain explicit after quarantine.
- Current blocker: none
- Next exact step: monitor PR #742 (`codex/issue-716` -> `main`) for initial CI and review feedback, then address any findings.
- Verification gap: none locally after `npx tsx --test src/core/state-store.test.ts src/doctor.test.ts` and `npm run build`.
- Files touched: `src/core/state-store.ts`, `src/core/state-store.test.ts`, `src/core/types.ts`, `src/doctor.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: removing the marker-writing path would restore the unsafe behavior where corrupted JSON remains at the live state path and later recovery loses the preserved durable artifact location.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-716/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-716/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git diff -- .codex-supervisor/issue-journal.md`; `git log --oneline --decorate -5`; `gh pr status`; `git diff --stat HEAD~1..HEAD`; `npx tsx --test src/core/state-store.test.ts src/doctor.test.ts`; `npm run build`; `date -Iseconds`; `gh repo view --json nameWithOwner,defaultBranchRef`; `git add .codex-supervisor/issue-journal.md`; `git commit -m "Update issue 716 journal state"`; `git push -u origin codex/issue-716`; `gh pr create --draft --base main --head codex/issue-716 --title "Quarantine corrupt JSON state files" --body ...`; `gh pr view 742 --json number,url,isDraft,headRefName,baseRefName,state`
### Scratchpad
- 2026-03-20 (JST): Pushed `codex/issue-716` to `origin`, opened draft PR #742 against `main`, confirmed the PR is open in draft state, and left the untracked `.codex-supervisor/replay/` directory untouched.
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
