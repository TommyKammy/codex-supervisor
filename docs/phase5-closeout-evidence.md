# Phase 5 Closeout Evidence

Phase 5 defines the external orchestration boundary around the thin supervisor core. The core keeps executor-owned mutation, safety gates, and PR lifecycle decisions. External orchestration may prepare evidence and route operator attention, but it cannot authorize Codex execution, GitHub mutation, or merge execution.

## Child Issue Outcomes

- `#2322` added the Phase 5 boundary inventory in [automation](./automation.md) and the portable [Codex Automation connector boundary](./codex-automation-connector-boundary.schema.json).
- `#2323` published operator-action routing metadata in [operator actions](./operator-actions.schema.json), separating core actions from external orchestration handoffs.
- `#2324` surfaced handoff evidence in status and explain output with `routing_category`, `mutation_authority`, `external_handoff`, and preserved core safety gate fields.
- `#2325` added regression coverage proving external orchestration handoff evidence cannot bypass issue selection, run-once execution, post-turn PR transitions, Decision Kernel v2 action input, or replay-corpus safety expectations.
- `#2326` records this closeout evidence, rollback posture, and broad verification surface.

## Responsibility Boundary

Core responsibilities remain inside `codex-supervisor`:

- issue contract validation and `issue-lint` readiness
- issue selection, per-issue worktree ownership, and journal ownership
- Codex execution and resume orchestration
- PR lifecycle action selection, including review, CI, stale-review terminal handling, operator escalation, and merge-readiness decisions
- branch protection, head-SHA, local CI, review, mergeability, and final auto-merge safety gates
- replay, status, and explain evidence for supervisor-owned decisions

External orchestration responsibilities remain outside core:

- evaluate roadmap, GitHub, local status, and external note state
- route actionable changes to the operator or the next runnable issue
- draft confirm-required follow-up issues
- record durable Obsidian or external history after real state changes
- notify the operator about actionable state changes
- prepare operator-facing evidence without treating that evidence as executor authority

## Contract Surfaces

- [automation](./automation.md) states the Phase 5 boundary inventory and non-goals.
- [Codex Automation connector boundary](./codex-automation-connector-boundary.schema.json) publishes the portable connector artifact.
- [operator actions](./operator-actions.schema.json) defines `external_orchestration_handoff` and requires routing metadata.
- `src/supervisor/supervisor-status-report.ts` renders Decision Kernel v2 mode and handoff evidence for status.
- `src/decision-kernel/v2-explain.ts` renders `v2_routing` evidence for explain output.
- `src/decision-kernel/v2-pr-lifecycle-action.ts` keeps PR lifecycle action input typed around core safety evidence, without external handoff authority fields.
- `replay-corpus/cases/phase5-aegisops-external-handoff-review-ci-merge/` and `replay-corpus/cases/phase5-hrcore-external-handoff-metadata-residue/` preserve representative Phase 5 handoff evidence.

## Safety Evidence

- Source guards in `src/run-once-issue-selection.test.ts`, `src/run-once-turn-execution.test.ts`, and `src/post-turn-pull-request.test.ts` fail if issue selection, Codex execution, or post-turn PR transitions consume `external_orchestration_handoff`, `externalOrchestrationHandoff`, `routingCategory`, or `mutationAuthority` as authority.
- `src/decision-kernel/v2-pr-lifecycle-action.test.ts` verifies that `DecisionKernelV2PrLifecycleActionInput` excludes external handoff authority fields and still fails closed without explicit core merge gate evidence.
- `src/supervisor/replay-corpus.test.ts` runs the checked-in Phase 5 replay cases and verifies handoff evidence remains bounded with `mutationAuthority=none` and `boundedNextAction=ask_operator`.
- Status and explain tests verify external handoff evidence is reported as non-mutating evidence while core safety gates remain preserved.

## Rollback Posture

The rollback path is core-only behavior:

- Disable or ignore external orchestration handoff metadata.
- Keep issue selection, Codex execution, post-turn PR transitions, review handling, local CI, branch protection, and merge execution unchanged.
- Use `disabled` or `diagnostic_only` Decision Kernel v2 mode when PR lifecycle action-taking must be rolled back.
- Continue treating external orchestration output as operator-facing evidence only; do not map it into executor authority or merge authority.
- Preserve checked-in replay corpus cases so operators can confirm that external evidence is still bounded after rollback.

## Verification Evidence

Phase 5 closeout is accepted only with broad boundary verification:

- `npx tsx --test src/decision-kernel*.test.ts src/decision-kernel/*.test.ts src/supervisor/*status*.test.ts src/supervisor/*explain*.test.ts src/run-once*.test.ts src/post-turn-pull-request*.test.ts src/supervisor/replay-corpus.test.ts`
- `npm run build`
- `git diff --check`

No Phase 5 closeout step changes issue selection, Codex execution, PR mutation, merge execution, branch protection, or loop ownership.
