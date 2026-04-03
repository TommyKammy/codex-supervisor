# Issue #1276: Avoid false positives when workstation-local path hygiene sees container paths like /home/node/.n8n

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1276
- Branch: codex/issue-1276
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 3bd1ee656ba375d8fa46be157bc0029fad8a9fa9
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ854q4Ck
- Repeated failure signature count: 1
- Updated at: 2026-04-03T07:19:29.006Z

## Latest Codex Summary
Narrowed workstation path hygiene in [src/workstation-local-paths.ts](src/workstation-local-paths.ts) so Linux `<redacted-local-path>` matches are classified by home owner instead of blanket-blocked, which now allows the known container path `<redacted-local-path>` while still blocking Linux/macOS/Windows workstation home directories. I also made the rendered diagnostics include the classification reason in [src/workstation-local-path-gate.ts](src/workstation-local-path-gate.ts) and [scripts/check-workstation-local-paths.ts](scripts/check-workstation-local-paths.ts), and added direct regressions in [src/workstation-local-paths.test.ts](src/workstation-local-paths.test.ts).

The work is committed and pushed on `codex/issue-1276`, the journal handoff is updated, and draft PR `#1283` is open: https://github.com/TommyKammy/codex-supervisor/pull/1283. Tracked files are clean; only transient untracked `.codex-supervisor` scratch files remain in the worktree.

Summary: Allowed `<redacted-local-path>.` container paths in `verify:paths`, kept workstation home blocking intact, added direct regressions, pushed commits `4181181` and `96d71ea`, and opened draft PR #1283
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/workstation-local-paths.test.ts src/local-ci.test.ts`; `npx tsx --test src/workstation-local-path-detector.test.ts`; `npm run build`
Next action: Watch draft PR #1283 for CI and review feedback, then promote it when ready
Failure signature: PRRT_kwDORgvdZ854q4Ck

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1283#discussion_r3031769997
- Details:
  - src/workstation-local-paths.ts:43 summary=_⚠️ Potential issue_ | _🟠 Major_ **Don't let `:/home/...` compound tokens bypass the `node` allowlist.** `PATH_TOKEN_PATTERN` still spans `:`, so a value like `<redacted-local-path>. url=https://github.com/TommyKammy/codex-supervisor/pull/1283#discussion_r3031769997

## Codex Working Notes
### Current Handoff
- Hypothesis: Compound tokens need to be split into independent absolute-path candidates before classification; otherwise an allowlisted segment can hide a later workstation-local path in the same token.
- What changed: `collectMatches()` now splits matched tokens on `:`/`;` whenever the next segment starts with `/home/`, `/Users/`, or `C:\\Users\\`, classifies each segment independently, and dedupes cross-pattern findings so mixed-prefix path lists stay clean. Added direct regressions for the reported `/home/node/...:/home/alice/...` bypass and a mixed-prefix Unix/macOS path-list case.
- Current blocker: none
- Next exact step: Push the follow-up review-fix checkpoint to PR #1283, then monitor CI and resolve or reply to thread `PRRT_kwDORgvdZ854q4Ck` if explicitly asked.
- Verification gap: This turn reran the issue’s focused path/local-CI slice and `npm run build`, but it did not rerun the separate detector CLI test file or a supervisor end-to-end flow.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/workstation-local-paths.ts`, `src/workstation-local-paths.test.ts`
- Rollback concern: Compound splitting now covers all known workstation-home prefixes after list delimiters, so if more prefixes are introduced later they need to be added to the splitter and corresponding regressions.
- Last focused command: `npm run build`
### Scratchpad
- Commands run this turn: `gh auth status`; `gh pr view 1283 --json number,url,isDraft,reviewDecision,mergeStateStatus,headRefName,baseRefName`; `gh api graphql ... reviewThreads ...`; `npx tsx --test src/workstation-local-paths.test.ts src/local-ci.test.ts`; `npm run build`; `git commit -m "Handle compound workstation path candidates"`; `git push origin codex/issue-1276`
- Active review status: CodeRabbit thread `PRRT_kwDORgvdZ854q4Ck` is still open on GitHub, but the reported bypass is now fixed locally and covered by regression.
