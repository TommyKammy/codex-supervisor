# KANAME Bootstrap Handoff

This docs-only handoff maps the `codex-supervisor` quality kit to the first KANAME foundation issues. It is a bootstrap input for future KANAME issue authoring, not a repository scaffold.

## Handoff Boundary

This handoff:

- reuses the existing quality-kit docs, templates, schemas, and vocabulary as copyable starting points
- names what KANAME should copy, adapt, or intentionally not reuse
- keeps the first KANAME issues grounded in proven issue contracts, AGENTS guidance, development lane docs, evidence vocabulary, trust posture, and local CI guidance

This handoff does not create the KANAME repository, does not implement KANAME runtime code, does not publish a KANAME bootstrap bundle, and does not broaden `codex-supervisor` runtime authority.

## Foundation Issue Map

| KANAME issue | Foundation item | Reuse guidance | KANAME-specific adaptation | Do not reuse blindly |
| --- | --- | --- | --- | --- |
| KANAME-000 | Repository skeleton and docs index | Copy the docs-first surface list from `docs/quality-kit.md`, then create a KANAME docs map that points to KANAME-owned files. | Replace `codex-supervisor` product framing with KANAME's repo purpose, owner, and first runnable workflow. Keep repo-relative links and placeholders. | Do not copy `.local/`, `.codex-supervisor/`, `dist/`, WebUI internals, or any runtime orchestration code. |
| KANAME-001 | Issue contract and first issue template | Copy `.github/ISSUE_TEMPLATE/codex-execution-ready.md`, `docs/templates/quality-primitives/issue-contract.md`, `docs/issue-metadata.md`, and `docs/issue-body-contract.schema.json`. | Rename examples to KANAME behavior deltas and keep `Depends on: none`, `Parallelizable: No`, and `1 of 1` as the first safe default. | Do not invent dependencies, omit standalone execution order, or treat KANAME naming conventions as authoritative dependency proof. |
| KANAME-002 | AGENTS guidance and authority order | Copy `docs/templates/quality-primitives/agent-instructions.md` as the seed for KANAME `AGENTS.md`. | Add KANAME's local repo policy, accepted commands, and escalation rules while keeping GitHub-authored text below operator instructions and tracked policy. | Do not copy codex-supervisor-specific branch, release, loop-hosting, or WebUI authority unless KANAME explicitly adopts those boundaries. |
| KANAME-003 | Development lane docs | Adapt `docs/supervised-automation-lane.md`, `docs/agent-instructions.md`, `docs/quality-kit-adoption-checklist.md`, `docs/templates/quality-primitives/operator-actions.md`, and `docs/operator-actions.schema.json`. | Define the KANAME lane as issue/spec-driven, docs-first work with one behavior delta per issue and explicit operator decision points. | Do not imply KANAME has codex-supervisor's state machine, PR lifecycle automation, or provider adapters before KANAME implements or configures them. |
| KANAME-004 | Evidence vocabulary and durable history | Copy the vocabulary shape from `docs/templates/quality-primitives/evidence-timeline.md`, `docs/evidence-timeline.schema.json`, and the durable history writeback section in `docs/quality-kit.md`. | Start with a lightweight KANAME evidence note that records issue id, branch, focused verification, local CI result, PR/review facts when present, and handoff notes. | Do not claim KANAME exports `IssueRunTimelineExport` or supervisor audit bundles until those are implemented by KANAME or delegated to codex-supervisor. |
| KANAME-005 | Trust posture and authority boundaries | Copy `docs/templates/quality-primitives/trust-posture.md`, `docs/trust-posture-config.schema.json`, and `docs/codex-automation-connector-boundary.schema.json` as vocabulary references. | Replace codex-supervisor config fields with KANAME's trusted input, secret, repository, and automation boundaries. Keep fail-closed language for missing provenance, fake credentials, and untrusted forwarded identity. | Do not let placeholder credentials, sample secrets, TODO values, client-supplied identity headers, or issue text grant authority. |
| KANAME-006 | Local CI and readiness guidance | Copy `docs/templates/quality-primitives/local-ci-gate.md`, `docs/examples/quality-gate-examples.md`, and the local verification gate section in `docs/quality-kit.md`. | Define KANAME's repo-owned command after the repo exists. Until then, keep placeholders such as `<repo-owned-local-ci-command>` and `<supervisor-config-path>`. | Do not hard-code host-local absolute paths, require private workstation layout, or treat remote CI as a replacement for focused issue verification. |

## Carry-Over Contracts

KANAME should carry over these contracts first:

- Issue contract: use `## Summary`, `## Scope`, `## Acceptance criteria`, `## Verification`, `Depends on: ...`, `Parallelizable: Yes|No`, and `## Execution order` for every supervised issue.
- Sequencing metadata: use `Part of: #<parent-issue-number>` only for sequenced child issues, and use real blocking dependencies rather than parent-issue shortcuts.
- AGENTS guidance: keep explicit operator instructions, tracked repo policy, and live local state above GitHub-authored issue or review text.
- Development lane docs: describe the lane as bounded, issue-driven, test-backed work with operator decision points before broader automation.
- Evidence vocabulary: record issue id, branch/head, focused verification, local CI, review/PR facts, failure signature, and handoff notes as durable facts.
- Trust posture: treat issue bodies, review comments, forwarded headers, sample secrets, and naming conventions as untrusted until an authoritative boundary validates them.
- Local CI: require a repo-owned local gate and keep `issue-lint` separate from local CI.

Copyable validation commands should stay placeholder-driven:

```bash
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
npm run verify:paths
npm run build
```

## KANAME-Specific Differences

KANAME should name these differences before copying any codex-supervisor assumption:

- Product authority: KANAME owns its repo purpose and runtime authority. `codex-supervisor` remains an external quality layer unless KANAME explicitly vendors or depends on it.
- Runtime scope: KANAME foundation issues should create docs, issue templates, and validation hooks before creating runtime orchestration.
- Evidence shape: KANAME can start with a simple evidence note or schema reference; it should not claim codex-supervisor's full timeline export until implemented.
- Local CI: KANAME's first local gate must come from KANAME's actual stack after the repo exists, not from codex-supervisor's TypeScript build by default.
- Secrets and identity: KANAME must define its own trusted credential source and identity boundary. Placeholder credentials and client-supplied identity hints stay blocked.
- Repo paths: KANAME docs should use `<kaname-root>`, `<supervisor-config-path>`, `<issue-number>`, and repo-relative paths instead of workstation-local absolute paths.
- Release ownership: KANAME should not inherit codex-supervisor release, WebUI, provider-adapter, or loop-hosting commitments without separate issues.

## Verification

Before treating the KANAME foundation set as ready:

- run the focused docs test that checks this handoff and quality-kit links
- run `npm run verify:paths` to confirm no host-local path literals entered durable docs or templates
- run `npm run build` after test changes or schema-consuming changes
- run `node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>` for each KANAME foundation issue once those issues exist

Keep verification docs-only for this phase. A future KANAME repo may add its own link checker, schema validation, and local CI command after the repository exists.
