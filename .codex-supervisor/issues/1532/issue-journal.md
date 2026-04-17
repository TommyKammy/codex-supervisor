# Issue #1532: Clarify path-hygiene policy for non-journal durable artifacts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1532
- Branch: codex/issue-1532
- Workspace: .
- Journal: .codex-supervisor/issues/1532/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 8c155425fc2a436a4148946ef3938dbd8b9411f5
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ857tTAm
- Repeated failure signature count: 1
- Updated at: 2026-04-17T11:13:02.142Z

## Latest Codex Summary
Updated the path-hygiene gate so its failure summary now distinguishes three remediation paths instead of collapsing everything into a generic `First fix:` line. In [src/workstation-local-path-gate.ts](src/workstation-local-path-gate.ts), the gate now explicitly says when supervisor-owned issue journals were auto-normalized, when a remaining blocker looks like an expected-local durable artifact policy problem such as `WORKLOG.md`, and when the operator should edit tracked publishable content. In [src/workstation-local-path-detector.test.ts](src/workstation-local-path-detector.test.ts), I added a focused mixed-artifact regression covering cross-issue journal auto-redaction plus a remaining `WORKLOG.md` blocker, and tightened the existing publishable-content summary assertion.

I committed the checkpoint as `8c15542` (`Clarify path-hygiene remediation summaries`), pushed `codex/issue-1532`, and opened draft PR [#1555](https://github.com/TommyKammy/codex-supervisor/pull/1555). The worktree is clean aside from ignored supervisor runtime artifacts under `.codex-supervisor/`.

Summary: Clarified path-hygiene remediation summaries, added mixed journal + WORKLOG regression coverage, pushed branch, and opened draft PR #1555.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/workstation-local-path-detector.test.ts`; `npx tsx --test src/turn-execution-publication-gate.test.ts src/post-turn-pull-request.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`; `npm run build`
Next action: Wait for CI on PR #1555, then address any review or check failures if they appear.
Failure signature: PRRT_kwDORgvdZ857tTAm

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1555#discussion_r3099812992
- Details:
  - src/workstation-local-path-gate.ts:117 summary=_⚠️ Potential issue_ | _🟠 Major_ **Don't special-case every `WORKLOG.md` by basename.** This currently treats any nested `WORKLOG.md` as an expected-local durable artifact, whi... url=https://github.com/TommyKammy/codex-supervisor/pull/1555#discussion_r3099812992

## Codex Working Notes
### Current Handoff
- Hypothesis: CodeRabbit's review was valid because `categorizeWorkstationLocalArtifact()` still special-cased any basename `WORKLOG.md`, which could misclassify nested tracked publishable files as expected-local durable artifacts and point operators at the wrong remediation.
- What changed: Narrowed the expected-local durable artifact classification in `src/workstation-local-path-gate.ts` to the repo-relative root path `WORKLOG.md` instead of any basename match. Added a focused regression in `src/workstation-local-path-detector.test.ts` asserting that `docs/WORKLOG.md` stays in the publishable-tracked-content bucket while the existing root-level `WORKLOG.md` behavior remains unchanged.
- Current blocker: none
- Next exact step: Commit the verified review fix on `codex/issue-1532`, push the branch, and then resolve or reply to PR thread `PRRT_kwDORgvdZ857tTAm` if the operator wants GitHub thread writes.
- Verification gap: Focused suites and `npm run build` passed. `npm test -- ...` currently expands to the full suite in this repo and exposed unrelated pre-existing failures outside this issue (`supervisor-pr-readiness`, `supervisor-status-model-supervisor`, `tracked-pr-lifecycle-projection`), so direct `npx tsx --test ...` was used for precise changed-area verification.
- Files touched: .codex-supervisor/issues/1532/issue-journal.md; src/workstation-local-path-gate.ts; src/workstation-local-path-detector.test.ts
- Rollback concern: The expected-local durable artifact classification is currently intentionally narrow and path-based (`WORKLOG.md`). If the policy needs to cover more repo-specific artifact classes, widen the classifier deliberately rather than generalizing from this issue.
- Last focused command: npx tsx --test src/workstation-local-path-detector.test.ts src/turn-execution-publication-gate.test.ts src/post-turn-pull-request.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts
### Scratchpad
- Review thread addressed locally: PRRT_kwDORgvdZ857tTAm.
- Commands run this turn:
  - `npm test -- src/workstation-local-path-detector.test.ts src/turn-execution-publication-gate.test.ts src/post-turn-pull-request.test.ts`
  - `npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`
  - `npx tsx --test src/workstation-local-path-detector.test.ts src/turn-execution-publication-gate.test.ts src/post-turn-pull-request.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`
  - `npm run build`
