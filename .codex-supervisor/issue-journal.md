# Issue #1275: Improve diagnostics when a tracked PR is waiting on CI/review signals the repo cannot produce yet

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1275
- Branch: codex/issue-1275
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=1, repair=2)
- Last head SHA: 509204d98265bdd26596e55c3e681441a5ce6b51
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ854uTZo|PRRT_kwDORgvdZ854uTZp
- Repeated failure signature count: 1
- Updated at: 2026-04-03T21:24:18.812Z

## Latest Codex Summary
Patched the readiness diagnostic in [supervisor-status-review-bot.ts](src/supervisor/supervisor-status-review-bot.ts) so configured-bot top-level reviews now count as external review signals, and aggregate status keeps any `repo_not_configured` CI/review gap visible unless there is an actual blocking CI failure or review finding. I added focused regressions in [supervisor-status-review-bot.test.ts](src/supervisor/supervisor-status-review-bot.test.ts) for both review comments.

Verification passed with `npx tsx --test src/supervisor/supervisor-status-review-bot.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts` and `npm run build`. I updated the issue journal and pushed commit `509204d` to `codex/issue-1275` for PR #1288.

Summary: Fixed review-bot readiness diagnostics and pushed the review-thread patch to PR #1288.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-status-review-bot.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`; `npm run build`
Next action: Monitor PR #1288 for refreshed CI/CodeRabbit results and resolve any remaining review follow-up if new feedback appears.
Failure signature: PRRT_kwDORgvdZ854uTZo|PRRT_kwDORgvdZ854uTZp

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1288#discussion_r3032943000
- Details:
  - .codex-supervisor/issue-journal.md:45 summary=_⚠️ Potential issue_ | _🟠 Major_ **Track or address the documented edge case.** The rollback concern identifies a real diagnostic accuracy gap: repos using external CI systems ... url=https://github.com/TommyKammy/codex-supervisor/pull/1288#discussion_r3032943000
  - src/supervisor/supervisor-status-review-bot.test.ts:283 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Register temp-dir cleanup immediately after creation.** On Line 278, cleanup is registered only after extra awaited setup calls. url=https://github.com/TommyKammy/codex-supervisor/pull/1288#discussion_r3032943002

## Codex Working Notes
### Current Handoff
- Hypothesis: The tracked-PR diagnostics only classified "missing provider signal" and "checks=none", so bootstrap repos with no workflows/check runs were being reported like a PR-specific wait instead of a repo capability mismatch.
- What changed: Addressed the remaining review follow-up by moving the temp-directory cleanup registration to immediately after `fs.mkdtemp(...)` in `supervisor-status-review-bot.test.ts`, and documented the workflow-presence heuristic in `externalSignalReadinessDiagnostics()` with a TODO that calls out external CI and GitHub App checks. Added a focused regression showing emitted external checks already override missing local workflow files, then pushed commit `4641127` to `codex/issue-1275`.
- Current blocker: none
- Next exact step: Wait for PR #1288 CI and CodeRabbit to finish on commit `4641127`, then leave the remaining test-thread resolution to the operator unless explicitly asked to write on GitHub.
- Verification gap: none for the requested focused suite and TypeScript build.
- Files touched: .codex-supervisor/issue-journal.md; src/supervisor/supervisor-status-review-bot.test.ts; src/supervisor/supervisor-status-review-bot.ts
- Rollback concern: Bootstrap-stage repos that rely on external CI before any check run is observed can still be inferred as `repo_not_configured` because workflow absence is only a local heuristic; the new TODO documents that gap without changing gating behavior.
- Last focused command: `npx tsx --test src/supervisor/supervisor-status-review-bot.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`; `npm run build`; `gh pr view 1288 --repo TommyKammy/codex-supervisor --json headRefOid,updatedAt,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup,url`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
