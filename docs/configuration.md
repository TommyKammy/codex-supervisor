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
- the repo is a trusted repo for autonomous execution
- the GitHub authors who can supply issue bodies, review comments, and related execution text are trusted authors for that repo

Current execution posture: supervisor-managed Codex turns use `--dangerously-bypass-approvals-and-sandbox`. Approvals and sandboxing are therefore not the active safety boundary during an autonomous turn. The practical safety boundary is the operator's trust decision about the repo and the GitHub-authored text that becomes execution input.

State backend posture: a missing JSON state file is a normal empty bootstrap case, but corrupted JSON state is not a normal empty-state bootstrap case. When the JSON backend reports corrupted JSON state, treat it as a recovery event to inspect, acknowledge, or reset before relying on that state again. Until that explicit operator handling happens, corrupted JSON state is not a durable recovery point.

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

- Supervisor-side: use `supervisor.config.coderabbit.json`, which tracks both `coderabbitai` and `coderabbitai[bot]`, waits up to 30 minutes after a CodeRabbit `Rate limit exceeded` warning before continuing, applies an initial startup grace period after required checks turn green, re-arms that same grace period when the latest earlier CodeRabbit signal was only a draft skip and the PR later becomes ready for review, and then applies a short settled wait after a fresh CodeRabbit current-head observation.
- Tuning: `configuredBotInitialGraceWaitSeconds` controls both the initial startup grace period and the draft-skip re-wait window. The default is `90`, and practical tuning can extend into the 60-120 second range. `configuredBotSettledWaitSeconds` controls the later post-activity quiet period. The default is `5`, which preserves current behavior after CodeRabbit begins reviewing the current head.
- Provider-side: install CodeRabbit. Add `.coderabbit.yaml` only when you intentionally want repo-specific CodeRabbit behavior; it is not required just to make the supervisor wait through temporary rate limits.
- Operator note: during the initial startup grace, `status` shows `configured_bot_initial_grace_wait status=active provider=coderabbit pause_reason=awaiting_initial_provider_activity recent_observation=required_checks_green ... configured_wait_seconds=90 wait_until=...`. That means required checks just turned green, CodeRabbit has not yet produced a current-head signal, and the supervisor is intentionally holding merge progression for the configured startup window.
- Operator note: if the latest earlier CodeRabbit signal was only a draft skip and the PR later becomes ready for review, `status` can instead show `configured_bot_initial_grace_wait status=active provider=coderabbit pause_reason=awaiting_fresh_provider_review_after_draft_skip recent_observation=ready_for_review_reopened_wait ... configured_wait_seconds=90 wait_until=...`. That means the supervisor restarted the grace window from the ready-for-review transition because the earlier draft-state skip does not satisfy the ready-state review requirement.
- Operator note: after CodeRabbit does produce a current-head signal, `status` can switch to `configured_bot_settled_wait status=active provider=coderabbit pause_reason=recent_current_head_observation recent_observation=current_head_activity ... configured_wait_seconds=5 wait_until=...`. That later settled wait is distinct from the startup grace: it is a short post-activity quiet period before merge progression resumes.
- Verify: open a PR and confirm CodeRabbit posts review activity under one of the configured bot identities.

Only treat a profile as working after the provider produces a usable PR review signal that the supervisor can observe and react to.

## Key Config Areas

Repository and workspace:

- `repoPath`, `repoSlug`, `workspaceRoot`
- `stateBackend`, `stateFile`, `stateBootstrapFile`
- `branchPrefix`

Operator diagnostics for state:

- `node dist/index.js status --config /path/to/supervisor.config.json` reports the current tracked issue/PR view, but it should not be read as permission to trust corrupted state implicitly.
- `node dist/index.js doctor --config /path/to/supervisor.config.json` is the primary check when you need to distinguish missing JSON state from corrupted JSON state and confirm whether operator recovery is required.

Codex execution policy:

- `codexBinary`
- `codexModelStrategy`, `codexModel`
- `boundedRepairModelStrategy`, `boundedRepairModel`
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

By default, `skipTitlePrefixes` contains `Epic:` so umbrella issues are not treated as runnable implementation work. Set it explicitly if you want a different policy.

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
- leave `boundedRepairModelStrategy` unset unless you explicitly want `repairing_ci` and `addressing_review` turns to route to a smaller model such as `GPT-5.4 mini`
- keep `xhigh` reserved for escalation paths rather than the default policy

## Related Docs

- [Getting started](./getting-started.md)
- [Architecture](./architecture.md)
- [Issue metadata](./issue-metadata.md)
- [Atlas example](./examples/atlaspm.md)
