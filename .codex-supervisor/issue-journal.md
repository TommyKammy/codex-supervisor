# Issue #1082: Bound full issue inventory refresh cadence and reuse recent inventory results

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1082
- Branch: codex/issue-1082
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 722f1a44416a93d5a9a46580ef18c684029fd0f6
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ853GE78
- Repeated failure signature count: 1
- Updated at: 2026-03-26T17:56:13.357Z

## Latest Codex Summary
Published the current checkpoint to draft PR [#1088](https://github.com/TommyKammy/codex-supervisor/pull/1088) on `codex/issue-1082`. The branch now contains the loop-scoped full issue inventory cache commit `84e8627` plus the journal handoff update `722f1a4`, and focused verification still passes on the pushed head.

I left the existing untracked supervisor runtime artifacts under `.codex-supervisor/` alone. The remaining review question is still whether the fixed 5-minute TTL should stay hard-coded or become config-derived; no failing behavior showed up locally.

Summary: Pushed the bounded loop inventory cache checkpoint, opened draft PR #1088, reran focused tests and build, and updated the issue journal on branch `codex/issue-1082`
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test --test-name-pattern "listLoopIssueInventory" src/supervisor/supervisor.test.ts`; `npx tsx --test src/supervisor/supervisor.test.ts`; `npm run build`
Next action: Review PR #1088 and decide whether the 5 minute inventory reuse TTL should remain fixed or be derived from config
Failure signature: PRRT_kwDORgvdZ853GE78

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1088#discussion_r2996706858
- Details:
  - .codex-supervisor/issue-journal.md:25 _⚠️ Potential issue_ | _🟡 Minor_ **Hyphenate “5-minute” in prose.** Use “5-minute TTL” for the two prose mentions to match standard compound-modifier style. <details> <summary>✏️ Proposed wording fix</summary> ```diff -Next action: Decide whether the 5 minute TTL should stay fixed or become config-derived, then open or update the PR +Next action: Decide whether the 5-minute TTL should stay fixed or become config-derived, then open or update the PR ... -- Next exact step: review whether the fixed 5 minute TTL should stay hard-coded or be config-derived, then either keep the current draft PR moving or apply the smallest follow-up change needed for review. +- Next exact step: review whether the fixed 5-minute TTL should stay hard-coded or be config-derived, then either keep the current draft PR moving or apply the smallest follow-up change needed for review. ``` </details> Also applies to: 36-36 <details> <summary>🧰 Tools</summary> <details> <summary>🪛 LanguageTool</summary> [grammar] ~25-~25: Use a hyphen to join words. Context: ...build` Next action: Decide whether the 5 minute TTL should stay fixed or become c... (QB_NEW_EN_HYPHEN) </details> </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md at line 25, Update the two prose occurrences of the phrase "5 minute TTL" to use the hyphenated compound modifier "5-minute TTL" (e.g., change the sentence starting "Next action: Decide whether the 5 minute TTL..." and the other occurrence of "5 minute TTL") so both reads use "5-minute TTL" for consistent, standard compound-modifier style. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the avoidable API pressure comes from `Supervisor.startRunOnceCycle()` always routing the prelude through a fresh `github.listAllIssues()` call, so a supervisor-local cache with a bounded TTL should reduce repeated full inventory reads without changing the loop’s correctness gates.
- What changed: added `listLoopIssueInventory()` in `src/supervisor/supervisor.ts`, cached successful full inventory reads for 5 minutes, invalidated the cache on refresh failure, and wired only the loop prelude’s `listAllIssues` path through that helper. Added focused tests in `src/supervisor/supervisor.test.ts` that verify reuse at `2026-03-20T00:04:59Z` after an initial fetch at `2026-03-20T00:00:00Z`, and verify a refresh occurs again at `2026-03-20T00:05:01Z`. Pushed the branch and opened draft PR #1088.
- Current blocker: none locally.
- Next exact step: commit and push the journal-only `5-minute TTL` wording fix, then resolve the remaining CodeRabbit thread if GitHub accepts the review-thread mutation.
- Verification gap: I did not run the entire suite because `npm test -- <file>` expands to the repo-wide test glob here; verification so far is the focused supervisor cache tests plus a full TypeScript build.
- Files touched: `src/supervisor/supervisor.ts`; `src/supervisor/supervisor.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: moderate. A too-long TTL would delay reconciliation of full-inventory-only state changes, so the remaining review question is whether 5 minutes is the right fixed bound.
- Last focused command: `git diff -- .codex-supervisor/issue-journal.md`
- What changed this turn: reread the required memory files and current journal, verified the CodeRabbit finding against the live `.codex-supervisor/issue-journal.md` contents, and fixed the two prose mentions to use `5-minute TTL` without changing the quoted review payload.
- Exact failure reproduced this turn: the wording issue was present locally in the journal prose at the summary paragraph and the current-handoff next-step line; no code or test failure reproduced.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1082/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1082/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short`; `rg -n "5 minute TTL|5-minute TTL" .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git diff -- .codex-supervisor/issue-journal.md`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
