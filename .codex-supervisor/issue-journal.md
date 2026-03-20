# Issue #729: Orphan prune command: add an explicit operator path for eligible orphaned workspace cleanup

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/729
- Branch: codex/issue-729
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 80f5b3ecbff3dd665dc647a0b37e1e6f13610d21
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T22:07:48.725Z

## Latest Codex Summary
- Added an explicit `prune-orphaned-workspaces` operator command that reuses orphan-prune safety checks and returns deterministic JSON describing pruned and skipped workspaces.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing operator path should be a dedicated top-level CLI command, not a broad admin surface, and it should reuse `inspectOrphanedWorkspacePruneCandidates()` so the same lock/age/safe-target gates apply to explicit pruning.
- What changed: added `prune-orphaned-workspaces` to CLI parsing and supervisor runtime dispatch; added a structured prune result DTO and supervisor service method; implemented `pruneOrphanedWorkspacesForOperator()` in `src/recovery-reconciliation.ts`; added focused coverage in `src/cli/entrypoint.test.ts`, `src/cli/supervisor-runtime.test.ts`, `src/supervisor/supervisor-execution-cleanup.test.ts`, and `src/supervisor/supervisor-diagnostics-status-selection.test.ts` for one eligible prune and one skipped recent orphan.
- Current blocker: none
- Next exact step: commit the explicit orphan-prune command checkpoint and, if needed, open or update a draft PR for issue #729.
- Verification gap: requested targeted tests and `npm run build` passed after hydrating dependencies with `npm ci`; the full repo test suite was not rerun.
- Files touched: `src/cli/entrypoint.test.ts`, `src/cli/parse-args.test.ts`, `src/cli/parse-args.ts`, `src/cli/supervisor-runtime.test.ts`, `src/cli/supervisor-runtime.ts`, `src/core/types.ts`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-execution-cleanup.test.ts`, `src/supervisor/supervisor-mutation-report.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting these changes would remove the supported operator cleanup path and force orphan cleanup back onto manual state editing or indirect automatic behavior.
- Last focused command: `npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-execution-cleanup.test.ts`
- Last focused failure: `none`
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-729/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-729/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
git status --short --branch
npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-execution-cleanup.test.ts
npm ci
npm run build
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
