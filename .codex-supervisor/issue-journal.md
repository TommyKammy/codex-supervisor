# Issue #715: JSON corruption diagnostics: surface hard corruption findings in doctor and status

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/715
- Branch: codex/issue-715
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 0e433f9b856d4232ec10ce5542165123aa52496e
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851s71w
- Repeated failure signature count: 1
- Updated at: 2026-03-20T12:28:27.705Z

## Latest Codex Summary
Draft PR [#741](https://github.com/TommyKammy/codex-supervisor/pull/741) picked up a valid CodeRabbit review on the new corruption-status regression: [`src/supervisor/supervisor-diagnostics-status-selection.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-715/src/supervisor/supervisor-diagnostics-status-selection.test.ts) created a temp supervisor fixture without registering teardown. I added the missing `t.after(...)` cleanup immediately after fixture creation, matching the existing cleanup pattern already used by the neighboring doctor test.

Focused verification passed again with `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`, and `npm run build` also passed after the review fix.

Summary: Applied the review-driven fixture cleanup fix for the corruption-status regression and revalidated with the focused test plus `npm run build`.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Failure signature: PRRT_kwDORgvdZ851s71w
Next action: commit and push the cleanup fix to PR #741, then clear or monitor the review thread

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/741#discussion_r2965473485
- Details:
  - src/supervisor/supervisor-diagnostics-status-selection.test.ts:78 _⚠️ Potential issue_ | _🟡 Minor_ **Missing test cleanup for temporary fixture.** This test creates a temporary fixture via `createSupervisorFixture()` but does not register a cleanup callback with `t.after()`, unlike the similar test at lines 18-45. This may leave temporary directories on the filesystem after test runs. <details> <summary>🧹 Proposed fix to add cleanup</summary> ```diff -test("status surfaces corrupted JSON state as an explicit hard diagnostic", async () => { +test("status surfaces corrupted JSON state as an explicit hard diagnostic", async (t) => { const fixture = await createSupervisorFixture(); + t.after(async () => { + await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true }); + }); await fs.writeFile(fixture.stateFile, "{not-json}\n", "utf8"); ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion test("status surfaces corrupted JSON state as an explicit hard diagnostic", async (t) => { const fixture = await createSupervisorFixture(); t.after(async () => { await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true }); }); await fs.writeFile(fixture.stateFile, "{not-json}\n", "utf8"); const supervisor = new Supervisor(fixture.config); (supervisor as unknown as { github: Record<string, unknown> }).github = { listCandidateIssues: async () => [], getPullRequestIfExists: async () => null, getChecks: async () => [], getUnresolvedReviewThreads: async () => [], }; const report = await supervisor.statusReport(); assert.match( report.detailedStatusLines.join("\n"), /state_diagnostic severity=hard backend=json summary=corrupted_json_state_forced_empty_fallback_not_missing_bootstrap findings=1 location=.*state\.json/, ); assert.match( report.detailedStatusLines.join("\n"), /state_load_finding backend=json scope=state_file issue_number=none location=.*state\.json message=/, ); assert.equal(report.warning, null); const status = await supervisor.status(); assert.match( status, /state_diagnostic severity=hard backend=json summary=corrupted_json_state_forced_empty_fallback_not_missing_bootstrap findings=1 location=.*state\.json/, ); assert.match(status, /state_load_finding backend=json scope=state_file issue_number=none location=.*state\.json message=/); assert.match(status, /^No active issue\.$/m); }); ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/supervisor/supervisor-diagnostics-status-selection.test.ts` around lines 47 - 78, This test creates a temporary fixture via createSupervisorFixture() but never registers teardown, so add a cleanup callback immediately after creating the fixture (after the line "const fixture = await createSupervisorFixture();") using the test harness teardown function (e.g., t.after(() => fixture.cleanup()) or await t.after(async () => await fixture.cleanup()) depending on whether cleanup returns a promise) to ensure the fixture's temporary files/directories are removed; reference createSupervisorFixture, fixture (fixture.stateFile / fixture.config) and register the cleanup before proceeding with the rest of the test. ``` </details> <!-- fingerprinting:phantom:poseidon:ocelot --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the CodeRabbit thread is a real test-harness issue, and the narrowest correct repair is to mirror the existing fixture teardown pattern in the corruption-status regression without changing the diagnostic behavior under test.
- What changed: updated `status surfaces corrupted JSON state as an explicit hard diagnostic` in `src/supervisor/supervisor-diagnostics-status-selection.test.ts` to accept `t` and register `t.after(async () => fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true }))` immediately after `createSupervisorFixture()`. No production behavior changed; this only closes the temp-directory leak in the review target.
- Current blocker: none
- Next exact step: commit and push the cleanup-only review fix on `codex/issue-715`, then resolve or monitor PR #741 review state.
- Verification gap: none locally after `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build`.
- Files touched: `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this small fix would reintroduce leaked temp fixture directories during the corruption-status regression, which is the exact review concern on PR #741.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-715/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-715/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `sed -n '1,220p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `rg -n "createSupervisorFixture|cleanup\\(" src/supervisor -g '*test*' -g '*helpers*'`; `sed -n '1,260p' src/supervisor/supervisor-test-helpers.ts`; `sed -n '260,520p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `git diff -- .codex-supervisor/issue-journal.md`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`; `git status --short`; `date -Iseconds`; `git rev-parse HEAD`
### Scratchpad
- 2026-03-20 (JST): Validated CodeRabbit thread `PRRT_kwDORgvdZ851s71w`, added missing `t.after(...)` cleanup to the corruption-status fixture test, and reran `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts` plus `npm run build` successfully.
- 2026-03-20 (JST): Re-ran the focused verification set plus `npm run build`, pushed `codex/issue-715` to `origin/codex/issue-715`, and opened draft PR #741 (`status: surface JSON corruption diagnostics`).
- 2026-03-20 (JST): Added a focused status regression for invalid JSON state, reproduced the omission where status only printed normal empty-state lines, then appended explicit `state_diagnostic` and `state_load_finding` lines for JSON `load_findings` so corruption is visible in status without changing loader semantics.
- 2026-03-20 (JST): Added a focused docs regression for the missing JSON corruption contract, confirmed the new assertion failed first, then updated the English operator docs so they consistently say corrupted JSON state is a recovery event requiring explicit acknowledgement/reset and `status`/`doctor` triage before reuse.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
