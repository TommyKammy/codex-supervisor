# Issue #1200: Setup opt-in flow: let operators save recommended localCiCommand from WebUI

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1200
- Branch: codex/issue-1200
- Workspace: .
- Journal: .codex-supervisor/issues/1200/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: e12fba9d50431c906afb1bed34c62c735f0b2349
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-30T10:06:52.424Z

## Latest Codex Summary
Implemented the setup opt-in flow for repo-owned local CI. `localCiCommand` is now part of typed setup readiness and the setup-owned write surface, so the setup form can read, edit, and persist it without changing the broader config mutation boundary. The setup shell also exposes an explicit “Use recommended command” action when a repo-owned candidate is detected, then revalidates readiness after save so the advisory warning is replaced by the configured-contract view. The main changes are in [setup-readiness.ts](src/setup-readiness.ts), [setup-config-write.ts](src/setup-config-write.ts), [webui-setup-browser-script.ts](src/backend/webui-setup-browser-script.ts), and [webui-setup-page.ts](src/backend/webui-setup-page.ts).

Focused coverage was added in [doctor.test.ts](src/doctor.test.ts), [config.test.ts](src/config.test.ts), and [webui-dashboard.test.ts](src/backend/webui-dashboard.test.ts). I also updated the issue journal at [issue-journal.md](.codex-supervisor/issues/1200/issue-journal.md) and committed the checkpoint as `e12fba9` (`Add setup opt-in flow for local CI command`).

Verification:
- `npx tsx --test src/doctor.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` passed.
- `npm run build` failed because `tsc` is not installed in this workspace (`sh: 1: tsc: not found`).
- An extra broad run of `src/config.test.ts` still shows two unrelated pre-existing CodeRabbit starter-profile failures.

Summary: Added `localCiCommand` to setup readiness and setup writes, plus a WebUI “Use recommended command” opt-in flow with focused test coverage; committed as `e12fba9`.
State hint: implementing
Blocked reason: verification
Tests: `npx tsx --test src/doctor.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` passed; `npm run build` failed because `tsc` is missing; extra `src/config.test.ts` sweep still has unrelated CodeRabbit failures
Next action: Install TypeScript or project dependencies, rerun `npm run build`, then decide whether the unrelated CodeRabbit profile test failures should be fixed in a separate issue
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The issue was blocked by three disconnected seams: `diagnoseSetupReadiness` did not include `localCiCommand` in editable setup fields, `updateSetupConfig` rejected `localCiCommand` as outside the setup-owned write surface, and the setup shell only displayed the recommendation without a direct opt-in control.
- What changed: Added `localCiCommand` to setup readiness and setup-config write contracts, treated it as optional/non-blocking for first-run readiness, rendered it in the setup form, added a dedicated "Use recommended command" button in the local CI panel, and added focused tests covering readiness exposure, persistence, and adopt-and-save revalidation.
- Current blocker: None for the issue implementation. After installing workspace dependencies, the remaining non-green signal is still the unrelated full-file `src/config.test.ts` CodeRabbit starter-profile baseline, not the setup flow.
- Next exact step: Commit the stabilizing follow-up on `codex/issue-1200`; if wider repo verification is required later, address or defer the unrelated CodeRabbit starter-profile expectations separately.
- Verification gap: Issue-targeted verification is green. A broad `npx tsx --test src/config.test.ts` still fails on the pre-existing CodeRabbit starter-profile assertions (`repoSlug` placeholder and `skipTitlePrefixes`), which are outside this issue's changed behavior.
- Files touched: `.codex-supervisor/issues/1200/issue-journal.md`, `src/setup-readiness.ts`, `src/setup-config-write.ts`, `src/setup-config-preview.ts`, `src/backend/webui-setup-page.ts`, `src/backend/webui-setup-browser-script.ts`, `src/doctor.test.ts`, `src/config.test.ts`, `src/backend/webui-dashboard.test.ts`.
- Rollback concern: Low. Main behavior change is limited to setup-owned config fields and optional setup UI affordances; clearing `localCiCommand` is still not supported through the form because empty-string writes remain rejected by the narrow setup API.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-03-30: `npm install` restored the local toolchain so `npm run build` could run. That exposed and resolved a missed `SetupReadinessFieldKey` plumbing seam in `src/setup-config-preview.ts` by adding `localCiCommand` to the known setup-preview keys, labels, and field-change list.
- 2026-03-30: Stabilizing verification passed with `npm run build`, `npx tsx --test src/doctor.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`, and `npx tsx --test --test-name-pattern 'buildSetupConfigPreview|updateSetupConfig' src/config.test.ts`.
