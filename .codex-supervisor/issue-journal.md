# Issue #731: Hydration freshness docs: define fresh-vs-cached contract for supervisor action paths

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/731
- Branch: codex/issue-731
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 3d7a257a37b0819279d0b3fddd2c03fd9ca20909
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T22:47:56Z

## Latest Codex Summary
- Added a focused docs regression test for the pull-request hydration freshness contract and updated `README.md`, `docs/architecture.md`, and `docs/configuration.md` so action-taking PR paths require fresh GitHub review facts while cached hydration remains informational and non-authoritative.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing contract is documentation-level, not behavior-level; the repo needs one explicit fresh-vs-cached rule that distinguishes PR action paths from informational hydration consumers.
- What changed: added `src/hydration-freshness-docs.test.ts` as a focused reproducer for the missing wording; updated `README.md`, `docs/architecture.md`, and `docs/configuration.md` to state that marking ready, unblocking review-driven state, and merging require fresh GitHub review facts, while retained cached hydration is informational and non-authoritative.
- Current blocker: none
- Next exact step: commit the docs-only hydration freshness checkpoint for issue #731, then open or update a draft PR if the branch does not already have one.
- Verification gap: the focused docs regression test and `npm run build` passed after hydrating dependencies with `npm ci`; the full `npm test` suite was not rerun.
- Files touched: `README.md`, `docs/architecture.md`, `docs/configuration.md`, `src/hydration-freshness-docs.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting these changes would restore the ambiguous docs posture where cached hydration could still be read as authoritative for PR action paths.
- Last focused command: `npx tsx --test src/hydration-freshness-docs.test.ts`
- Last focused failure: `none`
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-731/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-731/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
git status --short --branch
npx tsx --test src/hydration-freshness-docs.test.ts
npm run build
npm ci
npx tsx --test src/hydration-freshness-docs.test.ts
npm run build
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
