# Configuration Reference

This guide holds the setup and reference material that used to make the root `README.md` too dense.

## Base Setup

Start from [supervisor.config.example.json](../supervisor.config.example.json), then choose the review provider profile that matches your review flow:

- [supervisor.config.copilot.json](../supervisor.config.copilot.json)
- [supervisor.config.codex.json](../supervisor.config.codex.json)
- [supervisor.config.coderabbit.json](../supervisor.config.coderabbit.json)

The active file is whichever config path you pass with `--config`. `supervisor.config.json` is the common local default, and the shipped provider profiles are starting points, so you can either copy one over `supervisor.config.json` and customize it for your repo or copy its `reviewBotLogins` into your existing active config and keep your other edits.

Requirements:

- `gh auth status` succeeds
- `codex` CLI is installed
- the managed repository is already cloned locally
- branch protection and CI are already configured on the managed repository
- the repo is a trusted repo for autonomous execution
- the GitHub authors who can supply issue bodies, review comments, and related execution text are trusted authors for that repo

Current execution posture: supervisor-managed Codex turns use `--dangerously-bypass-approvals-and-sandbox`. Approvals and sandboxing are therefore not the active safety boundary during an autonomous turn. The practical safety boundary is the operator's trust decision about the repo and the GitHub-authored text that becomes execution input.

Pull-request hydration posture: fresh GitHub review facts are required before the supervisor takes PR actions such as marking ready, clearing review-driven blockers, or merging. Retained cached hydration data may still appear in diagnostics or operator-facing status output, but it is informational and non-authoritative. No configuration should treat cached pull-request hydration as authority for readiness, review-blocking, or merge decisions.

State backend posture: a missing JSON state file is a normal empty bootstrap case, but corrupted JSON state is not a normal empty-state bootstrap case. When the JSON backend reports corrupted JSON state, treat it as a recovery event to inspect, acknowledge, or reset before relying on that state again. Until that explicit operator handling happens, corrupted JSON state is not a durable recovery point.

Workspace restore posture: when `ensureWorkspace()` reconstructs an issue workspace, it should prefer an existing local issue branch first, then an existing remote issue branch, and only then bootstrap a fresh issue branch from an authoritative fresh default-branch ref such as `origin/<defaultBranch>`. A missing local branch alone should not imply a fresh bootstrap when the remote issue branch still exists; bootstrapping from the default branch is the fallback only after both restore paths are unavailable.

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

- Supervisor-side: use `supervisor.config.coderabbit.json`, which tracks both `coderabbitai` and `coderabbitai[bot]`, waits up to 30 minutes after a CodeRabbit `Rate limit exceeded` warning before continuing, applies an initial startup grace period after required checks turn green, re-arms that same grace period when the latest earlier CodeRabbit signal was only a draft skip and the PR later becomes ready for review, then requires a fresh current-head CodeRabbit signal before merge progression resumes. The shipped profile blocks after a bounded 10-minute timeout instead of waiting indefinitely when CodeRabbit never produces a current-head signal.
- Starter-profile note: the shipped CodeRabbit profile uses an intentionally non-loadable `repoSlug` placeholder so copying it without customization fails fast instead of silently targeting another repository.
- Tuning: `configuredBotInitialGraceWaitSeconds` controls both the initial startup grace period and the draft-skip re-wait window. The default is `90`, and practical tuning can extend into the 60-120 second range. `configuredBotSettledWaitSeconds` controls the later post-activity quiet period. The default is `5`, which preserves current behavior after CodeRabbit begins reviewing the current head. `configuredBotRequireCurrentHeadSignal=true` turns on strict gating for current-head provider activity, and `configuredBotCurrentHeadSignalTimeoutMinutes` plus `configuredBotCurrentHeadSignalTimeoutAction` bound that wait so merges do not stall forever.
- Provider-side: install CodeRabbit. Add `.coderabbit.yaml` only when you intentionally want repo-specific CodeRabbit behavior; it is not required just to make the supervisor wait through temporary rate limits.
- Operator note: during the initial startup grace, `status` shows `configured_bot_initial_grace_wait status=active provider=coderabbit pause_reason=awaiting_initial_provider_activity recent_observation=required_checks_green ... configured_wait_seconds=90 wait_until=...`. That means required checks just turned green, CodeRabbit has not yet produced a current-head signal, and the supervisor is intentionally holding merge progression for the configured startup window.
- Operator note: if the latest earlier CodeRabbit signal was only a draft skip and the PR later becomes ready for review, `status` can instead show `configured_bot_initial_grace_wait status=active provider=coderabbit pause_reason=awaiting_fresh_provider_review_after_draft_skip recent_observation=ready_for_review_reopened_wait ... configured_wait_seconds=90 wait_until=...`. That means the supervisor restarted the grace window from the ready-for-review transition because the earlier draft-state skip does not satisfy the ready-state review requirement.
- Operator note: after that initial grace expires, if `configuredBotRequireCurrentHeadSignal=true` and CodeRabbit still has not produced a current-head signal, `status` can show `configured_bot_current_head_signal_wait status=active provider=coderabbit pause_reason=awaiting_current_head_signal_after_required_checks recent_observation=required_checks_green ... configured_wait_minutes=10 wait_until=...`. That means merge progression is strictly gated on a current-head CodeRabbit signal, but the gate remains bounded by the configured timeout instead of waiting forever.
- Operator note: after CodeRabbit does produce a current-head signal, `status` can switch to `configured_bot_settled_wait status=active provider=coderabbit pause_reason=recent_current_head_observation recent_observation=current_head_activity ... configured_wait_seconds=5 wait_until=...`. That later settled wait is distinct from the startup grace: it is a short post-activity quiet period before merge progression resumes.
- Verify: open a PR and confirm CodeRabbit posts review activity under one of the configured bot identities.

