# Issue #990: JSON corruption regression: preserve quarantine markers across normal saves until explicit reset

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/990
- Branch: codex/issue-990
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 1f164205eaf4301802f9a5395f1eebce26af8e6f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T11:29:32.916Z

## Latest Codex Summary
- Reproduced the regression with a focused `StateStore` test showing that an ordinary JSON `save()` after a quarantined load dropped both `json_state_quarantine` and the persisted `load_findings`.
- Narrowed the fix to `normalizeStateForSave()` so normal JSON saves preserve the existing quarantine marker and load findings until the explicit `reset-corrupt-json-state` path writes a clean empty state.
- Local verification passed for `npx tsx --test src/core/state-store.test.ts`, `npx tsx --test src/doctor.test.ts`, `npx tsx --test src/cli/supervisor-runtime.test.ts`, and `npm run build` after installing missing dev dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: ordinary JSON save normalization was treating the quarantine marker fields as disposable metadata, so any later normal `StateStore.save()` silently cleared the corrupt-state marker and its associated JSON parse finding without going through `reset-corrupt-json-state`.
- What changed: preserved `load_findings` and `json_state_quarantine` inside `normalizeStateForSave()` and added a focused regression in `src/core/state-store.test.ts` that quarantines invalid JSON, performs a normal save with a regular issue mutation, and asserts the persisted quarantine marker plus parse finding are still present afterward.
- Current blocker: none.
- Next exact step: commit the quarantine-persistence fix on `codex/issue-990` and open or update a draft PR if one does not already exist.
- Verification gap: none in the requested local scope after rerunning `npx tsx --test src/core/state-store.test.ts`, `npx tsx --test src/doctor.test.ts`, `npx tsx --test src/cli/supervisor-runtime.test.ts`, and `npm run build`.
- Files touched: `src/core/state-store.ts`, `src/core/state-store.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only widens normal JSON save serialization to keep already-loaded quarantine metadata and findings intact, while the explicit reset path still clears them by saving `emptyState()`.
- Last focused command: `npm run build`
- Exact failure reproduced: after loading a corrupt `state.json`, the new focused regression performed a normal `StateStore.save()` with a routine issue update and then observed `persisted.json_state_quarantine === undefined`; the failure was `Expected values to be strictly equal: + actual - expected + undefined - '/tmp/.../state.json'`.
- Commands run: `npx tsx --test src/core/state-store.test.ts --test-name-pattern "StateStore json save preserves quarantine markers after a quarantined load"`; `npx tsx --test src/core/state-store.test.ts`; `npx tsx --test src/doctor.test.ts`; `npx tsx --test src/cli/supervisor-runtime.test.ts`; `npm run build`; `npm install`; `npm run build`; `npx tsx --test src/core/state-store.test.ts`; `npm run build`.
- PR status: none.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
