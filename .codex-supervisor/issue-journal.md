# Issue #1063: Promote generalized PR #1060 review learnings into shared memory

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1063
- Branch: codex/issue-1063
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 253756be094dd94a942c334cd588131676cb6e55
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T12:45:42.900Z

## Latest Codex Summary
- Added two PR #1060 durable external-review guardrails for response-flush-before-shutdown safety and `set -euo pipefail` shell diagnostics, plus a repo-backed loader test that proves those committed patterns stay present.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #1063 only needs a pair of durable external-review patterns plus a repo-backed loader assertion; the right reproducer is a focused test that fails until the committed shared-memory file contains the new PR #1060 promotions.
- What changed: added a repo-backed test in `src/external-review/external-review-miss-history.test.ts` that asserts the committed workspace guardrails include the generalized shutdown-response-flush and `set -euo pipefail` shell-diagnostic patterns; added those two entries to `docs/shared-memory/external-review-guardrails.json`; normalized the committed guardrail file with the CLI.
- Current blocker: none on the code change itself. Environment verification is limited because this worktree does not currently have `tsx`/`tsc` available on PATH for npm scripts or a local TypeScript compiler installed for `npx tsc`.
- Next exact step: commit this shared-memory/test checkpoint on `codex/issue-1063`; if full build verification is required afterward, install project dependencies or run in an environment that has the repo toolchain available.
- Verification gap: `npm run build` could not complete in this environment because `tsc` was not found, and direct `npx tsc -p tsconfig.json` reported that TypeScript is not installed locally. Focused shared-memory verification passed.
- Files touched: `docs/shared-memory/external-review-guardrails.json`, `src/external-review/external-review-miss-history.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The change only adds committed guardrail data and a loader test that locks in those exact entries.
- Last focused command: `npx tsx --test src/external-review/external-review-miss-history.test.ts`
- What changed this turn: read the required memory/journal files, added the narrow repo-backed reproducer, confirmed it failed because the committed JSON lacked the PR #1060 fingerprints, promoted the two generalized entries into shared memory, and revalidated the committed guardrails with the CLI and focused test.
- Exact failure reproduced this turn: `npx tsx --test src/external-review/external-review-miss-history.test.ts` initially failed with `AssertionError [ERR_ASSERTION]` because the loader returned `[]` for fingerprint `src/backend/supervisor-http-server.ts|shutdown-must-not-preempt-success-response-flush`, proving the committed guardrails were missing the new durable pattern.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1063/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1063/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "external-review-guardrails|shared-memory|guardrail" docs src package.json`; `sed -n '1,260p' docs/shared-memory/external-review-guardrails.json`; `sed -n '1,260p' src/committed-guardrails.test.ts`; `sed -n '1,220p' src/committed-guardrails-cli.ts`; `rg -n "loadExternalReviewGuardrails|parseExternalReviewGuardrails|formatCommittedGuardrails rewrites|external-review-guardrails.json" src/committed-guardrails.test.ts src/committed-guardrails.ts src`; `sed -n '260,520p' src/committed-guardrails.test.ts`; `sed -n '1,420p' src/committed-guardrails.ts`; `rg -n "loadCommittedExternalReviewGuardrails|docs/shared-memory/external-review-guardrails.json|committedPath: \"docs/shared-memory/external-review-guardrails.json\"" src`; `sed -n '1,220p' src/external-review/external-review-miss-history.test.ts`; `sed -n '1,220p' src/local-review/result.test.ts`; `sed -n '1,260p' src/verifier-guardrails.test.ts`; `rg -n "repo-backed|current workspace|committed .* includes|loadCommitted.*process.cwd|workspacePath: process.cwd\\(\\)" src`; `sed -n '260,360p' src/verifier-guardrails.test.ts`; `sed -n '220,420p' src/external-review/external-review-miss-history.test.ts`; `sed -n '420,520p' src/external-review/external-review-miss-history.test.ts`; `sed -n '1,220p' src/external-review/external-review-miss-history.ts`; `apply_patch ...`; `npx tsx --test src/external-review/external-review-miss-history.test.ts`; `npm run guardrails:fix`; `npx tsx src/committed-guardrails-cli.ts fix`; `npm run build`; `npx tsx src/committed-guardrails-cli.ts check`; `npx tsc -p tsconfig.json`; `git diff -- docs/shared-memory/external-review-guardrails.json src/external-review/external-review-miss-history.test.ts`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git status --short --branch`.
- PR status: no PR yet for `codex/issue-1063`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local