Only treat a profile as working after the provider produces a usable PR review signal that the supervisor can observe and react to.

## Key Config Areas

Repository and workspace:

- `repoPath`, `repoSlug`, `workspaceRoot`
- `stateBackend`, `stateFile`, `stateBootstrapFile`
- `branchPrefix`
- issue-workspace restore precedence: local branch, then remote branch, then fallback bootstrap from an authoritative fresh default-branch ref such as `origin/<defaultBranch>`

Operator diagnostics for state:

- `node dist/index.js status --config /path/to/supervisor.config.json` reports the current tracked issue/PR view, but it should not be read as permission to trust corrupted state implicitly.
- `node dist/index.js doctor --config /path/to/supervisor.config.json` is the primary check when you need to distinguish missing JSON state from corrupted JSON state and confirm whether operator recovery is required.

Codex execution policy:

- `codexBinary`
- `trustMode`, `executionSafetyMode`
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
- `candidateDiscoveryFetchWindow`
- `maxImplementationAttemptsPerIssue`, `maxRepairAttemptsPerIssue`, `maxCodexAttemptsPerIssue`
- `timeoutRetryLimit`, `blockedVerificationRetryLimit`
- `sameBlockerRepeatLimit`, `sameFailureSignatureRepeatLimit`

By default, `skipTitlePrefixes` contains `Epic:` so umbrella issues are not treated as runnable implementation work. Set it explicitly if you want a different policy.

Review and merge policy:

- `reviewBotLogins`
- `humanReviewBlocksMerge`
- `mergeCriticalRecheckSeconds`
- `copilotReviewWaitMinutes`, `copilotReviewTimeoutAction`
- `configuredBotRateLimitWaitMinutes`, `configuredBotInitialGraceWaitSeconds`, `configuredBotSettledWaitSeconds`
- `localReviewEnabled`, `localReviewAutoDetect`, `localReviewRoles`
- `localReviewPolicy`, `trackedPrCurrentHeadLocalReviewRequired`, `localReviewFollowUpIssueCreationEnabled`, `localReviewHighSeverityAction`
- `localReviewArtifactDir`, `localReviewConfidenceThreshold`, `localReviewReviewerThresholds`
- `mergeMethod`

Local-review default posture:

- shipped starter profiles and default config loading keep `localReviewEnabled: false`
- `localReviewFollowUpIssueCreationEnabled: false` is the safe default: follow-up issue creation stays advisory until an operator explicitly opts in
- once an operator intentionally enables local review, the recommended baseline is `localReviewAutoDetect: true`, `localReviewRoles: []`, `localReviewPolicy: "block_merge"`, `trackedPrCurrentHeadLocalReviewRequired: false`, `localReviewFollowUpIssueCreationEnabled: false`, and `localReviewHighSeverityAction: "blocked"`
- use `trackedPrCurrentHeadLocalReviewRequired: true` only when your workflow explicitly requires a fresh current-head local review before ready-for-review or merge can continue

