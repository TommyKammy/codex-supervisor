# Public Demo Validation Checklist

Use this checklist before publishing screenshots, README snippets, walkthrough copy, release notes, or external handoff material that points at the public demo assets. The checklist is repo-owned so maintainers can validate demo freshness without reconstructing Phase 16 context from chat.

The demo assets are intentionally offline-readable:

- [Self-contained demo scenario](./examples/self-contained-demo-scenario.md) (`docs/examples/self-contained-demo-scenario.md`)
- [Phase 16 dogfood PR walkthrough](./examples/phase-16-dogfood-pr-walkthrough.md) (`docs/examples/phase-16-dogfood-pr-walkthrough.md`)
- [Issue body contract schema](./issue-body-contract.schema.json)
- [Evidence timeline schema](./evidence-timeline.schema.json)
- [Operator actions schema](./operator-actions.schema.json)

## Checklist

- [ ] `README positioning`: the README links the self-contained demo scenario, annotated PR walkthrough, public demo validation checklist, issue metadata reference, and release readiness checklist from the docs map without re-explaining those artifacts as policy.
- [ ] `self-contained demo scenario`: the sample issue body remains execution-ready, keeps one behavior delta, uses canonical scheduling metadata, and validates with `node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>`.
- [ ] `annotated PR walkthrough`: the walkthrough still describes issue-lint, isolated worktree and issue journal, local verification, draft PR review, review provider signals, operator actions, and evidence timeline entries as separate lifecycle surfaces.
- [ ] `path hygiene`: publishable Markdown uses placeholders, repo-relative commands, and `CODEX_SUPERVISOR_CONFIG` where useful. Do not publish workstation-local absolute paths, private config values, secrets, or copied local-only logs.
- [ ] `schema links`: demo text links to current schema artifacts instead of duplicating their field contracts. At minimum keep links to `docs/issue-body-contract.schema.json`, `docs/evidence-timeline.schema.json`, and `docs/operator-actions.schema.json`.
- [ ] `safety boundaries`: GitHub-authored issue bodies, review text, provider summaries, and demo snippets remain execution inputs, not trusted policy. The demo must not imply that a provider signal, screenshot, or issue body can bypass local safeguards.
- [ ] `release note`: release notes or public announcements that cite the demo name the validation commands run at the publishing head.

## Drift Checks

The highest-risk demo drift is broken discoverability, stale issue-body metadata, schema link drift, and path leakage. Run the focused docs check before publishing demo material:

```bash
npx tsx --test src/demo-scenario-docs.test.ts
npm run verify:paths
npm run build
```

That focused test verifies the sample issue body with the same metadata parser behind `issue-lint`, checks README and walkthrough links, and rejects workstation-local path literals in the public demo surfaces.

For a live sandbox walkthrough, validate the target issue and config first:

```bash
export CODEX_SUPERVISOR_CONFIG=<supervisor-config-path>
node dist/index.js issue-lint <issue-number> --config "$CODEX_SUPERVISOR_CONFIG"
node dist/index.js doctor --config "$CODEX_SUPERVISOR_CONFIG"
node dist/index.js status --config "$CODEX_SUPERVISOR_CONFIG" --why
```

Use the live walkthrough only for current public evidence such as public issue numbers, PR numbers, and current-head verification results. Keep private host paths and credentials out of the published artifact.

## Refresh Readiness Note

Refresh the public demo assets when any of these change:

- README first-screen positioning or docs-map wording changes how new users discover the demo.
- Issue metadata rules, scheduling fields, or `issue-lint` output change.
- Evidence timeline, operator action, trust posture, or issue-body schema artifacts change.
- The supervised PR lifecycle changes enough that the annotated PR walkthrough no longer matches actual draft PR, review, CI, or merge behavior.
- Path-hygiene policy changes what publishable docs may contain.
- A release announcement, README screenshot, or external demo package cites these assets.

Before tagging or announcing a release that mentions the public demo, record the focused docs check, `npm run verify:paths`, and `npm run build` in the release evidence. If those commands fail, refresh the demo assets first or remove the stale public demo claim from the release note.

## Verification

Use this command set when changing public demo assets or this checklist:

```bash
npx tsx --test src/demo-scenario-docs.test.ts
npm run verify:paths
npm run build
```
