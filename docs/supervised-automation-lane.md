# Supervised Automation Lane

This note defines `codex-supervisor` as an OpenAI-ready product primitive: a supervised automation lane for issue/spec-driven implementation work. It describes the product shape operators can reason about before they look at implementation modules.

The lane sits beside Codex app chat and vibe coding. Chat-driven vibe coding is useful when a human is steering one session directly, revising the prompt as the work unfolds, and deciding when the result is good enough. The supervised automation lane is for work that has already been reduced to an explicit task contract, dependency order, trust posture, and verification surface. The operator gives the lane bounded authority to keep one issue moving through worktree, PR, CI, review, and merge-readiness states without treating chat memory as the source of truth.

This is not a broader autonomy pitch. The lane does not create new automation authority, does not default-enable follow-up issue creation, and does not broaden trusted solo-lane automation into multi-user governance.

## Product Primitive

The supervised automation lane is a durable execution wrapper around Codex turns. Its primitive is not a module or a background worker; it is a product contract with explicit inputs, authority boundaries, observable evidence, and bounded recovery.

### Task Contract

The task contract is the execution-ready GitHub issue. It names the behavior delta, scope, acceptance criteria, verification, dependencies, parallelization posture, and execution order. The issue body is an input to the lane, not a policy override. GitHub-authored text is execution input, not supervisor policy, and malformed or incomplete metadata should block or stay unrunnable instead of being inferred into a permissive plan.

### Trust Posture

The lane starts from an operator trust decision. The managed repo, local config, GitHub authors, review-provider text, and Codex execution environment must be trusted before autonomous execution is appropriate. The current runtime invokes Codex with elevated local authority, so the safe boundary is to choose the trusted lane before the turn starts rather than trying to recover trust after untrusted text has become execution input.

### Execution Attempt

An execution attempt is one bounded Codex turn against one selected issue in a dedicated worktree. The supervisor supplies current issue context, durable memory pointers, path-literal hygiene guidance, and the issue journal. The turn can change files, run focused verification, and produce a handoff, but it should not invent runtime authority or ignore the repo-owned safety boundaries.

### Evidence Timeline

The evidence timeline is the chain of facts that lets an operator or later session understand what happened. It includes issue state, branch and head SHA, worktree state, PR facts, checks, review facts, local verification, failure signatures, and the per-issue journal. Derived status text is an operator surface; action-taking paths should resolve from authoritative lifecycle records and fresh GitHub facts.

### Auditable Work State Machine

Agent work in the supervised automation lane should be understood as an auditable state machine, not as an opaque chat transcript. This product-level model keeps the vocabulary aligned with status, explain, WebUI, evidence timeline, and recovery diagnostics, but it does not rename runtime states or change selection, merge, or recovery behavior.

Operator-facing state is a trust surface. It tells the operator which authority boundary currently owns progress, which evidence proves that conclusion, and what action is allowed next. Derived status text should therefore be recalculated from authoritative lifecycle records, fresh GitHub facts, and the issue journal instead of becoming a separate source of truth.

| State | Reason | Evidence | Authority Boundary | Next Operator Action |
| --- | --- | --- | --- | --- |
| `queued` | A runnable issue is ready or has been requeued for another supervised attempt. | Issue metadata, dependency order, labels, local state record, and absence of a blocking active attempt. | Supervisor-owned once the issue body is execution-ready and the configured trust lane is acceptable. | Run `status --why`, `issue-lint`, or `run-once`; fix issue metadata if readiness evidence is missing. |
| `running` | A Codex turn is actively executing or the current phase is one of the live work phases such as planning, reproducing, implementing, local review fix, or stabilizing. | Active issue record, lock/session state, worktree, last head SHA, and issue journal handoff. | Supervisor-owned while locks and the current Codex session remain authoritative; operator judgment is required if locks, session state, or durable state conflict. | Let the turn finish, inspect the journal after interruption, or resolve stale locks only after confirming the real process state. |
| `blocked` | The lane cannot advance because a prerequisite or fail-closed guard is missing. | Blocked reason, failure context, diagnostics, issue journal, path-hygiene or verification artifacts, and explain output. | Shared boundary: supervisor records the block; operator judgment owns requirements, permissions, secrets, manual review, and recovery acknowledgement. | Satisfy the named prerequisite, edit the issue body, supply trusted config/auth, or leave the issue blocked. |
| `waiting_ci` | PR progress depends on check results, CI freshness, or local CI contract evidence. | PR number, head SHA, check rollup, local CI artifact, and timeline entry. | Supervisor-owned for observation and repair routing; GitHub checks and repo CI remain the authoritative result source. | Wait for checks, inspect failing jobs, or allow configured CI repair when the failure is in scope. |
| `waiting_review` | PR progress depends on review-provider or required-review facts settling. | Fresh PR review facts, review threads, configured bot diagnostics, review wait timestamps, and status or explain lines. | Mixed boundary: supervisor observes and classifies; GitHub review state and provider behavior are authoritative; operator judgment handles provider outages or missing trusted review. | Wait for review, request/re-run the provider outside the supervisor, or escalate to manual review when diagnostics require it. |
| `repairing_ci` | The lane is running a bounded repair attempt for an in-scope CI, verification, or path-hygiene failure. | Failure signature, repair target, previous verification artifact, Codex turn record, and journal notes. | Supervisor-owned only for the configured repair scope; it must not widen into unrelated behavior or invent missing authority. | Let the repair complete, review the resulting diff and verification, or block if the same signature exhausts retry policy. |
| `merging` | The PR is in the merge path after readiness evidence has been established. | Fresh PR facts, branch protection/check status, review status, head-SHA match, and merge attempt record. | Supervisor-owned for the merge attempt only when fresh facts match the recorded head; GitHub branch protection remains authoritative. | Do not reinterpret stale status as merge-ready; re-run status/explain if the head or review facts changed. |
| `done` | The issue has reached a terminal completed lifecycle state. | Merged PR or authoritative completion record, closed issue reconciliation, final journal handoff, and cleanup eligibility. | Supervisor-owned for reconciliation from authoritative lifecycle facts; derived summaries and counters must follow the terminal record. | Inspect final evidence, allow tracked done cleanup after its delay, or create an explicit follow-up for new work. |
| `manual_review` | Progress requires human judgment, usually represented as `blocked` with `blocked_reason=manual_review` rather than a separate runtime state. | Manual-review blocked reason, review residuals, path-hygiene decision, diagnostics, sticky PR status comment, and journal handoff. | Operator judgment owns the decision; the supervisor must preserve evidence and fail closed until that decision is made. | Review the evidence, decide whether to unblock, repair, split follow-up work, or keep the issue blocked. |

