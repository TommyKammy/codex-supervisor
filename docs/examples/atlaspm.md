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
  "boundedRepairModelStrategy": "",
  "boundedRepairModel": "",
  "localReviewModelStrategy": "",
  "localReviewModel": "",
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
  "gsdEnabled": false,
  "gsdAutoInstall": false,
  "gsdInstallScope": "global",
  "gsdCodexConfigDir": "",
  "gsdPlanningFiles": [
    "PROJECT.md",
    "REQUIREMENTS.md",
    "ROADMAP.md",
    "STATE.md"
  ],
  "localReviewEnabled": true,
  "localReviewAutoDetect": true,
  "localReviewRoles": [],
  "localReviewArtifactDir": "/Users/yourname/Dev/codex-supervisor/.local/reviews",
  "localReviewConfidenceThreshold": 0.7,
  "localReviewReviewerThresholds": {
    "generic": {
      "confidenceThreshold": 0.8,
      "minimumSeverity": "medium"
    },
    "specialist": {
      "confidenceThreshold": 0.7,
      "minimumSeverity": "low"
    }
  },
  "localReviewPolicy": "block_merge",
  "trackedPrCurrentHeadLocalReviewRequired": false,
  "localReviewFollowUpRepairEnabled": false,
  "localReviewManualReviewRepairEnabled": false,
  "localReviewFollowUpIssueCreationEnabled": false,
  "localReviewHighSeverityAction": "blocked",
  "reviewBotLogins": ["copilot-pull-request-reviewer"],
  "humanReviewBlocksMerge": true,
  "issueJournalRelativePath": ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  "issueJournalMaxChars": 6000,
  "issueLabel": "codex",
  "workspacePreparationCommand": "",
  "localCiCommand": "",
  "skipTitlePrefixes": ["Epic:"],
  "branchPrefix": "codex/issue-",
  "pollIntervalSeconds": 120,
  "copilotReviewWaitMinutes": 10,
  "copilotReviewTimeoutAction": "continue",
  "codexExecTimeoutMinutes": 30,
  "maxCodexAttemptsPerIssue": 30,
  "maxImplementationAttemptsPerIssue": 30,
  "maxRepairAttemptsPerIssue": 30,
  "timeoutRetryLimit": 2,
  "blockedVerificationRetryLimit": 3,
  "sameBlockerRepeatLimit": 2,
  "sameFailureSignatureRepeatLimit": 3,
  "maxDoneWorkspaces": 24,
  "cleanupDoneWorkspacesAfterHours": 24,
  "cleanupOrphanedWorkspacesAfterHours": 24,
  "mergeMethod": "squash",
  "draftPrAfterAttempt": 1
}
```

## Notes

- `atlaspm` uses canonical `Part of: #...`, `Depends on: ...`, and `## Execution order`, so the built-in sequencing logic is enough.
- If you use GSD for upstream planning, enable `gsdEnabled` and point `gsdPlanningFiles` at `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, and `STATE.md`.
- Copilot review is expected to start automatically after the PR is marked ready.
- Leave `boundedRepairModelStrategy` unset unless you explicitly want `repairing_ci` and `addressing_review` turns to use a smaller bounded-repair model such as `gpt-5.4-mini`.
- Leave `localReviewModelStrategy` unset unless you explicitly want generic local-review turns to use a separate review model.
- Keep `workspacePreparationCommand` and `localCiCommand` explicit when the repo owns host-local setup and verification entrypoints; otherwise leave them unset instead of expecting the supervisor to infer a contract.
- The shipped starter profiles keep local review disabled by default. This atlaspm example intentionally shows the recommended once enabled posture.
- A local review swarm should usually run with `localReviewPolicy: "block_merge"` so it acts as a practical merge gate, with Markdown (`head-<sha>.md`) and JSON (`head-<sha>.json`) artifacts written under the supervisor's `.local/reviews` directory.
- Those generated local-review artifacts carry trusted durable artifact provenance and use path-safe rendering so in-repo references stay repo-relative and host-local absolute paths are redacted before later promotion flows consume them.
- Leaving `localReviewRoles` empty while `localReviewAutoDetect` is `true` lets the supervisor add repo-specific specialists such as `prisma_postgres_reviewer`, `migration_invariant_reviewer`, `contract_consistency_reviewer`, and workflow-oriented roles like `github_actions_semantics_reviewer`, `workflow_test_reviewer`, and `portability_reviewer` when the repo shape suggests them.
- `localReviewPolicy: "block_merge"` is the recommended starting point because it allows normal ready-for-review flow while still blocking merge until actionable findings are resolved.
- Use `block_ready` when you want the swarm to stop draft PRs before `gh pr ready`, and `advisory` when you only want saved findings without merge gating.
- Keep `trackedPrCurrentHeadLocalReviewRequired: false` for the recommended enabled baseline. Set it to `true` only when tracked codex PRs must always refresh local review on the current head before either ready-for-review or merge can proceed.
- Keep `localReviewFollowUpRepairEnabled: false` unless you explicitly want `follow_up_eligible` local-review residuals handled on the current PR instead of staying advisory.
- Keep `localReviewManualReviewRepairEnabled: false` unless you explicitly want current-head `manual_review_blocked` local-review residuals routed back into same-PR repair once GitHub review blockers, CI blockers, and conflicts are already clear.
- Keep `localReviewFollowUpIssueCreationEnabled: false` unless you explicitly want local-review findings to create GitHub follow-up issues automatically.
- Do not enable `localReviewFollowUpRepairEnabled` and `localReviewFollowUpIssueCreationEnabled` at the same time; they represent incompatible follow-up routing choices.
- `localReviewHighSeverityAction: "blocked"` is the safer default for solo operators because verifier-confirmed high-severity findings stop the merge until a human decides the next step.
- Switch to `localReviewHighSeverityAction: "retry"` when your team explicitly wants the supervisor to start another repair pass automatically after verifier-confirmed high-severity findings.
- Findings below the configured confidence threshold stay in the raw role reports but are not counted as actionable.
- Even with multiple local review roles, the reviewer turn should still read the generated context index and issue journal first, then open durable memory files only on demand.
- `codexModelStrategy: "inherit"` means the supervisor follows the Codex CLI/App default model automatically. In practice, set the Codex default model to `GPT-5.4` and let the supervisor inherit it.
- For most atlaspm-style implementation loops, there is little reason to rotate through older Codex 5.1 to 5.3 variants. Tune reasoning effort first.
- Keep `xhigh` out of the default state policy. It is better reserved for exceptional repeated-failure escalation only.
- Only configured review bots are auto-addressed. Human review comments block merge and require manual follow-up.
- `Epic:` title prefixes are skipped as direct work items because the supervisor closes epics after all child issues close.
- Generated context index and `AGENTS.generated.md` artifacts are written under the supervisor state directory, not into the managed repo.
- `maxDoneWorkspaces: 24` keeps the newest 24 finished worktrees available for debugging; older done worktrees are cleaned up first. Set `0` to retain none, or a negative value to disable the count cap.
