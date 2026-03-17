# Issue #478: CodeRabbit draft-skip handling: record draft-skip review signals distinctly

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/478
- Branch: codex/issue-478
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-478
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-478/.codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: e7c417012debe2fa326367a32d199f7509480f91
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8502Hid|PRRT_kwDORgvdZ8502Hii
- Repeated failure signature count: 1
- Updated at: 2026-03-17T12:13:28Z

## Latest Codex Summary
Addressed both CodeRabbit review threads on PR [#481](https://github.com/TommyKammy/codex-supervisor/pull/481). `draftSkipAt` now ignores stale draft-skip issue comments once the configured bot has been removed later in the same request cycle, matching the existing rate-limit scoping, and the copied review-context links in this journal now use repository-relative markdown targets.

Focused verification passed on this repair: `npx tsx --test src/github/github-review-signals.test.ts src/github/github-pull-request-hydrator.test.ts` and `npm run build`. The code/test fix is committed as `e7c4170`; the only remaining workspace change is this journal update plus the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Repaired PR #481 review feedback for stale draft-skip inference and broken journal links.
State hint: local_review_fix
Blocked reason: none
Tests: `npx tsx --test src/github/github-review-signals.test.ts src/github/github-pull-request-hydrator.test.ts`; `npm run build`
Failure signature: none
Next action: Commit this journal refresh, push `codex/issue-478`, and monitor PR #481 CI plus thread resolution.

## Active Failure Context
- Category: review
- Summary: 2 automated review thread findings were fixed locally and are pending push/thread resolution.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/481#discussion_r2946322196
- Details:
  - .codex-supervisor/issue-journal.md:17 _⚠️ Potential issue_ | _🟡 Minor_ **Use repository-relative links instead of local absolute paths.** The markdown links on Line 17 point to `/home/...` paths, which will break for other contributors and in GitHub rendering. <details> <summary>🧰 Tools</summary> <details> <summary>🪛 LanguageTool</summary> [uncategorized] ~17-~17: The official name of this software platform is spelled with a capital "H". Context: ...unchanged. The main logic lives in [src/github/github-review-signals.ts](src/github/github-review-signals.ts) and [src/external-review/external-review-signal-heuristics.ts](src/external-review/external-review-signal-heuristics.ts); hydration now carries it onto [src/core/types.ts](src/core/types.ts) via [src/github/github-hydration.ts](src/github/github-hydration.ts). Focused coverage was added in [src/github/github-review-signals.test.ts](src/github/github-review-signals.test.ts) and [src/github/github-pull-request-hydrator.test.ts](src/github/github-pull-request-hydrator.test.ts). (GITHUB) </details> </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md at line 17, Replace the absolute /home/... paths in the markdown links on the reported line with repository-relative links pointing to the target files (e.g., src/github/github-review-signals.ts, src/external-review/external-review-signal-heuristics.ts, src/core/types.ts, src/github/github-hydration.ts, src/github/github-review-signals.test.ts, src/github/github-pull-request-hydrator.test.ts); edit the link targets so they are relative (like src/...) or prefixed with ./ as appropriate, keeping the link text unchanged and ensuring GitHub will resolve them correctly. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/github/github-review-signals.ts:503 _⚠️ Potential issue_ | _🟠 Major_ **Draft-skip inference can retain stale signals after request removal.** Unlike rate-limit inference, this path ignores per-bot `removed` events. A superseded draft-skip comment can still set `draftSkipAt`, which can misrepresent the current request cycle. <details> <summary>🐛 Proposed fix</summary> ```diff - const { activeRequestStartedAt } = summarizeConfiguredBotRequestWindow(facts.timeline, configuredReviewBots); + const { activeRequestStartedAt, latestRemovedByBot } = summarizeConfiguredBotRequestWindow( + facts.timeline, + configuredReviewBots, + ); const activeRequestStartedAtMs = parseTimestamp(activeRequestStartedAt); const scopedToActiveRequest = (value: string | null | undefined): value is string => value !== null && value !== undefined && (activeRequestStartedAt === null || parseTimestamp(value) >= activeRequestStartedAtMs); return latestTimestamp( facts.issueComments.flatMap((comment) => { const authorLogin = normalizeLogin(comment.authorLogin); + const latestRemovedAt = authorLogin ? latestRemovedByBot.get(authorLogin) ?? null : null; return authorLogin && configuredReviewBots.has(authorLogin) && isDraftSkipReviewText(comment.body) && - scopedToActiveRequest(comment.createdAt) + scopedToActiveRequest(comment.createdAt) && + (latestRemovedAt === null || parseTimestamp(comment.createdAt) > parseTimestamp(latestRemovedAt)) ? [comment.createdAt] : []; }), ); ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/github/github-review-signals.ts` around lines 487 - 503, The draft-skip timestamp calculation ignores per-bot removals and can therefore keep stale signals; update the filter that processes facts.issueComments (the block using normalizeLogin, configuredReviewBots and scopedToActiveRequest) to also verify the author bot was not removed at or before the comment timestamp: enhance configuredReviewBots (or use summarizeConfiguredBotRequestWindow) to expose per-bot removal/active windows and, for each comment, look up the bot's removal timestamp and reject the comment if comment.createdAt is <= bot.removedAt; ensure scopedToActiveRequest still applies but add this extra check so only comments from currently-active (not removed) configuredReviewBots contribute to draftSkipAt. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: CodeRabbit draft-skip issue comments were being treated as generic informational noise, so the configured-bot lifecycle could not distinguish “provider skipped because PR was draft” from “provider has not produced any meaningful signal yet.”
- What changed: Added the `draftSkipAt` signal for configured bots, then repaired the review follow-up so stale draft-skip issue comments are rejected after a later per-bot removal; the journal's copied review links were also rewritten to repository-relative targets.
- Current blocker: none
- Next exact step: Commit this journal refresh, push the repair commits to `origin/codex/issue-478`, and watch PR #481 CI before resolving the review threads.
- Verification gap: none locally; GitHub-side CI needs to rerun on the pushed repair commits.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/external-review/external-review-signal-heuristics.ts`, `src/github/github-review-signals.ts`, `src/github/github-review-signals.test.ts`, `src/github/github-hydration.ts`, `src/github/github-pull-request-hydrator.ts`, `src/github/github-pull-request-hydrator.test.ts`, `src/core/types.ts`
- Rollback concern: reverting this issue should remove only the distinct draft-skip field/heuristic; other configured-bot lifecycle and observation handling should remain unchanged.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproducing signature before the fix: required current-head CI completion metadata was absent from configured-bot hydration, so no stable `currentHeadCiGreenAt` value existed for later CodeRabbit provider-start wait logic.
- Focused derivation rule: use the latest completion timestamp among required current-head checks, but only when every required current-head check on the tracked head is already passing/skipping; otherwise leave the field null.
- Verification commands: `npx tsx --test src/supervisor/supervisor-status-review-bot.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm ci`; `npm run build`.
- Local failure resolved: `npm run build` initially failed with `sh: 1: tsc: not found` because this worktree was missing `node_modules`; `npm ci` restored the local toolchain and the acceptance build passed afterward.
- 2026-03-17: Focused reproducer was `inferStateFromPullRequest` returning `ready_to_merge` instead of `waiting_ci` when `currentHeadCiGreenAt=2026-03-13T02:05:00Z`, CodeRabbit was configured, and no `configuredBotCurrentHeadObservedAt` existed. The new initial grace wait covers that silent-provider window and hands off to the existing settled wait once `configuredBotCurrentHeadObservedAt` appears.
- 2026-03-17: Focused reproducer for this issue was the active status output omitting the configured wait length. Tightened tests expected `configured_wait_seconds=90` on `configured_bot_initial_grace_wait` and `configured_wait_seconds=5` on `configured_bot_settled_wait`; those failed before the status helper/assembly update and now pass.
- 2026-03-17: Focused reproducer for #478 was `buildConfiguredBotReviewSummary` returning only `{ lifecycle.state: "requested", arrivedAt: null }` for a CodeRabbit draft-skip issue comment, with no structured field distinguishing it from summary-only informational comments.
- 2026-03-17: Added `draftSkipAt` to configured-bot summaries and hydrated PRs; focused verification was `npx tsx --test src/github/github-review-signals.test.ts src/github/github-pull-request-hydrator.test.ts`, followed by `npm ci` and `npm run build`.
- 2026-03-17: Pushed `codex/issue-478` to `origin` and opened draft PR #481 (`https://github.com/TommyKammy/codex-supervisor/pull/481`) after confirming there was no existing PR for the branch.
- 2026-03-17: Review repair for PR #481 adds the same per-bot removal guard to `draftSkipAt` that rate-limit warnings already used, plus a regression test for stale draft-skip comments after request removal.
- 2026-03-17: Cleaned the copied review-context links in this journal so they use repository-relative markdown targets instead of local `/home/...` paths.
- 2026-03-17: Repair verification for the stale draft-skip fix was `npx tsx --test src/github/github-review-signals.test.ts src/github/github-pull-request-hydrator.test.ts` and `npm run build`, both passing before commit `e7c4170`.
