# Issue #1091: Capture malformed full-inventory payloads when GitHub issue inventory JSON parsing fails

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1091
- Branch: codex/issue-1091
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 3a6838f9d558b7ac6a481f96820659cb677ee081
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T00:19:42Z

## Latest Codex Summary
- Added env-gated malformed full-inventory payload capture in `GitHubClient.listAllIssues()` and the REST fallback page parser. On JSON parse failure, the client now writes a timestamped JSON artifact with the invoked command, source, page, stdout text plus base64, stderr, and parse error when `CODEX_SUPERVISOR_MALFORMED_INVENTORY_CAPTURE_DIR` is set.
- Added focused regression coverage for primary `gh issue list` capture, REST fallback page capture, and bounded pruning via `CODEX_SUPERVISOR_MALFORMED_INVENTORY_CAPTURE_LIMIT`. Documented loop-host retrieval in `docs/getting-started.md`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the intermittent `Bad control character in string literal` failure is still not locally reproducible, so the next useful step is preserving raw payload evidence from the exact parse-failure site instead of broadening fallback behavior again.
- What changed: added temporary, opt-in capture instrumentation behind `CODEX_SUPERVISOR_MALFORMED_INVENTORY_CAPTURE_DIR`. Primary `gh issue list` JSON parse failures and malformed REST fallback pages now write bounded timestamped artifacts that include command arguments, source, page context, stdout text and base64, stderr, and the parse error. The thrown error now includes the capture path when a capture was written.
- Current blocker: none.
- Next exact step: commit this checkpoint, push `codex/issue-1091`, open a draft PR, then let loop-host reproduction collect the first real malformed payload artifact.
- Verification gap: full `npm test` was not rerun this turn; only the focused GitHub inventory tests, docs guard, and `npm run build` were exercised.
- Files touched: `.codex-supervisor/issue-journal.md`; `docs/getting-started.md`; `src/github/github.test.ts`; `src/github/github.ts`
- Rollback concern: low. The new behavior is env-gated and only activates on JSON parse failure, but the capture artifact stores raw stdout text, so operators should point it at a controlled directory when enabling it on loop hosts.
- Last focused command: `npx tsx --test src/github/github.test.ts`
- What changed this turn: read the required memory and journal, located the live `listAllIssues()` parse sites, added a failing reproducer for missing capture, implemented env-gated capture plus bounded pruning, documented retrieval, restored `node_modules` with `npm ci`, reran the focused suite, and verified the TypeScript build.
- Exact failure reproduced this turn: before the fix, `GitHubClient listAllIssues captures malformed gh issue list payloads when debug capture is enabled` failed because no artifact was written to the configured capture directory.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' <redacted-local-path>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -n 8`; `rg -n "listAllIssues|gh issue list|Failed to parse JSON|Bad control character|inventory" src`; `sed -n '1,280p' src/github/github.ts`; `sed -n '1,920p' src/github/github.test.ts`; `rg -n "artifact|capture|debug|inventory_refresh_failure|malformed" src .codex-supervisor`; `sed -n '1,240p' src/core/command.ts`; `sed -n '1,260p' src/github/github-transport.ts`; `rg -n "inventory refresh|inventory failure|diagnostic artifact|artifact dir|loop host|operator" README.md docs src`; `sed -n '1,260p' docs/getting-started.md`; `npx tsx --test src/github/github.test.ts`; `test -d node_modules && echo present || echo absent`; `npm ci`; `npx tsx --test src/getting-started-docs.test.ts`; `npm run build`; `gh pr status`; `git diff -- src/github/github.ts src/github/github.test.ts docs/getting-started.md .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
