# Issue #1011: Execution-safety docs guard: extend orphan-cleanup negative wording checks across every contract doc

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1011
- Branch: codex/issue-1011
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: a3241f328fb671cc730d553d7078ebc85ddff88d
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852zOan
- Repeated failure signature count: 1
- Updated at: 2026-03-25T18:06:45Z

## Latest Codex Summary
Addressed CodeRabbit review thread `PRRT_kwDORgvdZ852zOan` in [src/execution-safety-docs.test.ts](src/execution-safety-docs.test.ts) by broadening the forbidden orphan-pruning wording regex to catch `automatic/background -> prune -> orphan` and `prune -> automatic -> orphan` permutations. I also added explicit sample assertions so phrases like `automatically prune orphaned workspaces` are covered directly instead of only indirectly through the live docs.

Focused verification passed locally for the requested commands: `npx tsx --test src/execution-safety-docs.test.ts` and `npm run build`. The worktree still has untracked supervisor-local artifacts under `.codex-supervisor/pre-merge/` and `.codex-supervisor/replay/`, left untouched.

Summary: Expanded the orphan-pruning negative wording guard for the missing phrasing orders and added direct regression samples
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/execution-safety-docs.test.ts`; `npm run build`
Next action: Commit and push the review fix to PR `#1029`, then re-check the thread/CI state
Failure signature: PRRT_kwDORgvdZ852zOan

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1029#discussion_r2990050663
- Details:
  - src/execution-safety-docs.test.ts:141 _⚠️ Potential issue_ | _🟠 Major_ **Negative-wording regex still misses valid drift phrasings.** The added guard does not catch wording like **“automatically prune orphaned workspaces”** (`automatic -> prune -> orphan` order), so some regressions can still pass. <details> <summary>Suggested minimal regex expansion</summary> ```diff assert.doesNotMatch( content, - /automatic orphan(?:ed)? [^.]{0,40}prun|orphan(?:ed)? [^.]{0,40}automatic(?:ally)? [^.]{0,40}prun|background orphan(?:ed)? [^.]{0,40}prun/i, + /automatic orphan(?:ed)? [^.]{0,40}prun|orphan(?:ed)? [^.]{0,40}automatic(?:ally)? [^.]{0,40}prun|background orphan(?:ed)? [^.]{0,40}prun|automatic(?:ally)? [^.]{0,40}prun[^.]{0,40}orphan(?:ed)?|background [^.]{0,40}prun[^.]{0,40}orphan(?:ed)?/i, `expected ${label} to reject automatic/background orphan pruning wording`, ); ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion assert.doesNotMatch( content, /automatic orphan(?:ed)? [^.]{0,40}prun|orphan(?:ed)? [^.]{0,40}automatic(?:ally)? [^.]{0,40}prun|background orphan(?:ed)? [^.]{0,40}prun|automatic(?:ally)? [^.]{0,40}prun[^.]{0,40}orphan(?:ed)?|background [^.]{0,40}prun[^.]{0,40}orphan(?:ed)?/i, `expected ${label} to reject automatic/background orphan pruning wording`, ); ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/execution-safety-docs.test.ts` around lines 137 - 141, The negative-wording regex in the assert.doesNotMatch check (using variables content and label) misses permutations such as "automatically prune orphaned workspaces"; update the pattern used in assert.doesNotMatch to also match sequences where "automatic/automatically" appears before "prun(e)" and "orphan(ed)" (e.g., add an alternative like automatic(?:ally)? [^.]{0,40}prun(?:e)? [^.]{0,40}orphan(?:ed)? and similarly cover prune -> automatic -> orphan order) so the test rejects those phrasings as well. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the broader doc coverage from the earlier fix was correct, but the shared negative-wording regex still allowed drift phrasings where `automatic/background` appeared before `prune` and `orphan`, so the contract could regress without tripping the test.
- What changed: extracted the forbidden orphan-pruning wording regex into a shared constant, expanded it to cover `automatically/background prune orphaned ...` and `prune ... automatically ... orphaned` orders, and added direct sample assertions before the contract-doc loop.
- Current blocker: none locally.
- Next exact step: commit and push the review fix to `codex/issue-1011`, then confirm PR `#1029` reflects the new head.
- Verification gap: none for the requested local commands after installing dependencies.
- Files touched: `src/execution-safety-docs.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only tightens doc-contract tests and does not affect runtime behavior.
- Last focused command: `npm run build`
- Exact failure reproduced: the regex in `src/execution-safety-docs.test.ts` did not match `automatically prune orphaned workspaces` or `background prune orphaned workspaces`; a direct `node` check confirmed both samples returned `false` before the fix.
- Commands run: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' <redacted-local-path>`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `nl -ba src/execution-safety-docs.test.ts | sed -n '120,170p'`; `node - <<'NODE' ... NODE`; `git diff -- src/execution-safety-docs.test.ts`; `sed -n '1,220p' src/execution-safety-docs.test.ts`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `npx tsx --test src/execution-safety-docs.test.ts`; `npm run build`; `git diff -- src/execution-safety-docs.test.ts .codex-supervisor/issue-journal.md`.
- PR status: draft PR `#1029` is open at `https://github.com/TommyKammy/codex-supervisor/pull/1029`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
