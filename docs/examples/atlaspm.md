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
  "localReviewConfidenceThreshold": 0.7,
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
  "maxDoneWorkspaces": 24,
  "cleanupDoneWorkspacesAfterHours": 24,
  "mergeMethod": "squash",
  "draftPrAfterAttempt": 1
}
```

## Notes

- `atlaspm` uses `Part of #...`, `Depends on: ...`, and `## Execution order`, so the built-in sequencing logic is enough.
- If you use GSD for upstream planning, enable `gsdEnabled` and point `gsdPlanningFiles` at `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, and `STATE.md`.
- Copilot review is expected to start automatically after the PR is marked ready.
- A local advisory review swarm can run before `gh pr ready`, with Markdown (`head-<sha>.md`) and JSON (`head-<sha>.json`) artifacts written under the supervisor's `.local/reviews` directory.
- Findings below the configured confidence threshold stay in the raw role reports but are not counted as actionable.
- Even with multiple local review roles, the reviewer turn should still read the generated context index and issue journal first, then open durable memory files only on demand.
- `codexModelStrategy: "inherit"` means the supervisor follows the Codex CLI/App default model automatically. In practice, set the Codex default model to `GPT-5.4` and let the supervisor inherit it.
- For most atlaspm-style implementation loops, there is little reason to rotate through older Codex 5.1 to 5.3 variants. Tune reasoning effort first.
- Keep `xhigh` out of the default state policy. It is better reserved for exceptional repeated-failure escalation only.
- Only configured review bots are auto-addressed. Human review comments block merge and require manual follow-up.
- `Epic:` title prefixes are skipped as direct work items because the supervisor closes epics after all child issues close.
- Generated context index and `AGENTS.generated.md` artifacts are written under the supervisor state directory, not into the managed repo.
- `maxDoneWorkspaces: 24` keeps the newest 24 finished worktrees available for debugging; older done worktrees are cleaned up first. Set `0` to retain none, or a negative value to disable the count cap.
