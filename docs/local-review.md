# Local Review Reference

This guide holds the detailed local-review swarm reference so the landing docs can stay focused on operator flow.

## What local review is for

`codex-supervisor` can run a local review swarm on pull requests before merge. The recommended starting policy is `block_merge`, because it preserves the usual ready-for-review flow while still making the swarm a practical merge gate on the current PR head.

Core behavior:

- each role runs in a separate Codex turn
- `localReviewPolicy` controls whether the swarm is advisory or blocking
- `trackedPrCurrentHeadLocalReviewRequired` adds an opt-in freshness gate for tracked codex PRs without changing the underlying policy once the current head has been reviewed
- verifier-confirmed high-severity findings can trigger `local_review_fix`
- findings are written as Markdown and JSON artifacts
- the same memory budget policy still applies: read the compact context index and issue journal first, then open durable memory only on demand

Policy guidance:

- `block_merge` is the recommended default: gate merge on ready PRs and re-run on ready PR head updates
- `block_ready` is stricter earlier in the flow: gate the draft-to-ready transition
- `advisory` is non-blocking and fits setups that want saved findings without automation gates
- `trackedPrCurrentHeadLocalReviewRequired: true` makes tracked codex PRs wait for a fresh local review on every head update before ready-for-review or merge can continue

## Choosing reviewer roles

There are two ways to choose local-review roles.

### Option 1: Auto-detect roles

This is the recommended starting point.

If `localReviewRoles` is empty and `localReviewAutoDetect` is `true`, the supervisor detects a role set from the managed repo shape.

Example:

```json
{
  "localReviewEnabled": true,
  "localReviewAutoDetect": true,
  "localReviewRoles": []
}
```

The baseline is:

- `reviewer`
- `explorer`

Then the supervisor adds specialists when the repo suggests them. For example:

- docs or durable memory present -> `docs_researcher`
- Prisma schema + migrations present -> `prisma_postgres_reviewer`, `migration_invariant_reviewer`, `contract_consistency_reviewer`
- Playwright-heavy repo -> `ui_regression_reviewer`
- GitHub Actions workflows present -> `github_actions_semantics_reviewer`
- workflow-focused tests present -> `workflow_test_reviewer`
- Node/script-heavy or workflow-heavy repo -> `portability_reviewer`

Generated local-review artifacts show why each auto-detected role was selected:

- the Markdown summary includes an `Auto-detected roles` section with concise signal summaries
- the JSON artifact includes `autoDetectedRoles`, with machine-readable `kind`, `signal`, and `paths` fields for each selected role

When you want to override auto-detect manually, inspect those reasons first, then copy only the roles you want into `localReviewRoles` and set `localReviewAutoDetect` to `false`. That keeps the useful specialists while making the swarm deterministic.

### Option 2: Explicit roles

Use explicit roles when you want full manual control.

Example:

```json
{
  "localReviewEnabled": true,
  "localReviewAutoDetect": false,
  "localReviewRoles": [
    "reviewer",
    "explorer",
    "docs_researcher",
    "prisma_postgres_reviewer",
    "migration_invariant_reviewer",
    "contract_consistency_reviewer"
  ]
}
```

Use this when:

- you already know the repo needs specialist reviewers
- you want deterministic role selection across machines
- you want to compare swarm results over time

### What specialist roles are for

The generic roles are good at broad bug hunting, but they will miss some repo-specific defects.

Examples:

- `prisma_postgres_reviewer`
  looks for PostgreSQL uniqueness semantics, nullable unique traps, partial indexes, and Prisma/schema drift
- `migration_invariant_reviewer`
  looks for invalid persisted states that are blocked in app code but not enforced by the database
- `contract_consistency_reviewer`
  compares contracts, schema, docs, and tests for drift
- `ui_regression_reviewer`
  looks for likely browser-flow and end-to-end regressions
- `github_actions_semantics_reviewer`
  looks for GitHub Actions event/context mistakes, concurrency pitfalls, and stale cancelled-check behavior
- `workflow_test_reviewer`
  looks for brittle workflow tests, regex-heavy assertions, and path/cwd assumptions
- `portability_reviewer`
  looks for shell glob, path, line-ending, and OS portability risks

In a repo like `atlaspm`, these specialist reviewers are often more useful than adding more generic reviewer turns.

## Artifacts, thresholds, and guardrails

Typical roles include:

- `reviewer`
- `explorer`
- `docs_researcher`

The swarm:

- runs separate review turns per role
- writes a Markdown summary and structured JSON artifact
- keeps older `head-<sha>` artifacts for history
- records `reviewed_head_sha` and `pr_head_sha` so `status` can tell you whether the latest actionable artifact still matches the PR head
- runs a verifier pass for actionable high-severity findings before stronger high-severity gates react
- deduplicates findings
- keeps only findings that meet the configured reviewer-type confidence and severity thresholds as actionable

By default, it does not:

- edit code
- replace GitHub branch protection

`block_ready` and `block_merge` react to raw actionable findings. `localReviewHighSeverityAction` only escalates on verifier-confirmed high-severity findings, which reduces false positives before the supervisor triggers another repair pass or a manual block.

Baseline `reviewer` and `explorer` turns are treated as `generic` reviewers. Every other role is treated as a `specialist`. You can tune those reviewer types independently with `localReviewReviewerThresholds`: each type has its own `confidenceThreshold` and `minimumSeverity`. If that field is unset, both reviewer types inherit `localReviewConfidenceThreshold` with a `low` severity floor.

For most solo-operator setups, prefer `localReviewHighSeverityAction: "blocked"` so verifier-confirmed high-severity findings stop the merge and force an explicit decision. Switch to `retry` only when you intentionally want the supervisor to launch another repair pass automatically.

Older local-review artifacts remain on disk unless you clean them up explicitly. For live triage, trust `status` first: `head=current` means the artifact for `reviewed_head_sha` matches `pr_head_sha`, while `head=stale` means the artifact is historical and a newer PR head needs another review run.

If the supervisor sends the issue into `local_review_fix`, treat the active local-review blocker as the top priority. The repair prompt suppresses stale issue-journal `Next 1-3 actions` bullets so older checkpoint advice does not compete with the current blocker. If you need to force a temporary repair instruction anyway, write it explicitly in the journal as `- Operator override: ...`; that override remains visible in repair prompts.

Committed local-review guardrails live under `docs/shared-memory/`:

- `verifier-guardrails.json`
- `external-review-guardrails.json`

Each committed guardrail document must include top-level `"version": 1`. The loader rejects missing versions, non-integer versions, and unsupported future versions so schema changes stay explicit and predictable.

Treat persisted-artifact promotion as provenance-sensitive. Before any persisted miss artifact, local-review artifact, or post-merge audit artifact is promoted into operator-facing summaries, follow-up candidates, or durable guardrails, the loader should validate it fail-closed:

- reject malformed nullable evidence fields such as `sourceUrl` or `sourceThreadId`
- cross-check embedded `issueNumber`, `prNumber`, `branch`, and `headSha` against the authoritative surrounding context when those values are available
- skip the artifact instead of partially promoting stale or mismatched data

When you add or update an entry, use the deterministic repo workflow:

1. Edit the committed JSON in `docs/shared-memory/`.
2. Run `npm run guardrails:fix` to normalize ordering and formatting.
3. Run `npm run guardrails:check` to catch malformed updates, duplicate verifier `id` values, duplicate external-review `fingerprint` values, or formatting drift before committing.

## Related docs

- [Getting started](./getting-started.md)
- [Configuration reference](./configuration.md)
- [Architecture](./architecture.md)
