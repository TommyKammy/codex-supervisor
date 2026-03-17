# Configuration Reference

This guide holds the setup and reference material that used to make the root `README.md` too dense.

## Base Setup

Start from [supervisor.config.example.json](../supervisor.config.example.json), then choose the review provider profile that matches your review flow:

- [supervisor.config.copilot.json](../supervisor.config.copilot.json)
- [supervisor.config.codex.json](../supervisor.config.codex.json)
- [supervisor.config.coderabbit.json](../supervisor.config.coderabbit.json)

`supervisor.config.json` is always the active file that the supervisor loads. The shipped provider profiles are complete templates, so you can either copy one over `supervisor.config.json` or copy its `reviewBotLogins` into your existing `supervisor.config.json` and keep your other edits.

Requirements:

- `gh auth status` succeeds
- `codex` CLI is installed
- the managed repository is already cloned locally
- branch protection and CI are already configured on the managed repository

## Provider Profiles

Each shipped profile only covers supervisor-side expectations. You still need the matching provider-side setup before the supervisor can observe a usable review signal.

### Copilot profile

- Supervisor-side: use `supervisor.config.copilot.json` or copy its `reviewBotLogins` entry into `supervisor.config.json`.
- Provider-side: install and enable GitHub Copilot review for the repository or organization, and make sure your PR flow requests or auto-triggers Copilot review.
- Verify: open a small test PR, mark it ready, and confirm GitHub shows review activity from `copilot-pull-request-reviewer`.

### Codex Connector profile

- Supervisor-side: use `supervisor.config.codex.json`, which tells the supervisor to watch for `chatgpt-codex-connector`.
- Provider-side: connect the repository to Codex in ChatGPT/OpenAI and enable the review flow your Codex Connector setup requires.
- Verify: trigger a PR that should receive Codex review and confirm the review arrives on the PR from `chatgpt-codex-connector`.

### CodeRabbit profile

- Supervisor-side: use `supervisor.config.coderabbit.json`, which tracks both `coderabbitai` and `coderabbitai[bot]`, waits up to 30 minutes after a CodeRabbit `Rate limit exceeded` warning before continuing, applies an initial startup grace period after required checks turn green, and then applies a short settled wait after a fresh CodeRabbit current-head observation.
- Tuning: `configuredBotInitialGraceWaitSeconds` controls the initial startup grace period. The default is `90`, and practical tuning can extend into the 60-120 second range. `configuredBotSettledWaitSeconds` controls the later post-activity quiet period. The default is `5`, which preserves current behavior after CodeRabbit begins reviewing the current head.
- Provider-side: install CodeRabbit. Add `.coderabbit.yaml` only when you intentionally want repo-specific CodeRabbit behavior; it is not required just to make the supervisor wait through temporary rate limits.
- Operator note: while that short settled wait is active, `status` shows `configured_bot_settled_wait status=active provider=coderabbit pause_reason=recent_current_head_observation recent_observation=current_head_activity ... wait_until=...`. That means the supervisor saw recent CodeRabbit activity on the current PR head, is deliberately pausing merge progression for a few seconds, and is telling you when progression will resume.
- Verify: open a PR and confirm CodeRabbit posts review activity under one of the configured bot identities.

Only treat a profile as working after the provider produces a usable PR review signal that the supervisor can observe and react to.

## Key Config Areas

Repository and workspace:

- `repoPath`, `repoSlug`, `workspaceRoot`
- `stateBackend`, `stateFile`, `stateBootstrapFile`
- `branchPrefix`

Codex execution policy:

- `codexBinary`
- `codexModelStrategy`, `codexModel`
- `codexReasoningEffortByState`
- `codexReasoningEscalateOnRepeatedFailure`
- `codexExecTimeoutMinutes`

Durable memory and planning:

- `sharedMemoryFiles`
- `issueJournalRelativePath`, `issueJournalMaxChars`
- `gsdEnabled`, `gsdAutoInstall`, `gsdInstallScope`, `gsdCodexConfigDir`, `gsdPlanningFiles`

Issue selection and retry policy:

- `issueLabel`, `issueSearch`, `skipTitlePrefixes`
- `maxImplementationAttemptsPerIssue`, `maxRepairAttemptsPerIssue`, `maxCodexAttemptsPerIssue`
- `timeoutRetryLimit`, `blockedVerificationRetryLimit`
- `sameBlockerRepeatLimit`, `sameFailureSignatureRepeatLimit`

Review and merge policy:

- `reviewBotLogins`
- `humanReviewBlocksMerge`
- `copilotReviewWaitMinutes`, `copilotReviewTimeoutAction`
- `configuredBotRateLimitWaitMinutes`, `configuredBotInitialGraceWaitSeconds`, `configuredBotSettledWaitSeconds`
- `localReviewEnabled`, `localReviewAutoDetect`, `localReviewRoles`
- `localReviewPolicy`, `localReviewHighSeverityAction`
- `localReviewArtifactDir`, `localReviewConfidenceThreshold`, `localReviewReviewerThresholds`
- `mergeMethod`

Workspace cleanup:

- `maxDoneWorkspaces`
- `cleanupDoneWorkspacesAfterHours`

## Model and Reasoning Guidance

Recommended default:

- set your Codex CLI or app default model to `GPT-5.4`
- use `codexModelStrategy: "inherit"` so the supervisor follows that default
- tune cost and effort through per-state reasoning instead of constant model switching

Practical guidance:

- `inherit` keeps the supervisor aligned with your Codex default
- `fixed` pins one model explicitly
- `alias` uses a moving alias when your Codex environment exposes one
- keep `xhigh` reserved for escalation paths rather than the default policy

## Related Docs

- [Getting started](./getting-started.md)
- [Architecture](./architecture.md)
- [Issue metadata](./issue-metadata.md)
- [Atlas example](./examples/atlaspm.md)
