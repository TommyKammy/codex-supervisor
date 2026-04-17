# Constitution

## Purpose

This repository is operated with AI-assisted implementation loops. Durable project knowledge lives in repo files, not in any single Codex thread.

## Non-negotiables

- Do not push directly to the default branch.
- Prefer the smallest safe change that satisfies the issue.
- Preserve current behavior unless the issue explicitly changes it.
- Keep schema, API, UI, and tests aligned when a feature spans layers.
- Do not mark work complete while focused verification is still failing.
- Do not commit workstation-local absolute paths in durable repo artifacts. Use repo-relative paths for in-repo files and redact private local paths.
- Keep operator-facing query surfaces resilient to partial or missing data. Prefer graceful degradation over hard failure in status, explain, doctor, and setup flows.
- Do not let transport, refresh, or UI follow-up failures rewrite the outcome of a successful mutation.

## AI workflow rules

- Treat repo memory files as the durable cross-thread memory source.
- Read the shared memory files before large changes.
- When provenance, scope, auth context, or boundary signals are missing, malformed, or only partially trusted, fail closed instead of inferring success.
- Treat placeholder credentials, untrusted forwarded headers, and ambiguous linkage as blockers until a trusted source or explicit binding exists.
- Follow issue dependency metadata literally.
- Keep iterating on failing verification unless truly blocked by permissions, secrets, or missing requirements.
