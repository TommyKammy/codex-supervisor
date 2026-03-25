# Issue #1014: Orphan grace runtime guard: add regression coverage for programmatically invalid cleanupOrphanedWorkspacesAfterHours

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1014
- Branch: codex/issue-1014
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 8bbc40100a27b7731b3e11a38b3eff65be30021d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T18:31:35Z

## Latest Codex Summary
- Added focused regression coverage proving orphan reconciliation still throws when `cleanupOrphanedWorkspacesAfterHours` becomes invalid after a successful `loadConfig`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the runtime guard in `orphanedWorkspaceGracePeriodHours` already handles programmatically invalid orphan-grace values; the missing coverage was the specific path where config loads validly and is mutated afterward.
- What changed: added a narrow regression test in `src/recovery-reconciliation.test.ts` that loads a valid config from disk, mutates `cleanupOrphanedWorkspacesAfterHours` to `-1`, and asserts `pruneOrphanedWorkspacesForOperator` throws `Invalid config field: cleanupOrphanedWorkspacesAfterHours`.
- Current blocker: none locally.
- Next exact step: commit the focused regression test and open or update the PR for issue `#1014`.
- Verification gap: none for the requested local checks after installing workspace dependencies with `npm ci`.
- Files touched: `src/recovery-reconciliation.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the code change is test-only and does not alter production behavior.
- Last focused command: `npm run build`
- Exact failure reproduced: before the new test, the suite covered load-time validation and direct invalid runtime config objects, but not the post-load mutation path where a previously valid `cleanupOrphanedWorkspacesAfterHours` becomes invalid before orphan reconciliation runs.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1014/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1014/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "cleanupOrphanedWorkspacesAfterHours|orphan" src`; `rg -n "cleanupOrphanedWorkspacesAfterHours|orphan" src/config.test.ts src/recovery-reconciliation.test.ts`; `sed -n '120,190p' src/config.test.ts`; `sed -n '200,270p' src/recovery-reconciliation.test.ts`; `sed -n '210,340p' src/recovery-reconciliation.ts`; `sed -n '1,120p' src/recovery-reconciliation.test.ts`; `rg -n "function createConfig|const createConfig|export function loadConfig|loadConfig\\(" src | sed -n '1,120p'`; `sed -n '1,140p' src/core/config.ts`; `sed -n '450,580p' src/config.test.ts`; `sed -n '1,120p' src/turn-execution-test-helpers.ts`; `rg -n "mutat|as SupervisorConfig|loadConfig\\(configPath\\).*=" src/config.test.ts src/*test.ts`; `npx tsx --test src/config.test.ts src/recovery-reconciliation.test.ts`; `sed -n '340,520p' src/recovery-reconciliation.ts`; `sed -n '1,220p' package.json`; `ls -1`; `test -d node_modules && echo present || echo missing`; `npm ci`; `git diff -- src/recovery-reconciliation.test.ts`; `npm run build`; `npx tsx --test src/config.test.ts src/recovery-reconciliation.test.ts`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `sed -n '1,120p' .codex-supervisor/issue-journal.md`.
- PR status: none yet for this branch.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
