# atlaspm example

This is one concrete way to use `codex-supervisor` against a local checkout of `TommyKammy/atlaspm`.

## Example config

```json
{
  "repoPath": "/Users/yourname/Dev/atlaspm",
  "repoSlug": "TommyKammy/atlaspm",
  "defaultBranch": "main",
  "workspaceRoot": "/Users/yourname/Dev/atlaspm-worktrees",
  "stateBackend": "json",
  "stateFile": "/Users/yourname/Dev/codex-supervisor/.local/state.json",
  "codexBinary": "/Applications/Codex.app/Contents/Resources/codex",
  "sharedMemoryFiles": [
    "README.md",
    "docs/architecture.md",
    "docs/constitution.md",
    "docs/workflow.md",
    "docs/decisions.md"
  ],
  "localReviewEnabled": true,
  "localReviewRoles": ["reviewer", "explorer"],
  "localReviewArtifactDir": "/Users/yourname/Dev/codex-supervisor/.local/reviews",
  "reviewBotLogins": ["copilot-pull-request-reviewer"],
  "humanReviewBlocksMerge": true,
  "issueJournalRelativePath": ".codex-supervisor/issue-journal.md",
  "issueJournalMaxChars": 6000,
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
- A local advisory review can run before `gh pr ready`, with artifacts written under the supervisor's `.local/reviews` directory.
- Only configured review bots are auto-addressed. Human review comments block merge and require manual follow-up.
- `Epic:` title prefixes are skipped as direct work items because the supervisor closes epics after all child issues close.
- Generated context index and `AGENTS.generated.md` artifacts are written under the supervisor state directory, not into the managed repo.
