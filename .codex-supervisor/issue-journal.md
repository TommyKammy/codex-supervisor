# Issue #1102: Publish gate: refuse supervisor-managed publication when durable artifacts fail path hygiene

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1102
- Branch: codex/issue-1102
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 5 (implementation=2, repair=3)
- Last head SHA: b1fab170b37765ff7edc52dee9c209d1e9db9d1f
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail
- Repeated failure signature count: 2
- Updated at: 2026-03-27T07:25:00.000Z

## Latest Codex Summary
Reproduced the failing Ubuntu `verify:paths` run for PR `#1107` on head `b1fab17` and confirmed it is not stale metadata: the pushed commit still records workstation-local absolute-path text inside the tracked command-history entry in [`.codex-supervisor/issue-journal.md`](.codex-supervisor/issue-journal.md), exactly matching the GitHub Actions log for run `23635587877`.

The local worktree already has the journal entry sanitized back to `<redacted-local-path>` placeholders, and that tracked artifact now passes `npm run verify:paths` and `npm run build` again. This repair turn is publishing the journal-only fix so PR `#1107` can rerun CI on a head that remains path-hygienic.

Summary: Reproduced the Ubuntu `verify:paths` failure on PR `#1107`, confirmed it came from stale workstation-local absolute-path text persisted in the tracked issue journal on head `b1fab17`, and prepared the sanitized journal-only repair that passes local verification.
State hint: repairing_ci
Blocked reason: none
Tests: `npm run verify:paths`; `npm run build`
Next action: Push the sanitized journal fix to PR `#1107`, then monitor the rerun until GitHub replaces the stale failing Ubuntu `verify:paths` result.
Failure signature: build (ubuntu-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1107 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1107
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23635587877/job/68844038454

## Codex Working Notes
### Current Handoff
- Hypothesis: supervisor-managed publication should fail closed at the publish/update seams whenever tracked durable artifacts still contain forbidden workstation-local absolute paths, and the checkpoint itself must remain publishable under the same `verify:paths` rule.
- What changed: confirmed the publication-gating code from the prior repair is not the current blocker; the remaining CI failure is the tracked issue journal on pushed head `b1fab17`, whose persisted command-history entry still contained workstation-local absolute-path text. The local journal now keeps those entries redacted as `<redacted-local-path>`.
- Current blocker: none locally.
- Next exact step: push the sanitized journal repair on `codex/issue-1102`, then monitor PR `#1107` until a fresh CI run supersedes the stale Ubuntu failure from run `23635587877`.
- Verification gap: no remote rerun has executed on the sanitized journal yet; this turn covered the failing `verify:paths` step and `build` locally.
- Files touched: `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The change only redacts workstation-local absolute paths from the tracked journal command history and does not change supervisor runtime behavior.
- Last focused command: `gh run view 23635587877 --log-failed`
- What changed this turn: read the required shared memory, verified PR `#1107` still points at head `b1fab17`, pulled the failing GitHub Actions log for run `23635587877`, confirmed the failure matches the tracked issue-journal command-history entry on the pushed commit, reran `npm run verify:paths` and `npm run build` locally against the sanitized journal, and updated the journal handoff for this CI repair.
- Exact failure reproduced this turn: GitHub Actions run `23635587877` failed `npm run verify:paths` on head `b1fab17` because [`.codex-supervisor/issue-journal.md`](.codex-supervisor/issue-journal.md) line 48 in the pushed commit still contained workstation-local absolute-path command-history text; the local worktree version replaces those paths with `<redacted-local-path>` and passes the same check.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>/SKILL.md`; `sed -n '1,220p' <redacted-local-path>/AGENTS.generated.md`; `sed -n '1,260p' <redacted-local-path>/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `gh auth status`; `gh pr view 1107 --json number,url,isDraft,headRefName,headRefOid,baseRefName,mergeStateStatus,mergeable,statusCheckRollup`; `python3 <redacted-local-path>/inspect_pr_checks.py --repo . --pr 1107 --json`; `git rev-parse HEAD`; `gh run view 23635587877 --json name,workflowName,conclusion,status,url,event,headBranch,headSha,jobs`; `gh run view 23635587877 --log-failed`; `nl -ba .codex-supervisor/issue-journal.md | sed -n '35,70p'`; `npm run verify:paths`; `git show --stat --oneline --decorate=short b1fab170b37765ff7edc52dee9c209d1e9db9d1f`; `git diff -- .codex-supervisor/issue-journal.md`; `npm run build`; `apply_patch`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
