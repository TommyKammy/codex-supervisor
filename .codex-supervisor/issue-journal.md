# Issue #993: Orphan cleanup contract: define explicit operator vs background cleanup semantics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/993
- Branch: codex/issue-993
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 593fb9be0676ae8df2dca2ac0ae05252d705b165
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852tcfC
- Repeated failure signature count: 1
- Updated at: 2026-03-25T12:58:06.650Z

## Latest Codex Summary
Defined the orphan-cleanup contract in code, tests, and docs. `runOnce` no longer prunes orphaned worktrees in the background from [src/recovery-reconciliation.ts](src/recovery-reconciliation.ts); explicit orphan cleanup stays on `prune-orphaned-workspaces`, and I added focused coverage in [src/supervisor/supervisor-execution-cleanup.test.ts](src/supervisor/supervisor-execution-cleanup.test.ts) showing that `runOnce` preserves orphans while still cleaning tracked done workspaces. I also tightened the docs contract in [docs/configuration.md](docs/configuration.md), [docs/getting-started.md](docs/getting-started.md), [docs/architecture.md](docs/architecture.md), plus the docs guard in [src/execution-safety-docs.test.ts](src/execution-safety-docs.test.ts).

I restored missing dev dependencies with `npm install`, committed the work as `15d8af3` and `593fb9b`, pushed `codex/issue-993`, and opened draft PR #998: https://github.com/TommyKammy/codex-supervisor/pull/998. `npm run build` passes. The broad `npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts` run still reports two unrelated pre-existing failures in merged-PR reconciliation coverage, which I recorded in the journal at [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md).

Summary: Removed background orphan pruning from `runOnce`, codified explicit operator-only orphan cleanup semantics, updated focused tests/docs, pushed commits, and opened draft PR #998.
State hint: draft_pr
Blocked reason: none
Tests: `npm install`; `npx tsx --test src/execution-safety-docs.test.ts`; `npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts` (two unrelated pre-existing failures remain); `npm run build`
Next action: Review PR #998 and decide whether the unrelated merged-PR reconciliation test failures should be handled in a follow-up or investigated before merge.
Failure signature: PRRT_kwDORgvdZ852tcfC

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/998#discussion_r2988030281
- Details:
  - docs/configuration.md:126 _⚠️ Potential issue_ | _🟠 Major_ **Define how an orphan is marked as “intentionally kept.”** The explicit prune path in `src/recovery-reconciliation.ts` only skips `locked`, `recent`, and `unsafe_target` candidates; there is no separate “manually kept” state. As written, this reads like `prune-orphaned-workspaces` will preserve operator-kept orphans automatically, but an otherwise eligible orphan would still be deleted. Please either document the concrete opt-out mechanism or remove that preservation guarantee so the contract stays unambiguous. <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@docs/configuration.md` at line 126, The docs claim orphan workspaces can be "intentionally kept" but the actual prune path in src/recovery-reconciliation.ts only skips candidates with the flags 'locked', 'recent', or 'unsafe_target' when the prune-orphaned-workspaces action runs; there is no separate "manually kept" state. Fix by either removing the "intentionally kept" wording from the configuration doc or explicitly documenting the concrete opt-out mechanism: state that only candidates marked as 'locked', recently touched (per cleanupOrphanedWorkspacesAfterHours), or flagged as 'unsafe_target' are preserved, and reference those exact symbols ('locked', 'recent', 'unsafe_target', cleanupOrphanedWorkspacesAfterHours, prune-orphaned-workspaces) so the contract is unambiguous. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: orphan cleanup should stay explicit operator work only, and the docs must describe the exact explicit-prune preserve states that the runtime already enforces: `locked`, `recent`, and `unsafe_target`, with no separate manual-keep marker.
- What changed: verified the CodeRabbit finding against `inspectOrphanedWorkspacePruneCandidates()` / `pruneOrphanedWorkspacesForOperator()`, then replaced the stale "manually/intentionally kept" wording in `README.md`, `docs/configuration.md`, `docs/getting-started.md`, and `docs/architecture.md` with the exact preserve-state contract. Tightened `src/execution-safety-docs.test.ts` so the docs guard now requires `locked`, `recent`, `unsafe_target`, plus the explicit `cleanupOrphanedWorkspacesAfterHours` and `prune-orphaned-workspaces` contract in `docs/configuration.md`.
- Current blocker: none.
- Next exact step: commit and push the review-fix patch for PR #998, then resolve/respond to the CodeRabbit thread if no other review feedback appears.
- Verification gap: the review-fix slice is covered by `npx tsx --test src/execution-safety-docs.test.ts` and `npm run build`, both green. The broader `npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts` suite still has the same two unrelated merged-PR reconciliation failures recorded earlier (`runOnce releases the current issue lock before restarting after a merged PR` and `runOnce reconciles inactive merging records whose tracked PR already merged`).
- Files touched: `README.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-execution-cleanup.test.ts`, `src/execution-safety-docs.test.ts`, `docs/configuration.md`, `docs/getting-started.md`, `docs/architecture.md`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the runtime change only stops background orphan pruning from happening during `runOnce`, while the explicit `prune-orphaned-workspaces` path and tracked done-workspace cleanup remain intact.
- Last focused command: `npm run build`
- Exact failure reproduced: the runtime never had an "intentionally kept" orphan state, but the docs still claimed one. The explicit prune path only skips candidates classified as `locked`, `recent`, or `unsafe_target`, so the contract was ambiguous until the docs were narrowed to those exact states.
- Commands run: `rg -n "prune-orphaned-workspaces|locked|recent|unsafe_target|cleanupOrphanedWorkspacesAfterHours|intentionally kept|orphan" src/recovery-reconciliation.ts docs/configuration.md src/execution-safety-docs.test.ts`; `sed -n '160,470p' src/recovery-reconciliation.ts`; `sed -n '100,170p' src/execution-safety-docs.test.ts`; `rg -n "manual(?:ly)? kept|intentionally kept|locked|recent|unsafe_target|cleanupOrphanedWorkspacesAfterHours|prune-orphaned-workspaces" README.md docs src/execution-safety-docs.test.ts`; `npx tsx --test src/execution-safety-docs.test.ts`; `npm run build`.
- PR status: draft PR opened at `https://github.com/TommyKammy/codex-supervisor/pull/998`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
