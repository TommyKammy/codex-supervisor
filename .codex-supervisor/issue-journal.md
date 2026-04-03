# Issue #1276: Avoid false positives when workstation-local path hygiene sees container paths like /home/node/.n8n

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1276
- Branch: codex/issue-1276
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: failed
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: c875106faf3ac1578c4f40e11e4e78dde49710b2
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail
- Repeated failure signature count: 3
- Updated at: 2026-04-03T07:42:26.894Z

## Latest Codex Summary
The CodeRabbit finding was valid. I updated [src/workstation-local-paths.ts](src/workstation-local-paths.ts) so compound tokens are split at `:` or `;` when the next segment starts with `<redacted-local-path>`, `<redacted-local-path>`, or `<redacted-local-path>`, then each segment is classified independently and deduped across matcher passes. That closes the `<redacted-local-path>.` bypass and keeps mixed-prefix path lists from reporting duplicates.

I added focused regressions in [src/workstation-local-paths.test.ts](src/workstation-local-paths.test.ts) for the reported Unix path-list case and a mixed Unix/macOS list, updated [issue-journal.md](.codex-supervisor/issue-journal.md), and pushed the branch. PR `#1283` now points at `c875106`; GitHub currently shows merge state `UNSTABLE`, which is expected immediately after the fresh push.

Summary: Fixed the compound-token review finding by splitting and independently classifying absolute home-path segments, added regressions for same-prefix and mixed-prefix path lists, updated the journal, and pushed `codex/issue-1276` to `c875106`
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/workstation-local-paths.test.ts src/local-ci.test.ts`; `npm run build`
Next action: Monitor CI on PR `#1283` at `c875106` and resolve or reply to review thread `PRRT_kwDORgvdZ854q4Ck` if explicitly asked
Failure signature: build (ubuntu-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1283 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1283
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23938197065/job/69818727704

## Codex Working Notes
### Current Handoff
- Hypothesis: Compound tokens need to be split into independent absolute-path candidates before classification; otherwise an allowlisted segment can hide a later workstation-local path in the same token.
- What changed: `collectMatches()` now splits matched tokens on `:`/`;` whenever the next segment starts with `<redacted-local-path>`, `<redacted-local-path>`, or `<redacted-local-path>`, classifies each segment independently, and dedupes cross-pattern findings so mixed-prefix path lists stay clean. Added direct regressions for the reported `<redacted-local-path>.` bypass and a mixed-prefix Unix/macOS path-list case.
- Current blocker: none
- Next exact step: Monitor CI on PR #1283 for commit `5d3d8a7`, then resolve or reply to thread `PRRT_kwDORgvdZ854q4Ck` if explicitly asked.
- Verification gap: This turn reran the issue’s focused path/local-CI slice and `npm run build`, but it did not rerun the separate detector CLI test file or a supervisor end-to-end flow.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/workstation-local-paths.ts`, `src/workstation-local-paths.test.ts`
- Rollback concern: Compound splitting now covers all known workstation-home prefixes after list delimiters, so if more prefixes are introduced later they need to be added to the splitter and corresponding regressions.
- Last focused command: `npm run build`
### Scratchpad
- Commands run this turn: `gh auth status`; `gh pr view 1283 --json number,url,isDraft,reviewDecision,mergeStateStatus,headRefName,baseRefName`; `gh api graphql ... reviewThreads ...`; `npx tsx --test src/workstation-local-paths.test.ts src/local-ci.test.ts`; `npm run build`; `git commit -m "Handle compound workstation path candidates"`; `git push origin codex/issue-1276`; `git commit -m "Split compound workstation path tokens"`; `git push origin codex/issue-1276`; `gh pr view 1283 --json number,url,reviewDecision,mergeStateStatus,isDraft,headRefOid`
- Active review status: CodeRabbit thread `PRRT_kwDORgvdZ854q4Ck` is still open on GitHub, but the reported bypass is now fixed locally and covered by regression.
