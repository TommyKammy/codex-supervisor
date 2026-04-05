# Issue #1302: [codex] Auto-redact supervisor-owned durable journal leaks before publication and ready gates

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1302
- Branch: codex/issue-1302
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2707dee2b637facb32f133c4cfa22de29f291242
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-05T21:42:33.382Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: publication and ready-for-review gates should retry workstation-local path hygiene after redacting only supervisor-owned tracked issue journals.
- What changed: added a shared gate retry that normalizes tracked `.codex-supervisor/issues/*/issue-journal.md` files and the legacy shared journal before re-running path hygiene, plus focused publication and ready-promotion regressions for cross-issue `/Users/...` leaks.
- Current blocker: none.
- Next exact step: commit the gate/test changes, then open or update the draft PR if one is needed for issue #1302.
- Verification gap: none; targeted tests and `npm run build` passed locally.
- Files touched: src/workstation-local-path-gate.ts, src/turn-execution-publication-gate.test.ts, src/post-turn-pull-request.test.ts
- Rollback concern: the retry only redacts canonical supervisor-owned journal paths; if custom journal locations also need automatic cleanup this helper will need to expand deliberately.
- Last focused command: npx tsx --test src/journal.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts && npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
