# Issue #1501: Surface effective Codex model policy in doctor and status

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1501
- Branch: codex/issue-1501
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 5c7d68c6748f31d228965a089ddd7ec40877cbe1
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T03:42:42.748Z

## Latest Codex Summary
- Surfaced compact Codex model-policy lines in `doctor` and active `status` output, including best-effort host default resolution from Codex host config, added focused regression coverage for inherited-host-default and explicit override cases, committed the change, pushed `codex/issue-1501`, and opened draft PR #1504.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The routing logic already existed, but operators could not see the effective route because read-only reporting never summarized default-vs-override policy or the inherited host default model.
- What changed: Added `src/codex/codex-model-policy.ts` to resolve the host default model from `CODEX_HOME`/`~/.codex/config.toml` and render compact policy lines; wired those lines into `doctor` and active `status`; added focused coverage in `src/doctor.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, and `src/supervisor/supervisor-status-rendering.test.ts`.
- Current blocker: none
- Next exact step: Monitor draft PR #1504 and address any local review or CI feedback against the new policy-summary output.
- Verification gap: Repo-wide `npm test` is still noisy because the package script runs the full suite and unrelated tests are currently red; the focused requested coverage and `npm run build` passed locally.
- Files touched: .codex-supervisor/issue-journal.md; src/codex/codex-model-policy.ts; src/doctor.ts; src/doctor.test.ts; src/supervisor/supervisor-selection-active-status.ts; src/supervisor/supervisor-read-only-reporting.ts; src/supervisor/supervisor-status-model.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/supervisor/supervisor-status-rendering.test.ts
- Rollback concern: Host-default resolution is intentionally best-effort and only inspects the top-level `model` key in Codex `config.toml`; if Codex host config layout changes, the output should degrade to `unresolved` without affecting execution.
- Last focused command: `npx tsx --test src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-status-rendering.test.ts && npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
