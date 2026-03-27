# Issue #1102: Publish gate: refuse supervisor-managed publication when durable artifacts fail path hygiene

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1102
- Branch: codex/issue-1102
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 8eca00284aee1aeb1ccc380f92ae11306e98c4ea
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ853Nni2|PRRT_kwDORgvdZ853Nni_
- Repeated failure signature count: 1
- Updated at: 2026-03-27T07:09:48.974Z

## Latest Codex Summary
Implemented the publication path-hygiene gate checkpoint, fixed the follow-up `verify:paths` regressions caused by tracked literal path fixtures, merged `github/main`, and cleaned the branch back to a reviewable state. Draft PR is open at https://github.com/TommyKammy/codex-supervisor/pull/1107 on head `8eca002`, and the local worktree is clean.

The merged branch also needed one policy-alignment fix from `main`: `src/backend/webui-dashboard.test.ts` is back in `DEFAULT_EXCLUDED_PATHS` in [`src/workstation-local-paths.ts`](src/workstation-local-paths.ts), which keeps the shared detector aligned with the merged detector regression. The issue journal was updated in [`.codex-supervisor/issue-journal.md`](.codex-supervisor/issue-journal.md).

Summary: Added the supervisor publication path-hygiene gate, fixed tracked fixture/journal leaks so the checkpoint passes `verify:paths`, merged `github/main`, and republished draft PR `#1107` on clean head `8eca002`
State hint: draft_pr
Blocked reason: none
Tests: `npm ci`; `npm run verify:paths`; `npx tsx --test src/workstation-local-path-detector.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts src/backend/webui-dashboard.test.ts src/ci-workflow.test.ts src/committed-guardrails.test.ts`; `npm run build`
Next action: watch draft PR `#1107` for CI on head `8eca002` and address any reported check or review failures
Failure signature: PRRT_kwDORgvdZ853Nni2|PRRT_kwDORgvdZ853Nni_

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1107#discussion_r2999366100
- Details:
  - src/run-once-issue-preparation.test.ts:865 _⚠️ Potential issue_ | _🟡 Minor_ **Avoid order-dependent assertions on failure details.** Asserting only `details[0]` makes this test brittle if finding order changes. Assert presence across the whole array instead. <details> <summary>💡 Suggested test hardening</summary> ```diff - assert.match(state.issues["240"]?.last_failure_context?.details[0] ?? "", /docs\/guide\.md:1/); - assert.match(state.issues["240"]?.last_failure_context?.details[0] ?? "", /\/home\/alice\/dev\/private-repo/); + const details = state.issues["240"]?.last_failure_context?.details ?? []; + assert.ok(details.some((entry) => /docs\/guide\.md:1/.test(entry))); + assert.ok(details.some((entry) => /\/home\/alice\/dev\/private-repo/.test(entry))); ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion const details = state.issues["240"]?.last_failure_context?.details ?? []; assert.ok(details.some((entry) => /docs\/guide\.md:1/.test(entry))); assert.ok(details.some((entry) => /\/home\/alice\/dev\/private-repo/.test(entry))); ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/run-once-issue-preparation.test.ts` around lines 864 - 865, The two brittle assertions target details[0] directly; instead ensure the regex is found anywhere in the details array for state.issues["240"]?.last_failure_context?.details by checking the whole array (e.g., join the array or use an any/some check) so order changes won't break the test; update the two assertions to search across state.issues["240"].last_failure_context.details rather than indexing details[0]. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/run-once-issue-preparation.ts:282 _⚠️ Potential issue_ | _🟠 Major_ **Move the hygiene gate ahead of the pre-resolution `pushBranch()` path.** Line 286 can still publish a local-ahead branch before this new guard runs, so the `remoteAhead > 0` catch-up path leaks forbidden paths to the remote and only fails afterward. Please gate any supervisor-managed `pushBranch()` before it happens, not just the later draft-PR creation branch. A regression around `remoteAhead > 0` with no open PR would catch this. Also applies to: 430-455 <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/run-once-issue-preparation.ts` around lines 281 - 282, The hygiene gate (runWorkstationLocalPathGateImpl / the supervisor-managed gate) must run before any call to pushBranch() so we never publish a local-ahead branch and then fail later; move or add a guard that invokes runWorkstationLocalPathGateImpl (or checks its boolean/throwing result) immediately before the pre-resolution pushBranch() path (the pushBranch call near the earlier publish) and likewise before the draft-PR creation pushBranch() sequence in the 430-455 region; ensure the gate short-circuits/throws before calling pushBranch() when remoteAhead > 0 or other forbidden conditions are detected. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: supervisor-managed publication should fail closed at the publish/update seams whenever tracked durable artifacts still contain forbidden workstation-local absolute paths, and the checkpoint itself must remain publishable under the same `verify:paths` rule.
