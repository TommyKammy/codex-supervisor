# Issue #862: Stale recovery counter: add dedicated repetition tracking for stale stabilizing no-PR cleanup

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/862
- Branch: codex/issue-862
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: 3e205726c49bf624137f5a7a9ffa657545843cec
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852BDOu
- Repeated failure signature count: 1
- Updated at: 2026-03-23T02:09:06.690Z

## Latest Codex Summary
Updated [src/no-pull-request-state.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-862/src/no-pull-request-state.ts) so the dedicated stale no-PR recovery counter is only visible when `last_failure_signature` is `STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE`; unrelated no-PR failures now cannot inherit stale-only retry budget. Added a regression in [src/no-pull-request-state.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-862/src/no-pull-request-state.test.ts) for that leak case, updated the issue journal, pushed commits `4c2e232` and `3e20572` to `codex/issue-862`, and resolved GitHub review thread `PRRT_kwDORgvdZ852A-pm`.

Focused verification passed: `npx tsx --test src/no-pull-request-state.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-lifecycle.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`. Local status is clean except for the pre-existing untracked `.codex-supervisor/replay/`.

Summary: Scoped the stale no-PR recovery counter to the stale failure signature, added a regression test, pushed the fix, and resolved the outstanding review thread.
State hint: pr_open
Blocked reason: none
Tests: `npx tsx --test src/no-pull-request-state.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-lifecycle.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`
Failure signature: none
Next action: Monitor PR #867 for any follow-up review or CI activity after the resolved thread and pushed head `3e20572`.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/867#discussion_r2972494600
- Details:
  - .codex-supervisor/issue-journal.md:33 _⚠️ Potential issue_ | _🟡 Minor_ **Fix markdownlint MD038 on the inline review blob.**
    Line 33 has markdown formatting that likely introduces spaces inside code span elements. Normalize the inline code spans, or split this into multi-line markdown blocks, to clear lint warnings.

    <details>
    <summary>Suggested cleanup shape</summary>

    ```diff
    - - src/no-pull-request-state.ts:17 _⚠️ Potential issue_ | _🟠 Major_ **Scope ...** ...
    - ```diff
    - export function ...
    - ```
    + - src/no-pull-request-state.ts:17 _⚠️ Potential issue_ | _🟠 Major_ **Scope ...**
    +
    + <details>
    + <summary>Suggested fix</summary>
    +
    + ```diff
    + export function getStaleStabilizingNoPrRecoveryCount(
    + ...
    + )
    + ```
    + </details>
    ```

    </details>
    <!-- suggestion_start -->
    <details>
    <summary>📝 Committable suggestion</summary>

    > ‼️ **IMPORTANT**
    > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test and benchmark the code to ensure it meets the requirements.

    ```suggestion
    - src/no-pull-request-state.ts:17 _⚠️ Potential issue_ | _🟠 Major_ **Scope the dedicated stale counter to the stale signature before returning it.**
    <details>
    <summary>Suggested fix</summary>
    ```

    </details>
    <!-- suggestion_end -->
    <details>
    <summary>🧰 Tools</summary>

    <details>
    <summary>🪛 markdownlint-cli2 (0.21.0)</summary>

    [warning] 33-33: Spaces inside code span elements (MD038, no-space-in-code)

    </details>
    </details>
    <details>
    <summary>🤖 Prompt for AI Agents</summary>

    ```text
    Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md at line 33, the markdown lint MD038 is triggered by inline code spans containing spaces in the review blob around the suggested fix for getStaleStabilizingNoPrRecoveryCount; fix the markdown by normalizing those inline code spans (remove stray spaces inside backticks) or convert the long suggested diff into a fenced code block so elements like getStaleStabilizingNoPrRecoveryCount, STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE, stale_stabilizing_no_pr_recovery_count, last_failure_signature, and repeated_failure_signature_count appear as proper code without internal spaces; update the inline <details>/<summary> section accordingly to eliminate the MD038 warning.
    ```

    </details>
    <!-- fingerprinting:phantom:triton:hawk -->
    <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining unresolved review thread is documentation-only; expanding the inline review blob in `.codex-supervisor/issue-journal.md` into normal multi-line Markdown should eliminate the reported `MD038` code-span warning without changing supervisor behavior.
- What changed: rewrote the Active Failure Context entry for thread `PRRT_kwDORgvdZ852BDOu` as a multi-line block with fenced snippets and details sections, so the review blob no longer packs pseudo-code spans onto one list line.
- Current blocker: none
- Next exact step: commit the journal-formatting cleanup, push `codex/issue-862`, and resolve thread `PRRT_kwDORgvdZ852BDOu` if GitHub still shows it as open on the updated head.
- Verification gap: the targeted `MD038` check is clear; full-file `markdownlint-cli2` still reports the journal's pre-existing line-length, heading-spacing, bare-URL, and inline-HTML warnings outside the scope of this review fix.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: low; the change is limited to journal formatting and preserves the same review context with more stable Markdown structure.
- Last focused command: `npx markdownlint-cli2 .codex-supervisor/issue-journal.md 2>&1 | rg -n "MD038|no-space-in-code"`
- Last focused failure: `PRRT_kwDORgvdZ852BDOu`
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
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
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
