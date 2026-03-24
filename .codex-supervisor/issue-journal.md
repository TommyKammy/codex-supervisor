# Issue #915: Final evaluation contract: define typed pre-merge outcomes and residual-finding policy

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/915
- Branch: codex/issue-915
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2d2b2416c9b17b433a25005b431379378d780a49
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T00:26:19.739Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing contract belongs in `src/local-review` as a typed, transport-independent pre-merge evaluation model derived from existing recommendation/severity/verification data, and it can be added without changing current merge or scheduling behavior.
- What changed: added typed pre-merge outcome and residual-resolution models in `src/local-review/types.ts`; introduced `derivePreMergeFinalEvaluation()` in `src/local-review/final-evaluation.ts` to classify `mergeable`, `fix_blocked`, `manual_review_blocked`, and `follow_up_eligible` outcomes plus residual finding dispositions; threaded the new `finalEvaluation` contract through `finalizeLocalReview()`, formatted results, exported types, and serialized artifacts; documented the contract in the local-review markdown artifact; added focused coverage in `src/local-review/final-evaluation.test.ts` and extended result/artifact tests.
- Current blocker: none
- Next exact step: commit the typed local-review final-evaluation contract, then open or update the draft PR so later issues can build status, merge gating, and follow-up creation on this model.
- Verification gap: focused local-review coverage and `npm run build` passed; the full repository test suite was not rerun in this turn.
- Files touched: `src/local-review/types.ts`, `src/local-review/final-evaluation.ts`, `src/local-review/final-evaluation.test.ts`, `src/local-review/finalize.ts`, `src/local-review/result.ts`, `src/local-review/index.ts`, `src/local-review/artifacts.ts`, `src/local-review/result.test.ts`, `src/local-review/artifacts.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; the change adds a typed evaluation contract and artifact fields only, and existing merge/block behavior still keys off the older recommendation/severity fields.
- Last focused command: `npx tsx --test src/local-review/final-evaluation.test.ts src/local-review/finalize.test.ts src/local-review/result.test.ts src/local-review/artifacts.test.ts && npm run build`
- Last focused failure: `npm run build` first failed with `sh: 1: tsc: not found` because `node_modules` was missing in this worktree; `npm ci` restored the local toolchain and the rerun passed.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-915/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-915/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
git branch --show-current
rg -n "final evaluation|pre-merge|mergeable|follow-up|residual|manual review|manual-review|blocked" src
sed -n '1,240p' src/local-review/types.ts
sed -n '1,260p' src/local-review/result.ts
sed -n '1,260p' src/local-review/finalize.ts
sed -n '1,260p' src/local-review/finalize.test.ts
sed -n '1,260p' src/local-review/result.test.ts
sed -n '140,240p' src/post-turn-pull-request.ts
sed -n '1,220p' src/local-review/index.ts
sed -n '1,220p' src/local-review/artifacts.ts
sed -n '1,220p' src/local-review/index.test.ts
sed -n '1,220p' src/local-review/test-helpers.ts
apply_patch
git diff -- src/local-review/types.ts src/local-review/final-evaluation.ts src/local-review/finalize.ts src/local-review/result.ts src/local-review/artifacts.ts src/local-review/index.ts src/local-review/final-evaluation.test.ts src/local-review/finalize.test.ts src/local-review/result.test.ts src/local-review/artifacts.test.ts
npx tsx --test src/local-review/final-evaluation.test.ts src/local-review/finalize.test.ts src/local-review/result.test.ts src/local-review/artifacts.test.ts
npm run build
test -d node_modules && echo present || echo missing
sed -n '1,220p' package.json
ls | rg 'package-lock.json|pnpm-lock.yaml|yarn.lock'
npm ci
npm run build
npx tsx --test src/local-review/final-evaluation.test.ts src/local-review/finalize.test.ts src/local-review/result.test.ts src/local-review/artifacts.test.ts
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
