# atlaspm example

This is one concrete way to use `codex-supervisor` against a local checkout of `TommyKammy/atlaspm`.

## Example config

```json
{
  "repoPath": "/Users/yourname/Dev/atlaspm",
  "repoSlug": "TommyKammy/atlaspm",
  "defaultBranch": "main",
  "workspaceRoot": "/Users/yourname/Dev/atlaspm-worktrees",
  "stateFile": "/Users/yourname/Dev/codex-supervisor/.local/state.json",
  "codexBinary": "/Applications/Codex.app/Contents/Resources/codex",
  "sharedMemoryFiles": [
    "README.md",
    "docs/architecture.md",
    "docs/constitution.md",
    "docs/workflow.md",
    "docs/decisions.md"
  ],
  "issueJournalRelativePath": ".codex-supervisor/issue-journal.md",
  "issueLabel": "codex",
  "skipTitlePrefixes": ["Epic:"],
  "branchPrefix": "codex/issue-",
  "pollIntervalSeconds": 120,
  "copilotReviewWaitMinutes": 10,
  "codexExecTimeoutMinutes": 30,
  "maxCodexAttemptsPerIssue": 30,
  "timeoutRetryLimit": 2,
  "blockedVerificationRetryLimit": 3,
  "sameBlockerRepeatLimit": 2,
  "sameFailureSignatureRepeatLimit": 3,
  "cleanupDoneWorkspacesAfterHours": 24,
  "mergeMethod": "squash",
  "draftPrAfterAttempt": 1
}
```

## Notes

- `atlaspm` uses `Part of #...`, `Depends on: ...`, and `## Execution order`, so the built-in sequencing logic is enough.
- Copilot review is expected to start automatically after the PR is marked ready.
- `Epic:` title prefixes are skipped as direct work items because the supervisor closes epics after all child issues close.
