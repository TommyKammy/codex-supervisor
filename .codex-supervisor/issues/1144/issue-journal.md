# Issue #1144: Promote fail-closed persisted artifact identity validation before post-merge follow-up promotion

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1144
- Branch: codex/issue-1144
- Workspace: .
- Journal: .codex-supervisor/issues/1144/issue-journal.md
- Current phase: addressing_review
- Attempt count: 6 (implementation=2, repair=4)
- Last head SHA: dc73a6cbae7b4480523420663e683499ee070731
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ853aiEX|PRRT_kwDORgvdZ853aiEb
- Repeated failure signature count: 1
- Updated at: 2026-03-28T01:17:16Z

## Latest Codex Summary
Updated [issue-journal.md](.codex-supervisor/issues/1144/issue-journal.md#L36) to capitalize `GitHub/main` in the handoff text, which was the remaining valid CodeRabbit prose fix. I also re-checked the unresolved-count review comment against the current journal and confirmed that thread is stale because the journal no longer contains the previously addressed-entry mismatch it referenced.

No code paths changed in this turn, so I re-verified the journal text locally with `nl -ba .codex-supervisor/issues/1144/issue-journal.md | sed -n '1,140p'` and `rg -n "github/main|GitHub/main|unresolved automated review thread\\(s\\) remain|Addressed in commit" .codex-supervisor/issues/1144/issue-journal.md`. I have not resolved or replied to the GitHub review threads.

Summary: Fixed the remaining valid journal prose review comment and confirmed the unresolved-count comment is stale against the current file.
State hint: addressing_review
Blocked reason: none
Tests: not run (journal-only change); local text checks with `nl -ba .codex-supervisor/issues/1144/issue-journal.md | sed -n '1,140p'` and `rg -n "github/main|GitHub/main|unresolved automated review thread\\(s\\) remain|Addressed in commit" .codex-supervisor/issues/1144/issue-journal.md`
Next action: Commit and push the journal-only review fix, then resolve or reply to PR #1147's remaining review threads with note that the unresolved-count comment is stale.
Failure signature: PRRT_kwDORgvdZ853aiEX|PRRT_kwDORgvdZ853aiEb

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1147#discussion_r3003875176
- Details:
  - .codex-supervisor/issues/1144/issue-journal.md:35 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Clarify the count of unresolved review threads.** Line 30 states "2 unresolved automated review thread(s) remain," but line 33 shows one thre... url=https://github.com/TommyKammy/codex-supervisor/pull/1147#discussion_r3003875176
  - .codex-supervisor/issues/1144/issue-journal.md:39 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Use proper brand capitalization for GitHub.** The text contains `github/main` which should be `GitHub/main` to match the proper capitalizatio... url=https://github.com/TommyKammy/codex-supervisor/pull/1147#discussion_r3003875181

## Codex Working Notes
### Current Handoff
- Hypothesis: Persisted artifact promotion was too permissive. Runtime external-review history accepted malformed optional evidence fields, and post-merge audit summarization trusted embedded local-review identity without checking it against the merged context.
- What changed: Added reusable identity/evidence validation helpers, enforced fail-closed validation before promoting persisted external-review miss artifacts, skipped post-merge audit artifacts whose embedded local-review issue/PR/branch/head identity mismatches the authoritative merged context, added focused regression tests, documented the guardrail in `docs/local-review.md`, merged `GitHub/main` at `a5d6e16`, resolved the resulting conflicts in `src/supervisor/post-merge-audit-summary.ts` and `src/supervisor/post-merge-audit-summary.test.ts`, tightened `src/external-review/external-review-miss-artifact.ts` so durable-guardrail provenance `issueNumber` and `prNumber` must be positive integers before promotion, added production-call-shape coverage for promotability checks that omit `headSha`, and removed the stale `6ad7898` SHA reference from this journal handoff.
- Current blocker: none
- Next exact step: Commit the journal-only review fix, push the branch update, then resolve or reply to PR #1147's remaining automated review threads, noting that the unresolved-count comment is already stale against the current journal text.
- Verification gap: No code paths changed in this turn, so I only re-checked the journal text locally; the earlier focused external-review artifact/history tests, post-merge audit summary test, and `npm run build` remain the latest code verification for this issue.
- Files touched: .codex-supervisor/issues/1144/issue-journal.md; docs/local-review.md; src/persisted-artifact-promotion.ts; src/external-review/external-review-miss-artifact.ts; src/external-review/external-review-miss-artifact.test.ts; src/external-review/external-review-miss-history.ts; src/external-review/external-review-miss-history.test.ts; src/local-review/repair-context.ts; src/local-review/runner.ts; src/supervisor/post-merge-audit-summary.ts; src/supervisor/post-merge-audit-summary.test.ts; src/supervisor/supervisor-status-rendering.ts
- Rollback concern: Tightened validation now skips malformed or mismatched persisted artifacts instead of promoting them; if older artifacts relied on permissive parsing, operator-facing summaries may surface fewer historical runtime hints until those artifacts are regenerated.
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1144/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1144/context-index.md`; `sed -n '1,260p' .codex-supervisor/issues/1144/issue-journal.md`; `nl -ba .codex-supervisor/issues/1144/issue-journal.md | sed -n '1,140p'`; `rg -n "github/main|GitHub/main|unresolved automated review thread\\(s\\) remain|Addressed in commit" .codex-supervisor/issues/1144/issue-journal.md`
### Scratchpad
- 2026-03-28: Re-checked the two remaining CodeRabbit comments before editing. The unresolved-count complaint is stale because the current journal now lists two unresolved threads without any embedded "Addressed in commit" entry; only the `github/main` brand-capitalization comment still required a local change.
- Keep this section short. The supervisor may compact older notes automatically.
