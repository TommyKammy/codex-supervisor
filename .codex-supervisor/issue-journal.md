# Issue #718: JSON corruption fail-closed: block execution-changing commands until explicit recovery

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/718
- Branch: codex/issue-718
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: e6a1280895c22c229c7352d4264cde18fe8ac626
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T15:22:47Z

## Latest Codex Summary
Verified the fail-closed checkpoint from `e6a1280` locally, pushed `codex/issue-718`, and opened draft PR #744 (`Fail closed on quarantined JSON state`).

This turn reran the focused verification suite and `npm run build` successfully, then pushed the branch to `origin/codex/issue-718` and opened https://github.com/TommyKammy/codex-supervisor/pull/744 as a draft against `main`. The implementation remains the same narrow JSON-quarantine fail-closed gate: execution-changing commands stop until explicit recovery, while diagnostics and `reset-corrupt-json-state` stay available.

One workspace note: the tree still has an unrelated untracked `.codex-supervisor/replay/` directory, which I left untouched.

Summary: Reverified the fail-closed checkpoint, pushed `codex/issue-718`, and opened draft PR #744 for review.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/core/state-store.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Failure signature: none
Next action: monitor PR #744, inspect CI, and address any review feedback

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #718 is implemented and locally verified; the only remaining work is normal PR/CI follow-through unless review finds a regression.
- What changed: reran the issue verification set and `npm run build`, pushed `codex/issue-718` to origin, and opened draft PR #744. The underlying implementation is still the narrow supervisor/runtime gate that fail-closes execution-changing commands when the JSON loader has quarantined corrupt state, while keeping status/doctor/reset available.
- Current blocker: none
- Next exact step: watch PR #744 / CI and respond to any review or mergeability issues.
- Verification gap: none locally after `npx tsx --test src/core/state-store.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this patch reopens the fail-open path where quarantined JSON state is treated as usable supervisor state, allowing `run-once`, `loop`, and operator requeue mutations to act on the forced-empty fallback before the operator intentionally recovers.
- Last focused command: `gh pr view 744 --json number,title,state,isDraft,headRefName,baseRefName,url`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-718/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-718/context-index.md`; `sed -n '1,360p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -5`; `git diff --stat origin/main...HEAD`; `git diff -- .codex-supervisor/issue-journal.md`; `gh pr view --json number,title,state,isDraft,headRefName,baseRefName,url`; `gh pr status`; `npx tsx --test src/core/state-store.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`; `git branch --show-current`; `git remote -v`; `git push -u origin codex/issue-718`; `gh pr create --draft --base main --head codex/issue-718 --title "Fail closed on quarantined JSON state" --body ...`; `gh pr view 744 --json number,title,state,isDraft,headRefName,baseRefName,url`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`
### Scratchpad
- 2026-03-21 (JST): Reverified the fail-closed checkpoint with the issue test set and `npm run build`, pushed `codex/issue-718`, and opened draft PR #744 so the branch now has a tracked review artifact; the unrelated untracked `.codex-supervisor/replay/` directory remains untouched.
- 2026-03-21 (JST): Added focused fail-closed regressions for quarantined JSON state, reproduced that `runOnce()` still reached issue selection, `requeue` still mutated against the forced-empty fallback, and `loop` kept sleeping after a fail-closed result, then implemented a narrow supervisor/runtime gate that blocks execution-changing commands until `reset-corrupt-json-state` and reran the issue verification plus `npm run build` successfully after `npm install`.
- 2026-03-20 (JST): Added a focused status regression for invalid JSON state, reproduced the omission where status only printed normal empty-state lines, then appended explicit `state_diagnostic` and `state_load_finding` lines for JSON `load_findings` so corruption is visible in status without changing loader semantics.
- 2026-03-20 (JST): Added a focused docs regression for the missing JSON corruption contract, confirmed the new assertion failed first, then updated the English operator docs so they consistently say corrupted JSON state is a recovery event requiring explicit acknowledgement/reset and `status`/`doctor` triage before reuse.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
