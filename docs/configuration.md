# Configuration Guide

Use this page when you want to understand `codex-supervisor` config without reading every field in one pass.

This guide is organized in the order a beginner usually needs:

1. what the config is responsible for
2. which fields you actually need to edit first
3. common setup recipes
4. field groups for deeper reference

If you want the end-to-end first-run flow, start with [Getting started](./getting-started.md). If you want the local-review feature in more depth, use [Local review](./local-review.md).

## Start Here

The active config is whichever file you pass with `--config`.

Most operators start from one of these files:

- [supervisor.config.example.json](../supervisor.config.example.json)
- [supervisor.config.copilot.json](../supervisor.config.copilot.json)
- [supervisor.config.codex.json](../supervisor.config.codex.json)
- [supervisor.config.coderabbit.json](../supervisor.config.coderabbit.json)

The shipped starter configs intentionally surface a short list of high-leverage optional fields in addition to the required baseline. In practice, operators most often need to discover model-routing overrides (`boundedRepairModel*`, `localReviewModel*`), current-head local-review freshness (`trackedPrCurrentHeadLocalReviewRequired`), and repo-owned host contracts (`workspacePreparationCommand`, `localCiCommand`) without reading the full schema first.

The simplest workflow is:

1. copy a starter file to `supervisor.config.json`
2. edit the repo-specific fields
3. run `issue-lint`, then `run-once`, then `loop`

```bash
cp supervisor.config.example.json supervisor.config.json
node dist/index.js issue-lint 123 --config /path/to/supervisor.config.json
node dist/index.js run-once --config /path/to/supervisor.config.json
node dist/index.js loop --config /path/to/supervisor.config.json
```

## Mental Model

Think of the config as four layers.

### 1. Repository and workspace

These fields tell the supervisor which repo it manages and where it may create per-issue worktrees.

- `repoPath`
- `repoSlug`
- `defaultBranch`
- `workspaceRoot`
- `branchPrefix`

### 2. Runtime and state

These fields control how the supervisor stores durable state and how long autonomous turns may run.

- `stateBackend`
- `stateFile`
- `stateBootstrapFile`
- `codexBinary`
- `codexExecTimeoutMinutes`

### 3. Scheduler and retry policy

These fields decide which issue is runnable, how long the supervisor keeps retrying, and when it should stop.

- `issueLabel`
- `skipTitlePrefixes`
- `candidateDiscoveryFetchWindow`
- `maxImplementationAttemptsPerIssue`
- `maxRepairAttemptsPerIssue`
- `maxCodexAttemptsPerIssue`
- `timeoutRetryLimit`
- `blockedVerificationRetryLimit`
- `sameBlockerRepeatLimit`
- `sameFailureSignatureRepeatLimit`

### 4. PR, review, and merge gates

These fields control how the supervisor waits on CI, review bots, human review, and local review.

- `reviewBotLogins`
- `humanReviewBlocksMerge`
- `copilotReviewWaitMinutes`
- `configuredBotRateLimitWaitMinutes`
- `configuredBotInitialGraceWaitSeconds`
- `configuredBotSettledWaitSeconds`
- `configuredBotRequireCurrentHeadSignal`
- `configuredBotCurrentHeadSignalTimeoutMinutes`
- `configuredBotCurrentHeadSignalTimeoutAction`
- `localReviewEnabled`
- `localReviewPolicy`
- `trackedPrCurrentHeadLocalReviewRequired`
- `localReviewFollowUpIssueCreationEnabled`
- `localReviewHighSeverityAction`
- `localReviewArtifactDir`

If you keep these four layers in mind, the file becomes much easier to read.

## Edit These First

For a first run, most people only need to touch the fields below.

| Field | What to put here | Why it matters |
| --- | --- | --- |
| `repoPath` | local filesystem path to the managed repo | tells the supervisor where git operations happen |
| `repoSlug` | GitHub `owner/repo` | used for GitHub issue and PR operations |
| `defaultBranch` | usually `main` | used for worktree restore and fresh branch bootstrap |
| `workspaceRoot` | directory for per-issue worktrees | keeps issue work isolated |
| `stateFile` | path to the supervisor state JSON | keeps durable progress between runs |
| `codexBinary` | usually `codex` | the CLI used for autonomous turns |
| `reviewBotLogins` | provider-specific bot identities | tells the supervisor which review activity to trust |

