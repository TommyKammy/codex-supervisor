# Issue #1391: Refactor: extract dashboard page rendering and layout helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1391
- Branch: codex/issue-1391
- Workspace: .
- Journal: .codex-supervisor/issues/1391/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: d4f16bb708bde8edae2ed67cf914cec1c02a0893
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ855yUm4
- Repeated failure signature count: 1
- Updated at: 2026-04-09T08:31:16.985Z

## Latest Codex Summary
Addressed CodeRabbit thread `PRRT_kwDORgvdZ855yUm4` by escaping `</script` sequences before interpolating `browserScript` into the dashboard layout and by adding a regression test that proves inline script content cannot terminate the page's sole script tag early.

The focused dashboard/server test slice and `npm run build` both passed after the patch. Local supervisor runtime artifacts under `.codex-supervisor/` remain untracked; I did not touch those.

Summary: Patched dashboard inline script rendering against `</script>` breakouts, added regression coverage, and reverified the review fix locally.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts --test-name-pattern 'dashboard|page|layout|html'`; `npm run build`
Next action: Commit and push the review fix to PR #1398, then leave the thread ready for manual resolution/review pickup.
Failure signature: PRRT_kwDORgvdZ855yUm4

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1398#discussion_r3056485329
- Details:
  - src/backend/webui-dashboard-page-layout.ts:1189 summary=_⚠️ Potential issue_ | _🟠 Major_ **Harden inline script injection against ` ` breakouts.** Line 1188 embeds raw script text directly; a literal ` ` in `browserScript` can termi... url=https://github.com/TommyKammy/codex-supervisor/pull/1398#discussion_r3056485329

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining review blocker is valid and can be closed without behavior drift by escaping inline `</script` sequences at the page layout boundary, keeping the generated browser script semantics intact.
- What changed: Escaped `</script` sequences in `renderDashboardPageLayout()` before embedding `browserScript`; added a layout regression test that asserts the HTML contains only the closing script tag from the shell itself.
- Current blocker: none
- Next exact step: Commit and push the review-fix checkpoint to `codex/issue-1391`, then hand back to the supervisor in `addressing_review`.
- Verification gap: No browser smoke rerun in this turn; focused dashboard/server tests and `npm run build` passed locally.
- Files touched: `src/backend/webui-dashboard-page-layout.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: Low; the change is limited to HTML-safe escaping of inline script content and a focused regression test.
- Last focused command: `npm run build`
- Last focused commands: `gh api graphql -f query='query { repository(owner: "TommyKammy", name: "codex-supervisor") { pullRequest(number: 1398) { reviewThreads(first: 20) { nodes { id isResolved isOutdated path line startLine comments(first: 10) { nodes { url author { login } body createdAt } } } } } } }'`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts --test-name-pattern 'dashboard|page|layout|html'`; `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
