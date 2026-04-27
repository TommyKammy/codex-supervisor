# Vibe Coding Before / After

This page shows the same small change in two flows. The goal is not to dunk on vibe coding. A live chat session can be useful when a human is exploring, deciding, and steering every step. `codex-supervisor` adds the missing quality layer when that exploration needs to become issue-driven, test-backed, reviewable delivery.

## Same Small Change

Imagine a repository needs one small docs fix: add a link from `README.md` to a new operator note, then prove the link stays valid.

The code delta is intentionally tiny. The difference is the execution surface around it.

## Before: Unstructured Chat Session

In an unstructured chat session, the operator usually writes a prompt such as "add the README link and make sure it works." The assistant edits the file, maybe runs a command, and reports back in the same conversation.

That can be enough for exploratory work, but important facts are easy to leave implicit:

- the exact behavior delta may live only in chat history
- acceptance criteria may be implied rather than written as an execution-ready GitHub issue
- local verification may be skipped, broad, or hard to replay
- review context may be scattered across chat messages instead of attached to a draft PR
- handoff evidence may disappear when the session is compacted or restarted

The human operator can still impose rigor manually. The problem is that the rigor is not the default shape of the workflow.

## After: Supervised codex-supervisor Loop

With `codex-supervisor`, the same change starts from an execution-ready GitHub issue. The issue names the summary, scope, acceptance criteria, verification, dependency posture, parallelization posture, and execution order before the loop treats it as runnable.

For an annotated version of the same lifecycle using Phase 16's own supervised demo-material work, read the [Phase 16 dogfood PR walkthrough](./examples/phase-16-dogfood-pr-walkthrough.md).

For the README-link change, a supervised run produces concrete artifacts:

- an execution-ready GitHub issue that defines the behavior delta and verification command
- a per-issue worktree on the issue branch, isolated from unrelated local work
- an issue journal that records the current hypothesis, changed files, focused commands, failures, and next action
- a draft PR that makes the delta reviewable by CI, configured review providers, and the human operator
- local verification output such as a focused docs test, `npm run verify:paths`, and `npm run build`
- an evidence timeline that records issue state, branch/head facts, PR facts, checks, review facts, and recovery context
- durable history through the issue, PR, journal, and any release or project notes the operator chooses to maintain

The Codex turn still edits files and runs commands, but it is wrapped in a product contract. The loop re-reads current issue and PR facts instead of treating chat memory as the source of truth.

## Quality Delta

| Surface | Unstructured chat | Supervised loop |
| --- | --- | --- |
| Task definition | Prompt text and chat context | Execution-ready GitHub issue |
| Scope control | Human remembers the boundary | Scope and acceptance criteria are written before execution |
| Verification | Optional or ad hoc command output | Focused local verification plus configured gates |
| Reviewability | Diff may stay local until the human packages it | Draft PR is part of the normal path |
| Evidence | Conversation transcript | Issue journal, evidence timeline, PR facts, checks, and review facts |
| Continuation | Restart from memory or summarize the chat | Resume from issue state, worktree, journal, and PR evidence |

This is the product value: `codex-supervisor` turns a useful coding assistant into a supervised delivery lane. It does not make the assistant magically correct; it makes the work easier to inspect, replay, repair, and hand off.

## Operator Boundary

`codex-supervisor` does not replace the human operator. The operator still owns repository trust, GitHub author trust, config selection, branch protection, review policy, secrets, and final judgment about whether the work should merge.

The supervisor should not claim unsafe autonomy. It should surface missing prerequisites, malformed issue metadata, failing verification, stale PR facts, review blockers, path-hygiene failures, or manual-review needs instead of guessing success. The quality layer is valuable because it keeps those boundaries visible while Codex handles bounded implementation turns.
