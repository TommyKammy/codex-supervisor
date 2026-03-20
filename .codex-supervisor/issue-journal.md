# Issue #721: Workspace restore visibility: surface whether recovery used local, remote, or bootstrap source

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/721
- Branch: codex/issue-721
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=1, repair=3)
- Last head SHA: c0afcd46c5d866166286585e94730191c7c6d7f6
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851w4ly
- Repeated failure signature count: 1
- Updated at: 2026-03-21T00:00:00Z

## Latest Codex Summary
Revalidated the remaining CodeRabbit journal-only thread against the current worktree and confirmed the finding was still valid. The journal still had semicolon-delimited inline command spans in `Tests:` and `Last focused commands:`, so this turn converts those logs to fenced `bash` blocks without changing any workspace-restore behavior.

Summary: Converting the remaining journal command logs to fenced `bash` blocks to address the unresolved MD038-style review finding on PR #746.
State hint: local_review_fix
Blocked reason: none
Tests:
```bash
rg -n "^(Tests|[-] Last focused commands): `" .codex-supervisor/issue-journal.md
perl -ne 'while(/(?<!`)`([^`]+)`(?!`)/g){ print qq($.::<$1>\n) if $1 =~ /^\s|\s$/ }' .codex-supervisor/issue-journal.md
git diff --check -- .codex-supervisor/issue-journal.md
```
Failure signature: PRRT_kwDORgvdZ851w4ly
Next action: Run the focused Markdown checks, commit the journal-only fix, push `codex/issue-721`, and resolve thread `PRRT_kwDORgvdZ851w4ly` if the branch diff matches the review ask.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/746#discussion_r2966841924
- Details:
  - `.codex-supervisor/issue-journal.md` still used inline semicolon-delimited code spans for command logs in `Tests:` and `Last focused commands:`. That pattern matches the unresolved CodeRabbit request and is the only journal content being changed in this turn.

## Codex Working Notes
### Current Handoff
- Hypothesis: The only remaining review fallout is the journal's inline command-log formatting, and converting those logs to fenced `bash` blocks should satisfy the unresolved thread without affecting restore behavior.
- What changed: updated the journal summary and failure context to reflect the still-open thread accurately, replaced the inline command-log list under `Tests:` with a fenced `bash` block, and replaced the long `Last focused commands:` inline span with a fenced `bash` block.
- Current blocker: none
- Next exact step: run the focused journal checks, then commit and push this markdown-only review fix before resolving the remaining CodeRabbit thread.
- Verification gap: no code-path behavior changed in this turn, so verification is limited to focused checks for the journal formatting change.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this patch would restore the inline command-log formatting that triggered the unresolved review thread, leaving the operator-visible journal state noisy and the PR stuck in review.
- Last focused command: `npx markdownlint-cli2 .codex-supervisor/issue-journal.md`
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-721/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-721/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
git diff -- .codex-supervisor/issue-journal.md
nl -ba .codex-supervisor/issue-journal.md | sed -n '1,180p'
npx markdownlint-cli2 .codex-supervisor/issue-journal.md
git rev-parse HEAD
git show HEAD:.codex-supervisor/issue-journal.md | sed -n '1,140p'
```
### Scratchpad
- 2026-03-21 (JST): Reproduced the remaining PR #746 review finding locally, confirmed the journal still had inline command-log spans in `Tests:` and `Last focused commands:`, and converted those logs to fenced `bash` blocks while keeping the failure context and handoff notes concise.
- 2026-03-21 (JST): Fixed the journal-only review fallout in `.codex-supervisor/issue-journal.md`, verified the summary no longer uses machine-local Markdown links and that inline code spans have no leading/trailing spaces, pushed `1707486` to `origin/codex/issue-721`, and resolved CodeRabbit threads `PRRT_kwDORgvdZ851wrHP`, `PRRT_kwDORgvdZ851wrHV`, and `PRRT_kwDORgvdZ851wrHX`.
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
