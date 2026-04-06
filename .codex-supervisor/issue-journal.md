# Issue #1306: [codex] Clarify workspacePreparationCommand runtime failures and suggest repo-native preparation commands

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1306
- Branch: codex/issue-1306
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 24632c5429d8d0f1e67d2206f05672450200d46f
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8548AMk
- Repeated failure signature count: 1
- Updated at: 2026-04-06T00:09:47.497Z

## Latest Codex Summary
Implemented the issue on `codex/issue-1306` and pushed it. The main change is a dedicated workspace-preparation runtime path for repo-relative helpers missing from issue worktrees: it now reports `worktree_helper_missing`, explains the likely untracked or host-local primary-checkout cause, and suggests a repo-native preparation command when the repo exposes an obvious candidate. I also extended setup readiness so a missing `workspacePreparationCommand` now surfaces repo-native suggestions such as `npm ci` when lockfiles make that obvious.

The branch has two commits, `963545d` and `24632c5`, and I opened draft PR [#1310](https://github.com/TommyKammy/codex-supervisor/pull/1310). Relevant changes are in [src/local-ci.ts](src/local-ci.ts), [src/setup-readiness.ts](src/setup-readiness.ts), [src/core/config.ts](src/core/config.ts), and the focused regressions in [src/local-ci.test.ts](src/local-ci.test.ts) plus [src/setup-readiness.test.ts](src/setup-readiness.test.ts).

Summary: Added focused runtime diagnostics and repo-native workspace-preparation suggestions, verified locally, pushed the branch, and opened draft PR #1310.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/local-ci.test.ts src/setup-readiness.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Next action: Wait for CI and PR feedback on draft PR #1310, then address any follow-up findings.
Failure signature: PRRT_kwDORgvdZ8548AMk

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1310#discussion_r3037527697
- Details:
  - src/core/config.ts:658 summary=_⚠️ Potential issue_ | _🟠 Major_ **Only recommend workspace-preparation commands from tracked repo files.** At Line 652, recommendation is based on `existsSync` alone. url=https://github.com/TommyKammy/codex-supervisor/pull/1310#discussion_r3037527697

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining review thread is valid because `findRepoOwnedWorkspacePreparationCandidate` was still recommending commands from any visible lockfile, including untracked checkout-local files that preserved issue worktrees would not inherit.
- What changed: Tightened repo-native workspace-preparation candidate detection to require a tracked lockfile, added direct config-level regression coverage for tracked vs. untracked lockfiles, and updated the readiness suggestion fixture so the positive recommendation path uses a committed lockfile.
- Current blocker: none
- Next exact step: Commit the review fix on `codex/issue-1306`, then push/update PR #1310 so the remaining automated review thread can be cleared.
- Verification gap: none for the focused review-fix suite and build; broader full-test coverage was not run beyond `src/config.test.ts`, `src/local-ci.test.ts`, `src/setup-readiness.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/config.test.ts`, `src/core/config.ts`, `src/core/types.ts`, `src/doctor.test.ts`, `src/local-ci.ts`, `src/local-ci.test.ts`, `src/post-turn-pull-request.ts`, `src/setup-readiness.ts`, `src/setup-readiness.test.ts`, `src/turn-execution-publication-gate.ts`
- Rollback concern: the new `worktree_helper_missing` failure class now flows through workspace-preparation signatures and tracked-PR blocker remediation targeting, so any future rollback should revert the runtime classification and the added contract-summary field together.
- Last focused command: `npx tsx --test src/config.test.ts src/local-ci.test.ts src/setup-readiness.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
### Scratchpad
- First rerun failed because `src/setup-readiness.test.ts` was still using an untracked `package-lock.json`; fixed by committing the fixture lockfile so the positive recommendation case matches the new tracked-file rule.
- Keep this section short. The supervisor may compact older notes automatically.
