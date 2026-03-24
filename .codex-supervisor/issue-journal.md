# Issue #950: Issue journal normalization: redact or normalize local absolute paths before writing durable output

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/950
- Branch: codex/issue-950
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 87a943ee2a2a5661838536742176c5faf7595a81
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail|build (macos-latest):fail
- Repeated failure signature count: 1
- Updated at: 2026-03-24T19:23:37.098Z

## Latest Codex Summary
Reproduced the failing CI compile step locally with `npx tsc --noEmit`, which failed because [`src/journal.test.ts`](src/journal.test.ts) used the invalid `FailureContextCategory` literal `"verification"`. Updated the regression test to use the existing `"manual"` category, then reran focused verification.

`npm run verify:paths` also exposed a remaining durable path leak in this journal summary: it still linked to [`issue-journal.md`](.codex-supervisor/issue-journal.md) via a workstation-local absolute path. Normalized that link to a repo-relative reference and reran the focused checks successfully.

Summary: Reproduced the CI `tsc` failure, fixed the invalid test category literal, normalized the remaining journal path leak, and reran focused verification locally.
State hint: repairing_ci
Blocked reason: none
Tests: `npx tsc --noEmit`; `npx tsx --test src/journal.test.ts`; `npx tsx --test src/workstation-local-path-detector.test.ts`; `npm run verify:paths`
Next action: Commit and push the CI repair to PR #965, then wait for the build checks to rerun.
Failure signature: build (ubuntu-latest):fail|build (macos-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #965 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/965
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23507627174/job/68419724064
  - build (macos-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23507627174/job/68419724051

## Codex Working Notes
### Current Handoff
- Hypothesis: the failing CI signal was a narrow TypeScript regression in the new journal test, and the branch also still carried one durable absolute-path leak inside the committed issue journal summary.
- What changed: changed the regression test failure-context category from the invalid `"verification"` literal to `"manual"` and normalized the lingering repo-local absolute journal link to a repo-relative link; reran the focused verification set.
- Current blocker: none.
- Next exact step: commit and push this repair to PR #965, then wait for the build checks to rerun.
- Verification gap: none.
- Files touched: `src/journal.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the repair only changes a test fixture/category literal and normalizes journal text.
- Last focused command: `npm run verify:paths`
- Last focused failure: `npm run verify:paths` initially failed because `## Latest Codex Summary` still contained a workstation-local absolute path to `.codex-supervisor/issue-journal.md`.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/965
- Last focused commands:
```bash
npx tsc --noEmit
npx tsx --test src/journal.test.ts
npx tsx --test src/workstation-local-path-detector.test.ts
npm run verify:paths
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
