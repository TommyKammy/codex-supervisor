# Issue #1501: Surface effective Codex model policy in doctor and status

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1501
- Branch: codex/issue-1501
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 5a9fde2946d7e04be1e63c132f805b4ce2247e18
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856tLOl|PRRT_kwDORgvdZ856tLOn|PRRT_kwDORgvdZ856tLOt|PRRT_kwDORgvdZ856tLOv|PRRT_kwDORgvdZ856tLOx|PRRT_kwDORgvdZ856tLO2|PRRT_kwDORgvdZ856tLO3
- Repeated failure signature count: 1
- Updated at: 2026-04-14T04:07:54.578Z

## Latest Codex Summary
Surfaced effective Codex model policy in the read-only reporting path without changing execution behavior. `doctor` now shows the default route, bounded repair override, local-review override, and best-effort host-default model resolution from Codex host config; active `status` now shows the effective route for the current state plus explicit override routing. I added a shared helper in [src/codex/codex-model-policy.ts](src/codex/codex-model-policy.ts:1) and wired it through [src/doctor.ts](src/doctor.ts:1), [src/supervisor/supervisor-selection-active-status.ts](src/supervisor/supervisor-selection-active-status.ts:1), and [src/supervisor/supervisor-status-model.ts](src/supervisor/supervisor-status-model.ts:1).

Focused coverage was added in [src/doctor.test.ts](src/doctor.test.ts:1), [src/supervisor/supervisor-diagnostics-status-selection.test.ts](src/supervisor/supervisor-diagnostics-status-selection.test.ts:1), and [src/supervisor/supervisor-status-rendering.test.ts](src/supervisor/supervisor-status-rendering.test.ts:1). I committed the work on `codex/issue-1501`, pushed it, and opened draft PR #1504: https://github.com/TommyKammy/codex-supervisor/pull/1504

Summary: Surfaced effective Codex model policy in doctor and status, added focused regression coverage, pushed branch, and opened draft PR #1504
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-status-rendering.test.ts`; `npm run build`
Next action: Monitor draft PR #1504 and address any CI or review feedback on the new model-policy diagnostics
Failure signature: PRRT_kwDORgvdZ856tLOl|PRRT_kwDORgvdZ856tLOn|PRRT_kwDORgvdZ856tLOt|PRRT_kwDORgvdZ856tLOv|PRRT_kwDORgvdZ856tLOx|PRRT_kwDORgvdZ856tLO2|PRRT_kwDORgvdZ856tLO3

## Active Failure Context
- Category: review
- Summary: 7 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1504#discussion_r3077075001
- Details:
  - src/codex/codex-model-policy.ts:65 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Accept inline comments in `config.toml`.** A valid TOML line like `model = "gpt-5" # shared default` will miss this regex and get reported as... url=https://github.com/TommyKammy/codex-supervisor/pull/1504#discussion_r3077075001
  - src/codex/codex-model-policy.ts:167 summary=_⚠️ Potential issue_ | _🟠 Major_ **Keep `defaultRoute` independent from `activeState`.** `defaultRoute.source` is labeled from `codexModelStrategy`, but `effectiveModel` comes ... url=https://github.com/TommyKammy/codex-supervisor/pull/1504#discussion_r3077075003
  - src/codex/codex-model-policy.ts:196 summary=_⚠️ Potential issue_ | _🔴 Critical_ 🧩 Analysis chain 🏁 Script executed: Repository: TommyKammy/codex-supervisor Length of output: 10996 --- 🏁 Script executed: Repository: To... url=https://github.com/TommyKammy/codex-supervisor/pull/1504#discussion_r3077075011
  - src/doctor.test.ts:186 summary=_⚠️ Potential issue_ | _🟡 Minor_ 🧩 Analysis chain 🏁 Script executed: Repository: TommyKammy/codex-supervisor Length of output: 816 --- 🏁 Script executed: Repository: TommyKa... url=https://github.com/TommyKammy/codex-supervisor/pull/1504#discussion_r3077075013
  - src/doctor.ts:683 summary=_⚠️ Potential issue_ | _🟠 Major_ **Sanitize Codex policy lines before injecting them into doctor output.** Line 683 appends raw strings. url=https://github.com/TommyKammy/codex-supervisor/pull/1504#discussion_r3077075015

## Codex Working Notes
### Current Handoff
- Hypothesis: The routing logic already existed, but operators could not see the effective route because read-only reporting never summarized default-vs-override policy or the inherited host default model.
- What changed: Addressed the outstanding PR #1504 review feedback in `src/codex/codex-model-policy.ts`, `src/doctor.ts`, `src/doctor.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, and `src/supervisor/supervisor-status-rendering.test.ts`. The helper now accepts inline TOML comments in host `config.toml`, keeps `defaultRoute` independent from active bounded-repair state, routes active `local_review` snapshots through `localReviewRoute` with target `local_review_generic`, sanitizes policy lines before doctor output, and restores `CODEX_HOME` safely in test teardown.
- Current blocker: none
- Next exact step: Commit the review-fix checkpoint on `codex/issue-1501`, push it to PR #1504, and then resolve or respond to the remaining automated review threads on GitHub.
- Verification gap: Repo-wide `npm test` is still noisy because the package script runs the full suite and unrelated tests are currently red; the focused requested coverage and `npm run build` passed locally.
- Files touched: .codex-supervisor/issue-journal.md; src/codex/codex-model-policy.ts; src/doctor.ts; src/doctor.test.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/supervisor/supervisor-status-rendering.test.ts
- Rollback concern: Host-default resolution is intentionally best-effort and only inspects the top-level `model` key in Codex `config.toml`; if Codex host config layout changes, the output should degrade to `unresolved` without affecting execution.
- Exact failures addressed: `PRRT_kwDORgvdZ856tLOl` inline TOML comments, `PRRT_kwDORgvdZ856tLOn` default route leaking active bounded-repair overrides, `PRRT_kwDORgvdZ856tLOt` missing active local-review route selection, `PRRT_kwDORgvdZ856tLOv|PRRT_kwDORgvdZ856tLO2|PRRT_kwDORgvdZ856tLO3` unsafe `CODEX_HOME` teardown, `PRRT_kwDORgvdZ856tLOx` unsanitized doctor policy lines.
- Commands run: `git diff -- src/codex/codex-model-policy.ts src/doctor.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-status-rendering.test.ts`; `npx tsx --test src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-status-rendering.test.ts`; `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
