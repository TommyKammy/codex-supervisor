# Issue #781: WebUI prep: make issue-lint return a typed DTO instead of CLI-oriented string lines

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/781
- Branch: codex/issue-781
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 6c36a253b6bfe586afe0350e77415cf1a36d1d2c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T14:49:33.468Z

## Latest Codex Summary
Opened draft PR #791 for commit `6c36a25` after pushing `codex/issue-781` to `origin`. The implementation and focused local verification remain unchanged from the previous checkpoint; current remote status is PR open with CI started (`build` on ubuntu/macos in progress, CodeRabbit already successful). `.codex-supervisor/replay/` remains untracked and untouched.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `issue-lint` was still coupled to CLI line rendering because the supervisor returned newline-joined strings and the service re-split them for the CLI, so introducing a typed DTO plus a dedicated renderer should preserve current CLI output while making the result JSON-ready for WebUI/API consumers.
- What changed: added `SupervisorIssueLintDto`, `buildIssueLintDto()`, and `renderIssueLintDto()`, switched `Supervisor.issueLint()` and `SupervisorService.queryIssueLint()` to return the DTO, updated the CLI to render from the DTO, kept diagnostics fixture coverage stable by rendering inside the test helper, added focused tests for DTO generation, CLI rendering, and facade exports, pushed `codex/issue-781` to `origin`, and opened draft PR #791 (`https://github.com/TommyKammy/codex-supervisor/pull/791`).
- Current blocker: none
- Next exact step: monitor PR #791 CI to completion and address any review or check failures if they appear.
- Verification gap: none for the requested local scope. No additional code verification was needed for the PR-open step; the previously passing targeted tests and `npm run build` remain the current local checkpoint. `.codex-supervisor/replay/` remains untracked and untouched.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/cli/supervisor-runtime.test.ts`, `src/cli/supervisor-runtime.ts`, `src/supervisor/supervisor-selection-issue-lint.test.ts`, `src/supervisor/supervisor-selection-issue-lint.ts`, `src/supervisor/supervisor-selection-status.test.ts`, `src/supervisor/supervisor-selection-status.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor-test-helpers.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: reverting the DTO boundary would force future WebUI/API consumers back to parsing CLI-formatted strings and would reintroduce string splitting/rendering logic across the service boundary.
- Last focused command: `gh pr create --draft --base main --head codex/issue-781 --title "WebUI prep: make issue-lint return a typed DTO instead of CLI-oriented string lines" ...`
- Last focused failure: none
- Last focused commands:
```bash
git push -u origin codex/issue-781
gh pr create --draft --base main --head codex/issue-781 --title "WebUI prep: make issue-lint return a typed DTO instead of CLI-oriented string lines" --body ...
gh pr view 791 --json number,url,state,isDraft,baseRefName,headRefName,statusCheckRollup
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
