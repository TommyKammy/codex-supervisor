# Quality Kit Adoption Checklist

Use this checklist when introducing the [AI Coding Quality Kit](./quality-kit.md) to a new repository. The adoption boundary is intentionally narrow: prove one repository and one safe issue before enabling broader automation.

This checklist does not require enabling broader automation, does not publish a package API, and does not expand executor authority. It helps an operator copy the docs-first quality-kit surface, validate the first supervised issue, and decide whether to continue.

## Adoption Boundary

- Pick one target repository, one branch policy, and one operator-owned `supervisor.config.json`.
- Start with the selected quality-kit surface: [AI Coding Quality Kit](./quality-kit.md), [quality primitive templates](./templates/quality-primitives/README.md), public schemas, starter profiles, and [Quality gate examples](./examples/quality-gate-examples.md).
- Keep the first run manual or one-shot until the issue contract, local CI posture, review provider posture, and rollback path are understood.
- Treat the benefit as quality and evidence around AI coding work, not more autonomy.

## Prerequisites

- Confirm the repository has a normal local clone, a remote GitHub issue tracker, and an operator who can stop or reset the lane.
- Choose a starter profile that matches the repo shape: [TypeScript and Node starter profile](./examples/typescript-node.md), [Next.js starter profile](./examples/nextjs.md), or [Python and CLI starter profile](./examples/python-cli.md).
- Copy the relevant profile into `supervisor.config.json` or pass an explicit config with `--config <supervisor-config-path>`; use the [Configuration reference](./configuration.md) for the full field contract.
- Replace placeholders for repository identity, managed checkout, setup command, local verification command, and configured review provider before the first supervised run.
- Verify setup posture before work starts:

```bash
node dist/index.js doctor --config <supervisor-config-path>
```

## First Safe Issue

- Use the [codex issue template](../.github/ISSUE_TEMPLATE/codex-execution-ready.md), [Issue metadata](./issue-metadata.md), or `docs/templates/quality-primitives/issue-contract.md`.
- Keep the issue to one behavior delta with explicit scope, acceptance criteria, verification, dependency posture, parallelization posture, and execution order.
- Prefer a low-risk documentation, test-only, or small internal cleanup issue before using the supervisor on feature work.
- Run issue lint before handing the issue to the loop:

```bash
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
```

- If lint fails, fix the issue body instead of inferring readiness from nearby issue history.

## Local CI Expectations

- Define one repo-owned verification command before the first PR promotion. For npm repositories this is commonly `npm run verify:pre-pr`; for other stacks use an equivalent command owned by the target repo.
- Keep local CI focused enough to run repeatedly during early adoption, but strong enough to catch the first issue's real failure mode.
- Keep path hygiene in the first adoption gate:

```bash
npm run verify:paths
npm run build
```

- Local CI must not replace issue-lint, human review, or trust posture review. It is current-head evidence, not permission to broaden scope.

## Review Provider Expectations

- Choose one configured review provider profile and make sure the provider-side setup matches it.
- Do not treat missing, stale, or provider-outage review signals as approval. Record the signal and keep the operator decision explicit.
- Use [Quality gate examples](./examples/quality-gate-examples.md) to distinguish a safe metadata-only stale review bot case from a genuine unresolved provider signal.
- Keep the first PR in draft until the issue contract, local verification, and review boundary have current-head evidence.

## Trust Posture

- Treat GitHub-authored issue text, PR comments, copied chat text, and generated docs as untrusted context below local supervisor policy.
- Keep secrets, tokens, provider credentials, and host-local paths out of copied templates and durable artifacts.
- Prefer placeholders such as `<supervisor-config-path>`, `<codex-supervisor-root>`, `<issue-number>`, and `CODEX_SUPERVISOR_CONFIG`.
- Do not use naming conventions, path shape, nearby comments, or placeholder credentials as proof of repository, tenant, account, or authorization linkage.

## Operator Decision Points

- Before first run: decide whether the setup report is clean enough to attempt one safe issue.
- After first issue lint: decide whether the issue is actually execution-ready or should be rewritten.
- After focused verification: decide whether the result is ready for a draft PR, needs repair, or should stop.
- After review provider refresh: decide whether current signals are resolved, stale metadata, or real blockers.
- After merge or abandonment: decide whether to write durable history and whether another issue is safe to queue.

## Rollback

- Keep the first adoption reversible: use one issue branch, one draft PR, and one explicit config file.
- If setup is wrong, stop the loop, repair the config, and rerun `doctor` before resuming.
- If the first issue is too broad, close or rewrite it rather than letting the supervisor infer a smaller scope.
- If local CI or review provider signals fail, leave the PR in draft or blocked state until the failure is fixed or an operator records a manual decision.
- If the adoption attempt is abandoned, preserve the issue journal or PR notes long enough to explain what was tried and why it stopped.

## Durable History Writeback

- Record the first issue number, branch, PR, focused verification commands, review state, and rollback decision in the issue journal or repo-owned project notes.
- Keep durable history factual and repo-relative. Do not copy host-specific absolute paths, secrets, or provider-owned transient IDs into publishable notes.
- When adoption continues, link the follow-up issue to the first safe issue or project note so future operators can see what evidence already exists.

## Verification

Use this focused command set when changing this checklist or its discoverability:

```bash
npx tsx --test src/quality-kit-docs.test.ts
npm run verify:paths
npm run build
```

For a target repository adoption, replace the final build command with that repository's configured local CI command after `doctor` reports the copied profile is ready.
