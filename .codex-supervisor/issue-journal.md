# Issue #800: WebUI contract hardening: expose typed issue collections and candidate-discovery summaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/800
- Branch: codex/issue-800
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: dbae4c24e4256cdf5a523b3279f244666c6bc379
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8517C9c
- Repeated failure signature count: 1
- Updated at: 2026-03-21T22:43:04Z

## Latest Codex Summary
Addressed the remaining CodeRabbit review on PR #805 by making readiness evaluation use `listAllIssues()` for blocker and predecessor checks while still iterating only `listCandidateIssues()` for candidate selection. I added a direct readiness-summary regression and an end-to-end `statusReport()` regression covering a candidate blocked by a non-candidate dependency, and updated the no-active-issue test doubles to expose `listAllIssues()`.

Local dirt is the updated journal plus the pre-existing untracked `.codex-supervisor/replay/` directory until the review-fix commit is created.

Summary: Fixed readiness/selection drift by using the full issue set for readiness blockers and added focused regressions
State hint: local_review_fix
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/supervisor-http-server.test.ts src/backend/webui-dashboard.test.ts`; `npm run build`
Failure signature: PRRT_kwDORgvdZ8517C9c
Next action: Commit and push the review fix on `codex/issue-800`, then resolve/respond to PR thread `PRRT_kwDORgvdZ8517C9c`

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/805#discussion_r2970431137
- Details:
  - src/supervisor/supervisor-selection-readiness-summary.ts:126 _⚠️ Potential issue_ | _🟠 Major_ **Use the full issue set here to keep readiness and selection in sync.** Line 124 narrows `issues` to `listCandidateIssues()`, and Lines 164-190 reuse that narrowed set for both `findBlockingIssue(...)` and `formatRunnableReadinessReason(...)`. `buildSelectionSummary()` below evaluates those same decisions against `listAllIssues()`, so the dashboard can report an issue as runnable even though the selector will skip it when the blocker/predecessor lives outside the candidate subset. <details> <summary>🔧 Suggested fix</summary> ```diff type ReadinessSummaryGitHub = - Pick<GitHubClient, "listCandidateIssues"> + Pick<GitHubClient, "listCandidateIssues" | "listAllIssues"> & Partial<Pick<GitHubClient, "getCandidateDiscoveryDiagnostics">>; - const issues = await github.listCandidateIssues(); + const candidateIssues = await github.listCandidateIssues(); + const issues = await github.listAllIssues(); const runnableIssues: SupervisorRunnableIssueDto[] = []; const blockedIssues: SupervisorBlockedIssueDto[] = []; - for (const issue of issues) { + for (const issue of candidateIssues) { ``` </details> Also applies to: 164-190 <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/supervisor/supervisor-selection-readiness-summary.ts` around lines 124 - 126, The code narrows the issues variable to github.listCandidateIssues() but then uses that reduced set for blocker/predecessor checks (e.g., findBlockingIssue(...) and formatRunnableReadinessReason(...)) while buildSelectionSummary() uses github.listAllIssues(), causing mismatches; fix by using the full issue set for readiness and selection-consistency: replace or augment the local issues value so the blocking/predecessor logic operates over github.listAllIssues() (or pass the fullIssues array into findBlockingIssue and formatRunnableReadinessReason) while still applying candidate filtering only when deciding which issues to select (keep listCandidateIssues for selection filtering but use listAllIssues for the blocking/readiness checks). ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review failure was valid because `buildReadinessSummary()` evaluated blockers against `listCandidateIssues()` while `buildSelectionSummary()` used `listAllIssues()`, which could surface a runnable dashboard issue that selection would still skip.
- What changed: widened the readiness GitHub contract to require `listAllIssues()`, separated `candidateIssues` from the full `issues` set in `buildReadinessSummary()`, and added focused regressions covering both the direct summary builder and `Supervisor.statusReport()`.
- Current blocker: none
- Next exact step: commit and push the review fix, then post a reply on PR #805 explaining that readiness now uses the full issue set for blocker/predecessor evaluation.
- Verification gap: none locally; the updated branch still needs remote CI after push.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-selection-readiness-summary.test.ts`, `src/supervisor/supervisor-selection-readiness-summary.ts`
- Rollback concern: keep readiness evaluation and selection evaluation on the same full-issue basis so typed dashboard readiness cannot drift from scheduler behavior.
- Last focused command: `npm run build`
- Last focused failure: none; the review fix verified cleanly on the focused test set and build.
- Last focused commands:
```bash
npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/supervisor-http-server.test.ts src/backend/webui-dashboard.test.ts
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- 2026-03-22T00:00:00Z: reproduced the issue with a new dashboard harness case that supplied typed tracked/blocked/candidate-discovery data but no legacy readiness lines; the dashboard rendered `No status lines reported.`
- 2026-03-22T00:00:00Z: refactored readiness assembly to emit typed runnable and blocked issue collections alongside the existing line-based summary, and added typed tracked issue DTOs plus typed candidate-discovery summary fields to `statusReport()`.
- 2026-03-22T00:00:00Z: focused verification passed; `npm run build` again needed a local `npm ci` because `tsc` was missing in this worktree.
- 2026-03-22T00:00:00Z: pushed `codex/issue-800` and opened draft PR #805 (`https://github.com/TommyKammy/codex-supervisor/pull/805`).
- 2026-03-21T22:43:04Z: validated CodeRabbit thread `PRRT_kwDORgvdZ8517C9c`; the review comment was correct because readiness was using only `listCandidateIssues()` for blocker/predecessor checks.
- 2026-03-21T22:43:04Z: fixed `buildReadinessSummary()` to iterate candidate issues but evaluate blockers and readiness reasons against `listAllIssues()`, and added regressions for both the summary builder and `Supervisor.statusReport()`.
- 2026-03-21T22:43:04Z: focused verification passed with `npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/supervisor-http-server.test.ts src/backend/webui-dashboard.test.ts` and `npm run build`.
