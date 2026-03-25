# Issue #995: Orphan cleanup config safety: replace ambiguous negative grace behavior with explicit validated semantics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/995
- Branch: codex/issue-995
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 47e7d2bfc5af7438f42a6a5bbde9bdae64d024ff
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852uRmG
- Repeated failure signature count: 1
- Updated at: 2026-03-25T13:42:22.223Z

## Latest Codex Summary
Validated orphan cleanup grace config on [`src/core/config.ts`](src/core/config.ts) so `cleanupOrphanedWorkspacesAfterHours` now rejects negative values instead of silently disabling recent-workspace protection. I also hardened [`src/recovery-reconciliation.ts`](src/recovery-reconciliation.ts) to fail fast if an invalid negative is injected programmatically, added the focused regression in [`src/config.test.ts`](src/config.test.ts), and updated orphan-cleanup fixtures in [`src/supervisor/supervisor-execution-cleanup.test.ts`](src/supervisor/supervisor-execution-cleanup.test.ts) to use explicit non-negative semantics.

Branch `codex/issue-995` is pushed and draft PR `#1013` is open: https://github.com/TommyKammy/codex-supervisor/pull/1013. I also updated [`issue-journal.md`](.codex-supervisor/issue-journal.md). A broader probe of `src/supervisor/supervisor-execution-cleanup.test.ts` still showed two unrelated pre-existing failures outside this issue slice; the acceptance-targeted verification and build are green.

Summary: Rejected negative orphan cleanup grace values, added focused regression coverage, pushed branch, and opened draft PR #1013.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/config.test.ts`; `npx tsx --test src/config.test.ts src/doctor.test.ts src/recovery-reconciliation.test.ts`; `npm ci`; `npm run build`
Next action: Wait for review/CI on PR #1013 and address any follow-up if it appears
Failure signature: PRRT_kwDORgvdZ852uRmG

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1013#discussion_r2988320865
- Details:
  - src/recovery-reconciliation.ts:195 _⚠️ Potential issue_ | _🟠 Major_ **Move orphan-grace validation out of the per-entry loop to guarantee fail-fast behavior.** Because the validation is first invoked at Line 369 inside the loop, invalid values can slip through when no orphan candidates are iterated (or when listing returns early). That contradicts the intended fail-fast runtime guard. <details> <summary>💡 Proposed fix</summary> ```diff export async function inspectOrphanedWorkspacePruneCandidates( config: SupervisorConfig, state: SupervisorStateFile, options: InspectOrphanedWorkspacePruneCandidatesOptions = {}, ): Promise<OrphanedWorkspacePruneCandidate[]> { + const gracePeriodHours = orphanedWorkspaceGracePeriodHours(config); const referencedWorkspaces = new Set( Object.values(state.issues).map((record) => path.resolve(record.workspace)), ); const candidates: OrphanedWorkspacePruneCandidate[] = []; const now = options.now ?? new Date(); @@ - const gracePeriodHours = orphanedWorkspaceGracePeriodHours(config); - if (modifiedAt && gracePeriodHours >= 0) { + if (modifiedAt) { const ageMs = now.getTime() - Date.parse(modifiedAt); if (ageMs >= 0 && ageMs < gracePeriodHours * 60 * 60 * 1000) { candidates.push({ ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/recovery-reconciliation.ts` around lines 190 - 195, The validation of cleanupOrphanedWorkspacesAfterHours must be performed once before iterating orphan candidates instead of inside the per-entry loop; locate where config.cleanupOrphanedWorkspacesAfterHours is read (producing const gracePeriodHours) and move the Number.isFinite/gracePeriodHours < 0 check so it runs immediately after computing gracePeriodHours (and before any listing/iteration), remove the redundant in-loop check, and keep the same Error("Invalid config field: cleanupOrphanedWorkspacesAfterHours") to ensure fail-fast behavior. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review finding was valid because `inspectOrphanedWorkspacePruneCandidates()` still deferred `cleanupOrphanedWorkspacesAfterHours` validation until an orphan candidate reached the recent-workspace branch, so invalid injected config could slip through when enumeration returned early.
- What changed: moved `orphanedWorkspaceGracePeriodHours(config)` to the top of `inspectOrphanedWorkspacePruneCandidates()` so the runtime guard fails before any directory listing or per-entry iteration, removed the redundant `gracePeriodHours >= 0` branch check, and added a focused `src/recovery-reconciliation.test.ts` regression that asserts invalid orphan grace throws even when `workspaceRoot` is missing.
- Current blocker: none.
- Next exact step: commit and push the review fix to PR #1013, then resolve the automated review thread if no further issues appear.
- Verification gap: none on the intended slice; `npx tsx --test src/recovery-reconciliation.test.ts src/config.test.ts src/doctor.test.ts` and `npm run build` are green after the review fix.
- Files touched: `src/recovery-reconciliation.ts`, `src/recovery-reconciliation.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the behavior change is intentionally narrow to orphan-cleanup config validation and a defensive runtime assertion.
- Last focused command: `npm run build`
- Exact failure reproduced: the CodeRabbit finding was correct because `inspectOrphanedWorkspacePruneCandidates()` only called `orphanedWorkspaceGracePeriodHours(config)` inside the per-entry loop, so invalid injected config could bypass the runtime guard when `workspaceRoot` was unreadable or no orphan candidate reached the recent-workspace branch.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-995/AGENTS.generated.md`; `sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-995/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `sed -n '160,260p' src/recovery-reconciliation.ts`; `sed -n '340,410p' src/recovery-reconciliation.ts`; `rg -n "orphanedWorkspaceGracePeriodHours|cleanupOrphanedWorkspacesAfterHours" src/recovery-reconciliation.ts src/core/config.ts src/*.test.ts`; `sed -n '1,240p' src/recovery-reconciliation.test.ts`; `sed -n '1,220p' src/config.test.ts`; `sed -n '260,380p' src/recovery-reconciliation.ts`; `sed -n '1,120p' src/turn-execution-test-helpers.ts`; `git diff -- src/recovery-reconciliation.ts src/recovery-reconciliation.test.ts`; `npx tsx --test src/recovery-reconciliation.test.ts src/config.test.ts src/doctor.test.ts`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `sed -n '1,220p' .codex-supervisor/issue-journal.md`.
- PR status: draft PR open at `https://github.com/TommyKammy/codex-supervisor/pull/1013`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
