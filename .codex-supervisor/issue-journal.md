# Issue #1054: Return restart requirements from typed setup config writes

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1054
- Branch: codex/issue-1054
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: implementing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d2488cb1b1da430e3202f355ce44ab979dfa203a
- Blocked reason: none
- Last failure signature: setup-config-update-missing-restart-metadata
- Repeated failure signature count: 0
- Updated at: 2026-03-26T16:10:55+09:00

## Latest Codex Summary
- Added restart metadata to typed setup config writes so the response now reports `restartRequired`, `restartScope`, and `restartTriggeredByFields` based on semantic field changes rather than raw requested fields.
- Classified all supported typed setup fields as requiring a supervisor restart when their effective configured value changes under the current architecture, while preserving no-op writes as `restartRequired: false`.
- Tightened focused tests in `src/config.test.ts` and `src/backend/supervisor-http-server.test.ts`, updated setup-shell/browser fixtures to the new response shape, and verified the contract with focused tests plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: typed setup config writes already know which fields were requested, and because the supervisor loads config at process startup, the write response can deterministically flag restart-required semantic changes without introducing any restart behavior.
- What changed: extended `SetupConfigUpdateResult` in `src/setup-config-write.ts` with `restartRequired`, `restartScope`, and `restartTriggeredByFields`; classified semantic field changes against the current config summary so no-op writes stay restart-free; added focused restart/no-restart tests in `src/config.test.ts`; added API coverage in `src/backend/supervisor-http-server.test.ts`; and updated setup-shell/browser fixtures in `src/backend/webui-dashboard.test.ts` and `src/backend/webui-dashboard-browser-smoke.test.ts`.
- Current blocker: none locally.
- Next exact step: stage the typed setup config contract changes, create a checkpoint commit on `codex/issue-1054`, and open or update the draft PR once the branch diff is ready.
- Verification gap: none in the requested local scope after focused setup-config tests, API response coverage, setup-shell contract coverage, and a successful local build.
- Files touched: `src/setup-config-write.ts`, `src/config.test.ts`, `src/backend/supervisor-http-server.test.ts`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-dashboard-browser-smoke.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change is API-contract-only, but future work should preserve the semantic no-op detection so the browser can distinguish restart-needed changes from harmless rewrites.
- Last focused command: `npm run build`
- Exact failure reproduced: `updateSetupConfig()` returned only `updatedFields` and refreshed readiness, so typed `/api/setup-config` saves provided no deterministic restart metadata and could not distinguish restart-required semantic changes from no-op writes.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1054/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1054/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "setup_config_update|setup-config|restartRequired|restartScope|typed setup" src .`; `rg --files | rg 'setup|config|supervisor-http|webui-setup|typed'`; `sed -n '1,280p' src/setup-config-write.ts`; `sed -n '1,260p' src/config.test.ts`; `sed -n '1030,1145p' src/backend/supervisor-http-server.test.ts`; `sed -n '1,220p' src/supervisor/supervisor-service.ts`; `sed -n '1,260p' src/supervisor/supervisor.ts`; `sed -n '1320,1365p' src/supervisor/supervisor.ts`; `sed -n '334,470p' src/core/config.ts`; `sed -n '1,260p' src/setup-readiness.ts`; `rg -n "restartScope|restartRequired|restart" src`; `sed -n '180,230p' src/backend/supervisor-http-server.test.ts`; `sed -n '560,620p' src/backend/supervisor-http-server.test.ts`; `sed -n '930,1035p' src/config.test.ts`; `sed -n '470,525p' src/backend/webui-dashboard-browser-smoke.test.ts`; `sed -n '1915,1955p' src/backend/webui-dashboard.test.ts`; `rg -n "updatedFields|restartRequired|restartScope|setup_config_update" src/backend/webui-setup-browser-script.ts src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts`; `sed -n '390,510p' src/backend/webui-setup-browser-script.ts`; `npx tsx --test src/config.test.ts --test-name-pattern "updateSetupConfig preserves unrelated fields, writes a backup, and refreshes readiness|updateSetupConfig reports no restart requirement when a typed setup write is a no-op"`; `sed -n '1,220p' src/core/review-providers.ts`; `sed -n '1,180p' src/backend/webui-dashboard-browser-smoke.test.ts`; `sed -n '1,130p' src/backend/supervisor-http-server.test.ts`; `npx tsx --test src/backend/supervisor-http-server.test.ts --test-name-pattern "accepts narrow setup config writes and returns refreshed readiness|surfaces no-op setup config writes without a restart requirement"`; `npx tsx --test src/backend/webui-dashboard.test.ts --test-name-pattern "setup shell saves through the narrow setup config API and revalidates readiness after the write"`; `npm run build`; `sed -n '1,220p' package.json`; `ls -1 node_modules/typescript node_modules/.bin/tsc package-lock.json`; `npm ci`; `npm run build`; `git status --short`; `git diff -- src/setup-config-write.ts src/config.test.ts src/backend/supervisor-http-server.test.ts src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts`; `date -Iseconds`.
- PR status: none yet for `codex/issue-1054`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
