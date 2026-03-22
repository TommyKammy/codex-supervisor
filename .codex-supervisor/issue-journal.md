# Issue #836: Setup UX contract follow-up: add typed remediation and field metadata for guided setup

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/836
- Branch: codex/issue-836
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 829120e1b1457174e1bc3b7d1456fc9e57778057
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8519xq3
- Repeated failure signature count: 1
- Updated at: 2026-03-22T11:57:07Z

## Latest Codex Summary
Applied the remaining PR review fix in [docs/getting-started.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-836/docs/getting-started.md) so the setup/readiness contract excerpt matches the live backend unions for field keys, field `valueType`, and blocker `remediation.kind`. I also tightened [src/getting-started-docs.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-836/src/getting-started-docs.test.ts) so those documented union members are pinned locally and future doc drift is caught before review.

Summary: Synced the getting-started setup contract snippet with the implementation and added a focused docs regression for the missing union members.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/getting-started-docs.test.ts`
Failure signature: PRRT_kwDORgvdZ8519xq3
Next action: Commit and push the docs/test review fix to `codex/issue-836`, then re-check PR `#842` for refreshed checks and thread state.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/842#discussion_r2971414677
- Details:
  - docs/getting-started.md:199 _⚠️ Potential issue_ | _🟡 Minor_ **Documentation type definitions are incomplete compared to implementation.** The documented types omit several valid union members from the actual implementation in `src/setup-readiness.ts`: 1. `SetupReadinessField.metadata.valueType` is missing: `"git_ref"`, `"file_path"`, `"text"` 2. `SetupReadinessBlocker.remediation.kind` is missing: `"repair_worktree_layout"` If these docs serve as an API contract reference, consider updating them to match the full implementation, or add a note indicating this is an illustrative subset. <details> <summary>📝 Suggested update to match implementation</summary> ```diff metadata: { source: "config"; editable: true; - valueType: "directory_path" | "repo_slug" | "executable_path" | "review_provider"; + valueType: "directory_path" | "repo_slug" | "git_ref" | "file_path" | "executable_path" | "text" | "review_provider"; }; } interface SetupReadinessBlocker { code: string; message: string; fieldKeys: SetupReadinessField["key"][]; remediation: { - kind: "edit_config" | "configure_review_provider" | "authenticate_github" | "verify_codex_cli"; + kind: "edit_config" | "configure_review_provider" | "authenticate_github" | "verify_codex_cli" | "repair_worktree_layout"; summary: string; fieldKeys: SetupReadinessField["key"][]; }; } ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion metadata: { source: "config"; editable: true; valueType: "directory_path" | "repo_slug" | "git_ref" | "file_path" | "executable_path" | "text" | "review_provider"; }; } interface SetupReadinessBlocker { code: string; message: string; fieldKeys: SetupReadinessField["key"][]; remediation: { kind: "edit_config" | "configure_review_provider" | "authenticate_github" | "verify_codex_cli" | "repair_worktree_layout"; summary: string; fieldKeys: SetupReadinessField["key"][]; }; } ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@docs/getting-started.md` around lines 184 - 199, Update the documented type unions to match the implementation: add "git_ref", "file_path", and "text" to SetupReadinessField.metadata.valueType and add "repair_worktree_layout" to SetupReadinessBlocker.remediation.kind (or explicitly note this doc is an illustrative subset if you intend to keep it smaller); locate the type defs for SetupReadinessField and SetupReadinessBlocker in the docs and extend the union literals to include those missing members so the docs reflect the actual src/setup-readiness.ts implementation. ``` </details> <!-- fingerprinting:phantom:medusa:ocelot --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining automated review thread is valid drift in the getting-started contract excerpt, not a backend bug; syncing the documented unions with `src/setup-readiness.ts` and pinning them in the docs test should clear it without changing runtime behavior.
- What changed: expanded the docs snippet in `docs/getting-started.md` so the setup-specific typed excerpt now includes all current setup field keys plus the missing `git_ref`, `file_path`, `text`, and `repair_worktree_layout` union members; updated `src/getting-started-docs.test.ts` to assert those definitions explicitly.
- Current blocker: none
- Next exact step: commit and push the doc/test fix, then re-check PR `#842` and resolve the remaining docs review thread if no additional drift remains.
- Verification gap: only the focused docs regression was rerun on this delta; the broader setup-readiness test matrix from the previous pass was not rerun because the live code path did not change.
- Files touched: `.codex-supervisor/issue-journal.md`, `docs/getting-started.md`, `src/getting-started-docs.test.ts`
- Rollback concern: this delta is documentation plus a docs-only regression guard; if reverted alone, runtime behavior stays the same but the PR thread and doc/implementation drift return.
- Last focused command: `npx tsx --test src/getting-started-docs.test.ts`
- Last focused failure: `AssertionError [ERR_ASSERTION]` in `src/getting-started-docs.test.ts` when the first regex tried to match both a type alias definition and its later field usage in one expression; splitting those checks fixed the false negative.
- Last focused commands:
```bash
git diff -- docs/getting-started.md src/getting-started-docs.test.ts
npx tsx --test src/getting-started-docs.test.ts
npx tsx --test src/getting-started-docs.test.ts
```
### Scratchpad
- 2026-03-22T11:57:07Z: updated the getting-started setup contract excerpt to match the implementation unions and added focused docs assertions for the missing value-type/remediation/key members.
- 2026-03-22T11:56:31Z: the first `npx tsx --test src/getting-started-docs.test.ts` run failed on an over-broad regex that tried to match the type alias definition and the later field usage in one expression; split those assertions and reran cleanly.
- 2026-03-22T11:31:39Z: pushed `codex/issue-836` to `origin` and opened draft PR `#842` at `https://github.com/TommyKammy/codex-supervisor/pull/842`.
- 2026-03-22T11:30:47Z: committed `b1bcbba` (`Add typed setup readiness remediation metadata`) with the setup-readiness contract, fixture, docs, and journal updates.
- 2026-03-22T11:30:09Z: focused setup-readiness verification passed with `npx tsx --test src/doctor.test.ts src/supervisor/supervisor-service.test.ts src/backend/supervisor-http-server.test.ts`; the broader scoped run including `src/getting-started-docs.test.ts` also passed.
- 2026-03-22T11:28:15Z: added the narrow reproducer in `src/doctor.test.ts`; the first focused run failed with `TypeError: Cannot read properties of undefined (reading 'source')`, confirming the DTO lacked typed field metadata.
- 2026-03-22T11:28:50Z: implemented `metadata` on setup fields plus typed `remediation` on blockers in `src/setup-readiness.ts`, then updated service/HTTP/docs fixtures to pin the richer contract.
- 2026-03-22T10:58:09Z: committed merge `aa11199` (`Merge remote-tracking branch 'origin/main' into codex/issue-824`) and pushed it to `origin/codex/issue-824`.
- 2026-03-22T10:58:09Z: `gh pr view 831 --json mergeStateStatus,headRefOid,isDraft,url` reported head `aa11199ec6471b6c8f6d95b64745a12a565f5cc2`, draft `true`, and `mergeStateStatus` `UNSTABLE`, confirming the PR is no longer dirty and is waiting on refreshed checks.
- 2026-03-22T10:56:27Z: `git merge --no-edit origin/main` reported a single content conflict in `.codex-supervisor/issue-journal.md`; all product code and tests from `origin/main` merged without manual intervention.
- 2026-03-22T10:56:27Z: resolved the journal conflict by restoring the issue-824 journal content and updating it for the current merge-resolution pass instead of taking `main`'s unrelated issue-829 journal.
- 2026-03-22T10:56:27Z: focused merge verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/getting-started-docs.test.ts src/doctor.test.ts` and `npm run build`.
- 2026-03-22T08:57:53Z: fixed the remaining shortcut-strip leak by switching tracked shortcut collection to `collectTrackedIssues(status)`, which keeps tracked `done` issues out of the default Issue Details shortcuts while leaving them available behind the tracked-history toggle.
- 2026-03-22T08:57:53Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts` and `npm run build` both passed on the local diff.
- 2026-03-22T06:48:38+00:00: initial `npm run build` failed because `tsc` was missing in this worktree; restored dependencies with `npm ci`, reran the focused tests, and `npm run build` then passed.
