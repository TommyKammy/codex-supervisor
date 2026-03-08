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
  "codexModelStrategy": "inherit",
  "codexModel": "",
  "codexReasoningEffortByState": {
    "planning": "low",
    "reproducing": "medium",
    "implementing": "high",
    "stabilizing": "medium",
    "draft_pr": "low",
    "local_review": "low",
    "repairing_ci": "medium",
    "resolving_conflict": "high",
    "addressing_review": "medium"
  },
  "codexReasoningEscalateOnRepeatedFailure": true,
  "sharedMemoryFiles": [
    "README.md",
    "docs/architecture.md",
    "docs/constitution.md",
    "docs/workflow.md",
    "docs/decisions.md"
  ],
  "localReviewEnabled": true,
  "localReviewRoles": ["reviewer", "explorer", "docs_researcher"],
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
- Even with multiple local review roles, the reviewer turn should still read the generated context index and issue journal first, then open durable memory files only on demand.
- `codexModelStrategy: "inherit"` means the supervisor follows the Codex CLI/App default model automatically. In practice, set the Codex default model to `GPT-5.4` and let the supervisor inherit it.
- For most atlaspm-style implementation loops, there is little reason to rotate through older Codex 5.1 to 5.3 variants. Tune reasoning effort first.
- Keep `xhigh` out of the default state policy. It is better reserved for exceptional repeated-failure escalation only.
- Only configured review bots are auto-addressed. Human review comments block merge and require manual follow-up.
- `Epic:` title prefixes are skipped as direct work items because the supervisor closes epics after all child issues close.
- Generated context index and `AGENTS.generated.md` artifacts are written under the supervisor state directory, not into the managed repo.
