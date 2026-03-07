# Constitution

## Purpose

This repository is operated with AI-assisted implementation loops. Durable project knowledge lives in repo files, not in any single Codex thread.

## Non-negotiables

- Do not push directly to the default branch.
- Prefer the smallest safe change that satisfies the issue.
- Preserve current behavior unless the issue explicitly changes it.
- Keep schema, API, UI, and tests aligned when a feature spans layers.
- Do not mark work complete while focused verification is still failing.

## AI workflow rules

- Treat repo memory files as the durable cross-thread memory source.
- Read the shared memory files before large changes.
- Follow issue dependency metadata literally.
- Keep iterating on failing verification unless truly blocked by permissions, secrets, or missing requirements.
