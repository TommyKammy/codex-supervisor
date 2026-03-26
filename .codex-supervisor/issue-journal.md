# Issue #1071: Harden full inventory transport without collapsing distinct failure classes

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1071
- Branch: codex/issue-1071
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 04b84401423138628e11decbbc6e2953a4a988d9
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T23:40:02.105Z

## Latest Codex Summary
- Hardened `GitHubClient.listAllIssues()` so only malformed JSON-array payloads can use the REST full-inventory fallback; transport-shaped non-JSON output now remains a fatal primary transport failure.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `listAllIssues()` was still treating any `gh issue list` parse failure as fallback-eligible, which collapses some primary transport failures into the same path as malformed payloads and can return silent success when the primary transport actually failed.
- What changed: added a JSON-array shape gate in `GitHubClient.listAllIssues()` so only malformed full-inventory payloads that still look like the expected array output can fall back to REST pagination; transport-shaped non-JSON output now throws the primary failure directly. Added focused regression coverage for transport-shaped stdout staying fatal and for preserving both primary parse failure and fallback transport failure details.
- Current blocker: none.
- Next exact step: commit the focused transport hardening checkpoint on `codex/issue-1071`, then continue with any wider inventory-path fallout only if later verification or review finds another failure boundary.
- Verification gap: `npm test` fails because `tsx` is not installed locally; `npm run build` and `npx tsc -p tsconfig.json` fail because `tsc`/TypeScript is not installed locally. A full `npx tsx --test "src/**/*.test.ts"` sweep also hits unrelated environment/test failures, including missing `playwright-core` and existing repo-structure/build tests.
- Files touched: `.codex-supervisor/issue-journal.md`; `src/github/github.test.ts`; `src/github/github.ts`
- Rollback concern: low. The new guard only narrows when the full-inventory fallback is allowed; the main risk is being too strict and surfacing a malformed-but-recoverable payload as fatal.
- Last focused command: `npx tsx --test src/github/github.test.ts`
- What changed this turn: reread the required memory files and journal, inspected the full inventory transport path, added a focused failing regression for transport-shaped non-JSON `gh issue list` output, implemented the fallback gate, added a regression for fallback transport failure attribution, reran focused tests, and attempted broader verification.
- Exact failure reproduced this turn: before the fix, `GitHubClient.listAllIssues()` treated plain-text transport output like `Post "https://api.github.com/graphql": ... connection reset by peer` as a parse failure that could use the REST fallback, so the call succeeded instead of surfacing the fatal primary transport failure.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1071/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1071/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "gh issue list|inventory refresh|full inventory|inventory.*transport|fallback|malformed|parse" src test`; `rg --files src test | rg "inventory|refresh|transport|gh|issue.*list|supervisor"`; `git log --oneline --decorate -n 12`; `sed -n '360,820p' src/run-once-cycle-prelude.test.ts`; `rg -n "load full issue inventory|Failed to load full issue inventory|fallback transport|malformed gh issue list JSON|inventory_refresh_failure" src/run-once-cycle-prelude.ts src/supervisor/supervisor.ts src`; `sed -n '1,320p' src/run-once-cycle-prelude.ts`; `sed -n '260,420p' src/github/github.ts`; `sed -n '1,260p' src/github/github-transport.ts`; `sed -n '1,280p' src/github/github-transport.test.ts`; `rg -n "async listAllIssues|listAllIssues\\(" src/github/github.ts src/github`; `sed -n '180,280p' src/github/github.ts`; `sed -n '1,220p' src/inventory-refresh-state.ts`; `sed -n '620,790p' src/github/github.test.ts`; `rg -n "listAllIssuesViaRestApi|Failed to load full issue inventory|Primary transport:|Fallback transport:" src/github/github.test.ts src`; `npx tsx --test src/github/github.test.ts`; `rg -n "transport failure|transient failure|rate limit|Command failed: gh|Command timed out: gh|looks like JSON|parse failure" src/github src`; `sed -n '1,220p' src/github/github.test.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts`; `npm test`; `npm run build`; `npx tsx --test "src/**/*.test.ts"`; `npx tsc -p tsconfig.json`; `git diff -- src/github/github.ts src/github/github.test.ts .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
