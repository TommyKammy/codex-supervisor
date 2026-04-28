# Quality Gate Examples

These examples show how the quality-kit gates improve AI coding outcomes before merge. They are readable offline, do not require live GitHub credentials, and use placeholder inputs instead of host-specific paths, secrets, or provider-owned IDs.

Use them as adoption examples for another repository. They explain the gate shape, the AI failure it catches, the copyable command, and the evidence a reviewer should expect before trusting the result.

## Local CI

Local CI is the first proof that the current head still satisfies the repo-owned contract. It catches generated code that looks plausible in chat but fails the actual TypeScript build, test runner, or configured project checks.

Example adoption shape:

```bash
npm run verify:paths
npm run verify:subprocess-safety
npm run build
```

Expected quality improvement:

- Codex must report concrete command output instead of saying that a change "should compile."
- Reviewers can compare the PR head against the same local gate before ready-for-review promotion.
- Failed checks become repair input for the next turn rather than hidden follow-up work.

Offline evidence to record:

```md
Gate: local-ci
Command: npm run build
Outcome: passed
Head: <commit-sha>
```

## Path Hygiene

Path hygiene blocks publishable artifacts that leak workstation-local absolute paths. The examples, issue bodies, docs, and prompts should prefer placeholders such as `<codex-supervisor-root>`, `<supervisor-config-path>`, and `CODEX_SUPERVISOR_CONFIG`.

Example adoption shape:

```bash
npm run verify:paths
```

Good publishable guidance:

```bash
CODEX_SUPERVISOR_CONFIG=<supervisor-config-path> node dist/index.js status
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
```

Expected quality improvement:

- AI output can include exact commands without leaking a maintainer home directory.
- Durable docs remain copyable across machines and CI runners.
- A path finding blocks publication until the tracked content is repaired.

Offline evidence to record:

```md
Gate: path-hygiene
Command: npm run verify:paths
Outcome: passed
Finding: none
```

## Review Readiness

Review readiness separates "the code changed" from "the PR is ready for another person or bot to review." It should require a valid issue contract, focused local verification, and a review boundary that treats GitHub-authored text as untrusted context.

Example adoption shape:

```bash
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
npm run verify:paths
npm run build
```

Expected quality improvement:

- The issue body proves scope, acceptance criteria, dependencies, parallelization posture, and execution order before work is delegated.
- The PR is not promoted only because Codex finished a turn.
- Missing verification, ambiguous dependencies, or malformed metadata stay visible before merge.

Offline evidence to record:

```md
Gate: review-readiness
Issue: <issue-number>
Issue lint: passed
Local verification: passed
Review boundary: GitHub-authored text treated as untrusted context
```

## Stale Review Bot Remediation Boundary

A SafeQuery-shaped metadata-only stale review bot case is a quality-surface example, not permission to broaden review automation. The safe case is narrow: a configured review bot left a review thread whose latest actionable provider signal is no longer present on the current head, and the remaining state is only stale metadata that has already been reconciled by the supervisor.

Handled example:

```md
Case: SafeQuery-shaped metadata-only stale review bot
Current head: <commit-sha>
Configured review bot: <configured-review-bot-login>
Thread state: unresolved in provider metadata
Latest provider signal on current head: none
Supervisor conclusion: metadata-only handled review state
Action: keep the reconciliation evidence; do not treat the stale metadata as a current code blocker
```

Blocked example:

```md
Case: genuine unresolved provider-signal
Current head: <commit-sha>
Configured review bot: <configured-review-bot-login>
Thread state: unresolved
Latest provider signal on current head: actionable comment exists
Supervisor conclusion: unresolved review blocker
Action: must stay unresolved until the code is fixed, the bot thread is resolved, or an operator records a manual review decision
```

Expected quality improvement:

- Stale metadata does not trap the lane when current-head provider evidence is gone.
- A genuine unresolved provider-signal must stay unresolved and block readiness.
- Provider outages, missing review facts, or unauthenticated reads fail closed instead of being interpreted as safe.

Offline evidence to record:

```md
Gate: stale-review-bot-boundary
Source: review-provider-metadata
Current-head signal: <none|actionable-comment>
Outcome: <handled-metadata-only|blocked-unresolved-provider-signal>
```

## Evidence Timeline

The evidence timeline gives future operators and reviewers a compact audit trail. It should show which gate ran, the head it applied to, the outcome, the remediation target, and the next action.

Example adoption shape:

```bash
node dist/index.js explain <issue-number> --timeline --config <supervisor-config-path>
```

Expected quality improvement:

- A later Codex session can resume from durable facts instead of reconstructing chat history.
- Failed gates identify the remediation target before the next turn starts.
- Reviewers can see whether local CI, path hygiene, review readiness, and stale review bot decisions applied to the same head.

Offline evidence to record:

```md
timeline_event index=1 type=issue_body outcome=available head_sha=<commit-sha> summary="Issue body snapshot is available."
timeline_event index=2 type=local_ci outcome=passed head_sha=<commit-sha> summary="Build passed."
timeline_event index=3 type=review outcome=blocked head_sha=<commit-sha> remediation_target=review_provider_signal next_action=fix_or_manual_review
```

Do not stitch together timeline events from different heads as if they prove one ready state. If a read set is mixed or incomplete, record the ambiguity and rerun the gate against a single committed snapshot.
