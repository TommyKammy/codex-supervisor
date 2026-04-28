# Local CI Gate Template

Use this template to document the repo-owned local verification gate that must pass before PR publication or ready-for-review promotion.

## Local gate

- Command: `<repo-owned-local-ci-command>`
- Workspace preparation command: `<repo-owned-workspace-preparation-command-or-none>`
- Config field: `<local-ci-config-field>`
- Owner: `<operator-or-maintainer-role>`

## Contract

- The local CI command must be repo-owned, deterministic, and runnable from `<repo-root>`.
- The command must fail closed when required tools, dependencies, or config are missing.
- Local CI must not replace issue-lint, trust posture review, focused issue verification, or review boundaries.
- GitHub checks can be green while local CI still blocks supervised progress.

## Adoption steps

1. Add or identify the repo-owned local CI command.
2. Run the command locally from `<repo-root>`.
3. Configure the supervisor profile with `<repo-owned-local-ci-command>`.
4. Keep the focused issue verification command in each issue body.
5. Record the command result in the issue or evidence timeline before promotion.
