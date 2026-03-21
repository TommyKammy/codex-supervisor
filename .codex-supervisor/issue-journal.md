# Issue #767: Merge latency config: add a dedicated recheck cadence for merge-critical PR states

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/767
- Branch: codex/issue-767
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 0cb65bff9c1a03c092a6457460218c0df147ef33
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ85133dq|PRRT_kwDORgvdZ85133ds
- Repeated failure signature count: 1
- Updated at: 2026-03-21T08:52:44.594Z

## Latest Codex Summary
Implemented the issue on `codex/issue-767` and opened draft PR [#771](https://github.com/TommyKammy/codex-supervisor/pull/771).

The change adds optional `mergeCriticalRecheckSeconds` config parsing with safe disabled fallback, a shared cadence diagnostics summary, and explicit cadence visibility in `status` and `doctor`. Focused tests were added for config loading, fallback behavior, and diagnostics rendering.

Summary: Added merge-critical recheck cadence config, surfaced it in status/doctor output, verified with focused tests and a clean build, and opened draft PR #771
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm ci`; `npm run build`
Failure signature: none
Next action: Watch PR #771 CI and address any review or build feedback if it appears

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/771#discussion_r2969331285
- Details:
  - .codex-supervisor/issue-journal.md:27 _⚠️ Potential issue_ | _🟡 Minor_ **Update stale “Next exact step” to match current PR state.** This step is outdated now that PR `#771` is already open; it may misdirect the next handoff. Please replace it with the actual next action (e.g., review follow-ups, merge readiness checks, or post-merge verification). <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md at line 27, Replace the stale sentence "Next exact step: commit the config/visibility change, then open or update the branch PR if one is not already present." in the .codex-supervisor/issue-journal.md entry with a current actionable next step reflecting PR `#771` being open—for example, "Next exact step: review PR `#771` for feedback, run merge-readiness checks, and perform post-merge verification"—so the journal points to review follow-ups and merge readiness instead of opening a PR. ``` </details> <!-- fingerprinting:phantom:triton:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/core/config.ts:225 _⚠️ Potential issue_ | _🟡 Minor_ **Normalize cadence diagnostics with the same validity rules as config parsing.** `summaryCadenceDiagnostics` accepts any positive number, while `loadConfig` requires finite integer values. This can leak invalid values (e.g., `Infinity`, `1.5`) into diagnostics when config is provided programmatically. <details> <summary>🔧 Proposed fix</summary> ```diff export function summarizeCadenceDiagnostics( config: Pick<SupervisorConfig, "pollIntervalSeconds" | "mergeCriticalRecheckSeconds">, ): CadenceDiagnosticsSummary { const mergeCriticalRecheckSeconds = - typeof config.mergeCriticalRecheckSeconds === "number" && config.mergeCriticalRecheckSeconds > 0 + typeof config.mergeCriticalRecheckSeconds === "number" && + Number.isFinite(config.mergeCriticalRecheckSeconds) && + Number.isInteger(config.mergeCriticalRecheckSeconds) && + config.mergeCriticalRecheckSeconds > 0 ? config.mergeCriticalRecheckSeconds : null; ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion export function summarizeCadenceDiagnostics( config: Pick<SupervisorConfig, "pollIntervalSeconds" | "mergeCriticalRecheckSeconds">, ): CadenceDiagnosticsSummary { const mergeCriticalRecheckSeconds = typeof config.mergeCriticalRecheckSeconds === "number" && Number.isFinite(config.mergeCriticalRecheckSeconds) && Number.isInteger(config.mergeCriticalRecheckSeconds) && config.mergeCriticalRecheckSeconds > 0 ? config.mergeCriticalRecheckSeconds : null; ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/core/config.ts` around lines 219 - 225, summarizeCadenceDiagnostics currently accepts any positive number and can leak invalid values like Infinity or non-integers; change its validation to match loadConfig by ensuring both config.mergeCriticalRecheckSeconds and config.pollIntervalSeconds are finite positive integers (use Number.isFinite and Number.isInteger and > 0) and return null when they fail those checks; update the assignments for mergeCriticalRecheckSeconds and pollIntervalSeconds in summarizeCadenceDiagnostics to use this stricter validation so diagnostics mirror loadConfig's rules. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining valid review fixes are limited to the stale journal handoff and `summarizeCadenceDiagnostics` being too permissive for programmatic `mergeCriticalRecheckSeconds`; `pollIntervalSeconds` should not be tightened here because `loadConfig` still accepts any positive numeric poll cadence.
- What changed: updated the journal handoff text for PR `#771`; tightened `summarizeCadenceDiagnostics` so invalid programmatic merge-critical recheck values fall back to disabled; added a regression test covering `Infinity` and fractional merge-critical values; and pushed commit `e3bb2e9` to `codex/issue-767`.
- Current blocker: none
- Next exact step: reply to or resolve the two automated review threads on PR `#771`, then watch CI for the pushed head.
- Verification gap: none locally; the untracked `.codex-supervisor/replay/` workspace artifact remains present but was not touched.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/config.test.ts`, `src/core/config.ts`
- Rollback concern: removing the cadence-summary helper or the new renderer lines would drop the explicit visibility promised by issue #767 even though runtime polling behavior would still fall back safely.
- Last focused command: `git push`
- Last focused failure: `none`
- Last focused commands:
```bash
npx tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
npm run build
git diff -- src/core/config.ts src/config.test.ts .codex-supervisor/issue-journal.md
git commit -m "Tighten merge-critical cadence diagnostics"
git push
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
