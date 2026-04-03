# Issue #1275: Improve diagnostics when a tracked PR is waiting on CI/review signals the repo cannot produce yet

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1275
- Branch: codex/issue-1275
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=1)
- Last head SHA: bb3ffbe68e90a3707299f47fcb8221f4ea7a0ae0
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ854uBe6|PRRT_kwDORgvdZ854uBfA
- Repeated failure signature count: 1
- Updated at: 2026-04-03T13:42:43.615Z

## Latest Codex Summary
Addressed the two open CodeRabbit findings on PR [#1288](https://github.com/TommyKammy/codex-supervisor/pull/1288) in `supervisor-status-review-bot`. The readiness diagnostic now treats configured-bot top-level reviews as observed external review signals, and the aggregate readiness state now preserves any `repo_not_configured` CI/review gap unless an actual blocking failure is present.

Added focused regressions for both review cases and reran the requested verification set plus the TypeScript build.

Summary: Fixed the tracked-PR readiness diagnostic so top-level configured-bot reviews count as signals and partial repo-readiness gaps remain visible.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-status-review-bot.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`; `npm run build`
Next action: Commit and push the review-fix patch to PR #1288, then monitor for any remaining review-thread or CI follow-up.
Failure signature: PRRT_kwDORgvdZ854uBe6|PRRT_kwDORgvdZ854uBfA

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1288#discussion_r3032846939
- Details:
  - src/supervisor/supervisor-status-review-bot.ts:398 summary=_⚠️ Potential issue_ | _🟠 Major_ **Treat configured-bot top-level reviews as external review signals.** This branch only upgrades `review` from thread state plus `summarizeObse... url=https://github.com/TommyKammy/codex-supervisor/pull/1288#discussion_r3032846939
  - src/supervisor/supervisor-status-review-bot.ts:407 summary=_⚠️ Potential issue_ | _🟠 Major_ **Preserve partial repo-readiness gaps in the aggregate status.** Right now `status=repo_not_ready_for_expected_signals` only appears when CI i... url=https://github.com/TommyKammy/codex-supervisor/pull/1288#discussion_r3032846944

## Codex Working Notes
### Current Handoff
- Hypothesis: The tracked-PR diagnostics only classified "missing provider signal" and "checks=none", so bootstrap repos with no workflows/check runs were being reported like a PR-specific wait instead of a repo capability mismatch.
- What changed: Addressed the two current review findings in `externalSignalReadinessDiagnostics()` by treating configured-bot top-level review effects as external review signals and by preserving any partial `repo_not_configured` readiness gap in the aggregate status. Added focused unit coverage for blocking top-level reviews and softened-review plus missing-workflow combinations.
- Current blocker: none
- Next exact step: Commit and push the review-fix patch to `codex/issue-1275`, then update PR #1288 and watch for any remaining unresolved review threads.
- Verification gap: none for the requested focused suite and TypeScript build.
- Files touched: .codex-supervisor/issue-journal.md; src/supervisor/supervisor-detailed-status-assembly.ts; src/supervisor/supervisor-diagnostics-explain.test.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/supervisor/supervisor-selection-issue-explain.ts; src/supervisor/supervisor-status-rendering-supervisor.test.ts; src/supervisor/supervisor-status-review-bot.test.ts; src/supervisor/supervisor-status-review-bot.ts
- Rollback concern: The new readiness classification uses local `.github/workflows/*` presence as a diagnostic heuristic; if a repo emits external checks without committed workflows, the line could over-classify that case as repo-not-configured.
- Last focused command: `npx tsx --test src/supervisor/supervisor-status-review-bot.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`; `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
