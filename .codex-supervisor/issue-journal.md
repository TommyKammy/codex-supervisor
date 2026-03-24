# Issue #923: Post-merge audit contract: define typed non-gating learning outcomes and promotion candidates

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/923
- Branch: codex/issue-923
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: dfda4edf6173c9c2eeccf24eedb6dd5bea95de36
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T05:01:13.103Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the repo had a typed pre-merge evaluation contract, but no separate typed post-merge audit contract for non-gating learning outcomes, recurring-pattern summaries, or promotion candidates.
- What changed: added focused regression coverage in `src/local-review/post-merge-audit.test.ts`; introduced a dedicated `src/local-review/post-merge-audit.ts` helper plus new typed models in `src/local-review/types.ts` for advisory-only post-merge outcomes, recurring-pattern summaries, and promotion candidates; documented the non-gating contract in `src/local-review/artifacts.ts` and tightened `src/local-review/artifacts.test.ts`.
- Current blocker: none.
- Next exact step: review the diff, commit the post-merge audit contract change, and open or update the branch PR if needed.
- Verification gap: none locally; focused post-merge audit coverage, adjacent local-review tests, `npm run build`, and the full test suite are green in this workspace.
- Files touched: `src/local-review/types.ts`, `src/local-review/post-merge-audit.ts`, `src/local-review/post-merge-audit.test.ts`, `src/local-review/artifacts.ts`, `src/local-review/artifacts.test.ts`, `src/local-review/index.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; reverting would remove the typed post-merge audit contract and the explicit non-gating documentation needed for later reporting and promotion work.
- Last focused command: `npx tsx --test src/**/*.test.ts`
- Last focused failure: none
- Draft PR: none
- Last focused commands:
```bash
sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-923/AGENTS.generated.md
sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-923/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
rg -n "post-merge|post merge|audit outcome|promotion candidate|learning outcome|follow_up_eligible|final evaluation|promotion" src .codex-supervisor -g '!node_modules'
sed -n '1,220p' src/local-review/types.ts
sed -n '1,320p' src/core/types.ts
sed -n '1,220p' src/local-review/final-evaluation.ts
sed -n '1,220p' src/local-review/artifacts.ts
sed -n '1,220p' src/local-review/final-evaluation.test.ts
sed -n '1,200p' src/local-review/artifacts.test.ts
sed -n '1,220p' src/local-review/result.test.ts
npx tsx --test src/local-review/post-merge-audit.test.ts
npx tsx --test src/local-review/artifacts.test.ts src/local-review/final-evaluation.test.ts src/local-review/result.test.ts
npm install
npm run build
npx tsx --test src/**/*.test.ts
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
