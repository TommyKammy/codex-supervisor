# Codex App Automation Boundary

Codex app Automation may coordinate a `codex-supervisor` operating lane, but codex-supervisor remains the implementation executor. Automation is not an executor replacement and must not move loop ownership out of the supervisor.

Use Automation for orchestration, review, follow-up issue drafting, and Obsidian
record support around the loop. Keep the implementation turn, issue worktree,
journal, PR lifecycle, CI repair loop, review handling, and merge safety inside
the supervisor-owned flow.

The portable connector-style artifact is [Codex Automation connector boundary](./codex-automation-connector-boundary.schema.json). It publishes the stable responsibility vocabulary for external automation while keeping the enforcement boundary inside `codex-supervisor`.

## Roles

- Loop Watcher: reads roadmap, GitHub issue and PR state, local status, loop
  runtime state, and supervisor diagnostics; routes or notifies only actionable
  changes.
- Merge Evaluator: inspects recently merged work against the roadmap and local
  repository state before declaring a phase complete or identifying a narrow
  follow-up.
- Follow-up Issue Creator: drafts a single behavior delta only after a concrete
  unmet requirement is confirmed; issue creation is confirm-required and must
  preserve canonical issue metadata.
- Obsidian Recorder: updates external development history or operating notes
  after real issue, PR, verification, or phase state changes.
- Operator Evidence Preparer: prepares operator-facing evidence from current
  issue, PR, CI, review, and local status facts without treating that evidence
  as execution authority.

External automation may evaluate, route, draft, record, notify, and prepare
operator-facing evidence. It may not execute implementation changes, decide
merge readiness, or turn advisory context into supervisor authority.

## Phase 5 Boundary Inventory

Phase 5 keeps `codex-supervisor` core focused on executor-owned state changes
and safety gates. These responsibilities stay inside core:

- issue contract validation and `issue-lint` readiness
- per-issue worktree and journal ownership
- Codex execution and resume orchestration
- PR lifecycle action selection, including review, CI, stale-review terminal,
  operator escalation, and merge-readiness decisions
- CI, review, branch-protection, head-SHA, and merge safety gates
- evidence capture, replay, status, and explain output for supervisor-owned
  decisions

These responsibilities remain external orchestration:

- evaluate roadmap, GitHub, local status, and note state
- route actionable changes to the operator or the next runnable issue
- draft confirm-required follow-up issues
- record durable Obsidian or external history after real state changes
- notify the operator about actionable state changes
- prepare operator-facing evidence without treating that evidence as execution
  authority

Compatibility note: Phase 5 does not replace issue selection, Codex execution,
merge execution, branch protection, or the supervisor's final auto-merge guard.
External orchestration can help route, record, and explain work, but it cannot
authorize implementation turns, GitHub mutations, merges, or safety-gate
bypasses.

Closeout evidence for the implemented boundary, rollback posture, and broad
verification surface is recorded in [Phase 5 closeout evidence](./phase5-closeout-evidence.md).

## Safety Contract

Automation must stay quiet when there is no actionable change. It should not
create status noise, issue churn, or durable notes merely because it ran.

Follow-up issue creation is confirm-required. Automation can identify and draft
follow-ups, but it must not make default-enabled follow-up issue creation the
normal path.

Automation must perform no destructive git operations. It must not discard local
changes, reset branches, force-push, or repair broad path drift without explicit
operator direction and a verified reason.

Automation must respect core safety gates. Issue metadata, path-literal hygiene,
fresh GitHub PR facts, review-provider boundaries, branch protection, head-SHA
matching, local config drift, and fail-closed trust-boundary behavior remain
supervisor requirements.

Automation must not bypass executor safety gates, issue-lint, fresh PR facts,
local CI, or operator confirmations. Operator confirmations include follow-up
issue creation, destructive cleanup, recovery acknowledgement, and any manual
review decision that the supervisor has surfaced as a prerequisite.

## Explicit Non-Goals

- Do not move implementation execution from `codex-supervisor` into Codex app
  Automation.
- Do not enable default-enabled follow-up issue creation.
- Do not add metadata-only review auto-resolve.
- Do not run broad path repair as an Automation default.
- Do not broaden the solo automation lane into multi-user governance.
- Do not put multi-repo orchestration in codex-supervisor core.
- Do not grant Codex app Automation new executor authority.

## Portable References

Repo-owned guidance should use repo-relative paths, documented environment
variables, and placeholders such as `<codex-supervisor-root>` and
`<supervisor-config-path>`. Durable examples should prefer commands like
`node dist/index.js status --config <supervisor-config-path>` or
`CODEX_SUPERVISOR_CONFIG=<supervisor-config-path>` instead of host-local
absolute paths.
