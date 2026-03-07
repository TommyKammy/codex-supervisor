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
