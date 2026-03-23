# Issue #862: Stale recovery counter: add dedicated repetition tracking for stale stabilizing no-PR cleanup

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/862
- Branch: codex/issue-862
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=1, repair=3)
- Last head SHA: b45d12b3a08904f885d19d65e4654a3677c478b8
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T02:12:08Z

## Latest Codex Summary
Reformatted the unresolved review blob in [.codex-supervisor/issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-862/.codex-supervisor/issue-journal.md) into multi-line Markdown so the CodeRabbit entry no longer relies on the inline code-span pattern that triggered `MD038`. Confirmed the targeted lint output no longer reports `MD038`, committed the journal cleanup as `b45d12b`, pushed `codex/issue-862`, and resolved GitHub review thread `PRRT_kwDORgvdZ852BDOu`.

Focused verification passed: `npx markdownlint-cli2 .codex-supervisor/issue-journal.md 2>&1 | rg -n "MD038|no-space-in-code"` returned no matches. Full-file `markdownlint-cli2` still reports the journal's pre-existing style warnings outside this review fix. Local status is clean except for the pre-existing untracked `.codex-supervisor/replay/`.

Summary: Fixed the journal's inline review blob formatting, verified the MD038 warning no longer appears, pushed `b45d12b`, and resolved the remaining review thread on PR #867.
State hint: pr_open
Blocked reason: none
Tests: `npx markdownlint-cli2 .codex-supervisor/issue-journal.md 2>&1 | rg -n "MD038|no-space-in-code"`
Failure signature: none
Next action: Monitor PR #867 for any follow-up review or CI activity after the resolved thread and pushed head `b45d12b`.

## Active Failure Context
- Category: review
- Summary: No unresolved automated review threads remain after resolving `PRRT_kwDORgvdZ852BDOu`.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/867#discussion_r2972494600
- Details:
  - Rewrote the line-33 review blob as a multi-line Markdown block with fenced snippets and confirmed the targeted markdownlint output no longer reports `MD038`.

## Codex Working Notes
### Current Handoff
- Hypothesis: the only remaining risk was the journal's inline review blob formatting; now that the entry is multi-line and the targeted lint output is clear, the PR should be back to passive monitoring unless new review or CI activity appears.
- What changed: reformatted `.codex-supervisor/issue-journal.md` to eliminate the inline review blob that triggered `MD038`, committed the cleanup as `b45d12b`, pushed `codex/issue-862`, and resolved thread `PRRT_kwDORgvdZ852BDOu`.
- Current blocker: none
- Next exact step: monitor PR `#867` for any follow-up review or CI activity after the resolved thread and pushed head `b45d12b`.
- Verification gap: the targeted `MD038` check is clear; full-file `markdownlint-cli2` still reports the journal's pre-existing line-length, heading-spacing, bare-URL, and inline-HTML warnings outside the scope of this review fix.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: low; the change is limited to journal formatting and preserves the same review context with more stable Markdown structure.
- Last focused command: `gh api graphql -f query='mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved id } } }' -F threadId=PRRT_kwDORgvdZ852BDOu`
- Last focused failure: none
- Last focused commands:
```bash
sed -n '1,220p' "<local-memory>/issue-862/AGENTS.generated.md"
sed -n '1,220p' "<local-memory>/issue-862/context-index.md"
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
nl -ba .codex-supervisor/issue-journal.md | sed -n '24,60p'
git diff -- .codex-supervisor/issue-journal.md
rg -n "MD038|no-space-in-code|suggestion_start|getStaleStabilizingNoPrRecoveryCount" .codex-supervisor/issue-journal.md
apply_patch
nl -ba .codex-supervisor/issue-journal.md | sed -n '28,92p'
npx markdownlint-cli2 .codex-supervisor/issue-journal.md
npx markdownlint-cli2 .codex-supervisor/issue-journal.md 2>&1 | rg -n "MD038|no-space-in-code"
git diff -- .codex-supervisor/issue-journal.md
git add .codex-supervisor/issue-journal.md
git commit -m "Fix issue journal review markdown"
git rev-parse HEAD
git push origin codex/issue-862
gh api graphql -f query='mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved id } } }' -F threadId=PRRT_kwDORgvdZ852BDOu
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-23T02:12:08Z: committed the journal markdown cleanup as `b45d12b`, pushed `codex/issue-862`, and resolved GitHub review thread `PRRT_kwDORgvdZ852BDOu`.
- 2026-03-23T02:11:10Z: rewrote the unresolved `.codex-supervisor/issue-journal.md` review blob into multi-line Markdown, then confirmed `npx markdownlint-cli2 .codex-supervisor/issue-journal.md 2>&1 | rg -n "MD038|no-space-in-code"` returned no matches even though full-file markdownlint still reports pre-existing non-MD038 journal warnings.
- 2026-03-23T01:57:27Z: pushed review-fix commit `4c2e232` to `codex/issue-862` and resolved GitHub review thread `PRRT_kwDORgvdZ852A-pm` with `gh api graphql`.
- 2026-03-23T01:55:57Z: validated CodeRabbit thread `PRRT_kwDORgvdZ852A-pm` against the live branch, confirmed `getStaleStabilizingNoPrRecoveryCount` leaked `stale_stabilizing_no_pr_recovery_count` across unrelated failure signatures, then scoped the helper to the stale signature and passed `npx tsx --test src/no-pull-request-state.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-lifecycle.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`.
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
