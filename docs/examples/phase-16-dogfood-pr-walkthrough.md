# Phase 16 Dogfood PR Walkthrough

This walkthrough shows how a Phase 16 supervised issue becomes a reviewable PR with durable evidence. It is a docs artifact, not a new runner or a credentialed demo. A new reader can follow the lifecycle offline without running `codex-supervisor` or authenticating to GitHub.

## Provenance

Phase 16 is the repository's own supervised-demo-material phase. The most faithful source is the live supervised PR flow that produces these docs. Because this page must be publishable without workstation-local paths, private config values, or live GitHub credentials, the walkthrough uses a sanitized equivalent of that flow:

- issue: `#<issue-number>` from the Phase 16 sequence
- branch: `codex/issue-<issue-number>`
- PR: `#<pr-number>` once the supervisor opens the draft PR
- head: `<head-sha>` from the current branch head
- config: `<supervisor-config-path>` or `CODEX_SUPERVISOR_CONFIG`

The sanitized equivalent preserves the product contract: execution-ready issue metadata, per-issue worktree, issue journal, local verification, draft PR review, configured review provider signals, operator actions, and evidence timeline entries all remain visible as separate lifecycle surfaces.

## Lifecycle Walkthrough

| Step | What happens | Evidence to look for | Annotation |
| --- | --- | --- | --- |
| 1. Issue becomes runnable | The operator writes a `codex` issue with `## Summary`, `## Scope`, `## Acceptance criteria`, `## Verification`, `Depends on`, `Parallelizable`, and `## Execution order`. Sequenced Phase 16 children also include `Part of: #<epic-number>`. | GitHub issue body and `issue-lint` output. | `issue-lint` is the readiness boundary; it validates metadata before the loop treats the issue as runnable. |
| 2. Supervisor reserves the issue | The loop selects the next unblocked Phase 16 child and creates or reuses the isolated issue branch and worktree. | Issue journal handoff, branch name, and evidence timeline reservation event. | The issue journal records the active hypothesis and next exact step, while the evidence timeline records the run-level lifecycle fact. |
| 3. Codex implements the bounded delta | Codex edits only the files needed for the issue. For this walkthrough, the bounded delta is public docs material and focused docs tests. | Changed files on `codex/issue-<issue-number>` and the issue journal's `Files touched` field. | The issue scope remains the authority; the docs page does not expand executor authority or introduce a demo runner. |
| 4. Local verification runs | The worktree proves the docs behavior before PR progression. | Focused docs test, `npm run verify:paths`, and `npm run build`. | Local verification is current-head evidence, not a prose claim. Path hygiene specifically blocks workstation-local paths and private config values. |
| 5. Draft PR is opened | The branch becomes reviewable as a draft PR. | Draft PR URL, PR head SHA, changed-file list, and CI check rollup when available. | The draft PR is the review surface for humans, CI, and configured review provider signals. |
| 6. Review provider signals settle | The configured provider posts or withholds review on the current head. | Review comments, review summaries, or local review artifacts linked to the same head SHA. | Review provider signals are inputs, not trusted policy. The supervisor must still honor local safeguards and fresh PR facts. |
| 7. Operator action resolves the boundary | The operator decides whether to continue, request a fix, wait for CI, or merge after gates pass. | Operator action record, PR state transition, and issue journal handoff. | Operator actions remain explicit; the walkthrough does not require live credentials to read or validate the docs. |
| 8. Terminal evidence is durable | The issue reaches a terminal state such as `done`, or the journal explains the blocker. | Evidence timeline terminal event, issue journal, PR outcome, and release or history notes if maintained. | Later sessions recover from durable state and GitHub facts instead of chat memory. |

Focused readiness command:

```bash
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
```

Equivalent environment-variable form:

```bash
export CODEX_SUPERVISOR_CONFIG=<supervisor-config-path>
node dist/index.js issue-lint <issue-number> --config "$CODEX_SUPERVISOR_CONFIG"
```

Focused verification for this docs walkthrough:

```bash
npx tsx --test src/demo-scenario-docs.test.ts src/readme-docs.test.ts
npm run verify:paths
npm run build
```

## Artifact Contracts

Use the current repo contracts instead of this page as policy:

- [Issue metadata](../issue-metadata.md) (`docs/issue-metadata.md`) defines execution-ready issue bodies and `issue-lint` expectations.
- [Issue body contract](../issue-body-contract.schema.json) (`docs/issue-body-contract.schema.json`) publishes the portable issue-body field shape for external tooling.
- [Evidence timeline schema](../evidence-timeline.schema.json) (`docs/evidence-timeline.schema.json`) publishes the run evidence contract.
- [Operator actions schema](../operator-actions.schema.json) (`docs/operator-actions.schema.json`) publishes the operator action contract.
- [Architecture](../architecture.md) (`docs/architecture.md`) explains the loop, durable state, PR freshness, and safety boundaries.
- [Automation boundary](../automation.md) (`docs/automation.md`) explains why orchestration must not bypass executor gates, local CI, issue-lint, fresh PR facts, or operator confirmations.

## Sanitization Boundary

This page intentionally uses placeholders rather than local machine values:

- use `<supervisor-config-path>` instead of a host-specific config path
- use `<codex-supervisor-root>` when a root placeholder is needed
- use `#<issue-number>`, `#<pr-number>`, and `<head-sha>` for GitHub-specific facts
- keep secrets, private config values, and workstation-local absolute paths out of publishable Markdown

If a future Phase 16 PR provides public evidence that can be cited safely, update the placeholders with public issue or PR numbers only when doing so does not embed private host details. Otherwise, keep the sanitized equivalent: it demonstrates the same supervised lifecycle without turning local operational facts into docs.

## Read Offline

A new reader should be able to read this walkthrough and understand the PR lifecycle without running the supervisor:

1. The issue body becomes runnable only after `issue-lint` accepts the metadata.
2. The supervisor creates an isolated branch, worktree, and issue journal.
3. Codex implements one bounded behavior delta.
4. Local verification proves the current head before PR progression.
5. The draft PR gathers CI, review provider signals, and human review.
6. Operator actions decide when to continue, fix, wait, or merge.
7. The evidence timeline and issue journal preserve what happened for later recovery and audit.
