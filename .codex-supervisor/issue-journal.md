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

Pushed the repair commit `49f3a04` to `codex/issue-950`. `gh pr checks 965` now shows the GitHub build jobs rerunning on the updated PR head.

Summary: Reproduced the CI `tsc` failure, fixed the invalid test category literal, normalized the remaining journal path leak, reran focused verification locally, and pushed the repair for CI rerun.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsc --noEmit`; `npx tsx --test src/journal.test.ts`; `npx tsx --test src/workstation-local-path-detector.test.ts`; `npm run verify:paths`
Next action: Wait for PR #965 build checks to complete on commit `49f3a04`, then address any remaining review feedback if it appears.
Failure signature: none

## Active Failure Context
- Category: checks
- Summary: PR #965 checks are rerunning after the CI repair push.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/965
- Details:
  - CodeRabbit (pending) https://github.com/TommyKammy/codex-supervisor/pull/965
  - build (ubuntu-latest) (pending) https://github.com/TommyKammy/codex-supervisor/actions/runs/23508273114/job/68422054730
  - build (macos-latest) (pending) https://github.com/TommyKammy/codex-supervisor/actions/runs/23508273114/job/68422054748

## Codex Working Notes
### Current Handoff
- Hypothesis: the failing CI signal was a narrow TypeScript regression in the new journal test, and the branch also still carried one durable absolute-path leak inside the committed issue journal summary.
- What changed: changed the regression test failure-context category from the invalid `"verification"` literal to `"manual"`, normalized the lingering repo-local absolute journal link to a repo-relative link, reran the focused verification set, and pushed commit `49f3a04` to the PR branch.
- Current blocker: none.
- Next exact step: wait for PR #965 build checks to finish on commit `49f3a04`, then address any remaining review feedback if needed.
- Verification gap: none.
- Files touched: `src/journal.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the repair only changes a test fixture/category literal and normalizes journal text.
- Last focused command: `gh pr checks 965`
- Last focused failure: `npm run verify:paths` initially failed because `## Latest Codex Summary` still contained a workstation-local absolute path to `.codex-supervisor/issue-journal.md`.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/965
- Last focused commands:
```bash
npx tsc --noEmit
npx tsx --test src/journal.test.ts
npx tsx --test src/workstation-local-path-detector.test.ts
npm run verify:paths
git push
gh pr view 965 --json headRefOid,headRefName,isDraft,state,url
gh pr checks 965
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
