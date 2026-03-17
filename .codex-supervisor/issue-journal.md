# Issue #507: Change-risk explainability: reuse the normalized risk decision in explain diagnostics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/507
- Branch: codex/issue-507
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 388d9baea1abf0337a09c4ee7b5ab2269d100cb7
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851AkY9
- Repeated failure signature count: 1
- Updated at: 2026-03-17T23:02:43.584Z

## Latest Codex Summary
Explain diagnostics now emit the same normalized risk lines status already uses. In [supervisor-selection-status.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-507/src/supervisor/supervisor-selection-status.ts#L44) I added a shared explain-side loader for `change_classes` and `verification_policy`, and [supervisor-diagnostics-explain.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-507/src/supervisor/supervisor-diagnostics-explain.test.ts#L227) now covers both a risky auth ambiguity case and a tracked blocked docs-only case. I also updated the issue journal and committed the change as `388d9ba`.

Verification passed with `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts`, `npx tsx --test src/supervisor/supervisor-diagnostics.test.ts`, `npx tsx --test src/supervisor/supervisor-change-risk-status.test.ts src/issue-metadata/issue-metadata-change-risk-decision.test.ts`, and `npm run build`. `npm run build` initially failed because `tsc` was missing in this worktree, so I ran `npm ci` first. Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/516

Summary: Reused the normalized change-risk summary in explain diagnostics, added focused regressions, passed focused tests and build, and opened draft PR #516.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics.test.ts`; `npx tsx --test src/supervisor/supervisor-change-risk-status.test.ts src/issue-metadata/issue-metadata-change-risk-decision.test.ts`; `npm ci`; `npm run build`
Failure signature: none
Next action: Wait for PR #516 review/CI and address any feedback or failures.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/516#discussion_r2949964503
- Details:
  - .codex-supervisor/issue-journal.md:7 _⚠️ Potential issue_ | _🟡 Minor_ **Avoid committing machine-specific absolute paths in journal snapshot.** Line 6 and Line 7 expose local filesystem details (`/home/tommy/...`) and make the journal less portable. Prefer repo-relative values for committed metadata. <details> <summary>Suggested update</summary> ```diff -- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-507 -- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-507/.codex-supervisor/issue-journal.md +- Workspace: . +- Journal: .codex-supervisor/issue-journal.md ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion - Workspace: . - Journal: .codex-supervisor/issue-journal.md ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md around lines 6 - 7, The journal contains machine-specific absolute paths on the lines starting with "Workspace:" and "Journal:" — replace those absolute paths with repository-relative paths or placeholders (e.g., "./" or ".codex-supervisor/issue-journal.md") so the committed metadata is portable; update the values for the "Workspace:" and "Journal:" entries in .codex-supervisor/issue-journal.md to use repo-relative references or environment-derived variables instead of hard-coded /home/tommy/... paths. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining PR #516 review thread is valid because the journal snapshot still commits machine-specific absolute `Workspace`/`Journal` paths; those snapshot fields should stay repo-relative while preserving the prior explain diagnostics repair.
- What changed: normalized the Supervisor Snapshot `Workspace` and `Journal` entries in this journal to `.` and `.codex-supervisor/issue-journal.md` so the committed metadata stays portable across worktrees and machines.
- Current blocker: none
- Next exact step: run focused diff verification, commit the journal portability repair on `codex/issue-507`, push the branch, and resolve the remaining CodeRabbit thread on PR #516.
- Verification gap: none after focused diff verification for the journal-only repair.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this repair would reintroduce machine-specific absolute paths into committed journal metadata.
- Last focused command: `rg -n "^- Workspace:|^- Journal:" .codex-supervisor/issue-journal.md`
### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
- 2026-03-18 (JST): Local review repair for PR #516 normalizes the committed journal snapshot `Workspace`/`Journal` fields to repo-relative values (`.` and `.codex-supervisor/issue-journal.md`) to address CodeRabbit thread `PRRT_kwDORgvdZ851AkY9`. Focused verification target: `git diff --check`.
- 2026-03-18 (JST): Issue #507 now reuses the normalized change-risk status lines in explain diagnostics; focused reproducer first failed because explain omitted `verification_policy`/`change_classes`, then passed after wiring `buildIssueExplainSummary` through the shared status helpers. Verification: `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts`, `npx tsx --test src/supervisor/supervisor-diagnostics.test.ts`, `npx tsx --test src/supervisor/supervisor-change-risk-status.test.ts src/issue-metadata/issue-metadata-change-risk-decision.test.ts`, `npm ci`, `npm run build`.
- 2026-03-18 (JST): Review repair for PR #515 now renders tracked journal `Workspace`/`Journal` snapshot fields relative to the workspace root, adds a focused regression in `src/journal.test.ts`, and passes `npx tsx --test src/journal.test.ts` plus `npm run build`.
- 2026-03-18 (JST): Pushed `646ea24` (`Clear stale journal failure context`) to `origin/codex/issue-506` and resolved CodeRabbit thread `PRRT_kwDORgvdZ851ANbp` with `gh api graphql` after removing the stale copied failure context and restoring the inherited scratchpad tail.
- 2026-03-18 (JST): Local review repair for PR #515 removes the stale Active Failure Context copied from the resolved line-54 truncation report and restores the inherited scratchpad tail from `HEAD`; focused verification target is `git diff --check`.
- 2026-03-18 (JST): Committed and pushed `3a85dbe` (`Fix truncated journal scratchpad entry`) on `codex/issue-506`, restoring the inherited `#477` scratchpad tail plus the omitted follow-on notes and resolving CodeRabbit thread `PRRT_kwDORgvdZ851AJNQ`.
- 2026-03-18 (JST): Pushed `3458587` (`Explain verification policy in status`) to `origin/codex/issue-506` and opened draft PR #515 (`https://github.com/TommyKammy/codex-supervisor/pull/515`).
- 2026-03-18 (JST): Issue #506 now renders `verification_policy intensity=<...> driver=<source>:<classes>` in status output; focused coverage includes docs-only `changed_files` and stronger `issue_metadata` auth cases.
- 2026-03-18 (JST): Focused verification for #506 was `npx tsx --test src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-change-risk-status.test.ts`; `npm run build` initially failed with `sh: 1: tsc: not found`, `npm ci` restored the toolchain, and the rerun passed.
- 2026-03-18 (JST): Review repair for PR #508 normalized the tracked journal `Workspace`/`Journal` fields and new summary links to repo-relative paths, reduced the copied CodeRabbit failure context to a neutral summary, restored the truncated #477 scratchpad tail from `HEAD^`, and passed `git diff --check`.
- 2026-03-18 (JST): Committed `395a11c` (`Normalize change-risk decisions`), pushed `codex/issue-505`, and opened draft PR #508 (`https://github.com/TommyKammy/codex-supervisor/pull/508`).
- 2026-03-18 (JST): Added `summarizeChangeRiskDecision` so prompt/status consumers share one normalized risk decision with `issue_metadata` tie precedence, risky approval inputs, deterministic changed-file classes, and the resulting verification intensity.
- 2026-03-18 (JST): Focused reproducer for #505 was a new `issue-metadata-change-risk-decision` test asserting `auth` metadata plus docs/tests changed files should still resolve to `verificationIntensity=strong` with `higherRiskSource=issue_metadata`.
- 2026-03-18 (JST): `npm run build` first failed with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain, then the focused issue-metadata/prompt tests and `npm run build` both passed.
- 2026-03-18 (JST): Pushed `30b3066` (`Clarify journal scratchpad date basis`) to `origin/codex/issue-494` and resolved CodeRabbit thread `PRRT_kwDORgvdZ8508oYP` on PR #503 with `gh api graphql`.
- 2026-03-18 (JST): Review repair for PR #503 clarifies that scratchpad entries use the workspace-local date basis while the Supervisor Snapshot `Updated at` field remains UTC.
- 2026-03-18 (JST): `npm run build` initially failed with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain and the next `npm run build` passed.
- 2026-03-17: Pushed `codex/issue-478` to `origin` and opened draft PR #481 (`https://github.com/TommyKammy/codex-supervisor/pull/481`) after confirming there was no existing PR for the branch.
- 2026-03-17: Review repair f
