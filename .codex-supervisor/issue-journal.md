# Issue #948: Path hygiene check: add a focused detector for workstation-local absolute paths

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/948
- Branch: codex/issue-948
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: waiting_ci
- Attempt count: 5 (implementation=2, repair=3)
- Last head SHA: 91e2a0d240ffe0248e46148d05ffedc232d49dd6
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T17:29:42+00:00

## Latest Codex Summary
Validated the CodeRabbit review note on `--exclude-path` normalization in [scripts/check-workstation-local-paths.ts](scripts/check-workstation-local-paths.ts), updated repo-relative path normalization to canonicalize slash variants plus leading `./`, and added a regression case in [src/workstation-local-path-detector.test.ts](src/workstation-local-path-detector.test.ts) covering `--exclude-path ./docs/guide.md`.

Because the tracked issue journal had regressed to workstation-local absolute links, I also restored those references to repo-relative form so [scripts/check-workstation-local-paths.ts](scripts/check-workstation-local-paths.ts) could verify the worktree again. Focused verification passed, I pushed `91e2a0d` to `origin/codex/issue-948`, and I resolved the CodeRabbit review thread `PRRT_kwDORgvdZ852fkSD`. PR [#963](https://github.com/TommyKammy/codex-supervisor/pull/963) remains open with `mergeStateStatus=UNSTABLE`.

Summary: Normalized excluded path inputs, added a `./` exclusion regression test, reran the detector, pushed the review fix, and resolved the review thread
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/workstation-local-path-detector.test.ts`; `npx tsx scripts/check-workstation-local-paths.ts`
Next action: Monitor PR #963 for refreshed checks or follow-up review feedback on `codex/issue-948`
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the CodeRabbit finding is fully addressed, and any remaining risk on issue #948 is limited to post-push CI or new review feedback rather than detector logic.
- What changed: updated [scripts/check-workstation-local-paths.ts](scripts/check-workstation-local-paths.ts) so repo-relative path normalization canonicalizes slash variants and strips leading `./` segments before exclude matching, added regression coverage in [src/workstation-local-path-detector.test.ts](src/workstation-local-path-detector.test.ts) for `--exclude-path ./docs/guide.md`, cleaned the journal back to repo-relative links so the detector passes on the tracked tree again, pushed `91e2a0d`, and resolved review thread `PRRT_kwDORgvdZ852fkSD`.
- Current blocker: none.
- Next exact step: monitor PR #963 for refreshed checks and repair any follow-up review or CI findings on `codex/issue-948`.
- Verification gap: none for the changed behavior; the remaining signal is PR-level CI and review.
- Files touched: [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md), [scripts/check-workstation-local-paths.ts](scripts/check-workstation-local-paths.ts), and [src/workstation-local-path-detector.test.ts](src/workstation-local-path-detector.test.ts).
- Rollback concern: low; the functional change is isolated to CLI exclude-path normalization and its regression coverage.
- Last focused command: `gh api graphql -f query='mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { isResolved } } }' -F threadId=PRRT_kwDORgvdZ852fkSD`
- Last focused failure: none.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/963
- Last focused commands:
```bash
sed -n '1,220p' ../codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-948/AGENTS.generated.md
sed -n '1,220p' ../codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-948/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
sed -n '1,240p' scripts/check-workstation-local-paths.ts
sed -n '1,240p' src/workstation-local-path-detector.test.ts
git status --short --branch
nl -ba scripts/check-workstation-local-paths.ts | sed -n '1,180p'
nl -ba src/workstation-local-path-detector.test.ts | sed -n '1,220p'
npx tsx --test src/workstation-local-path-detector.test.ts
rg -n '<unix-home-prefix>|<macos-users-prefix>|<windows-users-prefix>' .codex-supervisor/issue-journal.md
npx tsx scripts/check-workstation-local-paths.ts
git diff --stat -- scripts/check-workstation-local-paths.ts src/workstation-local-path-detector.test.ts .codex-supervisor/issue-journal.md
git add scripts/check-workstation-local-paths.ts src/workstation-local-path-detector.test.ts .codex-supervisor/issue-journal.md
git commit -m "Normalize excluded workstation-local paths"
git push origin codex/issue-948
gh pr view 963 --json url,isDraft,state,mergeStateStatus,headRefOid,reviewDecision
gh api graphql -f query='mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { isResolved } } }' -F threadId=PRRT_kwDORgvdZ852fkSD
git rev-parse HEAD
date -Iseconds -u
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