### Operator Action

Operator action is explicit human control over the lane. Examples include choosing the config, starting or stopping the loop, acknowledging corrupted state recovery, pruning orphaned workspaces, approving follow-up issue creation, or deciding that a trust prerequisite is missing. Operator action is a boundary, not an implementation convenience; the lane should surface real prerequisites instead of silently guessing them.

### Bounded Recovery

Bounded recovery keeps failures inside the lane. The supervisor can retry known repair states, resume Codex sessions, preserve issue journals, reconcile PR state, and keep failed attempts observable. Recovery must stay fail-closed: corrupted state, missing auth, ambiguous scope, stale review facts, or half-written durable state should block or require explicit operator handling rather than becoming a new source of authority.

### Durable Memory Writeback

Durable memory writeback is the repo-owned and issue-owned context that survives thread loss. The issue journal records the current hypothesis, changes, blockers, verification gap, files touched, and next exact step. Shared memory files and docs provide longer-lived operating context. Writeback should be concise, factual, and anchored to current evidence so later Codex turns can continue from the lane state instead of reconstructing from chat.

## Difference From Vibe Coding

| Chat-driven vibe coding | Issue/spec-driven supervised automation |
| --- | --- |
| Human steers a live chat session | GitHub issue and repo state steer the next runnable action |
| Chat history often carries the working plan | Issue metadata, worktree state, PR facts, and journal entries carry the plan |
| Safety depends on the human watching each step | Safety depends on explicit trust posture, branch protection, review facts, and local verification gates |
| Recovery often means starting another chat | Recovery resumes from durable state, issue journal, and bounded failure signatures |
| Follow-up work is usually discussed inline | Follow-up issue creation remains confirm-required and narrow |

## Authority Boundaries

- GitHub-authored issue bodies, review comments, and summaries are untrusted execution inputs until the operator has chosen a trusted repo and author lane.
- Codex app Automation may orchestrate around the lane, but `codex-supervisor` remains the implementation executor.
- The lane does not create new automation authority beyond the operator-selected config and repo workflow.
- The lane does not default-enable follow-up issue creation; follow-ups remain confirm-required and scoped to one behavior delta.
- The lane should preserve trusted solo-lane automation and should not recast the product as broad multi-user governance.
- Fresh PR review facts, branch protection, head-SHA matching, local path hygiene, and issue metadata remain safety surfaces.

## Current Behavior Anchors

Current `codex-supervisor` behavior already implements most of this product shape:

- execution-ready issues are linted from canonical metadata before they are treated as runnable
- each issue runs in a dedicated worktree with a persistent issue journal
- the loop refreshes GitHub facts before action-taking PR and merge transitions
- local state and journals provide recovery points across process restarts and thread loss
- review, CI, and verification failures are kept in bounded repair states instead of being hidden
- operator actions own setup, loop hosting, explicit recovery, and risky cleanup decisions

Use this note as the product primitive contract. Use [Architecture](./architecture.md), [Configuration reference](./configuration.md), [Issue metadata](./issue-metadata.md), and [Codex app Automation boundary](./automation.md) for the detailed runtime and operator references.