- What changed: moved the workstation-local path gate into a shared `before publication` helper in `src/run-once-issue-preparation.ts` so the `remoteAhead > 0` catch-up `pushBranch()` path is blocked before any supervisor-managed publication, kept the draft-PR publication gate on the same helper, added a regression test for the remote-ahead path, and hardened the failure-detail assertion to search across the full details array.
- Current blocker: none locally.
- Next exact step: commit and push the review-fix patch to PR `#1107`, then monitor CI and clear the addressed review threads.
- Verification gap: no full supervisor end-to-end `runOnce` exercise yet; this turn covered the preparation/publish-gate suites, `verify:paths`, and `build`.
- Files touched: `src/run-once-issue-preparation.ts`; `src/run-once-issue-preparation.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The change is scoped to supervisor-managed publication gates and reuses the existing tracked-file detector instead of widening unrelated retry or scheduling behavior.
- Last focused command: `npm run build`
- What changed this turn: verified both CodeRabbit findings against the current head, moved the publication path-hygiene gate ahead of the early remote-ahead `pushBranch()` path, kept the later draft-PR publication gate on the same helper, added a regression proving the early path blocks before both push and PR resolution, hardened the detail assertion to avoid order dependence, reran the focused publication suites, and removed untracked supervisor scratch artifacts from the worktree.
- Exact failure reproduced this turn: local inspection confirmed `src/run-once-issue-preparation.ts` still called `pushBranch()` on the `remoteAhead > 0` path before the new hygiene gate ran, so a supervisor-managed publication could leak a forbidden path before later failing; the targeted assertion in `src/run-once-issue-preparation.test.ts` also still depended on `details[0]`.
- Commands run this turn: `sed -n '1,220p' /home/tommy/.codex/plugins/cache/openai-curated/github/.../skills/gh-address-comments/SKILL.md`; `sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1102/AGENTS.generated.md`; `sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1102/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `nl -ba src/run-once-issue-preparation.ts | sed -n '240,470p'`; `nl -ba src/run-once-issue-preparation.ts | sed -n '470,540p'`; `nl -ba src/run-once-issue-preparation.test.ts | sed -n '400,520p'`; `nl -ba src/run-once-issue-preparation.test.ts | sed -n '720,910p'`; `rg -n "pushBranch\\(|runWorkstationLocalPathGateImpl|runWorkstationLocalPathGate" src/run-once-issue-preparation.ts src/run-once-issue-preparation.test.ts`; `rg -n "remoteAhead:\\s*[1-9]|remoteAhead > 0|prepareIssueExecutionContext\\(" src/*.test.ts`; `rg -n "workstation-local-path-hygiene-failed|tracked durable artifacts failed workstation-local path hygiene before publication" src/*.test.ts`; `apply_patch`; `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/post-turn-pull-request.test.ts`; `npm run verify:paths`; `npm run build`; `git diff -- .codex-supervisor/issue-journal.md src/run-once-issue-preparation.ts src/run-once-issue-preparation.test.ts`; `git remote -v`; `rm -rf .codex-supervisor/pre-merge .codex-supervisor/replay .codex-supervisor/turn-in-progress.json`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
