# Issue #736: Hydration provenance visibility: surface cached-vs-fresh PR hydration results

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/736
- Branch: codex/issue-736
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 49fa60219bda219462266360d13794c08db1dd2d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T23:36:28.000Z

## Latest Codex Summary
Added a narrow hydration provenance signal end to end. Hydrated PRs now carry `hydrationProvenance: "fresh" | "cached"` in [src/core/types.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-736/src/core/types.ts), the hydrator sets it deterministically in [src/github/github-pull-request-hydrator.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-736/src/github/github-pull-request-hydrator.ts), and detailed supervisor status renders `pr_hydration provenance=...` in [src/supervisor/supervisor-detailed-status-assembly.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-736/src/supervisor/supervisor-detailed-status-assembly.ts). Action behavior is unchanged.

Focused coverage was added in [src/github/github-pull-request-hydrator.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-736/src/github/github-pull-request-hydrator.test.ts) and [src/supervisor/supervisor-status-rendering-supervisor.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-736/src/supervisor/supervisor-status-rendering-supervisor.test.ts). I also updated the issue journal and committed the checkpoint as `49fa602` (`Surface PR hydration provenance`). The only remaining workspace dirt is pre-existing untracked `.codex-supervisor/replay/`.

Summary: Added deterministic fresh-vs-cached PR hydration provenance and surfaced it in supervisor status, with focused regressions and successful local verification on the acceptance test slice
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/github/github-pull-request-hydrator.test.ts`; `npx tsx --test src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npx tsx --test src/pull-request-state.test.ts src/supervisor/supervisor-lifecycle.test.ts src/doctor.test.ts`; `npm ci`; `npm run build`
Failure signature: none
Next action: monitor or address review and CI for draft PR #755

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: a small PR-level provenance field is enough for this issue because later behavior changes can reuse it without changing any action paths now.
- What changed: added `hydrationProvenance` to hydrated pull requests, set it deterministically to `fresh` or `cached` in the GitHub PR hydrator, and rendered it as `pr_hydration provenance=...` in detailed supervisor status output.
- Current blocker: none
- Next exact step: push the journal checkpoint for PR #755 so the branch is clean, then monitor CI and review feedback.
- Verification gap: none on code; `npm run build` initially failed only because `node_modules/.bin/tsc` was missing before `npm ci`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/core/types.ts`, `src/github/github-pull-request-hydrator.ts`, `src/github/github-pull-request-hydrator.test.ts`, `src/supervisor/supervisor-detailed-status-assembly.ts`, `src/supervisor/supervisor-status-rendering-supervisor.test.ts`
- Rollback concern: removing the provenance field would drop the only deterministic operator-visible cached-vs-fresh hydration signal needed by later action-path issues.
- Last focused command: `gh pr create --draft --base main --head codex/issue-736 --title "Surface cached-vs-fresh PR hydration provenance" ...`
- Last focused failure: none
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-736/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-736/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
npx tsx --test src/pull-request-state.test.ts src/supervisor/supervisor-lifecycle.test.ts src/doctor.test.ts
npm run build
gh pr view --json number,state,isDraft,headRefName,baseRefName,url 2>/dev/null || true
git diff --stat origin/main...HEAD
git push -u origin codex/issue-736
gh pr create --draft --base main --head codex/issue-736 --title "Surface cached-vs-fresh PR hydration provenance" --body ...
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