Repository-owned local CI policy:

- when a repo exposes a canonical pre-PR entrypoint such as `ci:local` or `verify:pre-pr`, keep that command definition in the managed repo rather than in supervisor inference logic
- the repo is the source of truth for the command contents; the supervisor should only run the configured entrypoint and observe its exit status
- exit code `0` means the repo-declared local verification passed; any non-zero exit code means the repo-declared local verification failed
- if no local CI contract is configured, preserve backward compatibility by not inventing one from workflow YAML or changed-file heuristics
- `No repo-owned local CI contract is configured.` means no canonical repo-owned local gate is active.
- `Repo-owned local CI candidate exists but localCiCommand is unset.` means setup/readiness found a repo script candidate. The source is `repo script candidate`. codex-supervisor will not run it until localCiCommand is configured. This warning is advisory only.
- `Repo-owned local CI contract is configured.` means the configured command is active and fail-closed. When configured local CI fails, PR publication stays blocked until the command passes again.

`localCiCommand` execution modes:

- structured mode: configure an explicit executable plus argument list. This is the preferred mode because the supervisor runs the declared program directly without shell expansion.
- explicit shell mode: configure a shell command intentionally when you really need shell grammar such as pipes or compound commands. Treat this as the high-risk escape hatch.
- legacy shell-string mode: older string configs still work for backward compatibility, but they run through the shell and should be migrated to structured mode when practical.

Operator rule of thumb:

- prefer structured mode for repo-owned commands such as `npm`, `pnpm`, `cargo`, or `make`
- use explicit shell mode only when the repo contract truly depends on shell syntax
- if a configured local CI gate fails, inspect whether the failure came from the repo-owned command itself or from missing workspace toolchain prerequisites before changing the issue body

Workspace cleanup:

- `maxDoneWorkspaces`
- `cleanupDoneWorkspacesAfterHours`
- `cleanupOrphanedWorkspacesAfterHours`

`maxDoneWorkspaces` and `cleanupDoneWorkspacesAfterHours` apply only to tracked done workspaces. `cleanupOrphanedWorkspacesAfterHours` does not enable background orphan cleanup; it defines the age gate used when `doctor` reports orphan prune candidates and when the operator runs `prune-orphaned-workspaces`. An orphaned workspace is an untracked canonical issue workspace that no longer has a live state entry. The explicit `prune-orphaned-workspaces` path only preserves candidates whose eligibility is `locked`, `recent`, or `unsafe_target`; there is no separate manual-keep marker outside those states. The default orphan grace period is 24 hours, so `cleanupOrphanedWorkspacesAfterHours` keeps recently touched orphan workspaces in the `recent` state until that window expires. When you need to verify the live effective policy, run `doctor` and inspect `doctor_orphan_policy mode=explicit_only background_prune=false operator_prune=true grace_hours=... preserved=locked,recent,unsafe_target`.

Setup config backup posture:

- setup writes now keep a rotating local backup chain instead of overwriting a single `.bak` forever
- the newest backup still lives at `<configPath>.bak`, and older snapshots rotate to numbered siblings such as `<configPath>.bak.1`
- treat those backups as local operator rollback aids, not as a substitute for version control or host backups
- if you automate config edits outside the setup flow, preserve the same expectation that backups are bounded and local rather than an infinite history log

## Operator Dashboard

The local WebUI uses the same supervisor config and `SupervisorService` boundary as the CLI.

Start it with:

```bash
node dist/index.js web --config /path/to/supervisor.config.json
```

The current dashboard is local-only and reads typed JSON endpoints plus the live SSE stream. It does not read the state file directly, and it does not call `gh` or `codex` from the browser.

Current safe command surface:

- `run-once`
- `requeue`
- `prune-orphaned-workspaces`
- `reset-corrupt-json-state`

Use the dashboard when you want the same operator state through a browser view, not a different execution model.

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
- [Operator dashboard](./operator-dashboard.md)
- [Architecture](./architecture.md)
- [Issue metadata](./issue-metadata.md)
- [Atlas example](./examples/atlaspm.md)
