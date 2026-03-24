# Issue #950: Issue journal normalization: redact or normalize local absolute paths before writing durable output

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/950
- Branch: codex/issue-950
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bb7e5be9c4d5be88534d29554506b30c7c223e4e
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T18:51:23.251Z

## Latest Codex Summary
Summary: Normalized durable issue-journal text so in-repo absolute paths become repo-relative and non-portable local host paths are redacted before `syncIssueJournal()` writes the snapshot, failure context, summary, or preserved notes.
State hint: implementing
Blocked reason: none
Tests: `npx tsx --test src/journal.test.ts`; `npx tsx --test src/workstation-local-path-detector.test.ts`; `npm run verify:paths`
Failure signature: none
Next action: Commit the journal sanitizer changes on `codex/issue-950`, then open or update the draft PR for review.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the path leak happens inside `syncIssueJournal()` because it writes `last_codex_summary`, failure-context fields, and preserved notes verbatim after only normalizing the top-level workspace metadata.
- What changed: added a journal-local sanitizer that converts workspace-contained absolute paths to repo-relative paths and replaces non-portable local host paths with `<redacted-local-path>` before durable journal text is written; added a focused regression test that covers both cases.
- Current blocker: none.
- Next exact step: commit the focused fix, then open or update a draft PR from `codex/issue-950`.
- Verification gap: none.
- Files touched: `src/core/journal.ts`, `src/journal.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only rewrites durable journal rendering and adds a regression test.
- Last focused command: `npm run verify:paths`
- Last focused failure: `npm run verify:paths` initially failed in this workspace because the new regression test committed a literal `/home/...` fixture; the fixture now constructs that path at runtime instead, and the verifier passes.
- Last focused commands:
```bash
sed -n '1,220p' <memory-root>/TommyKammy-codex-supervisor/issue-950/AGENTS.generated.md
sed -n '1,220p' <memory-root>/TommyKammy-codex-supervisor/issue-950/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
npx tsx --test src/journal.test.ts
sed -n '1,260p' src/core/journal.ts
sed -n '1,320p' src/journal.test.ts
rg -n "issue-journal|Working Notes|Latest Codex Summary|normalize|absolute path|repo-relative|redact" src scripts .
sed -n '1,260p' scripts/check-workstation-local-paths.ts
sed -n '1,260p' src/workstation-local-path-detector.test.ts
test -x node_modules/.bin/tsx && echo installed || echo missing
test -f package-lock.json && echo lockfile || echo no-lockfile
sed -n '1,220p' package.json
npm install
npx tsx --test src/workstation-local-path-detector.test.ts
npm run verify:paths
git diff -- src/core/journal.ts src/journal.test.ts .codex-supervisor/issue-journal.md
date -Iseconds -u
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
