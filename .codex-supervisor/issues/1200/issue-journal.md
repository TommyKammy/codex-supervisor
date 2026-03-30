# Issue #1200: Setup opt-in flow: let operators save recommended localCiCommand from WebUI

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1200
- Branch: codex/issue-1200
- Workspace: .
- Journal: .codex-supervisor/issues/1200/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=3, repair=1)
- Last head SHA: 41e11c5d341f950a9fe790bdbdcbd4e7d52a657b
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ853pVce|PRRT_kwDORgvdZ853pVci|PRRT_kwDORgvdZ853pVck
- Repeated failure signature count: 1
- Updated at: 2026-03-30T10:27:33Z

## Latest Codex Summary
Addressed the three automated review findings on PR #1201 locally. `src/setup-readiness.ts` now treats invalid optional setup fields as invalid when computing blockers and overall status, `src/backend/webui-dashboard.test.ts` now preserves initial `hidden` and `disabled` button attributes in the fake DOM and asserts the recommended-command adopt button becomes visible and enabled before click dispatch, and this journal now reflects the current review-fix handoff instead of the stale pre-publish verification note.

Focused verification passed again after the review fixes: `npm run build`, `npx tsx --test src/doctor.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`, and `npx tsx --test --test-name-pattern 'buildSetupConfigPreview|updateSetupConfig' src/config.test.ts`.

Summary: Addressed the three CodeRabbit review findings on PR #1201 and revalidated the setup local-CI flow
State hint: addressing_review
Blocked reason: none
Tests: `npm run build`; `npx tsx --test src/doctor.test.ts src/backend/webui-dashboard.test.ts`; `npx tsx --test src/doctor.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`; `npx tsx --test --test-name-pattern 'buildSetupConfigPreview|updateSetupConfig' src/config.test.ts`
Next action: Commit and push the review-fix checkpoint to `codex/issue-1200`, then watch PR #1201 for rerun CI and reviewer acknowledgement
Failure signature: none

## Active Failure Context
- Category: review
- Summary: Local fixes are ready for the three automated review findings; the branch just needs to be updated for re-review.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1201#discussion_r3008896268
- Details:
  - `src/setup-readiness.ts`: invalid optional setup fields now contribute to both blocker generation and overall readiness status.
  - `src/backend/webui-dashboard.test.ts`: the setup harness now preserves initial button `hidden` and `disabled` attributes, and the adopt-flow tests assert the button is visible and enabled before clicking it.
  - `.codex-supervisor/issues/1200/issue-journal.md`: handoff notes now reflect the review-fix state; if readiness metadata is ever in doubt, run `node dist/index.js issue-lint 1200 --config /path/to/supervisor.config.json`.

## Codex Working Notes
### Current Handoff
- Hypothesis: All three review comments were valid but narrow: readiness classification ignored invalid optional setup fields, the setup-shell test harness did not preserve the adopt button's initial disabled/hidden state, and the journal handoff still read like the pre-review publish checkpoint instead of the current review-fix pass.
- What changed: Tightened readiness classification so invalid optional setup fields remain invalid/blocking, preserved initial `hidden` and `disabled` attributes in the setup fake DOM and asserted the adopt button is exposed before click dispatch, and refreshed the journal summary/handoff with the current review-fix verification state and lint guidance.
- Current blocker: None locally. PR #1201 needs the updated branch pushed so the review threads can be re-evaluated.
- Next exact step: Push the review-fix commit to `codex/issue-1200`, then monitor PR #1201 for rerun CI or follow-up review. If the unrelated broad `src/config.test.ts` starter-profile baseline resurfaces, track it as a separate issue instead of folding it into #1200.
- Verification gap: None for the changed paths. The broader full-file `src/config.test.ts` CodeRabbit starter-profile baseline remains a separate known issue and was intentionally kept out of this review-fix scope.
- Files touched: `.codex-supervisor/issues/1200/issue-journal.md`, `src/setup-readiness.ts`, `src/backend/webui-dashboard.test.ts`.
- Rollback concern: Low. Main behavior change is limited to setup-owned config fields and optional setup UI affordances; clearing `localCiCommand` is still not supported through the form because empty-string writes remain rejected by the narrow setup API.
- Last focused command: `npx tsx --test --test-name-pattern 'buildSetupConfigPreview|updateSetupConfig' src/config.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-03-30: `npm install` restored the local toolchain so `npm run build` could run. That exposed and resolved a missed `SetupReadinessFieldKey` plumbing seam in `src/setup-config-preview.ts` by adding `localCiCommand` to the known setup-preview keys, labels, and field-change list.
- 2026-03-30: Stabilizing verification passed with `npm run build`, `npx tsx --test src/doctor.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`, and `npx tsx --test --test-name-pattern 'buildSetupConfigPreview|updateSetupConfig' src/config.test.ts`.
- 2026-03-30: Pushed `codex/issue-1200` to `github` and opened draft PR #1201 with `gh pr create` after the GitHub connector returned `403 Resource not accessible by integration` for pull-request creation.
- 2026-03-30: Review-fix verification passed with `npm run build`, `npx tsx --test src/doctor.test.ts src/backend/webui-dashboard.test.ts`, `npx tsx --test src/doctor.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`, and `npx tsx --test --test-name-pattern 'buildSetupConfigPreview|updateSetupConfig' src/config.test.ts`.
- 2026-03-30: If setup readiness metadata is ever in doubt during handoff, run `node dist/index.js issue-lint 1200 --config /path/to/supervisor.config.json`; unrelated full-file CodeRabbit starter-profile failures belong in a separate issue, not this review-fix pass.
