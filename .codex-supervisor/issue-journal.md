# Issue #925: Post-merge audit analysis: summarize recurring review, recovery, and failure patterns

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/925
- Branch: codex/issue-925
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 5242c31a5b0752fd739f2bc35364ce216b1ea1b3
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T09:56:21.252Z

## Latest Codex Summary
- Added a typed advisory-only post-merge audit pattern summary over persisted completed-work artifacts and exposed it through the new `summarize-post-merge-audits` CLI/runtime path.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: persisted post-merge audit artifacts already captured the raw review, recovery, and failure signals needed for recurring-pattern analysis, but there was no typed aggregate that operators could query without manually inspecting individual JSON files.
- What changed: added `src/supervisor/post-merge-audit-summary.ts` to scan persisted post-merge audit artifacts, aggregate recurring review root causes plus failure and recovery taxonomy patterns, and emit a typed advisory-only summary; exposed that summary via the new `summarize-post-merge-audits` CLI/runtime/service path; added focused coverage in `src/supervisor/post-merge-audit-summary.test.ts`, `src/supervisor/post-merge-audit-summary-runtime.test.ts`, `src/cli/parse-args.test.ts`, and `src/cli/entrypoint.test.ts`.
- Current blocker: none.
- Next exact step: commit the summary/CLI changes on `codex/issue-925`, then open or update the branch PR if the supervisor asks for the artifact-analysis checkpoint to be reviewed.
- Verification gap: none in code paths touched; full `src/**/*.test.ts` and `npm run build` are green locally after installing the declared dev dependencies.
- Files touched: `src/supervisor/post-merge-audit-summary.ts`, `src/supervisor/post-merge-audit-summary.test.ts`, `src/supervisor/post-merge-audit-summary-runtime.test.ts`, `src/cli/parse-args.ts`, `src/cli/parse-args.test.ts`, `src/cli/entrypoint.test.ts`, `src/cli/supervisor-runtime.ts`, `src/core/types.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; reverting would only remove a read-only analysis surface and leave the persisted audit artifacts intact.
- Last focused command: `npx tsx --test src/**/*.test.ts`
- Last focused failure: none
- Draft PR: none
- Last focused commands:
```bash
git status --short
sed -n '1,360p' src/supervisor/post-merge-audit-artifact.test.ts
sed -n '1,260p' src/local-review/post-merge-audit.ts
npx tsx --test src/supervisor/post-merge-audit-summary.test.ts src/supervisor/post-merge-audit-summary-runtime.test.ts
npx tsx --test src/cli/parse-args.test.ts src/cli/entrypoint.test.ts src/supervisor/post-merge-audit-summary-runtime.test.ts src/supervisor/post-merge-audit-summary.test.ts
npm install
npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts
npx tsx --test src/**/*.test.ts
npm run build
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
