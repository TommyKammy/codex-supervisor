# Issue #1243: [codex] Add structured execution mode for localCiCommand

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1243
- Branch: codex/issue-1243
- Workspace: .
- Journal: .codex-supervisor/issues/1243/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0e9ae270378d53632f0b967541b92910c22406f7
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-31T03:59:29.663Z

## Latest Codex Summary
- Added structured `localCiCommand` support with explicit `mode: "structured"` and `mode: "shell"` object forms while preserving legacy string configs as a compatibility shell path.
- Local CI execution now records `execution_mode` in latest results and failure details, and focused regression tests cover literal metachar handling for structured mode plus intentional shell semantics for explicit shell mode.
- Build verification is still blocked by workspace toolchain availability: `npm run build` fails because `tsc` is not installed in this worktree (`node_modules/typescript` is missing).

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `localCiCommand` should support a non-shell structured path for repo-owned entrypoints while leaving shell execution explicit and observable.
- What changed: Added `LocalCiCommandConfig` union parsing, structured/shell execution resolution, execution-mode diagnostics on local CI results, and setup/readiness display support for structured commands.
- Current blocker: `npm run build` fails in the workspace because `tsc` is unavailable on PATH and `node_modules/typescript` is not installed.
- Next exact step: Commit the structured local CI changes, then either install dependencies or restore the workspace toolchain before rerunning `npm run build`.
- Verification gap: Full TypeScript build is still unverified due missing `tsc`; focused test coverage passed for local CI, post-turn PR transitions, publication gate, config loading, and setup readiness/doctor flows.
- Files touched: src/core/types.ts; src/core/config.ts; src/local-ci.ts; src/setup-config-write.ts; src/setup-readiness.ts; src/local-ci.test.ts; src/config.test.ts; src/post-turn-pull-request.test.ts; src/doctor.test.ts
- Rollback concern: Setup/WebUI surfaces still only write string `localCiCommand` values; structured commands are supported when hand-authored in config, so future UI work should avoid overwriting object configs accidentally.
- Last focused command: npx tsx --test src/local-ci.test.ts src/post-turn-pull-request.test.ts src/turn-execution-publication-gate.test.ts src/config.test.ts src/doctor.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
