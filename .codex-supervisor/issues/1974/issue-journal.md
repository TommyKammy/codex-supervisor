# Issue #1974: Classify Codex Connector unresolved current-head threads as metadata-only before retrying repairs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1974
- Branch: codex/issue-1974
- Workspace: .
- Journal: .codex-supervisor/issues/1974/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=3, repair=1)
- Last head SHA: 533b90c87e8a75bb167ef8100f896d70781d1860
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ86Bsx7f|PRRT_kwDORgvdZ86Bsx7r
- Repeated failure signature count: 1
- Updated at: 2026-05-13T09:59:43.129Z

## Latest Codex Summary
Implemented and committed a clean checkpoint on `codex/issue-1974` for issue **#1974**.

- Kept stale-review diagnostics from treating Codex `metadata_only_current_head_converged` as unresolved work in explain output.
- Kept reply-and-resolve automation gated to safe metadata-only cases (`metadata_only` and `metadata_only_current_head_converged`) in tracked PR persistent status comment flow.

Committed:
- `533b90c` — `Handle Codex metadata-only stale review thread states`

Also updated `.codex-supervisor/issues/1974/issue-journal.md` with current handoff/verification notes.

- `src/supervisor/supervisor-selection-issue-explain.ts`
- `src/tracked-pr-status-comment.ts`

Observed test output: the full targeted suite passed (`330` tests).  
`npm run build` and `issue-lint 1974` both passed.

Summary: Extended classification handling in diagnostics/status paths so metadata-only Codex current-head thread residue is not treated as unresolved work for stale-work repair diagnostics/automation.
State hint: stabilizing
Blocked reason: none
Tests: `npx tsx --test src/post-turn-pull-request.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-status-review-bot.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/review-thread-reporting.test.ts` (330 passed), `npm run build`, `node dist/index.js issue-lint 1974 --config "$CODEX_SUPERVISOR_CONFIG"` (pass; no blocking test failures)
Next action: open/update draft PR for this issue branch and continue PR-handoff with this checkpoint hash (`533b90c`); optionally run `status --why`/`explain` on active loop for operator-facing validation.
Failure signature: PRRT_kwDORgvdZ86Bsx7f|PRRT_kwDORgvdZ86Bsx7r

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1975#discussion_r3233042086
- Details:
  - src/supervisor/stale-review-bot-remediation.ts:116 summary=_⚠️ Potential issue_ | _🟠 Major_ | _⚡ Quick win_ 🧩 Analysis chain 🏁 Script executed: Repository: TommyKammy/codex-supervisor Length of output: 50384 --- 🏁 Script executed: R... url=https://github.com/TommyKammy/codex-supervisor/pull/1975#discussion_r3233042086
  - src/supervisor/stale-review-bot-remediation.ts:181 summary=_⚠️ Potential issue_ | _🟡 Minor_ | _⚡ Quick win_ 🧩 Analysis chain 🏁 Script executed: Repository: TommyKammy/codex-supervisor Length of output: 50384 --- 🏁 Script executed: R... url=https://github.com/TommyKammy/codex-supervisor/pull/1975#discussion_r3233042096

## Codex Working Notes
### Current Handoff
- Hypothesis confirmed: remaining Codex review-thread residue should be classified as metadata-only before retrying repairs only when provider-owned evidence proves the current head observation comes from Codex and the policy outcome is either missing-current-head or non-actionable convergence.
- What changed in this checkpoint: In `src/supervisor/stale-review-bot-remediation.ts`, `codexConnectorCurrentHeadReviewState` now requires `configuredBotCurrentHeadObservationSource === "codex_pr_success_comment"` before reporting `observed`; `classifyCodexMetadataOnly` now explicitly handles `policy.outcome === "nitpick_only"` with the same converged metadata-only path and makes fallback states explicit.
- Commit: `a244e69`
- Current blocker: none.
- Exact verification run: `npx tsx --test src/post-turn-pull-request.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-status-review-bot.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/review-thread-reporting.test.ts` (330 passed), `npm run build` (pass), `node dist/index.js issue-lint 1974 --config "$CODEX_SUPERVISOR_CONFIG"` (pass).
- Next exact step: continue addressing_review with this checkpoint (`a244e69`) and leave PR updated; if required, run `status --why`/`explain` on active loop for final operator-facing confirmation.
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- No remaining issue-specific failures in this turn. Remaining log noise in targeted suites is from intentionally inverted execution-metrics fixture data and expected recoverable warnings.
