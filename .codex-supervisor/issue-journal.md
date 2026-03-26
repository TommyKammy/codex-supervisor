# Issue #1045: Promote generalized PR #1040/#1041 review findings into shared memory

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1045
- Branch: codex/issue-1045
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 762d0921f3a3db270de7ae9c755aec918fdd5d52
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T04:35:40.023Z

## Latest Codex Summary
- Reproduced the shared-memory gap with a focused repo-level external-review history test, then promoted the two generalized PR #1040/#1041 findings into committed durable guardrails and verified the narrowed regression, `guardrails:check`, and `build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing durable memory for PR #1040/#1041 is best enforced by a repo-level test that asserts the promoted external-review patterns exist in committed shared memory and excludes the implementation-specific `inventory_refresh` sanitization note.
- What changed: added a focused repo-committed pattern assertion in `src/external-review/external-review-miss-history.test.ts`; promoted one degraded-mode dependency/order invariant pattern and one fault-class-scoped fallback pattern into `docs/shared-memory/external-review-guardrails.json`; normalized the committed guardrails with `npm run guardrails:fix`.
- Current blocker: none locally.
- Next exact step: review the shared-memory/test diff, commit the promoted-guardrails change set on `codex/issue-1045`, and open or update a PR if requested.
- Verification gap: none in the requested local scope.
- Files touched: `docs/shared-memory/external-review-guardrails.json`, `src/external-review/external-review-miss-history.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only adds durable shared-memory entries and a focused assertion covering their continued presence.
- Last focused command: `npm run build`
- Exact failure reproduced: `npx tsx --test src/external-review/external-review-miss-history.test.ts` failed because `loadRelevantExternalReviewMissPatterns()` returned no committed pattern for `src/supervisor/supervisor-pr-review-blockers.ts|degraded-mode-shortcuts-must-preserve-dependency-ordering`, proving the generalized PR #1040/#1041 findings were not yet promoted into shared memory.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1045/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1045/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `sed -n '1,260p' docs/shared-memory/external-review-guardrails.json`; `rg -n "external-review-guardrails|guardrails:check|shared-memory" src docs package.json`; `sed -n '1,340p' src/committed-guardrails.test.ts`; `sed -n '1,260p' src/committed-guardrails.ts`; `sed -n '140,220p' docs/local-review.md`; `sed -n '340,520p' src/committed-guardrails.test.ts`; `sed -n '1,220p' src/external-review/external-review-miss-artifact-types.ts`; `rg -n "read.*external-review-guardrails|validateCommittedGuardrails\\(|patterns\\[|fingerprint" src/*.test.ts src/**/*.test.ts`; `sed -n '380,500p' src/external-review/external-review-miss-history.test.ts`; `sed -n '1,220p' src/external-review/external-review-miss-history.ts`; `rg -n "1040|1041|inventory_refresh|degraded|fallback|transport|execution-order|dependency" docs src .codex-supervisor -g '!node_modules'`; `apply_patch` to add the focused repo-level regression test; `npx tsx --test src/external-review/external-review-miss-history.test.ts`; `apply_patch` to add the durable external-review guardrail patterns; `test -d node_modules && echo present || echo missing`; `sed -n '1,120p' package.json`; `sed -n '1,160p' docs/shared-memory/external-review-guardrails.json`; `npm ci`; `npm run guardrails:fix`; `npx tsx --test src/external-review/external-review-miss-history.test.ts`; `npm run guardrails:check`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git diff -- src/external-review/external-review-miss-history.test.ts docs/shared-memory/external-review-guardrails.json .codex-supervisor/issue-journal.md`; `git status --short --branch`.
- PR status: none yet for `codex/issue-1045`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
