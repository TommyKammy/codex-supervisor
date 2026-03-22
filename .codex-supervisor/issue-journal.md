# Issue #840: Setup config write API: add a narrow validated first-run config update path

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/840
- Branch: codex/issue-840
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: d3f451f0c60064b0623a7b99dd07af35e3bf6a33
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail|build (macos-latest):fail
- Repeated failure signature count: 1
- Updated at: 2026-03-22T18:35:16Z

## Latest Codex Summary
Reproduced the failing PR build locally with `npm run build`, which matched CI as `TS2769` at `src/config.test.ts:883` because `result.backupPath` was typed as `string | null` and passed directly to `fs.readFile`. I fixed the test by asserting `result.backupPath` is present before reading the backup file in [src/config.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-840/src/config.test.ts), committed it as `d3f451f`, and pushed the repair to PR [#853](https://github.com/TommyKammy/codex-supervisor/pull/853).

Focused local verification is green again: `npm run build` now passes, and `npx tsx --test src/backend/supervisor-http-server.test.ts src/config.test.ts src/doctor.test.ts` passed after the fix. The worktree is clean apart from the pre-existing untracked `.codex-supervisor/replay/` directory, and `gh pr view 853` reports `isDraft: false`, `state: OPEN`, `headRefOid: d3f451f0c60064b0623a7b99dd07af35e3bf6a33`, and `mergeStateStatus: UNSTABLE` while checks rerun.

Summary: Reproduced the CI TypeScript failure locally, fixed the nullability assertion in `src/config.test.ts`, and pushed repair commit `d3f451f` to PR `#853`.
State hint: repairing_ci
Blocked reason: none
Tests: `npm run build`; `npx tsx --test src/backend/supervisor-http-server.test.ts src/config.test.ts src/doctor.test.ts`
Failure signature: build-tsc-ts2769-config-test-backupPath-null
Next action: monitor PR `#853` for rerun results and address any additional CI or review feedback if more failures surface

## Active Failure Context
- Category: checks
- Summary: PR #853 failed the build checks, and the failure reproduces locally as a TypeScript nullability error in `src/config.test.ts`.
- Command or source: `npm run build`
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/853
- Details:
  - local reproduction before the fix: `src/config.test.ts(883,55): error TS2769: No overload matches this call`
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23409475269/job/68094061598
  - build (macos-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23409475269/job/68094061599

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe first-run mutation path is a dedicated server-owned merge that only accepts a small typed field set and maps `reviewProvider` to `reviewBotLogins`, rather than exposing arbitrary config patching.
- What changed: reproduced the failing CI build locally, then added `assert.ok(result.backupPath, "Expected backupPath to be set when updating an existing config")` before reading the backup file in [src/config.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-840/src/config.test.ts) so the test encodes the existing-config precondition and satisfies TypeScript's `string | null` typing.
- Current blocker: none
- Next exact step: monitor PR `#853` (`https://github.com/TommyKammy/codex-supervisor/pull/853`) for the rerun build results, then only intervene again if another CI or review signal appears.
- Verification gap: none for this repair; both `npm run build` and `npx tsx --test src/backend/supervisor-http-server.test.ts src/config.test.ts src/doctor.test.ts` passed after the assertion fix.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/config.test.ts`
- Rollback concern: low; the change is additive and narrow, and existing configs get a `.bak` rollback point before writes.
- Last focused command: `gh pr view 853 --json url,isDraft,mergeStateStatus,headRefOid,state`
- Last focused failure: `npm run build` failed before the fix with `src/config.test.ts(883,55): error TS2769: No overload matches this call`; after the assertion change, the build and the issue verification command both passed locally.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-840/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-840/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
sed -n '850,905p' src/config.test.ts
npm run build
npm ci
npm run build
npx tsx --test src/config.test.ts
npm run build
npx tsx --test src/backend/supervisor-http-server.test.ts src/config.test.ts src/doctor.test.ts
git diff -- src/config.test.ts
git diff -- .codex-supervisor/issue-journal.md
gh pr view 853 --json url,isDraft,mergeStateStatus,headRefOid,state
git add src/config.test.ts
git commit -m "Fix setup config backup test typing"
git push origin codex/issue-840
git rev-parse HEAD
date -u +%Y-%m-%dT%H:%M:%SZ
gh pr view 853 --json url,isDraft,mergeStateStatus,headRefOid,state
```
### Scratchpad
- 2026-03-22T18:35:16Z: reproduced the PR build failure locally with `npm run build` as `TS2769` in `src/config.test.ts(883,55)`, added a non-null assertion via `assert.ok(result.backupPath, ...)`, reran `npm run build` plus the issue verification command successfully, and pushed repair commit `d3f451f` to PR `#853`.
- 2026-03-22T10:56:27Z: `git merge --no-edit origin/main` reported a single content conflict in `.codex-supervisor/issue-journal.md`; all product code and tests from `origin/main` merged without manual intervention.
- 2026-03-22T10:56:27Z: resolved the journal conflict by restoring the issue-824 journal content and updating it for the current merge-resolution pass instead of taking `main`'s unrelated issue-829 journal.
- 2026-03-22T10:56:27Z: focused merge verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/getting-started-docs.test.ts src/doctor.test.ts` and `npm run build`.
- 2026-03-22T08:57:53Z: fixed the remaining shortcut-strip leak by switching tracked shortcut collection to `collectTrackedIssues(status)`, which keeps tracked `done` issues out of the default Issue Details shortcuts while leaving them available behind the tracked-history toggle.
- 2026-03-22T08:57:53Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts` and `npm run build` both passed on the local diff.
- 2026-03-22T06:48:38+00:00: initial `npm run build` failed because `tsc` was missing in this worktree; restored dependencies with `npm ci`, reran the focused tests, and `npm run build` then passed.
