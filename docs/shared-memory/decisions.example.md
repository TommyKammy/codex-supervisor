# Decisions

## AI thread model

- Codex threads are not the durable memory layer.
- Repo files are the durable memory layer.
- Supervisor prompts should point new sessions to shared repo memory files.

## Automation model

- GitHub is the source of truth for issue, PR, review, and CI state.
- Supervisor state exists to continue loops across sessions, not to replace GitHub facts.
- Issue metadata such as `Depends on` and `Execution order` is authoritative for sequencing.
- Shared-memory heuristics should prefer fail-closed outcomes when provenance, scope, auth context, or trust-boundary signals are missing or malformed.
- Auth or scope checks that rely on placeholder credentials, forwarded headers, or ambiguous linkage should block until the authoritative source is present.
- Authoritative lifecycle records beat derived summaries, convenience projections, and operator-facing DTOs when they disagree.
- Resolve `current`, `latest`, `active`, `terminal`, `open`, and `done` classifications from authoritative lifecycle fields first, then derive summaries from that result.
- When selecting among competing records, authoritative lifecycle state, durable identifiers, terminal markers, and authoritative timestamps beat display order, badge text, convenience booleans, or whichever row refreshed last.

## Operator surface model

- Operator-facing DTOs are best-effort views and should degrade gracefully when optional metadata, PR resolution, or transport context is missing.
- Mutation execution results are distinct from post-mutation refresh outcomes. Refresh failures must not erase a successful command result.
- Do not let refresh failures, timeline rows, badges, counters, or detail projections overwrite the authoritative outcome of a successful mutation or lifecycle transition.
- Diagnostics, summaries, and docs should reuse the same validity rules as config parsing and runtime contracts instead of re-implementing looser variants.

## Portability model

- Durable repo artifacts must stay portable across clones and hosts.
- Commit repo-relative references for in-repo files and avoid embedding workstation-local absolute paths in journals, handoffs, and docs.
