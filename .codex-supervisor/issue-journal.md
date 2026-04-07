# Issue #1322: [codex] Keep local review disabled by default but opinionated when enabled

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1322
- Branch: codex/issue-1322
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: e5b04812832912bd5796f7aa9013fc00a339cc59
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-07T01:09:49.465Z

## Latest Codex Summary
- Reproduced the default-posture drift with a focused config test: `loadConfig` still defaulted `localReviewPolicy` to `block_ready` even though the shipped starter profiles already recommended `block_merge` with local review disabled. Fixed the parser default in `src/core/config.ts`, added coverage in `src/config.test.ts` for both the runtime defaults and the shipped starter configs, and updated the docs to distinguish the safe disabled-by-default posture from the recommended once-enabled baseline.

- Focused verification passed with `npx tsx --test src/config.test.ts`, and `npm run build` completed successfully. The change stays scoped to config defaults and docs; local-review runtime behavior was not redesigned.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the only product-default drift is in config parsing and docs wording, not in local-review execution itself.
- What changed: changed the fallback `localReviewPolicy` default from `block_ready` to `block_merge`; added focused tests for the disabled-by-default plus opinionated-enabled baseline and for starter-profile `localReviewEnabled: false`; updated `docs/local-review.md`, `docs/getting-started.md`, `docs/configuration.md`, and `docs/examples/atlaspm.md` to make the disabled-vs-enabled distinction explicit.
- Current blocker: none.
- Next exact step: commit the verified changes on `codex/issue-1322`, then open or update a draft PR if needed.
- Verification gap: did not run the full test suite beyond `src/config.test.ts` and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/core/config.ts`, `src/config.test.ts`, `docs/configuration.md`, `docs/getting-started.md`, `docs/local-review.md`, `docs/examples/atlaspm.md`.
- Rollback concern: low; the runtime change is a default-only policy alignment, and local review remains disabled unless operators explicitly enable it.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
