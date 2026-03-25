# Issue #995: Orphan cleanup config safety: replace ambiguous negative grace behavior with explicit validated semantics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/995
- Branch: codex/issue-995
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: 20e4ef677d9cd181835378b21267bd1a48f4e143
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852udeJ
- Repeated failure signature count: 1
- Updated at: 2026-03-25T13:53:39Z

## Latest Codex Summary
Corrected the issue journal handoff text so PR `#1013` consistently reflects the live GitHub state for branch `codex/issue-995`: the PR is ready, not draft, and the current merge state is `CLEAN`. The underlying orphan-grace validation fix remains the same head commit `20e4ef677d9cd181835378b21267bd1a48f4e143`.

I verified the metadata with `gh pr view 1013 --json isDraft,reviewDecision,mergeStateStatus,headRefOid,url` before editing [`issue-journal.md`](.codex-supervisor/issue-journal.md), so the review-fix wording matches the current PR instead of the stale earlier snapshot.

Summary: Corrected the journal's PR status wording to match live GitHub metadata for PR #1013 and preserved the existing orphan-grace fix context
State hint: local_review_fix
Blocked reason: none
Tests: not run; verified journal wording against live PR metadata with `gh pr view 1013 --json isDraft,reviewDecision,mergeStateStatus,headRefOid,url`
Next action: Commit the journal wording fix, push `codex/issue-995`, and resolve the remaining CodeRabbit thread if no new review signal appears
Failure signature: PRRT_kwDORgvdZ852udeJ

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1013#discussion_r2988385539
- Details:
  - .codex-supervisor/issue-journal.md:19 _⚠️ Potential issue_ | _🟡 Minor_ **Resolve contradictory PR state wording.** Line 19 says PR `#1013` is a **draft PR**, while Line 43 says **ready PR open**. Keep one status to avoid operator confusion during handoff. <details> <summary>Suggested edit</summary> ```diff -PR status: ready PR open at `https://github.com/TommyKammy/codex-supervisor/pull/1013`; current GitHub merge state is `UNSTABLE` immediately after the latest push and should settle once checks refresh. +PR status: draft PR open at `https://github.com/TommyKammy/codex-supervisor/pull/1013`; current GitHub merge state is `UNSTABLE` immediately after the latest push and should settle once checks refresh. ``` </details> Also applies to: 43-43 <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md at line 19, The document contains contradictory PR state wording for branch codex/issue-995 and PR `#1013` (one place says "draft PR" and another says "ready PR open"); pick the correct status and make both occurrences consistent—update the phrase (e.g., change "ready PR open" to "draft PR" or vice versa) wherever the PR is referenced in issue-journal.md and ensure the PR link and branch name remain unchanged so the entry is unambiguous for handoff. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining CodeRabbit finding is valid because the journal mixed stale PR-state snapshots; the correct live status is a ready PR with `mergeStateStatus=CLEAN`, not a draft PR or an `UNSTABLE` merge-state note.
- What changed: refreshed the journal wording for PR `#1013` after checking live GitHub metadata, while preserving the already-landed orphan-grace validation fix context from head `20e4ef677d9cd181835378b21267bd1a48f4e143`.
- Current blocker: none.
- Next exact step: commit this journal-only review fix, push the branch, and resolve review thread `PRRT_kwDORgvdZ852udeJ`.
- Verification gap: none for this docs-only review fix; live PR metadata was re-queried immediately before editing.
- Files touched: `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the behavior change is intentionally narrow to orphan-cleanup config validation and a defensive runtime assertion.
- Last focused command: `gh pr view 1013 --json isDraft,reviewDecision,mergeStateStatus,headRefOid,url`
- Exact failure reproduced: the journal had conflicting PR-state snapshots across turns; an earlier summary still described PR `#1013` as draft while the handoff line said ready, and the stale `UNSTABLE` merge-state wording no longer matched GitHub's current `CLEAN` status.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-995/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-995/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `rg -n "draft PR|ready PR open|PR status|isDraft|UNSTABLE|CLEAN" .codex-supervisor/issue-journal.md`; `gh pr view 1013 --json isDraft,reviewDecision,mergeStateStatus,headRefOid,url`; `git status --short --branch`; `git diff -- .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`
- PR status: ready PR open at `https://github.com/TommyKammy/codex-supervisor/pull/1013`; current GitHub metadata reports `isDraft=false` and `mergeStateStatus=CLEAN` on head `20e4ef677d9cd181835378b21267bd1a48f4e143`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
