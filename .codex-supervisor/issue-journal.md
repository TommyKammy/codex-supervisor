# Issue #1044: Run focused malformed-inventory regression tests in CI

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1044
- Branch: codex/issue-1044
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 15434d1acc2a0415244256de3c36000738981b87
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T04:23:00Z

## Latest Codex Summary
- Reproduced the issue by confirming the malformed-inventory regression suite already passes locally but is not invoked from `.github/workflows/ci.yml`. Added a dedicated focused npm script, required the workflow step in `src/ci-workflow.test.ts`, wired the Ubuntu CI job to run the focused suite, and verified with the workflow test, the exact five-file `npx tsx --test ...` command, the named script, and `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the malformed-inventory regression coverage already exists in focused tests, but pull-request CI only runs `replay-corpus` and `npm run build`, so the `#1040` / `#1041` failure surface is not enforced on PRs.
- What changed: added `test:malformed-inventory-regressions` to `package.json`, added a focused workflow assertion in `src/ci-workflow.test.ts`, and inserted an Ubuntu-only `npm run test:malformed-inventory-regressions` step into `.github/workflows/ci.yml` after the replay-corpus step.
- Current blocker: none locally.
- Next exact step: review the diff, commit the CI workflow change set on `codex/issue-1044`, and prepare the branch for PR creation or update if requested.
- Verification gap: none in the requested local scope; GitHub Actions execution of the new step is not yet observed remotely.
- Files touched: `.github/workflows/ci.yml`, `package.json`, `src/ci-workflow.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only adds a narrow Ubuntu CI step and its corresponding workflow assertion.
- Last focused command: `npm run build`
- Exact failure reproduced: `.github/workflows/ci.yml` ran `npm ci`, Ubuntu replay-corpus, and `npm run build`, but did not run the focused malformed-inventory regression suite, so PR checks could pass without exercising malformed `gh issue list` fallback and degraded active-issue reevaluation coverage.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1044/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1044/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `sed -n '1,240p' .github/workflows/ci.yml`; `rg -n "run-once-cycle-prelude|supervisor-pr-review-blockers|supervisor-diagnostics-status-selection|supervisor-diagnostics-explain|github\\.test\\.ts" src .github/workflows package.json`; `npx tsx --test src/github/github.test.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`; `sed -n '1,220p' package.json`; `rg -n '"scripts"|tsx --test|replay-corpus|build' package.json src .github/workflows`; `sed -n '1,220p' src/ci-workflow.test.ts`; `rg -n "ci-workflow|workflow" src/*.test.ts src/**/*.test.ts`; `npx tsx --test src/ci-workflow.test.ts`; `npm ci`; `npx tsx --test src/github/github.test.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`; `npm run test:malformed-inventory-regressions`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git diff -- .github/workflows/ci.yml package.json src/ci-workflow.test.ts .codex-supervisor/issue-journal.md`.
- PR status: none yet for `codex/issue-1044`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
