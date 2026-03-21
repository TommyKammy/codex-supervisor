# Issue #786: Backend commands MVP: expose only existing safe supervisor mutations over HTTP

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/786
- Branch: codex/issue-786
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 2bea29c5c601c644af564601ec6465c1fa3daebf
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8515_nW
- Repeated failure signature count: 1
- Updated at: 2026-03-21T19:26:55.383Z

## Latest Codex Summary
Implemented the backend command MVP in [src/backend/supervisor-http-server.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-786/src/backend/supervisor-http-server.ts) by adding a strict `POST /api/commands/*` allowlist for `run-once`, `requeue`, `prune-orphaned-workspaces`, and `reset-corrupt-json-state`. Unknown commands stay fail-closed, non-`POST` command requests return `405`, malformed JSON returns `400`, and the existing service-layer DTOs are returned directly. `run-once` now returns a small structured JSON wrapper instead of a raw CLI string. I also added the narrow reproducer/verification in [src/backend/supervisor-http-server.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-786/src/backend/supervisor-http-server.test.ts) and updated the dashboard copy in [src/backend/webui-dashboard.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-786/src/backend/webui-dashboard.ts).

Verification passed with `npm ci`, `npx tsx --test src/backend/supervisor-http-server.test.ts`, `npx tsx --test src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`, and `npm run build`. I committed and pushed this as `c30c6ba` and `2bea29c`, and opened draft PR `#796`: https://github.com/TommyKammy/codex-supervisor/pull/796. The only remaining local dirt is the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Added safe supervisor HTTP command endpoints, focused backend tests, updated the journal, and opened draft PR #796
State hint: draft_pr
Blocked reason: none
Tests: `npm ci`; `npx tsx --test src/backend/supervisor-http-server.test.ts`; `npx tsx --test src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor draft PR #796 for review feedback and decide whether `run-once` should keep its lightweight HTTP wrapper or move to a shared DTO type

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/796#discussion_r2970028559
- Details:
  - src/backend/supervisor-http-server.test.ts:286 _⚠️ Potential issue_ | _🟡 Minor_ **Non-null assertion could cause runtime error if `args` is undefined.** Lines 267 and 277 use `args!.pruneCalls` and `args!.resetCalls` respectively. If `createStubService()` is called without arguments, these will throw a TypeError when accessing properties on `undefined`. <details> <summary>🐛 Proposed fix to handle undefined args</summary> ```diff pruneOrphanedWorkspaces: async () => { - args!.pruneCalls = (args?.pruneCalls ?? 0) + 1; + if (args) { + args.pruneCalls = (args.pruneCalls ?? 0) + 1; + } return { action: "prune-orphaned-workspaces", outcome: "completed", summary: "Pruned 0 orphaned workspaces.", pruned: [], skipped: [], }; }, resetCorruptJsonState: async () => { - args!.resetCalls = (args?.resetCalls ?? 0) + 1; + if (args) { + args.resetCalls = (args.resetCalls ?? 0) + 1; + } return { ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion pruneOrphanedWorkspaces: async () => { if (args) { args.pruneCalls = (args.pruneCalls ?? 0) + 1; } return { action: "prune-orphaned-workspaces", outcome: "completed", summary: "Pruned 0 orphaned workspaces.", pruned: [], skipped: [], }; }, resetCorruptJsonState: async () => { if (args) { args.resetCalls = (args.resetCalls ?? 0) + 1; } return { action: "reset-corrupt-json-state", outcome: "mutated", summary: "Reset corrupt JSON state.", stateFile: "/tmp/state.json", quarantinedFile: "/tmp/state.json.corrupt", quarantinedAt: "2026-03-22T00:00:00.000Z", }; }, ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/backend/supervisor-http-server.test.ts` around lines 266 - 286, The test stubs pruneOrphanedWorkspaces and resetCorruptJsonState use the non-null assertion args! which will throw if createStubService() is called with undefined; fix by ensuring a safe local args object (e.g., const localArgs = args ?? {} or initialize args if undefined) and increment localArgs.pruneCalls / localArgs.resetCalls (or assign back to args) instead of using args! so property access never occurs on undefined; update both pruneOrphanedWorkspaces and resetCorruptJsonState to use this guarded local variable and preserve the existing return objects. ``` </details> <!-- fingerprinting:phantom:medusa:ocelot --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining PR work is only review cleanup, and the current automated finding is valid because the test stub still uses `args!` in two optional-call counters.
- What changed: guarded the `pruneOrphanedWorkspaces` and `resetCorruptJsonState` stub counters in `src/backend/supervisor-http-server.test.ts` so `createStubService()` no longer throws when called without tracking args; preserved the existing DTO return objects and HTTP-surface behavior.
- Current blocker: none
- Next exact step: commit and push the guarded test-helper fix, then clear the remaining review thread on PR #796 if no further comments land.
- Verification gap: no known automated gap for this review fix; the focused backend HTTP test passed locally after the change.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.test.ts`
- Rollback concern: keep the HTTP command surface narrow and transport-level only; do not add loop control or any new mutation authority before the backend/UI MVP is stabilized.
- Last focused command: `npx tsx --test src/backend/supervisor-http-server.test.ts`
- Last focused failure: `PRRT_kwDORgvdZ8515_nW`
- Last focused commands:
```bash
npx tsx --test src/backend/supervisor-http-server.test.ts
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- `npm ci` was required locally because `npm run build` initially failed with `sh: 1: tsc: not found`.
- The new backend tests cover the intended allowlist and keep `loop` blocked at the HTTP layer with `404`.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/796
- Review fix on 2026-03-22: CodeRabbit thread `PRRT_kwDORgvdZ8515_nW` was valid; `createStubService()` could reach `args!` in the prune/reset stubs. Guarding those counters keeps the helper safe when called without tracking state.
- Updated at: 2026-03-22T00:00:00Z
