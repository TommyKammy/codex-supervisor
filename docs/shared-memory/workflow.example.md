# Workflow

## Default issue flow

1. Read the issue body and dependency metadata.
2. Review shared repo memory files.
3. Inspect the touched code paths before editing.
4. Implement the smallest viable fix.
5. Run focused verification.
6. Commit only after the focused checks pass.
7. Open or update the PR.
8. Address CI failures and review feedback until mergeable.

## Durable memory

Do not rely on one Codex thread to remember prior work. Update shared memory files whenever information should survive future sessions.

## Review checklist additions

Before commit, check that:

1. Durable repo artifacts do not embed workstation-local absolute paths.
2. Operator-facing UI and API changes handle partial, null, or missing data without hard failure.
3. Successful commands remain reported as successful even if follow-up refresh or transport updates fail.
4. New diagnostics and docs match the same parser and runtime contract as the implementation.
