# AI Coding Quality Kit

This public product overview maps the implemented `codex-supervisor` primitives that turn Codex work into issue-driven, test-backed, reviewable delivery. It is adoption-oriented: use it to see what each primitive does and where the repo already backs it with docs, schema artifacts, or tests.

The kit is intentionally small. It does not introduce new runtime primitives, and it points to existing artifacts instead of restating Phase 15 schema content.

## Public Package Surface

The public package surface is the docs-first bundle recommended by the [Quality kit package surfaces](./quality-kit-package-surfaces.md) Phase 18.1 package-surface comparison. External adopters should treat these artifacts as the stable, copyable quality-kit surface:

- `docs/quality-kit.md`: primitive map and adoption entrypoint
- `docs/issue-metadata.md` and `.github/ISSUE_TEMPLATE/codex-execution-ready.md`: issue authoring contract and copyable execution-ready template
- `docs/issue-body-contract.schema.json`: machine-readable issue-body field contract
- `docs/evidence-timeline.schema.json`: evidence timeline vocabulary for audit and handoff records
- `docs/operator-actions.schema.json`: operator action tokens for status, doctor, WebUI, and external automation routing
- `docs/trust-posture-config.schema.json`: explicit trust and execution-safety posture vocabulary
- `docs/supervised-automation-state-machine.schema.json`: operator-facing lifecycle vocabulary mapped to runtime `RunState`
- `docs/codex-automation-connector-boundary.schema.json`: Codex app Automation boundary for orchestration without executor authority
- `docs/templates/quality-primitives/`: [quality primitive templates](./templates/quality-primitives/README.md) for copying the issue contract, AGENTS.md guidance, local CI gate, evidence timeline, trust posture, and operator action vocabulary into a new repo
- `docs/quality-kit-adoption-checklist.md`: [Quality kit adoption checklist](./quality-kit-adoption-checklist.md) for introducing the docs-first kit to one repository and one safe issue before broader automation
- `docs/kaname-bootstrap-handoff.md`: [KANAME bootstrap handoff](./kaname-bootstrap-handoff.md) for mapping the quality kit to KANAME-000 through KANAME-006 without creating a new repo or runtime
- `docs/examples/self-contained-demo-scenario.md`, `docs/examples/phase-16-dogfood-pr-walkthrough.md`, [Quality gate examples](./examples/quality-gate-examples.md), and `docs/public-demo-validation-checklist.md`: public examples and publishable validation checklist

This surface is intentionally repo-relative and placeholder-driven. It does not publish a cloud service, does not publish a WebUI package, does not publish a provider SDK, and does not expand executor authority beyond the local `codex-supervisor` loop.
It also does not publish an npm package or stable package API in this phase; the `package.json` metadata remains private and points readers back to this repository and docs-first surface.

## Schema Versioning and Compatibility

Public schema artifacts are versioned with the repository release that ships them. Artifacts named `contractName` use `contractVersion`; the Codex Automation connector boundary uses `artifactVersion` because it is a boundary artifact rather than a runtime contract. Each schema includes a `compatibilityPolicy` that names the version field, the existing runtime enforcement boundary, additive changes, breaking changes, and the stability limit.

Additive changes are optional fields, optional examples, advisory notes, or new vocabulary values that existing consumers can ignore while the current parser, config loader, status model, or executor boundary keeps the same behavior. Breaking changes include removing or renaming mandatory fields, changing mandatory metadata, changing vocabulary semantics, changing lifecycle meaning, weakening prohibited bypasses, or changing which runtime boundary is authoritative.

These schemas do not claim standalone runtime stability beyond what the repository enforces today. Compatibility remains anchored to existing behavior: `issue-lint`, config loading and setup readiness, `src/operator-actions.ts`, `IssueRunTimelineExport`, `RunState`, status/explain rendering, and the executor safety gates.

## Internal-Only Surfaces

The following surfaces may support or validate the kit, but external adopters should not depend on them as package contracts:

- `src/**/*.ts`, `src/**/*.test.ts`, and `dist/`: implementation, regression tests, and compiled runtime output
- `.codex-supervisor/` and `.local/`: issue-local supervisor state, journals, generated memory, and host-local runtime data
- WebUI routes, backend DTO shapes, and browser helper internals beyond the published operator action and automation-boundary schema artifacts
- provider-specific runner internals, review-provider adapters, and local CI orchestration details that are configured through `supervisor.config.json`
- KANAME bootstrap bundle or KANAME handoff artifacts: future reusable inputs may consume this docs-first bundle, but this phase does not publish a KANAME repository scaffold, lifecycle owner, release workflow, or bootstrap runtime

