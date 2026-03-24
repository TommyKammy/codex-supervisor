# Issue #950: Issue journal normalization: redact or normalize local absolute paths before writing durable output

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/950
- Branch: codex/issue-950
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: b9ae02dc894191cc45876f27cd1c35f6732c4651
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T19:08:58.140Z

## Latest Codex Summary
Opened draft PR #965 for the focused journal sanitization fix after pushing `codex/issue-950`.

The implementation remains unchanged from commit `b9ae02d`: durable issue-journal writes now normalize workspace-contained absolute paths to repo-relative references and redact non-portable local host paths before persisting summaries, failure context, or preserved notes.

Summary: Pushed `codex/issue-950` and opened draft PR #965 for the durable issue-journal path normalization fix.
State hint: pr_open
Blocked reason: none
Tests: not rerun this turn; relying on prior focused verification (`npx tsx --test src/journal.test.ts`; `npx tsx --test src/workstation-local-path-detector.test.ts`; `npm run verify:paths`)
Next action: monitor PR #965 for CI and review feedback, then address any follow-up if it appears.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the path leak happens inside `syncIssueJournal()` because it writes `last_codex_summary`, failure-context fields, and preserved notes verbatim after only normalizing the top-level workspace metadata.
- What changed: added a journal-local sanitizer that converts workspace-contained absolute paths to repo-relative paths and replaces non-portable local host paths with `<redacted-local-path>` before durable journal text is written; added a focused regression test that covers both cases.
- Current blocker: none.
- Next exact step: monitor draft PR #965 for CI and review feedback, then address any follow-up.
- Verification gap: none.
- Files touched: `src/core/journal.ts`, `src/journal.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only rewrites durable journal rendering and adds a regression test.
- Last focused command: `gh pr create --draft --base main --head codex/issue-950 --title "Normalize durable issue journal paths" --body ...`
- Last focused failure: none.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/965
- Last focused commands:
```bash
sed -n '1,220p' <memory-root>/TommyKammy-codex-supervisor/issue-950/AGENTS.generated.md
sed -n '1,220p' <memory-root>/TommyKammy-codex-supervisor/issue-950/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
gh pr view --json url,isDraft,state,headRefName,baseRefName,number
git push -u origin codex/issue-950
gh pr create --draft --base main --head codex/issue-950 --title "Normalize durable issue journal paths" --body ...
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
