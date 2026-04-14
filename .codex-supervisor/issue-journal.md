# Issue #1500: Preserve the current Codex model config API while improving config UX

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1500
- Branch: codex/issue-1500
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: e052eda414aa8a9ac93a9c03176ad85267f7115c
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856sy5v|PRRT_kwDORgvdZ856sy5y|PRRT_kwDORgvdZ856sy50
- Repeated failure signature count: 1
- Updated at: 2026-04-14T03:14:12.949Z

## Latest Codex Summary
Added a read-only model-routing posture to first-run setup so operators can see the effective default, bounded-repair, and generic local-review routing without inspecting implementation code. The setup readiness path now fails closed when any `fixed` or `alias` strategy is missing its required model value, and the setup shell renders that posture directly. I also added focused docs recipes in [docs/configuration.md](docs/configuration.md) for inherited defaults, global fixed routing, bounded-repair overrides, and local-review overrides while keeping the existing authoritative config API unchanged.

Focused coverage was added in [src/setup-readiness.test.ts](src/setup-readiness.test.ts), [src/backend/webui-dashboard.test.ts](src/backend/webui-dashboard.test.ts), [src/backend/supervisor-http-server.test.ts](src/backend/supervisor-http-server.test.ts), and [src/config.test.ts](src/config.test.ts). I updated the issue journal and created checkpoint commit `e052eda` (`Improve Codex model routing setup posture`).

Summary: Added fail-closed setup model-routing posture reporting, surfaced it in the setup shell, documented copy-paste routing recipes, and committed the checkpoint as `e052eda`.
State hint: stabilizing
Blocked reason: none
Tests: `npx tsx --test src/setup-readiness.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts src/config.test.ts src/core/config-local-review-model-routing.test.ts`; `npm run build`
Next action: Push `codex/issue-1500` and open a draft PR for the committed checkpoint.
Failure signature: PRRT_kwDORgvdZ856sy5v|PRRT_kwDORgvdZ856sy5y|PRRT_kwDORgvdZ856sy50

## Active Failure Context
- Category: review
- Summary: 3 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1503#discussion_r3076937856
- Details:
  - .codex-supervisor/issue-journal.md:30 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Misleading risk characterization: fail-closed blocking is not "read-only".** The rollback concern is described as "Low" with justification th... url=https://github.com/TommyKammy/codex-supervisor/pull/1503#discussion_r3076937856
  - src/setup-readiness.ts:377 summary=_⚠️ Potential issue_ | _🟠 Major_ **Do not silently collapse unknown model strategies to `inherit`.** Line 377 treats any unrecognized raw value as if the route were inherited, ... url=https://github.com/TommyKammy/codex-supervisor/pull/1503#discussion_r3076937859
  - src/setup-readiness.ts:577 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Populate the blocker with the offending model field.** These blockers currently set `fieldKeys: []`, which means the setup shell renders them... url=https://github.com/TommyKammy/codex-supervisor/pull/1503#discussion_r3076937862

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining review gaps were in setup-readiness reporting, not the authoritative config API itself. Raw strategy typos still rendered like inherited routing, and missing-model blockers were not tied back to the concrete `*Model` config key in the UI.
- What changed: Setup readiness now preserves unsupported raw model strategy strings as invalid posture instead of collapsing them to `inherit`, and `buildBlockers` now fails closed both when a strategy is unsupported and when `target.missingExplicitModel` is true. Missing-model blockers now point at the offending `*Model` config field. Focused tests were added to cover both the unsupported-strategy path and the blocker field-key wiring.
- Current blocker: none
- Next exact step: Commit the review-fix checkpoint on `codex/issue-1500`, then push the branch and reply to the unresolved PR threads if requested.
- Verification gap: None locally after focused verification; PR threads remain unresolved on GitHub until the branch is pushed and the comments are answered or resolved.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/setup-readiness.ts`, `src/setup-readiness.test.ts`, `src/backend/setup-test-fixtures.ts`, `src/backend/supervisor-http-server.test.ts`
- Rollback concern: Moderate; setup now correctly fails closed for invalid model-routing configs that were previously under-reported, so existing deployments with mistyped or incomplete `fixed`/`alias` routing can now be blocked during setup until the config is corrected.
- Last focused command: `npx tsx --test src/setup-readiness.test.ts`
### Scratchpad
- Addressed review threads: preserve unsupported raw strategy strings in setup posture, point missing-model blockers at the relevant `*Model` key, and corrected the journal risk characterization.
- Keep this section short. The supervisor may compact older notes automatically.
