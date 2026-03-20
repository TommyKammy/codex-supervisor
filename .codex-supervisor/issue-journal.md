# Issue #721: Workspace restore visibility: surface whether recovery used local, remote, or bootstrap source

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/721
- Branch: codex/issue-721
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: a2dfa89f8ce261ae5abd8a9f5bbb194ca4514de7
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851wrHP|PRRT_kwDORgvdZ851wrHV|PRRT_kwDORgvdZ851wrHX
- Repeated failure signature count: 1
- Updated at: 2026-03-20T16:40:00.345Z

## Latest Codex Summary
Preserved restore metadata on the workspace-status refresh path in [src/run-once-issue-preparation.ts](../src/run-once-issue-preparation.ts) so `restoreSource` and `restoreRef` survive the `remoteAhead > 0` push-and-reload flow. Added a focused regression in [src/run-once-issue-preparation.test.ts](../src/run-once-issue-preparation.test.ts) that exercises that path and verifies the metadata remains visible in both the returned status and replay snapshot.

The fix is pushed to `origin/codex/issue-721` at `a2dfa89`, the issue journal was updated in [.codex-supervisor/issue-journal.md](./issue-journal.md), and the earlier CodeRabbit thread `PRRT_kwDORgvdZ851wejt` was resolved before the current journal-only review follow-up arrived. The untracked `.codex-supervisor/replay/` directory was left untouched.

Summary: Preserved workspace restore metadata across status refresh, added a regression test, pushed the branch update, and left the branch in review follow-up after a previously resolved thread.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor.test.ts`; `npm run build`
Failure signature: none
Next action: Watch PR #746 CI on `a2dfa89` and address any new check or review fallout if it appears.

## Active Failure Context
- Category: review
- Summary: 3 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/746#discussion_r2966767721
- Details:
  - .codex-supervisor/issue-journal.md:19 _⚠️ Potential issue_ | _🟡 Minor_ **Replace machine-local file links with repo-relative links.** Line 19 uses `/home/tommy/...` paths, which are not portable and will be broken for other readers. Please switch these to repository-relative links (e.g., `../src/...` from `.codex-supervisor/`). <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md at line 19, In issue-journal.md replace the machine-local absolute links (e.g., paths starting with /home/tommy/) with repository-relative Markdown links pointing to the same files inside the repo (for example use ../src/core/workspace.ts or ./src/... as appropriate) so the "Key files" list becomes portable; update each broken link entry to the equivalent repo-relative path, save, commit, and push the change. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->
  - .codex-supervisor/issue-journal.md:53 _⚠️ Potential issue_ | _🟡 Minor_ **Journal state is internally inconsistent about review-thread status.** Line 35 says there is an unresolved automated review thread, while Line 52 says thread `PRRT_kwDORgvdZ851wejt` was resolved. This should be reconciled to keep operator status deterministic. <details> <summary>🧰 Tools</summary> <details> <summary>🪛 LanguageTool</summary> [style] ~48-~48: Consider an alternative for the overused word “exactly”. Context: ...remoteAhead > 0` refresh path, which is exactly the operator-visible status regression ... (EXACTLY_PRECISELY) </details> <details> <summary>🪛 markdownlint-cli2 (0.21.0)</summary> [warning] 38-38: Spaces inside code span elements (MD038, no-space-in-code) --- [warning] 38-38: Spaces inside code span elements (MD038, no-space-in-code) </details> </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md around lines 35 - 53, The journal's summary claim "1 unresolved automated review thread(s) remain" is inconsistent with the later entry resolving PRRT_kwDORgvdZ851wejt; update the journal content so its summary and details agree—either decrement/remove the unresolved-thread summary or remove/undo the resolved-thread line so both show the same state; ensure the unique thread ID PRRT_kwDORgvdZ851wejt is represented consistently and the "Summary:" line accurately reflects the current unresolved count. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->
  - .codex-supervisor/issue-journal.md:38 _⚠️ Potential issue_ | _🟡 Minor_ **Fix markdownlint MD038 in inline code spans.** Line 38 currently triggers `MD038 (spaces inside code span elements)`. Removing leading/trailing spaces inside inline backticks will clear the warning. <details> <summary>🧰 Tools</summary> <details> <summary>🪛 markdownlint-cli2 (0.21.0)</summary> [warning] 38-38: Spaces inside code span elements (MD038, no-space-in-code) --- [warning] 38-38: Spaces inside code span elements (MD038, no-space-in-code) </details> </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md at line 38, Remove the leading/trailing spaces inside the inline backtick code spans on the reported line in .codex-supervisor/issue-journal.md so they read like `nextWorkspaceStatus = await getWorkspaceStatus(args.workspacePath, args.record.branch, args.config.defaultBranch);` and `restoreSource`/`restoreRef` (and any other inline code tokens) with no extra spaces inside the backticks to satisfy MD038. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining CodeRabbit feedback is valid and confined to `.codex-supervisor/issue-journal.md`, specifically the machine-local Markdown links, the stale waiting-CI summary text, and the inline text that triggered MD038.
- What changed: replacing machine-local links with repo-relative links, updating the latest summary so it matches the active three-thread review context, and keeping the journal's previous resolved-thread note without implying there are no current review threads.
- Current blocker: none
- Next exact step: rerun focused Markdown verification for `.codex-supervisor/issue-journal.md`, commit the journal-only review fix, and push the branch update for PR #746.
- Verification gap: no behavioral code verification is needed for this journal-only review fix beyond confirming the Markdown warnings are cleared.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this patch would restore non-portable links and reintroduce a misleading journal summary during review follow-up.
- Last focused command: `npx markdownlint-cli2 .codex-supervisor/issue-journal.md`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-721/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-721/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short`; `git diff -- .codex-supervisor/issue-journal.md`; `nl -ba .codex-supervisor/issue-journal.md | sed -n '1,140p'`; `npx markdownlint-cli2 .codex-supervisor/issue-journal.md`
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
