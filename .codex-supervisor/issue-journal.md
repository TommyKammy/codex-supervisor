# Issue #781: WebUI prep: make issue-lint return a typed DTO instead of CLI-oriented string lines

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/781
- Branch: codex/issue-781
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: a2cf837d08ca8ac51356aaf24a4243dc474eb0e9
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T14:34:03.362Z

## Latest Codex Summary
- Issue-lint now returns a typed DTO from the supervisor/service boundary, the CLI renders the existing operator-facing text from that DTO, focused DTO/rendering regressions were added, and the requested local tests plus `npm run build` passed after restoring missing local dev dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `issue-lint` was still coupled to CLI line rendering because the supervisor returned newline-joined strings and the service re-split them for the CLI, so introducing a typed DTO plus a dedicated renderer should preserve current CLI output while making the result JSON-ready for WebUI/API consumers.
- What changed: added `SupervisorIssueLintDto`, `buildIssueLintDto()`, and `renderIssueLintDto()`, switched `Supervisor.issueLint()` and `SupervisorService.queryIssueLint()` to return the DTO, updated the CLI to render from the DTO, kept diagnostics fixture coverage stable by rendering inside the test helper, and added focused tests for DTO generation, CLI rendering, and facade exports.
- Current blocker: none
- Next exact step: commit the typed issue-lint DTO change on `codex/issue-781` and open or update the draft PR with the verified checkpoint if needed.
- Verification gap: none for the requested local scope. The first `npm run build` failed because this worktree had no local `tsc`; after `npm install`, the targeted tests and build passed. `.codex-supervisor/replay/` remains untracked and untouched.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/cli/supervisor-runtime.test.ts`, `src/cli/supervisor-runtime.ts`, `src/supervisor/supervisor-selection-issue-lint.test.ts`, `src/supervisor/supervisor-selection-issue-lint.ts`, `src/supervisor/supervisor-selection-status.test.ts`, `src/supervisor/supervisor-selection-status.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor-test-helpers.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: reverting the DTO boundary would force future WebUI/API consumers back to parsing CLI-formatted strings and would reintroduce string splitting/rendering logic across the service boundary.
- Last focused command: `npm run build`
- Last focused failure: `npm run build` failed with `sh: 1: tsc: not found` until local dev dependencies were installed with `npm install`
- Last focused commands:
```bash
npx tsx --test src/supervisor/supervisor-selection-issue-lint.test.ts
npx tsx --test src/cli/supervisor-runtime.test.ts
npx tsx --test src/supervisor/supervisor-selection-status.test.ts
npx tsx --test src/supervisor/supervisor-selection-issue-explain.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-selection-issue-lint.test.ts src/supervisor/supervisor-diagnostics-issue-lint-readiness.test.ts src/supervisor/supervisor-diagnostics-issue-lint-ambiguity.test.ts src/supervisor/supervisor-diagnostics-issue-lint-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint-repair-guidance.test.ts
npm install
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
