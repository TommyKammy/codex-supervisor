# Issue #950: Issue journal normalization: redact or normalize local absolute paths before writing durable output

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/950
- Branch: codex/issue-950
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: ab75cec48da893569361eafcb70952f1867c4957
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852hV_K|PRRT_kwDORgvdZ852hV_L
- Repeated failure signature count: 1
- Updated at: 2026-03-24T19:54:36.607Z

## Latest Codex Summary
Addressing the remaining review feedback in `src/core/journal.ts`. The durable journal sanitizer now targets inline absolute-path substrings such as `path=<redacted-local-path>` and Markdown links, and it broadens non-portable local-root detection while preserving in-repo paths as repo-relative text.

Added focused regressions in `src/journal.test.ts` for inline assignments, Markdown links, quoted spaced paths, and broader local absolute roots. I also normalized tracked sample-path literals in `src/journal.test.ts` and this journal so the durable-path policy check passes again.

Summary: Implemented the review fixes for journal path normalization, added focused regression coverage, normalized the tracked durable text, and reran the focused verification set successfully.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/journal.test.ts`; `npx tsc --noEmit`; `npx tsx --test src/workstation-local-path-detector.test.ts`; `npm run verify:paths`
Next action: Commit and push the review fix to PR #965, then resolve the remaining automated review threads.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the two review threads are valid, and the current patch should be ready to land once the PR branch is updated with the now-green focused verification set.
- What changed: patched `src/core/journal.ts` to sanitize inline absolute-path substrings and broader local roots, added focused regression tests in `src/journal.test.ts`, and normalized tracked durable-path text in fixtures and this journal so the focused verification set passes.
- Current blocker: none.
- Next exact step: commit and push the review fix, then resolve the remaining automated review threads on PR #965.
- Verification gap: none.
- Files touched: `src/core/journal.ts`, `src/journal.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only affects journal path normalization heuristics, regression fixtures, and durable notes.
- Last focused command: `npx tsx --test src/workstation-local-path-detector.test.ts`
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