Everything else is usually tuning, not bootstrapping.

## Minimum Working Example

This is the smallest mental checklist for a beginner.

```json
{
  "repoPath": "/absolute/path/to/managed-repo",
  "repoSlug": "owner/repo",
  "defaultBranch": "main",
  "workspaceRoot": "/absolute/path/to/worktrees",
  "stateBackend": "json",
  "stateFile": "/absolute/path/to/state.json",
  "codexBinary": "codex",
  "issueLabel": "codex",
  "reviewBotLogins": ["coderabbitai", "coderabbitai[bot]"]
}
```

If your config loads, `gh auth status` succeeds, and `run-once` chooses the right issue, you can tune the rest incrementally.

## Choose a Provider Profile

Each shipped profile only configures what the supervisor expects to observe. You still need the provider itself installed and working on the repo.

| Profile | Start from | Choose when | Supervisor watches | First-run caveat |
| --- | --- | --- | --- | --- |
| Copilot | [supervisor.config.copilot.json](../supervisor.config.copilot.json) | Your PR flow already requests or auto-triggers Copilot review. | `copilot-pull-request-reviewer` | Confirm Copilot is enabled for the repo and requested by your normal PR flow. |
| Codex Connector | [supervisor.config.codex.json](../supervisor.config.codex.json) | The repo is already connected to Codex review and you want that connector to be the trusted review signal. | `chatgpt-codex-connector` | Confirm the connector is installed for the target repo before treating missing review activity as settled. |
| CodeRabbit | [supervisor.config.coderabbit.json](../supervisor.config.coderabbit.json) | You want bounded waiting for current-head CodeRabbit review signals. | `coderabbitai`, `coderabbitai[bot]` | Replace `repoSlug: "REPLACE_ME"` before first run; the placeholder is a fail-closed guardrail. |

