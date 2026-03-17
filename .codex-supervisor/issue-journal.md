# Issue #511: External-review misses: emit a follow-up action digest from miss analysis

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/511
- Branch: codex/issue-511
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-511
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-511/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 4f0f3d0b10e28bda9cf2510eb2f517e14495190f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T23:40:23.251Z

## Latest Codex Summary
- Added a deterministic external-review follow-up digest (`.md`) next to each persisted miss artifact (`.json`), grouped missed findings by prevention target, and surfaced current-head metadata plus one recommended next action per miss.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the follow-up digest should be generated alongside the miss artifact itself so operators get a deterministic markdown action list without changing status rendering or prompt flow yet.
- What changed: added `external-review-miss-digest.ts`, wrote a `.md` digest beside each external-review miss artifact, grouped missed findings by prevention target with target-specific recommended next actions, and added focused artifact/persistence tests for digest generation plus stale-head metadata rendering.
- Current blocker: none
- Next exact step: commit the digest implementation on `codex/issue-511`, then open or update the draft PR so CI can validate the new artifact output.
- Verification gap: none locally after rerunning focused external-review digest tests and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/external-review/external-review-miss-artifact.test.ts`, `src/external-review/external-review-miss-digest.ts`, `src/external-review/external-review-miss-persistence.test.ts`, `src/external-review/external-review-miss-persistence.ts`
- Rollback concern: removing the digest writer would leave the JSON artifact as the only miss-analysis output, forcing operators back to raw artifact inspection and dropping the deterministic next-action summary promised by this issue.
- Last focused command: `npx tsx --test src/external-review/external-review-miss-artifact.test.ts src/external-review/external-review-miss-persistence.test.ts && npm ci && npm run build`
### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
- 2026-03-18 (JST): Focused reproducer first failed in `src/external-review/external-review-miss-artifact.test.ts` because missed findings in the artifact had `preventionTarget: undefined`; failure signature: `missing-prevention-target`.
- 2026-03-18 (JST): Deterministic target precedence is `issue_comment -> issue_template`, `top_level_review -> review_prompt`, severe anchored `review_thread` misses -> `durable_guardrail`, regression-qualified `review_thread` misses -> `regression_test`, otherwise `review_prompt`.
- 2026-03-18 (JST): `npm run build` initially failed with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain and the rerun passed.
- 2026-03-18 (JST): Added a focused reproducer in `src/external-review/external-review-miss-persistence.test.ts` that first failed with `ENOENT` for `external-review-misses-head-deadbeefcafe.md`; failure signature: `missing-follow-up-digest`.
- 2026-03-18 (JST): Implemented `external-review-miss-digest.ts` so each persisted miss artifact now has an adjacent markdown digest with `current-head` vs `stale-head` metadata, prevention-target grouping, and one deterministic recommended next action per missed finding.
