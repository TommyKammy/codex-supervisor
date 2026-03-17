# Issue #487: Test cleanup: split supervisor recovery coverage by reconciliation and failure flows

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/487
- Branch: codex/issue-487
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-487
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-487/.codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: bd2b93474e51ce2ad29fd71f625e1b4b849ce11f
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8504_WU
- Repeated failure signature count: 1
- Updated at: 2026-03-17T14:50:03.280Z

## Latest Codex Summary
Applied the two valid review fixes in [supervisor-recovery-failure-flows.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-487/src/supervisor/supervisor-recovery-failure-flows.test.ts) and [issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-487/.codex-supervisor/issue-journal.md). The failure-flow test now derives the issue lock path through `Supervisor.lockPath`, and the journal’s live summary links now use repo-relative targets instead of `/home/...` paths.

Focused verification passed with `npx tsx --test src/supervisor/supervisor-recovery-failure-flows.test.ts` and `npm run build`. I committed the repair as `bd2b934`, pushed `codex/issue-487`, and resolved both CodeRabbit threads on PR #496. The only remaining local artifact is untracked `.codex-supervisor/replay/`.

Summary: Applied and pushed the PR #496 review repair, then resolved both CodeRabbit threads
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-recovery-failure-flows.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor PR #496 for any new review or CI signals

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/496#discussion_r2947318955
- Details:
  - .codex-supervisor/issue-journal.md:33 _⚠️ Potential issue_ | _🟡 Minor_ **Reformat this embedded review payload into multiline Markdown blocks.** Line 33 is packed into a single inline block (`<details>` + fenced text), which triggers markdownlint MD038 and is difficult to edit safely. Please expand it into proper multiline Markdown.

    <details>
    <summary>🧰 Tools</summary>

    <details>
    <summary>🪛 markdownlint-cli2 (0.21.0)</summary>

    ```text
    [warning] 33-33: Spaces inside code span elements (MD038, no-space-in-code)
    ---
    [warning] 33-33: Spaces inside code span elements (MD038, no-space-in-code)
    ```

    </details>
    </details>

    <details>
    <summary>🤖 Prompt for AI Agents</summary>

    ````text
    Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md at line 33, The embedded review payload inside .codex-supervisor/issue-journal.md is currently crammed into a single inline <details> block with a fenced ```diff``` payload, which triggers MD038 and is hard to edit; open that inline block into proper multiline Markdown by replacing the single-line <details>...```diff```...</details> construct with a multiline <details> containing a separate <summary> line, a standalone fenced code block (```diff) with its contents on separate lines, and closing fences and </details> on their own lines, and do the same for the committable suggestion and Prompt for AI Agents sections so each <details>, <summary>, and fenced block (e.g., the suggestion and prompt) are multiline and easy to edit.
    ````

    </details>
    <!-- fingerprinting:phantom:poseidon:hawk -->
    <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: #487 can stay behavior-neutral by moving the recovery reconciliation assertions into their own focused suite and isolating dirty-worktree/unexpected-failure recovery flows in a separate file, with the original test path kept only as a facade import.
- What changed: split `src/supervisor/supervisor-recovery.test.ts` into `src/supervisor/supervisor-recovery-reconciliation.test.ts` and `src/supervisor/supervisor-recovery-failure-flows.test.ts`, and reduced `src/supervisor/supervisor-recovery.test.ts` to two side-effect imports.
- Current blocker: none
- Next exact step: Verify the multiline markdown repair in `.codex-supervisor/issue-journal.md`, then commit, push, and resolve the remaining CodeRabbit thread on PR #496.
- Verification gap: full-file `markdownlint-cli2` still reports longstanding journal-wide style violations, but the targeted `MD038` signal for this copied review payload no longer appears.
- Files touched: `src/supervisor/supervisor-recovery.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-recovery-failure-flows.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this cleanup would put reconciliation helper coverage and heavier recovery integration flows back into one file, increasing edit overlap and making failures less localized.
- Last focused command: `bash -lc 'npx markdownlint-cli2 .codex-supervisor/issue-journal.md 2>&1 | rg "MD038|Summary:"'`
### Scratchpad
- 2026-03-17: Reflowed the remaining copied CodeRabbit payload in `.codex-supervisor/issue-journal.md` into multiline `<details>` blocks so markdownlint no longer sees inline code-span spacing around the embedded fenced content.
- 2026-03-17: Review repair for PR #496 switched the live journal summary links from absolute `/home/...` targets to repository-relative paths and updated the dirty-worktree recovery test to derive its issue lock path via `Supervisor.lockPath`; focused verification was `npx tsx --test src/supervisor/supervisor-recovery-failure-flows.test.ts` and `npm run build`.
- 2026-03-17: Added `draftSkipAt` to configured-bot summaries and hydrated PRs; focused verification was `npx tsx --test src/github/github-review-signals.test.ts src/github/github-pull-request-hydrator.test.ts`, followed by `npm ci` and `npm run build`.
- 2026-03-17: Pushed `codex/issue-478` to `origin` and opened draft PR #481 (`https://github.com/TommyKammy/codex-supervisor/pull/481`) after confirming there was no existing PR for the branch.
- 2026-03-17: Review repair for PR #481 adds the same per-bot removal guard to `draftSkipAt` that rate-limit warnings already used, plus a regression test for stale draft-skip comments after request removal.
- 2026-03-17: Cleaned the copied review-context links in this journal so they use repository-relative markdown targets instead of local `/home/...` paths.
- 2026-03-17: Repair verification for the stale draft-skip fix was `npx tsx --test src/github/github-review-signals.test.ts src/github/github-pull-request-hydrator.test.ts` and `npm run build`, both passing before commit `e7c4170`.
- 2026-03-17: Focused reproducer for #480 was `inferStateFromPullRequest` returning `ready_to_merge` instead of `waiting_ci` when `review_wait_started_at=2026-03-13T02:30:00Z`, `configuredBotDraftSkipAt=2026-03-13T02:25:00Z`, `currentHeadCiGreenAt=2026-03-13T02:05:00Z`, and no fresh CodeRabbit signal had arrived after ready-for-review.
- 2026-03-17: The fix reuses the refreshed review-wait window after ready-for-review for CodeRabbit draft-skip cases, but only until either `configuredBotInitialGraceWaitSeconds` expires or a newer actionable configured-bot signal arrives (`configuredBotCurrentHeadObservedAt`, `copilotReviewArrivedAt`, or `configuredBotTopLevelReviewSubmittedAt`).
- 2026-03-17: Verification for #480 was `npx tsx --test src/pull-request-state-provider-waits.test.ts src/supervisor/supervisor-lifecycle.test.ts`; `npm run build` initially failed with `sh: 1: tsc: not found`, then `npm ci` restored the toolchain and both the focused tests and `npm run build` passed.
- 2026-03-17: Re-ran `npx tsx --test src/pull-request-state-provider-waits.test.ts src/supervisor/supervisor-lifecycle.test.ts` and `npm run build`, both passing before pushing `codex/issue-480` and opening draft PR #482 (`https://github.com/TommyKammy/codex-supervisor/pull/482`).
- 2026-03-17: Review repair for PR #482 filters malformed configured-bot timestamps before selecting the latest actionable signal; focused regression/verification was `npx tsx --test src/pull-request-state-provider-waits.test.ts` and `npm run build`.
- 2026-03-17: Follow-up review repair for PR #482 updates the live journal summary links from absolute `/home/...` targets to repository-relative `../src/...` paths so CodeRabbit readers can open them from the repo view.
- 2026-03-17: Pushed `9a7289c` (`Use repo-relative journal links`) to `origin/codex/issue-480` and resolved CodeRabbit thread `PRRT_kwDORgvdZ850206I` with `gh api graphql`.
- 2026-03-17: Focused reproducer for #477 was status still emitting `configured_bot_initial_grace_wait pause_reason=awaiting_initial_provider_activity recent_observation=required_checks_green` after ready-for-review when `review_wait_started_at=2026-03-13T02:30:00Z`, `configuredBotDraftSkipAt=2026-03-13T02:25:00Z`, and no fresh CodeRabbit signal had arrived since the draft skip.
- 2026-03-17: Status fix for #477 keys the draft-skip re-wait off `review_wait_started_at`/`review_wait_head_sha`, reuses the configured initial grace duration, and surfaces it distinctly as `pause_reason=awaiting_fresh_provider_review_after_draft_skip` with `recent_observation=ready_for_review_reopened_wait`.
- 2026-03-17: Verification for #477 was `npx tsx --test src/supervisor/supervisor-status-review-bot.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm run build` first failed with `sh: 1: tsc: not found`, then `npm ci` restored the local toolchain and both the focused tests and `npm run build` passed.
