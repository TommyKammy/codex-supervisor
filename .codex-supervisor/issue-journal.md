# Issue #721: Workspace restore visibility: surface whether recovery used local, remote, or bootstrap source

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/721
- Branch: codex/issue-721
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=1, repair=3)
- Last head SHA: 1707486e0135bf87b37c6d364ddb0112b197cafe
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T16:43:06Z

## Latest Codex Summary
Addressed the three remaining CodeRabbit follow-ups in [.codex-supervisor/issue-journal.md](./issue-journal.md) without changing any restore behavior. The journal now uses repo-relative links in the latest summary, keeps the review-status narrative consistent with the current branch state, and no longer contains inline-code spacing that could trigger the reported MD038 warning.

The journal-only fix is pushed to `origin/codex/issue-721` at `1707486`, and review threads `PRRT_kwDORgvdZ851wrHP`, `PRRT_kwDORgvdZ851wrHV`, and `PRRT_kwDORgvdZ851wrHX` were resolved after the push. The untracked `.codex-supervisor/replay/` directory was left untouched.

Summary: Fixed the journal-only review fallout, pushed `1707486`, and resolved the remaining CodeRabbit threads on PR #746.
State hint: waiting_ci
Blocked reason: none
Tests: `rg -n '\\]\\(/home/tommy' .codex-supervisor/issue-journal.md`; `perl -ne 'while(/(?<!`)`([^`]+)`(?!`)/g){ print qq($.::<$1>\\n) if $1 =~ /^\\s|\\s$/ }' .codex-supervisor/issue-journal.md`; `git diff --check -- .codex-supervisor/issue-journal.md`
Failure signature: none
Next action: Watch PR #746 CI on `1707486` and address any new check or review fallout if it appears.

## Active Failure Context
- Category: none
- Summary: none
- Reference: none
- Details:
  - none

## Codex Working Notes
### Current Handoff
- Hypothesis: The review fallout was documentation-only and is now fully addressed on the branch; the next risk is only whether CI or new review feedback appears after the latest push.
- What changed: replaced machine-local links with repo-relative links in the latest summary, updated the journal summary/status text to match the branch's review-follow-up state, pushed commit `1707486`, and resolved CodeRabbit threads `PRRT_kwDORgvdZ851wrHP`, `PRRT_kwDORgvdZ851wrHV`, and `PRRT_kwDORgvdZ851wrHX`.
- Current blocker: none
- Next exact step: monitor PR #746 CI and watch for any fresh review fallout after commit `1707486`.
- Verification gap: no code-path behavior changed in this turn, so verification was limited to the journal-only Markdown checks.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this patch would restore non-portable journal links and a misleading review-status summary, which would make the operator-visible state inconsistent again.
- Last focused command: `gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -f threadId='PRRT_kwDORgvdZ851wrHX'`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-721/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-721/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short`; `git diff -- .codex-supervisor/issue-journal.md`; `nl -ba .codex-supervisor/issue-journal.md | sed -n '1,140p'`; `npx markdownlint-cli2 .codex-supervisor/issue-journal.md`; `rg -n '\\]\\(/home/tommy' .codex-supervisor/issue-journal.md`; `perl -ne 'while(/(?<!`)`([^`]+)`(?!`)/g){ print qq($.::<$1>\\n) if $1 =~ /^\\s|\\s$/ }' .codex-supervisor/issue-journal.md`; `git diff --check -- .codex-supervisor/issue-journal.md`; `git add .codex-supervisor/issue-journal.md && git commit -m "Fix issue journal review follow-ups"`; `git push origin codex/issue-721`; `git rev-parse HEAD`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -f threadId='PRRT_kwDORgvdZ851wrHP'`; `gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -f threadId='PRRT_kwDORgvdZ851wrHV'`; `gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -f threadId='PRRT_kwDORgvdZ851wrHX'`; `git status --short`
### Scratchpad
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
