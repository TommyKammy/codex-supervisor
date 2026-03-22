# Issue #840: Setup config write API: add a narrow validated first-run config update path

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/840
- Branch: codex/issue-840
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 55d96bf5c7aa0ccaaa247890113f26ce6101e665
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T18:20:46.080Z

## Latest Codex Summary
Implemented a narrow first-run config write path in [src/setup-config-write.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-840/src/setup-config-write.ts), wired it through [src/supervisor/supervisor.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-840/src/supervisor/supervisor.ts), [src/supervisor/supervisor-service.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-840/src/supervisor/supervisor-service.ts), and [src/backend/supervisor-http-server.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-840/src/backend/supervisor-http-server.ts). The new `POST /api/setup-config` path only accepts the supported first-run fields, validates them before mutation, preserves unrelated config keys, writes a `.bak` rollback copy for existing configs, updates the file atomically, and returns refreshed setup readiness.

Focused coverage was added in [src/backend/supervisor-http-server.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-840/src/backend/supervisor-http-server.test.ts) and [src/config.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-840/src/config.test.ts) for accepted writes, malformed request rejection, invalid-value rejection, and preservation behavior. I updated [.codex-supervisor/issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-840/.codex-supervisor/issue-journal.md) and committed the checkpoint as `55d96bf` (`Add setup config write path`). The only remaining workspace noise is the pre-existing untracked `.codex-supervisor/replay/` directory, which I left alone.

Summary: Added a validated `/api/setup-config` write path with backup/preservation behavior and focused tests; committed as `55d96bf`.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/backend/supervisor-http-server.test.ts src/config.test.ts`; `npx tsx --test src/backend/supervisor-http-server.test.ts src/config.test.ts src/doctor.test.ts`
Failure signature: none
Next action: open or update the draft PR for issue #840 from branch `codex/issue-840` and let CI run on commit `55d96bf`

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe first-run mutation path is a dedicated server-owned merge that only accepts a small typed field set and maps `reviewProvider` to `reviewBotLogins`, rather than exposing arbitrary config patching.
- What changed: added a focused failing HTTP regression for `POST /api/setup-config` and a config-layer regression for backup/preservation, reproduced the gap as `405` plus a missing `setup-config-write` module, then implemented [src/setup-config-write.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-840/src/setup-config-write.ts) to validate supported first-run fields, reject invalid writes before disk mutation, preserve unrelated fields, write a `.bak` rollback copy for existing configs, atomically rewrite the config, and recompute setup readiness. Wired the new path through [src/supervisor/supervisor.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-840/src/supervisor/supervisor.ts), [src/supervisor/supervisor-service.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-840/src/supervisor/supervisor-service.ts), and [src/backend/supervisor-http-server.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-840/src/backend/supervisor-http-server.ts), then added rejection coverage in [src/backend/supervisor-http-server.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-840/src/backend/supervisor-http-server.test.ts) and [src/config.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-840/src/config.test.ts).
- Current blocker: none
- Next exact step: review the new write-path diff once, commit it on `codex/issue-840`, and open or update a draft PR if none exists yet.
- Verification gap: none on the issue command; `npx tsx --test src/backend/supervisor-http-server.test.ts src/config.test.ts src/doctor.test.ts` passed on the local diff.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.test.ts`, `src/backend/supervisor-http-server.ts`, `src/config.test.ts`, `src/setup-config-write.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: low; the change is additive and narrow, and existing configs get a `.bak` rollback point before writes.
- Last focused command: `npx tsx --test src/backend/supervisor-http-server.test.ts src/config.test.ts src/doctor.test.ts`
- Last focused failure: reproduced before implementation as `setup-config-write-route-missing`; `POST /api/setup-config` returned `405` and `src/config.test.ts` failed with `Cannot find module './setup-config-write'`.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-840/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-840/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "setup-config|setup readiness|setup-readiness|preview|first-run|config write|reviewProviderProfile|supervisor config" src
sed -n '1,220p' src/backend/supervisor-http-server.ts
sed -n '1,220p' src/supervisor/supervisor-service.ts
sed -n '1040,1135p' src/supervisor/supervisor.ts
sed -n '1,340p' src/setup-config-preview.ts
sed -n '780,900p' src/config.test.ts
sed -n '780,980p' src/backend/supervisor-http-server.test.ts
sed -n '1,220p' supervisor.config.example.json
npx tsx --test src/backend/supervisor-http-server.test.ts src/config.test.ts
npx tsx --test src/backend/supervisor-http-server.test.ts src/config.test.ts
npx tsx --test src/backend/supervisor-http-server.test.ts src/config.test.ts src/doctor.test.ts
git diff -- src/backend/supervisor-http-server.ts src/backend/supervisor-http-server.test.ts src/config.test.ts src/setup-config-write.ts src/supervisor/supervisor-service.ts src/supervisor/supervisor.ts .codex-supervisor/issue-journal.md
```
### Scratchpad
- 2026-03-22T18:09:02Z: reproduced the issue with a focused failing HTTP regression (`POST /api/setup-config` returned `405`) and a missing-module failure for `./setup-config-write`, then implemented the write path and reran the focused issue command successfully.
- 2026-03-22T10:56:27Z: `git merge --no-edit origin/main` reported a single content conflict in `.codex-supervisor/issue-journal.md`; all product code and tests from `origin/main` merged without manual intervention.
- 2026-03-22T10:56:27Z: resolved the journal conflict by restoring the issue-824 journal content and updating it for the current merge-resolution pass instead of taking `main`'s unrelated issue-829 journal.
- 2026-03-22T10:56:27Z: focused merge verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/getting-started-docs.test.ts src/doctor.test.ts` and `npm run build`.
- 2026-03-22T08:57:53Z: fixed the remaining shortcut-strip leak by switching tracked shortcut collection to `collectTrackedIssues(status)`, which keeps tracked `done` issues out of the default Issue Details shortcuts while leaving them available behind the tracked-history toggle.
- 2026-03-22T08:57:53Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts` and `npm run build` both passed on the local diff.
- 2026-03-22T06:48:38+00:00: initial `npm run build` failed because `tsc` was missing in this worktree; restored dependencies with `npm ci`, reran the focused tests, and `npm run build` then passed.
