# Issue #711: Trust enforcement: gate autonomous execution on explicit trusted-input or safer-mode policy

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/711
- Branch: codex/issue-711
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 16096dbfb1ed33899bfadcf8f291b763e5b7144c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T06:20:31Z

## Latest Codex Summary
Verified the trust-gate checkpoint at `16096db` and opened draft PR #764: https://github.com/TommyKammy/codex-supervisor/pull/764

The new behavior is narrow:
- In `trustMode=untrusted_or_mixed` plus `executionSafetyMode=operator_gated`, autonomous execution now blocks before handoff unless the issue has the `trusted-input` label.
- `trusted_repo_and_authors` and `unsandboxed_autonomous` still allow execution.
- Readiness/status/explain now surface the decision explicitly with `blocked_by=trust_gate:trusted-input-required`.

Focused verification passed again in the current worktree, and the branch now tracks `origin/codex/issue-711`. One unrelated untracked path remains: `.codex-supervisor/replay/`.

Summary: Re-verified the safer-mode autonomous execution trust gate, pushed `codex/issue-711`, and opened draft PR #764 for review.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor.test.ts`; `npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/run-once-issue-selection.test.ts`; `npm run build`
Failure signature: none
Next action: monitor PR #764 for CI and review feedback, then address follow-up if any appears.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: enforcement belonged in issue selection, not deep in the Codex runner, so safer-mode trust gating could fail closed before consuming a turn and still surface a deterministic operator-facing reason.
- What changed: added `src/supervisor/supervisor-trust-gate.ts` with a narrow `trusted-input` label rule. `resolveRunnableIssueContext()` now blocks safer-mode autonomous execution when `trustMode=untrusted_or_mixed` and `executionSafetyMode=operator_gated` unless the issue has the `trusted-input` label, while trusted-repo mode or explicit unsafe override still allow execution. Readiness and explain/status paths now report `blocked_by=trust_gate:trusted-input-required` and still treat previously trust-gated records as selectable once the issue becomes trusted. Draft PR #764 is open against `main`.
- Current blocker: none
- Next exact step: watch PR #764 for CI and review results, then address any follow-up without broadening the trust rule.
- Verification gap: none in the implemented scope after installing local dev dependencies in this worktree.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/run-once-issue-selection.ts`, `src/run-once-issue-selection.test.ts`, `src/supervisor/supervisor-trust-gate.ts`, `src/supervisor/supervisor-selection-readiness-summary.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`
- Rollback concern: removing the selection-stage trust gate or readiness/explain wiring would silently restore autonomous execution for untrusted GitHub-authored issue/review input in `operator_gated` safer mode.
- Last focused command: `gh pr create --draft --base main --head codex/issue-711 --title "Gate safer-mode autonomous execution on trusted input" --body ...`
- Last focused failure: none
- Last focused commands:
```bash
npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor.test.ts
npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
npx tsx --test src/run-once-issue-selection.test.ts
npm run build
git push -u origin codex/issue-711
gh pr create --draft --base main --head codex/issue-711 --title "Gate safer-mode autonomous execution on trusted input" --body ...
gh pr view 764 --json number,title,state,isDraft,url,headRefName,baseRefName
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
