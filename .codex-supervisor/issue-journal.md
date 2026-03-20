# Issue #721: Workspace restore visibility: surface whether recovery used local, remote, or bootstrap source

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/721
- Branch: codex/issue-721
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=1, repair=3)
- Last head SHA: 5fe2de71639d12e965ac8c2dd5a4a80b4b9d8f68
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T16:59:28Z

## Latest Codex Summary
Resolved the remaining PR #746 CodeRabbit thread by converting the journal's semicolon-delimited inline command logs to fenced `bash` blocks in [.codex-supervisor/issue-journal.md](./issue-journal.md). The markdown-only fix was pushed as `5fe2de7`, thread `PRRT_kwDORgvdZ851w4ly` was resolved, and the pre-existing untracked `.codex-supervisor/replay/` directory was left untouched.

Summary: Fixed the last journal-only review thread, pushed `5fe2de7`, and resolved `PRRT_kwDORgvdZ851w4ly` on PR #746.
State hint: waiting_ci
Blocked reason: none
Tests:
```bash
perl -ne 'print if /^(Tests|[-] Last focused commands): `/' .codex-supervisor/issue-journal.md
perl -ne 'while(/(?<!`)`([^`]+)`(?!`)/g){ print qq($.::<$1>\n) if $1 =~ /^\s|\s$/ }' .codex-supervisor/issue-journal.md
git diff --check -- .codex-supervisor/issue-journal.md
```
Failure signature: none
Next action: Watch PR #746 on `5fe2de7`; both CI build jobs passed on 2026-03-20 and only the refreshed CodeRabbit status remains pending.

## Active Failure Context
- Category: none
- Summary: none
- Reference: none
- Details:
  - none

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining review fallout is cleared on the branch, so the only near-term risk is whether refreshed CodeRabbit status surfaces any new journal-only complaint on head `5fe2de7`.
- What changed: converted the journal's inline command-log lists to fenced `bash` blocks, committed the markdown-only fix as `5fe2de7`, pushed `codex/issue-721`, and resolved CodeRabbit thread `PRRT_kwDORgvdZ851w4ly`.
- Current blocker: none
- Next exact step: watch PR #746 status on `5fe2de7` until the refreshed CodeRabbit result posts.
- Verification gap: no code-path behavior changed in this turn, so verification remained limited to focused checks for the journal formatting change plus PR status confirmation after push.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this patch would restore the inline command-log formatting that triggered the review thread and would likely reopen the journal-only PR feedback on the next CodeRabbit pass.
- Last focused command: `gh pr view 746 --json headRefOid,mergeStateStatus,statusCheckRollup`
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
git add .codex-supervisor/issue-journal.md && git commit -m "Fence journal command logs"
date -u +"%Y-%m-%dT%H:%M:%SZ"
git push origin codex/issue-721
gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -f threadId='PRRT_kwDORgvdZ851w4ly'
gh pr view 746 --json headRefOid,mergeStateStatus,statusCheckRollup
```
### Scratchpad
- 2026-03-21 (JST): Pushed `5fe2de7` with the journal-only fenced-command-log fix, resolved CodeRabbit thread `PRRT_kwDORgvdZ851w4ly`, and confirmed via `gh pr view` that both CI build jobs were green while the refreshed CodeRabbit status was still pending on the new head.
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