## Issue Contract

An Issue Contract turns a GitHub issue into a bounded execution input. The issue must name the behavior delta, scope, acceptance criteria, verification, dependency posture, parallelization posture, and execution order before the supervisor treats it as runnable.

Backed by:

- [Issue metadata](./issue-metadata.md)
- [issue body contract](./issue-body-contract.schema.json)
- [codex issue template](../.github/ISSUE_TEMPLATE/codex-execution-ready.md)
- `src/supervisor/supervisor-selection-issue-lint.test.ts`
- `src/demo-scenario-docs.test.ts`

## Local Verification Gate

The Local Verification Gate keeps a change from advancing on prose alone. Focused issue verification, configured local CI, path hygiene, and build checks provide current-head evidence before PR publication or ready-for-review promotion.

Backed by:

- [Configuration reference](./configuration.md)
- [Local review reference](./local-review.md)
- [Release readiness checklist](./validation-checklist.md)
- [Quality gate examples](./examples/quality-gate-examples.md)
- `src/local-ci.test.ts`
- `src/tracked-pr-local-ci-publication-gate.test.ts`
- `src/post-turn-pull-request.test.ts`

## Prompt Safety Boundary

The Prompt Safety Boundary is the trust posture around text that Codex receives. GitHub-authored issue bodies, PR review comments, and similar text are execution inputs, not supervisor policy; the operator must choose a trusted repo, author lane, config, and execution-safety posture before autonomous runs are appropriate.

Backed by:

- [AI agent handoff](./agent-instructions.md)
- [trust posture](./trust-posture-config.schema.json)
- [Architecture](./architecture.md)
- [Codex app Automation boundary](./automation.md)
- `src/codex/codex-prompt.test.ts`
- `src/local-review/prompt.test.ts`

## Evidence Timeline

The Evidence Timeline records what happened so an operator, reviewer, or future Codex session can audit the run. It ties issue state, branch and head facts, PR state, checks, review facts, local verification, failure signatures, and journal handoff to durable records instead of chat memory.

Backed by:

- [evidence timeline](./evidence-timeline.schema.json)
- [Quality gate examples](./examples/quality-gate-examples.md)
- [self-contained demo scenario](./examples/self-contained-demo-scenario.md)
- [Phase 16 dogfood PR walkthrough](./examples/phase-16-dogfood-pr-walkthrough.md)
- `src/timeline-artifacts.test.ts`
- `src/operator-audit-bundle.test.ts`

## Operator Action

Operator Action is explicit human control over the lane. It covers setup choices, missing prerequisites, loop hosting, recovery acknowledgement, risky cleanup, local CI adoption, follow-up issue confirmation, and manual review decisions.

Backed by:

- [Operator actions](./operator-actions.schema.json)
- [Operator dashboard](./operator-dashboard.md)
- [Getting started](./getting-started.md)
- [Supervised automation lane](./supervised-automation-lane.md)
- `src/operator-actions.test.ts`
- `src/supervisor/supervisor-diagnostics-status-selection.test.ts`

## Durable History Writeback

Durable History Writeback preserves the facts needed after thread loss, process restart, release review, or future planning. The active issue journal carries short-horizon working notes; GitHub issues, PRs, evidence timeline entries, and operator-maintained project notes carry longer-lived history.

Backed by:

- [Supervised automation lane](./supervised-automation-lane.md)
- [Architecture](./architecture.md)
- [self-contained demo scenario](./examples/self-contained-demo-scenario.md)
- [Codex app Automation boundary](./automation.md)
- `src/journal.test.ts`
- `src/supervisor/supervisor-recovery-reconciliation.test.ts`

## Reading Path

Start with this map when you need the product primitive vocabulary. For a first safe issue in a new repo, use the [Quality kit adoption checklist](./quality-kit-adoption-checklist.md), copy [quality primitive templates](./templates/quality-primitives/README.md) starting with `issue-contract.md`, then use [Getting started](./getting-started.md) for first-run operation, [Issue metadata](./issue-metadata.md) for authoring, [Configuration reference](./configuration.md) for trust and local verification posture, and [Architecture](./architecture.md) for the runtime boundaries.
