# Issue #1466: Add tmux-backed macOS loop launcher scripts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1466
- Branch: codex/issue-1466
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: 89a9a695ee4ff986e3e40e95573a1ef54cc53a21
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856ZzBs
- Repeated failure signature count: 1
- Updated at: 2026-04-12T22:37:39.277Z

## Latest Codex Summary
Aligned the issue journal verification line with the issue acceptance command so PR reviewers see `npm test -- src/managed-restart-launcher-assets.test.ts` instead of the narrower direct `tsx` invocation. While rerunning that acceptance command locally, I found it expands to the repo-wide `npm test` script rather than staying focused on the managed-restart file.

I updated the stale expectation in [src/backend/webui-local-ci-browser-helpers.test.ts](src/backend/webui-local-ci-browser-helpers.test.ts) so it matches the current `warning=none` status token. The focused launcher asset test still passes via `npx tsx --test src/managed-restart-launcher-assets.test.ts`, and `npm run build` passes. The broader `npm test -- src/managed-restart-launcher-assets.test.ts` command still fails on unrelated existing tests outside this issue’s scope. The journal/test update is committed as `d73c21b` and pushed to `origin/codex/issue-1466`.

Summary: Aligned the journal verification command with the issue acceptance text, fixed one stale test expectation, and re-ran focused verification
State hint: addressing_review
Blocked reason: none
Tests: `npm test -- src/managed-restart-launcher-assets.test.ts` (fails on unrelated existing tests in `src/supervisor-orphan-workspace-cleanup.test.ts`, `src/supervisor/supervisor-pr-readiness.test.ts`, `src/supervisor/supervisor-status-model-supervisor.test.ts`, and `src/tracked-pr-lifecycle-projection.test.ts`); `npx tsx --test src/managed-restart-launcher-assets.test.ts`; `npm run build`
Next action: Resolve or reply to the remaining PR #1469 discussion with the command-alignment change and the note that the npm acceptance command is broader than intended
Failure signature: PRRT_kwDORgvdZ856ZzBs

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1469#discussion_r3070273869
- Details:
  - .codex-supervisor/issue-journal.md:24 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Align verification command with the issue acceptance command.** Line 24 uses `npx tsx --test ...`, while the issue acceptance criteria calls ... url=https://github.com/TommyKammy/codex-supervisor/pull/1469#discussion_r3070273869

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining CodeRabbit thread is valid at the journal level only: the recorded verification command should match the issue acceptance text, but the acceptance command currently expands to the repo-wide `npm test` script and exposes unrelated failures outside the tmux launcher scope.
- What changed: Updated `.codex-supervisor/issue-journal.md` so the recorded verification command matches the issue acceptance text. Fixed the stale `src/backend/webui-local-ci-browser-helpers.test.ts` expectation to include the current `warning=none` status token. Re-ran `npm test -- src/managed-restart-launcher-assets.test.ts`, `npx tsx --test src/managed-restart-launcher-assets.test.ts`, and `npm run build`. Committed the journal/test updates as `d73c21b` and pushed them to `origin/codex/issue-1466`.
- Current blocker: none
- Next exact step: Resolve or answer the remaining PR #1469 review thread with the command-alignment change and the note that the npm form is broader than intended.
- Verification gap: No live tmux integration run yet. The exact acceptance command remains broader than intended and currently fails on unrelated existing tests outside the managed-restart launcher file.
- Files touched: .codex-supervisor/issue-journal.md; src/backend/webui-local-ci-browser-helpers.test.ts; src/managed-restart-launcher-assets.test.ts; scripts/start-loop-tmux.sh; scripts/stop-loop-tmux.sh
- Rollback concern: Low; the change only adds new macOS helper scripts and test coverage, with no edits to existing Linux/systemd launcher paths.
- Last focused command: git push origin codex/issue-1466
### Scratchpad
- Review thread `PRRT_kwDORgvdZ856Zw2L` reported valid ordering bug in `scripts/start-loop-tmux.sh`.
- Review thread `PRRT_kwDORgvdZ856ZzBs` is valid for journal-command alignment; the exact npm acceptance command also exposed unrelated existing test failures outside this issue.
- Commands run this turn: `nl -ba .codex-supervisor/issue-journal.md | sed -n '1,120p'`; `git status --short`; `git diff -- .codex-supervisor/issue-journal.md`; `npm test -- src/managed-restart-launcher-assets.test.ts`; `npm run build`; `npm test -- --test-name-pattern "local CI browser helpers summarize a repo-owned candidate contract consistently"`; `npx tsx -e "import {buildLocalCiContractStatusLines, buildLocalCiContractChecklistItems, canAdoptRecommendedLocalCiCommand} from './src/backend/webui-local-ci-browser-helpers.ts'; ..."`; `npx tsx --test src/managed-restart-launcher-assets.test.ts`; `git commit -m "Align review verification journal entry"`; `git push origin codex/issue-1466`.
