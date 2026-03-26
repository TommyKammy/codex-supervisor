# Issue #1078: Promote reconnect polling backoff into shared-memory guardrails

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1078
- Branch: codex/issue-1078
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 4628bb00171f510bdedd4335f883756019760cdb
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T15:42:42.430Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the durable issue is the setup reconnect loop itself, not just test timing. Repeated reconnect failures or unhealthy readiness responses should back off with a bounded delay instead of polling every 50 ms forever.
- What changed: added a focused setup reconnect regression test in `src/backend/webui-dashboard.test.ts`, changed `src/backend/webui-setup-browser-script.ts` to use capped exponential backoff for unsuccessful reconnect polls, updated the existing reconnect success-path test to match the new `50 ms -> 100 ms` schedule, and promoted the generic polling backoff rule into `docs/shared-memory/external-review-guardrails.json`.
- Current blocker: none.
- Next exact step: commit the reconnect backoff + shared-memory guardrail changes on `codex/issue-1078`, push the branch, and open a draft PR if one does not already exist.
- Verification gap: full `npm test` has not been run; focused setup WebUI reconnect coverage and committed-guardrail validation are green.
- Files touched: `.codex-supervisor/issue-journal.md`; `docs/shared-memory/external-review-guardrails.json`; `src/backend/webui-dashboard.test.ts`; `src/backend/webui-setup-browser-script.ts`.
- Rollback concern: low. The runtime change is limited to the setup-page reconnect poll cadence and the tests cover both recovery and repeated-failure timing.
- Last focused command: `npx tsx src/committed-guardrails-cli.ts check`
- What changed this turn: reread the required memory files and journal, traced the setup reconnect path to `monitorManagedRestartReconnect()`, reproduced that the browser script retried readiness fetches every fixed 50 ms on both unhealthy responses and fetch errors, added a deterministic timer-based regression test for repeated failures, changed the reconnect loop to use capped exponential backoff, normalized the promoted durable guardrail entry, and reran focused verification.
- Exact failure reproduced this turn: after launcher-managed restart, `src/backend/webui-setup-browser-script.ts` kept polling `/api/setup-readiness` every 50 ms forever while the worker stayed unhealthy, so repeated failures never widened the retry interval.
- Commands run this turn: `sed -n '1,220p' <always-read-memory>`; `sed -n '1,260p' <context-index>`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "external-review-guardrails|reconnect|readiness|polling|backoff|50ms|50 ms|setTimeout\\(|retry" docs src test`; `sed -n '1,260p' docs/shared-memory/external-review-guardrails.json`; `rg --files src test docs | rg "setup-shell|webui-setup|restartable|dashboard|guardrail|shared-memory"`; `rg -n "reconnect|poll|backoff|setTimeout\\(|50\\)|50,|schedule|retry" src/backend/restartable-webui-shell-service.ts src/backend/webui-setup-browser-script.ts src/backend/webui-dashboard.test.ts src/backend/restartable-webui-shell-service.test.ts`; `sed -n '1,260p' src/backend/restartable-webui-shell-service.ts`; `sed -n '1,280p' src/backend/restartable-webui-shell-service.test.ts`; `sed -n '1,260p' src/backend/webui-setup-browser-script.ts`; `sed -n '260,430p' src/backend/webui-setup-browser-script.ts`; `sed -n '2560,2945p' src/backend/webui-dashboard.test.ts`; `rg -n "advanceTime|manual timer|createSetupHarness|fetchCalls|refreshSetupReadiness|Waiting for the restarted worker to reconnect|temporarily unavailable" src/backend/webui-dashboard.test.ts`; `sed -n '1,220p' src/committed-guardrails.test.ts`; `sed -n '1,220p' src/verifier-guardrails.test.ts`; `sed -n '1,120p' src/backend/webui-dashboard.test.ts`; `sed -n '260,540p' src/backend/webui-dashboard.test.ts`; `rg -n "backoff|exponential|retryDelay|retryInterval|pollIntervalMs|delay\\(" src | head -n 200`; `apply_patch ...`; `npx tsx --test src/backend/webui-dashboard.test.ts`; `apply_patch ...`; `npx tsx --test src/backend/webui-dashboard.test.ts`; `apply_patch ...`; `apply_patch ...`; `npx tsx --test src/backend/webui-dashboard.test.ts`; `rg -n "validateCommittedGuardrails|committed-guardrails|external-review-guardrails" src package.json`; `cat package.json`; `apply_patch ...`; `npx tsx --test src/backend/webui-dashboard.test.ts`; `npm run guardrails:check`; `npx tsx src/committed-guardrails-cli.ts check`; `npx tsx src/committed-guardrails-cli.ts fix`; `npx tsx src/committed-guardrails-cli.ts check`; `git diff -- src/backend/webui-setup-browser-script.ts src/backend/webui-dashboard.test.ts docs/shared-memory/external-review-guardrails.json`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `gh pr view --json number,url,isDraft,headRefName,baseRefName,state`.
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