After choosing a starter profile, use the [review-provider settings](#review-and-merge-policy) for the full field list. Keep provider-specific setup outside the supervisor aligned with the same choice instead of copying every provider caveat into this quick comparison.

## The Most Common Recipes

These are the combinations most operators actually want.

### I just want a safe baseline

Use the shipped profile for your review provider and keep local review off.

Recommended starting posture:

- `localReviewEnabled: false`
- `humanReviewBlocksMerge: true`
- keep the provider wait defaults from the shipped profile

This is the easiest mode to reason about.

### I want local review, but conservative

Use local review as a merge gate, not as an autonomous repair engine.

Recommended posture:

- `localReviewEnabled: true`
- `localReviewAutoDetect: true`
- `localReviewRoles: []`
- `localReviewPolicy: "block_merge"`
- `trackedPrCurrentHeadLocalReviewRequired: false`
- `localReviewFollowUpIssueCreationEnabled: false`
- `localReviewHighSeverityAction: "blocked"`

This is the current recommended enabled baseline in the docs and shipped examples.

### I want local review to rerun on the current tracked PR head

Turn on the stricter freshness gate.

- `trackedPrCurrentHeadLocalReviewRequired: true`

Use this only when your repo really wants current-head local review freshness. It makes the loop stricter and can push work back into `local_review` or `waiting_ci` after the head changes.

### I want the supervisor to auto-repair verifier-confirmed high-severity findings

This is the opt-in switch:

- `localReviewHighSeverityAction: "retry"`

What it means:

- current-head verifier-confirmed high-severity local-review findings can route into `local_review_fix`
- repeated unchanged results are still bounded by retry protections
- the safer shipped default remains `"blocked"`

If you are evaluating whether a new enhancement is needed here, check this field first. A surprising amount of "why didn't it auto-repair?" behavior is simply the difference between `"blocked"` and `"retry"`.

### I want local review findings to open follow-up issues automatically

This is separate from merge gating and separate from repair retries.

- `localReviewFollowUpIssueCreationEnabled: true`

Keep this off unless you explicitly want issue creation noise. The current safe default is `false`.

### I want repo-owned local CI to gate PR progression

Configure a canonical repo-owned command rather than asking the supervisor to infer one.

Typical examples:

- `npm run verify:pre-pr`
- `pnpm ci:local`
- `cargo test`

The repo owns the command contract. The supervisor should only execute the configured entrypoint and react to its exit code.
If no local CI contract is configured, preserve backward compatibility by not inventing one.

## Model Routing Quick Recipes

These are the authoritative fields for Codex model selection:

- `codexModelStrategy`
- `codexModel`
- `boundedRepairModelStrategy`
- `boundedRepairModel`
- `localReviewModelStrategy`
- `localReviewModel`

Recommended default:

- use `codexModelStrategy: "inherit"`
- leave `boundedRepairModelStrategy` and `localReviewModelStrategy` unset unless you intentionally want overrides
- treat `fixed` and `alias` the same way for validation: both fail closed unless the matching model field is set explicitly

### Inherit the host default model

Use this when you want `codex-supervisor` to follow the Codex CLI/App default model without pinning anything in supervisor config.

```json
{
  "codexModelStrategy": "inherit"
}
```

### Pin every Codex turn globally

Use this when you want the supervisor to ignore the host default and always use one explicit model or alias.
Choose `fixed` when one supervisor profile must pin a model and ignore the host default model.

```json
{
  "codexModelStrategy": "fixed",
  "codexModel": "gpt-5.4"
}
```

If you prefer an alias instead of a fixed model name:

```json
{
  "codexModelStrategy": "alias",
  "codexModel": "gpt-5"
}
```

### Override bounded repair only

Use this when implementation turns should inherit the main route, but `repairing_ci` and `addressing_review` should use a smaller or cheaper model.

```json
{
  "codexModelStrategy": "inherit",
  "boundedRepairModelStrategy": "fixed",
  "boundedRepairModel": "gpt-5.4-mini"
}
```

### Override generic local review only

Use this when the main route should stay unchanged, but generic local-review turns should use a separate review model or alias.

```json
{
  "codexModelStrategy": "inherit",
  "localReviewModelStrategy": "alias",
  "localReviewModel": "local-review-fast"
}
```

Validation rule:

- `codexModelStrategy: "fixed"` or `codexModelStrategy: "alias"` requires `codexModel`
- `boundedRepairModelStrategy: "fixed"` or `boundedRepairModelStrategy: "alias"` requires `boundedRepairModel`
- `localReviewModelStrategy: "fixed"` or `localReviewModelStrategy: "alias"` requires `localReviewModel`

## The Config Questions Most Beginners Ask

### What is the difference between `repoPath` and `repoSlug`?

- `repoPath` is the local checkout path
- `repoSlug` is the GitHub `owner/repo`

You need both.

### Which config file is actually active?

Whichever path you pass to `--config`.

Example:

```bash
node dist/index.js status --config /path/to/supervisor.config.json
```

### Why did the CodeRabbit profile fail to load?

Most likely because `repoSlug` is still `REPLACE_ME`.

### Why is the loop blocked on local review instead of auto-fixing?

Usually one of these:

- `localReviewEnabled` is still `false`
- `localReviewPolicy` is still conservative
- `localReviewHighSeverityAction` is `"blocked"` instead of `"retry"`
- there is a higher-priority blocker such as failing CI, manual review, or merge conflict

### Why does a tracked PR go back to `local_review` or `waiting_ci`?

Usually because the PR head changed and current-head freshness is being enforced, especially when `trackedPrCurrentHeadLocalReviewRequired: true`.

## Important Operating Rules

These are not "tuning" choices. They are part of the safety model.

### Trust boundary

GitHub-authored issue bodies, review comments, and similar GitHub text are execution inputs. The current runtime uses `--dangerously-bypass-approvals-and-sandbox`, so the practical safety boundary is whether the repo and its GitHub authors are trusted.

Operator prerequisite:

- only use autonomous execution when this is a trusted repo with a trusted author set
- if the repo or author trust is unclear, do not rely on bypassed sandbox or approval protections

### PR hydration authority

Fresh GitHub review facts are authoritative for review decisions. Merge decisions should continue to rely on fresh GitHub PR/merge signals (checks, required reviews, branch protection, and merge state). Cached hydration can appear in diagnostics, but it is informational and non-authoritative, not the source of truth for readiness or merge safety. No configuration should treat cached pull-request hydration as authority for readiness, review-blocking, or merge decisions.

### JSON state recovery

- missing JSON state is a normal empty bootstrap case
- corrupted JSON state is not a normal empty-state bootstrap case
- corrupted state should be treated as a recovery event until an operator inspects, acknowledges, or resets it
- if you need a concise rule: inspect, acknowledge, or reset before resuming normal automation
- use `status` or `doctor` to inspect the condition before treating the recovered marker as safe progress

### Workspace restore order

When `ensureWorkspace()` restores an issue workspace, the intended order is:

1. existing local issue branch
2. existing remote issue branch
3. fresh bootstrap from `origin/<defaultBranch>`

Fresh bootstrap is the fallback, not the default answer to every missing local branch.
The restore flow prefers the local issue branch first, then the remote issue branch, and only then falls back to bootstrap from `origin/<defaultBranch>` or `origin/main`.

## Field Groups Reference

This section is for browsing, not for first-time learning.

### Repository and workspace

- `repoPath`
- `repoSlug`
- `defaultBranch`
- `workspaceRoot`
- `branchPrefix`

### State and runtime

- `stateBackend`
- `stateFile`
- `stateBootstrapFile`
- `codexBinary`
- `codexExecTimeoutMinutes`

Diagnostics that matter here:

- `status` for current tracked state
- `doctor` when you need to distinguish missing state from corrupted state

### Codex execution policy

- `trustMode`
- `executionSafetyMode`
- `codexModelStrategy`
- `codexModel`
- `boundedRepairModelStrategy`
- `boundedRepairModel`
- `codexReasoningEffortByState`
- `codexReasoningEscalateOnRepeatedFailure`

Choose `trustMode` and `executionSafetyMode` explicitly during first-run setup. `trusted_repo_and_authors` plus `unsandboxed_autonomous` is the trusted solo-lane posture: it is appropriate only when the operator trusts the repository and the GitHub authors who can write issue bodies, PR comments, and review text that become execution inputs. For untrusted or mixed-author repositories, set `executionSafetyMode: "operator_gated"`; setting only `trustMode: "untrusted_or_mixed"` does not force fail-closed execution because `unsandboxed_autonomous` remains an explicit override. Once execution is gated, `trustMode` is the secondary policy that decides whether trusted repo/authors are enough or whether `untrusted_or_mixed` requires an explicit trusted-input signal.

### Durable memory and planning

- `sharedMemoryFiles`
- `issueJournalRelativePath`
- `issueJournalMaxChars`
- `gsdEnabled`
- `gsdAutoInstall`
- `gsdInstallScope`
- `gsdCodexConfigDir`
- `gsdPlanningFiles`

### Issue selection and retry policy

- `issueLabel`
- `issueSearch`
- `skipTitlePrefixes`
- `candidateDiscoveryFetchWindow`
- `maxImplementationAttemptsPerIssue`
- `maxRepairAttemptsPerIssue`
- `maxCodexAttemptsPerIssue`
- `timeoutRetryLimit`
- `blockedVerificationRetryLimit`
- `sameBlockerRepeatLimit`
- `sameFailureSignatureRepeatLimit`

Default note:

- `skipTitlePrefixes` includes `Epic:` by default so umbrella issues are not treated as runnable execution work

### Review and merge policy

- `reviewBotLogins`
- `humanReviewBlocksMerge`
- `mergeCriticalRecheckSeconds`
- `copilotReviewWaitMinutes`
- `copilotReviewTimeoutAction`
- `configuredBotRateLimitWaitMinutes`
- `configuredBotInitialGraceWaitSeconds`
- `configuredBotSettledWaitSeconds`
- `configuredBotRequireCurrentHeadSignal`
- `configuredBotCurrentHeadSignalTimeoutMinutes`
- `configuredBotCurrentHeadSignalTimeoutAction`
- `localReviewEnabled`
- `localReviewPosture`
- `localReviewAutoDetect`
- `localReviewRoles`
- `localReviewPolicy`
- `trackedPrCurrentHeadLocalReviewRequired`
- `localReviewFollowUpRepairEnabled`
- `localReviewManualReviewRepairEnabled`
- `localReviewFollowUpIssueCreationEnabled`
- `localReviewHighSeverityAction`
- `localReviewArtifactDir`
- `localReviewConfidenceThreshold`
- `localReviewReviewerThresholds`
- `mergeMethod`

Default local-review posture:

- `localReviewPosture: "off"` is the high-level default and keeps local review disabled unless a config explicitly selects another named posture
- shipped starter profiles and default config loading keep `localReviewEnabled: false`
- `localReviewFollowUpRepairEnabled: false` is the safe default, so same-PR repair of `follow_up_eligible` residual local-review work stays off until you opt in
- `localReviewManualReviewRepairEnabled: false` is the safe default, so same-PR repair of current-head `manual_review_blocked` local-review residuals stays off until you opt in
- `localReviewFollowUpIssueCreationEnabled: false` is the safe default, so follow-up issue creation stays advisory until you opt in
- named postures map to the existing low-level fields:
  - `off`: disables local review
  - `advisory`: enables local review with `localReviewPolicy: "advisory"` and no blocking gate
  - `block_merge`: enables local review as a merge gate without auto-repair or follow-up issue creation
  - `repair_high_severity`: enables the merge gate and sets `localReviewHighSeverityAction: "retry"` for verifier-confirmed high-severity findings only
  - `follow_up_issue_creation`: enables the merge gate and sets `localReviewFollowUpIssueCreationEnabled: true`
- once you intentionally enable local review, the recommended baseline is `localReviewAutoDetect: true`, `localReviewRoles: []`, `localReviewPolicy: "block_merge"`, `trackedPrCurrentHeadLocalReviewRequired: false`, `localReviewFollowUpRepairEnabled: false`, `localReviewManualReviewRepairEnabled: false`, `localReviewFollowUpIssueCreationEnabled: false`, and `localReviewHighSeverityAction: "blocked"`
- `localReviewFollowUpRepairEnabled` and `localReviewFollowUpIssueCreationEnabled` are mutually exclusive
- `localReviewManualReviewRepairEnabled` is separate from `localReviewFollowUpRepairEnabled`: the follow-up flag only covers `follow_up_eligible` residuals, while the manual-review flag covers current-head `manual_review_blocked` residuals only when GitHub is not still reporting an aggregate review block
- use `trackedPrCurrentHeadLocalReviewRequired: true` only when your workflow explicitly requires a fresh current-head local review before ready-for-review or merge can continue

### Workspace cleanup

- `maxDoneWorkspaces`
- `cleanupDoneWorkspacesAfterHours`
- `cleanupOrphanedWorkspacesAfterHours`

Important distinction:

- `maxDoneWorkspaces` and `cleanupDoneWorkspacesAfterHours` apply to tracked done workspaces
- `cleanupOrphanedWorkspacesAfterHours` is an age gate for explicit orphan pruning, not a background cleanup toggle
- orphaned worktrees and orphaned workspaces are preserved until an explicit `prune-orphaned-workspaces` run evaluates them
- preserve locked, recent, and `unsafe_target` orphaned workspaces instead of pruning them eagerly
- use `prune-orphaned-workspaces` when you want explicit cleanup of eligible orphaned workspaces

### Repo-owned local CI contract

Use a repo-owned command when the repo has a canonical pre-PR gate.

Execution modes:

- structured mode: preferred
- explicit shell mode: high-risk escape hatch
- legacy shell string: supported for compatibility, but migrate when practical

Operational notes:

- when a repo exposes a canonical pre-PR entrypoint such as `ci:local` or `verify:pre-pr`, keep that command definition in the managed repo rather than in supervisor inference logic
- the repo is the source of truth for the command contents, and the supervisor should only run the configured entrypoint and observe its exit status
- `No repo-owned local CI contract is configured.` means no canonical repo-owned local gate is active
- `Repo-owned local CI candidate exists but localCiCommand is unset.` means setup or readiness found a repo script candidate, but codex-supervisor will not run it until localCiCommand is configured. This warning is advisory only.
- `Repo-owned local CI candidate was intentionally dismissed; localCiCommand remains unset and non-blocking.` means an operator acknowledged the detected candidate without adopting it, so setup and doctor should stop treating the candidate as unresolved first-run noise.
- `Repo-owned local CI contract is configured.` means the configured command is active and fail-closed, so when configured local CI fails, PR publication stays blocked until the command passes again

Operator rule:

- keep the command defined in the managed repo
- adopt the candidate by saving it as `localCiCommand` only when that repo-owned command is intended to become the fail-closed publication gate
- dismiss a candidate only as an explicit acknowledgement that the repo script should stay non-blocking for this supervisor profile
- let the supervisor execute it
- do not ask the supervisor to infer CI behavior from workflow YAML

### Release-readiness gate

`releaseReadinessGate` controls whether the maintained release-readiness checklist is only advisory or is exposed as a repo-owned release publication gate.

Supported values:

- `advisory`: default. The checklist remains an operator-maintained release artifact. It cannot block PR publication, merge readiness, loop operation, or release publication.
- `block_release_publication`: explicit opt-in. The configured release-readiness gate may block release publication only. It does not block PR publication, merge readiness, local CI, issue verification, or loop operation.

Operational notes:

- setup/readiness reports the effective release-readiness gate posture without treating unset config as a blocker
- `doctor` prints `doctor_release_readiness_gate ...` so operators can verify the active posture for the selected config
- local CI still owns PR publication and ready-for-review promotion when `localCiCommand` is configured
- issue verification still comes from the issue's `## Verification` commands and supervisor verification policy
- merge readiness still comes from fresh PR facts, required checks, required reviews, branch protection, and merge state
- release automation must wire `block_release_publication` explicitly before the checklist becomes a blocking release gate

## Provider-Specific Notes

### CodeRabbit waits

The CodeRabbit profile has more moving parts than the others.

What it does:

- waits through temporary rate limits
- holds a short startup grace window after required checks turn green
- re-arms that grace window when draft-skip behavior means the ready-state review has not really happened yet
- can require a fresh current-head review signal before merge progression resumes
- uses a bounded timeout instead of waiting forever

This is why the CodeRabbit profile feels more complex than the Copilot or Codex Connector profiles.

### Local review posture

The shipped docs and configs intentionally recommend:

- `localReviewPosture: "off"` by default
- `localReviewEnabled: false` by default
- `localReviewHighSeverityAction: "blocked"` as the safer enabled baseline

That posture is deliberate. Choose `localReviewPosture: "repair_high_severity"` only when you explicitly want the supervisor to retry verifier-confirmed high-severity findings. Choose `localReviewPosture: "follow_up_issue_creation"` only when automatic follow-up issue creation is intended.

## Model and Reasoning Guidance

Recommended default:

- set your Codex default model to `GPT-5.4`
- use `codexModelStrategy: "inherit"`
- tune cost and depth through `codexReasoningEffortByState`

Practical rule of thumb:

- use `inherit` unless you have a strong reason not to
- leave `boundedRepairModelStrategy` unset unless you intentionally want smaller models for repair turns
- reserve `xhigh` for escalation paths rather than using it everywhere

## Operator Dashboard

The WebUI uses the same config and the same `SupervisorService` boundary as the CLI.

```bash
node dist/index.js web --config /path/to/supervisor.config.json
```

Current safe command surface:

- `run-once`
- `requeue`
- `prune-orphaned-workspaces`
- `reset-corrupt-json-state`

Use the dashboard when you want a browser view of the same supervisor state, not a separate execution model.

## Related Docs

- [Getting started](./getting-started.md)
- [Local review](./local-review.md)
- [Operator dashboard](./operator-dashboard.md)
- [Architecture](./architecture.md)
- [Issue metadata](./issue-metadata.md)
- [Atlas example](./examples/atlaspm.md)
