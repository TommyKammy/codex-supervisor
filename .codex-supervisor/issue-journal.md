# Issue #1302: [codex] Auto-redact supervisor-owned durable journal leaks before publication and ready gates

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1302
- Branch: codex/issue-1302
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: b013c69b14e398322e426ab4058d487b90d5bc04
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8547rAH|PRRT_kwDORgvdZ8547rAI
- Repeated failure signature count: 1
- Updated at: 2026-04-05T22:13:22.044Z

## Latest Codex Summary
Reproduced the failing Ubuntu check from the GitHub Actions log and confirmed it was not a code regression in the gate logic. The blocker was the committed supervisor-owned `.codex-supervisor/issue-journal.md`, which still contained a workstation-local home-path reference in tracked durable text, so `npm run verify:paths` failed on Linux.

I sanitized the tracked journal, updated the durable handoff to reflect the repair, committed the fix, and pushed `b013c69` to `codex/issue-1302`. Local `npm run verify:paths` and `npm run build` both pass. PR #1307 has restarted CI; both `build` jobs are currently pending on Actions run `24011370574`.

Summary: Reproduced the failing PR path-hygiene check, removed the committed supervisor-owned journal leak, reran local verification, and pushed the repair to PR #1307.
State hint: waiting_ci
Blocked reason: none
Tests: `npm run verify:paths`; `npm run build`
Next action: watch PR #1307 CI rerun and inspect the Ubuntu build again only if it still fails
Failure signature: PRRT_kwDORgvdZ8547rAH|PRRT_kwDORgvdZ8547rAI

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1307#discussion_r3037418680
- Details:
  - src/workstation-local-path-gate.ts:34 summary=_⚠️ Potential issue_ | _🟠 Major_ **Fail closed when journal normalization throws.** `normalizeCommittedIssueJournal` throws on unreadable journals and atomic write failures (`s... url=https://github.com/TommyKammy/codex-supervisor/pull/1307#discussion_r3037418680
  - src/workstation-local-path-gate.ts:45 summary=_⚠️ Potential issue_ | _🔴 Critical_ **Persist the journal rewrite before returning `ok`.** After Line 43 rewrites the file in the workspace, Line 44 rescans that modified worki... url=https://github.com/TommyKammy/codex-supervisor/pull/1307#discussion_r3037418681

## Codex Working Notes
### Current Handoff
- Hypothesis: the two open CodeRabbit threads were valid follow-up gaps in the auto-redaction gate, not false positives from stale review context.
- What changed: updated the workstation-local path gate to report rewritten supervisor-owned journals and to fail closed with explicit blocker details when journal normalization throws; added branch persistence for rewritten supervisor-owned journals in the pre-push publication path, draft-PR creation gate, and draft-to-ready gate; updated the ready path to keep the PR in `draft_pr` on the new head after an auto-redaction commit so checks can rerun before readying.
- Current blocker: none.
- Next exact step: commit the review-thread fix, push `codex/issue-1302`, then re-check PR #1307 for the two unresolved automated review threads.
- Verification gap: GitHub review threads and PR checks have not been re-read after the local review-fix commit yet.
- Files touched: src/workstation-local-path-gate.ts, src/core/workspace.ts, src/run-once-turn-execution.ts, src/turn-execution-publication-gate.ts, src/post-turn-pull-request.ts, src/workstation-local-path-detector.test.ts, src/turn-execution-publication-gate.test.ts, src/post-turn-pull-request.test.ts
- Rollback concern: low; the new persistence path only stages and commits the exact supervisor-owned journal files that the gate itself rewrote.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-04-06: Verified the review fix with `npx tsx --test src/journal.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts src/turn-execution-publication-gate.test.ts src/workstation-local-path-detector.test.ts` and `npm run build`.
- 2026-04-06: Added a regression proving the gate returns a blocker when supervisor-owned journal normalization throws instead of bubbling the exception.
- 2026-04-06: Publication and ready-path regressions now use real temp repos with a local bare `origin` so the auto-redaction persistence path exercises commit and push behavior instead of only local rewrites.
- 2026-04-06: Re-ran `npx tsx --test src/journal.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts` and `npm run build`; both passed before pushing and opening PR #1307.
- 2026-04-06: Reproduced the failing Ubuntu check by inspecting `gh run view 24011239602 --log-failed`; the only blocker was the committed `.codex-supervisor/issue-journal.md` line that still mentioned a macOS home path.
- 2026-04-06: Pushed `08b883d` to `codex/issue-1302`; `gh pr checks 1307` now shows both build jobs pending on Actions run `24011353906`.
