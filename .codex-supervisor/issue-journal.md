# Issue #1500: Preserve the current Codex model config API while improving config UX

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1500
- Branch: codex/issue-1500
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=1)
- Last head SHA: f5656b5f4358c034ad5d56ec587f40cdfe462592
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856s4-L
- Repeated failure signature count: 1
- Updated at: 2026-04-14T03:28:52.792Z

## Latest Codex Summary
Updated `codex/issue-1500` and pushed commit `f5656b5` to PR `#1503`. The setup-readiness model-routing posture now preserves unsupported raw strategy strings as invalid instead of collapsing them to `inherit`, emits fail-closed blockers for those invalid strategies, and attaches missing-model blockers to the offending `*Model` config key so the setup UI no longer shows `Related fields: none` for that case. I also updated the issue journal wording to reflect the real rollback risk of fail-closed blocking rather than describing it as read-only reporting.

Focused coverage was added in [src/setup-readiness.test.ts](src/setup-readiness.test.ts), and the DTO fixture/test shapes were updated in [src/backend/setup-test-fixtures.ts](src/backend/setup-test-fixtures.ts) and [src/backend/supervisor-http-server.test.ts](src/backend/supervisor-http-server.test.ts). The journal was updated in [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md).

Summary: Preserved unsupported raw model strategy values as invalid in setup readiness, wired missing-model blockers to the correct config field, corrected the journal risk note, and pushed commit `f5656b5` to `codex/issue-1500`.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/setup-readiness.test.ts`; `npm run build`
Next action: Review PR `#1503` on GitHub against commit `f5656b5`, then reply to or resolve the remaining automated review threads if the updated diff is acceptable.
Failure signature: PRRT_kwDORgvdZ856s4-L

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1503#discussion_r3076971459
- Details:
  - src/setup-readiness.ts:493 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Differentiate “all overrides” from a true mixed posture.** The final branch handles every non-all-`inherit` case, so a config with three expl... url=https://github.com/TommyKammy/codex-supervisor/pull/1503#discussion_r3076971459

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining review gap was a posture-summary wording bug in setup readiness, not a config API problem. All-explicit per-target routing was still being summarized as "mixed" because the summary logic only distinguished "all inherit" from everything else.
- What changed: `buildModelRoutingPosture` now counts inherited targets so it can distinguish all-inherit, all-explicit, and genuinely mixed routing. A focused regression test now covers the all-explicit case without pinning unrelated overall setup readiness state.
- Current blocker: none
- Next exact step: Review PR `#1503` at commit `fb49342`, then resolve or reply to the remaining PR thread if requested.
- Verification gap: None locally after `npx tsx --test src/setup-readiness.test.ts` and `npm run build`; the remaining work is GitHub thread state, not local correctness.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/setup-readiness.ts`, `src/setup-readiness.test.ts`
- Rollback concern: Low; the code change only corrects the top-level setup-readiness posture copy for the already-supported all-explicit override case.
- Last focused command: `npm run build`
### Scratchpad
- Addressed review threads: preserve unsupported raw strategy strings in setup posture, point missing-model blockers at the relevant `*Model` key, and corrected the journal risk characterization.
- Addressed review thread: distinguish fully explicit model routing from genuinely mixed inherit-plus-override routing in setup readiness posture text.
- Pushed review-fix commit `fb49342` (`Clarify explicit model routing posture`) to `origin/codex/issue-1500`.
- Keep this section short. The supervisor may compact older notes automatically.
