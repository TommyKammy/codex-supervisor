# Issue #926: Post-merge promotion candidates: surface shared-memory and guardrail suggestions from recurring patterns

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/926
- Branch: codex/issue-926
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: f43049f1222be02f076db6de85664316205dc7a2
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852Y1vo|PRRT_kwDORgvdZ852Y1vy|PRRT_kwDORgvdZ852Y1v7
- Repeated failure signature count: 1
- Updated at: 2026-03-24T11:22:58.998Z

## Latest Codex Summary
Addressed the three open CodeRabbit review threads on PR #943 in [src/supervisor/post-merge-audit-summary.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-926/src/supervisor/post-merge-audit-summary.ts) by bumping the summary schema version to `2`, deriving review-backed promotion candidate keys from the canonical pattern key so severity-distinct patterns stay unique, and preserving all review finding keys instead of truncating them before candidate generation.

I updated the focused summary assertions in [src/supervisor/post-merge-audit-summary.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-926/src/supervisor/post-merge-audit-summary.test.ts), added a regression that covers duplicate summaries across severities plus 4+ supporting finding keys, and bumped the CLI runtime DTO expectation in [src/supervisor/post-merge-audit-summary-runtime.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-926/src/supervisor/post-merge-audit-summary-runtime.test.ts).

Verification ran clean in this worktree:
- `npx tsx --test src/supervisor/post-merge-audit-summary.test.ts`
- `npx tsx --test src/supervisor/post-merge-audit-summary-runtime.test.ts`
- `npx tsx --test src/**/*.test.ts`
- `npm run build`

Local workspace still has untracked `.codex-supervisor/replay/`, which I left alone.

Summary: Fixed the three outstanding PR #943 review threads by versioning the summary DTO, making review-derived candidate keys severity-stable, and preserving full finding-key traceability with regression coverage.
State hint: addressing_review
Blocked reason: none
Tests: npx tsx --test src/supervisor/post-merge-audit-summary.test.ts; npx tsx --test src/supervisor/post-merge-audit-summary-runtime.test.ts; npx tsx --test src/**/*.test.ts; npm run build
Next action: Commit the review fixes, push `codex/issue-926`, and update PR #943.
Failure signature: none

## Active Failure Context
- Category: review
- Summary: Resolved locally; the three automated PR #943 review threads were addressed in code and tests.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/943#discussion_r2980798199
- Details:
  - Bumped `POST_MERGE_AUDIT_PATTERN_SUMMARY_SCHEMA_VERSION` to `2` and updated focused/runtime assertions so the new required `promotionCandidates` field is versioned correctly.
  - Switched review-derived `guardrail` and `shared_memory` candidate keys to `slugify(pattern.key)` so the severity embedded in the canonical pattern key prevents collisions.
  - Removed the `.slice(0, 3)` truncation on `exampleFindingKeys` and added a regression that proves 4 supporting finding keys survive into both `reviewPatterns` and `promotionCandidates`.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining PR #943 review risk was confined to DTO contract/versioning and traceability details rather than the overall promotion-candidate feature shape.
- What changed: bumped the post-merge audit summary schema version to `2`, made review-derived promotion candidate keys derive from the canonical severity-aware review pattern key, removed the premature truncation of review finding keys, and added focused regression coverage for duplicate summary/severity splits plus 4-key traceability.
- Current blocker: none.
- Next exact step: commit these review fixes, push `codex/issue-926`, and update PR #943 so the review threads can be resolved.
- Verification gap: none; focused tests, the full `src/**/*.test.ts` suite, and `npm run build` all passed after the review fixes.
- Files touched: `src/supervisor/post-merge-audit-summary.ts`, `src/supervisor/post-merge-audit-summary.test.ts`, `src/supervisor/post-merge-audit-summary-runtime.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; reverting would only remove a read-only analysis surface and leave the persisted audit artifacts intact.
- Last focused command: `npm run build`
- Last focused failure: none.
- Draft PR: #943 https://github.com/TommyKammy/codex-supervisor/pull/943
- Last focused commands:
```bash
git status --short
rg -n "POST_MERGE_AUDIT_PATTERN_SUMMARY_SCHEMA_VERSION|promotionCandidates|exampleFindingKeys|buildReviewPatternKey|guardrail:|shared_memory:" src/supervisor/post-merge-audit-summary.ts src/supervisor/post-merge-audit-summary.test.ts src/supervisor/post-merge-audit-summary-runtime.test.ts
sed -n '1,260p' src/supervisor/post-merge-audit-summary.ts
sed -n '1,340p' src/supervisor/post-merge-audit-summary.test.ts
sed -n '1,120p' src/supervisor/post-merge-audit-summary-runtime.test.ts
npx tsx --test src/supervisor/post-merge-audit-summary.test.ts
npx tsx --test src/supervisor/post-merge-audit-summary-runtime.test.ts
npx tsx --test src/**/*.test.ts
npm run build
date -u +"%Y-%m-%dT%H:%M:%SZ"
git status --short
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
