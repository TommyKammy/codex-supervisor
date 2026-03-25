# Issue #997: Orphan cleanup visibility: surface the effective orphan policy clearly in docs and diagnostics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/997
- Branch: codex/issue-997
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 5378f1b825431b461700acb7db4f2424add27b0d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T14:19:22.744Z

## Latest Codex Summary
- Added an explicit `doctor_orphan_policy` diagnostic line so operators can see the effective orphan cleanup mode and grace window directly in `doctor`, aligned the orphan-cleanup docs to point at that line, and removed stale negative-grace guidance that no longer matches config validation.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the current branch already enforced explicit-only orphan cleanup, but operators still had to infer that policy indirectly from candidate listings and scattered doc text instead of a single diagnostic line.
- What changed: added `doctor_orphan_policy mode=explicit_only background_prune=false operator_prune=true grace_hours=... preserved=locked,recent,unsafe_target` to the rendered `doctor` output, added focused coverage in `src/doctor.test.ts`, and updated `README.md`, `docs/getting-started.md`, and `docs/configuration.md` to point operators at that line and match the validated non-negative grace contract.
- Current blocker: none.
- Next exact step: monitor draft PR `#1018` for CI or review feedback and address anything that comes back.
- Verification gap: none locally after installing locked dependencies with `npm ci`; `npx tsx --test src/doctor.test.ts src/getting-started-docs.test.ts src/readme-docs.test.ts` and `npm run build` both passed.
- Files touched: `src/doctor.ts`; `src/doctor.test.ts`; `src/getting-started-docs.test.ts`; `README.md`; `docs/getting-started.md`; `docs/configuration.md`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; changes are limited to operator-facing diagnostics, docs, and focused tests.
- Last focused command: `npm run build`
- Exact failure reproduced: not a runtime prune bug on current `main`; the issue reproduced as a visibility gap where `doctor` listed orphan candidates but did not render the effective orphan cleanup policy directly, while docs still included stale negative-grace guidance.
- Commands run: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "orphan|cleanup.*policy|effective orphan|doctor|status" src README.md docs`; `rg --files src docs | rg "doctor|readme-docs|getting-started-docs|status|runtime|config|orphan|cleanup|prune"`; `git log --oneline --decorate -n 12 -- src/doctor.ts src/doctor.test.ts README.md docs/getting-started.md src/core/config.ts docs/configuration.md`; `sed -n '1,260p' src/doctor.ts`; `sed -n '1,260p' src/doctor.test.ts`; `sed -n '80,170p' README.md`; `sed -n '150,210p' docs/getting-started.md`; `sed -n '118,145p' docs/configuration.md`; `rg -n "orphan" src/doctor.ts src/core/types.ts src/recovery-reconciliation.ts src/supervisor/supervisor-status-report.ts src/supervisor/supervisor-status-rendering.ts`; `sed -n '260,520p' src/doctor.ts`; `sed -n '1,260p' src/core/types.ts`; `rg -n "renderDoctorReport|doctor_candidate_discovery|doctor_check|doctor_detail|doctor_posture" src/doctor.ts`; `sed -n '520,760p' src/doctor.ts`; `sed -n '1,220p' src/readme-docs.test.ts`; `sed -n '1,220p' src/getting-started-docs.test.ts`; `sed -n '1,260p' src/recovery-reconciliation.ts`; `rg -n "cleanupOrphanedWorkspacesAfterHours|orphanedWorkspaceGracePeriodHours|prune-orphaned-workspaces" src/recovery-reconciliation.ts src/core/config.ts src/cli/supervisor-runtime.ts src/supervisor/supervisor.ts`; `sed -n '1,260p' src/cli/supervisor-runtime.test.ts`; `sed -n '560,610p' src/core/config.ts`; `rg -n "cleanupOrphanedWorkspacesAfterHours|negative.*orphan|orphan.*disable|nonnegative" src/config.test.ts src/core/config-local-review-model-routing.test.ts src/recovery-reconciliation.test.ts`; `sed -n '1,260p' src/config.test.ts`; `git show --stat --summary 2fba051`; `git show 2fba051 -- src/core/config.ts src/config.test.ts docs/configuration.md src/recovery-reconciliation.ts`; `rg -n "effective orphan|orphan policy|workspace cleanup contract|background orphan cleanup|explicit-only|background-enabled|disabled" src docs README.md`; `git show 1d75a2b -- README.md docs/getting-started.md docs/configuration.md src/doctor.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `rg -n "DoctorDiagnostics|doctorReport\\(|renderDoctorReport\\(|queryDoctor|doctor diagnostics|candidateDiscoverySummary" src`; `sed -n '1240,1315p' src/supervisor/supervisor.ts`; `sed -n '1,220p' src/supervisor/supervisor-service.ts`; `git diff -- src/doctor.ts src/doctor.test.ts README.md docs/getting-started.md docs/configuration.md src/getting-started-docs.test.ts`; `npx tsx --test src/doctor.test.ts src/getting-started-docs.test.ts src/readme-docs.test.ts`; `npm run build`; `test -d node_modules && echo present || echo missing`; `test -f package-lock.json && echo lock-present || echo lock-missing`; `cat package.json`; `npm ci`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
- PR status: draft PR open at `https://github.com/TommyKammy/codex-supervisor/pull/1018` on head `78f897ad249f12078e6f98383e2cf64be6a16951`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
