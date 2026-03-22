# Getting Started with codex-supervisor

Use this guide when you are ready to operate `codex-supervisor` against a real repository.

It focuses on the practical flow:

- decide whether the work is ready for the supervisor
- configure the supervisor for your repo and review provider
- author issues the scheduler can execute safely
- run a first pass, inspect the result, then switch to the loop
- know which reference doc to open when you need deeper detail

For the product overview, fit, and docs map, start with the [README](../README.md). If you are handing the repo to an AI operator, send it to the [Agent Bootstrap Protocol](./agent-instructions.md) instead of duplicating that bootstrap sequence here.

## Before you start

Confirm these prerequisites before you run the supervisor:

- `gh auth status` succeeds
- `codex` CLI is installed and works from your shell
- the managed repository is already cloned locally
- branch protection and CI are already configured on the managed repository
- you have a repo path where the supervisor can create per-issue worktrees
- the repo is a trusted repo for autonomous execution
- the GitHub authors who can edit issue bodies, review comments, and related execution text are trusted for that repo

Build the CLI once in the supervisor repo:

```bash
npm install
npm run build
```

If you want to run the WebUI browser smoke suite locally or in CI, use:

```bash
npm run test:webui-smoke
```

That harness uses `playwright-core` with a local Chrome/Chromium executable against an in-process dashboard fixture. Set `CHROME_BIN=/path/to/browser` when the browser is not discoverable as `google-chrome`, `google-chrome-stable`, `chromium`, or `chromium-browser`.

Current execution-safety rule: GitHub-authored issue bodies, review comments, and similar GitHub text are part of the supervisor trust boundary because they become execution inputs for Codex. The current runtime uses `--dangerously-bypass-approvals-and-sandbox`, so autonomous execution is safe enough to enable only in a trusted repo with trusted authors. If that trust is not present, autonomous execution is not safe for the current posture.

Current state-recovery rule: missing JSON state means there is no durable state yet, so the supervisor can bootstrap from empty state. Corrupted JSON state is not the same thing. Treat corrupted JSON state as a recovery event and not a durable recovery point until an operator has inspected the problem and completed an explicit acknowledgement or reset.

Current workspace-recovery rule: when `ensureWorkspace()` needs to restore an issue workspace, it should prefer an existing local issue branch first, then an existing remote issue branch, and only then bootstrap a fresh issue branch from `origin/<defaultBranch>`. Treat that default-branch bootstrap as the fallback when no existing issue branch can be restored, not as the normal response to every missing local branch.

## Choose the operating mode

Use `codex-supervisor` only when the next issue is already execution-ready.

Choose `codex-supervisor` directly when:

- the issue body explains the change clearly
- dependencies are written down
- execution order is explicit when sibling issues must run in sequence
- acceptance criteria and verification are concrete

Use GSD before the supervisor when:

- the request is still vague
- one issue needs to be split into several dependent issues
- repo memory or planning docs need to be updated before execution starts

Rule of thumb:

**GSD designs the backlog. `codex-supervisor` executes the backlog.**

## Prepare the supervisor config

Create an active config from the base example:

```bash
cp supervisor.config.example.json supervisor.config.json
```

Then choose the review provider profile that matches your PR review flow:

- [supervisor.config.copilot.json](../supervisor.config.copilot.json)
- [supervisor.config.codex.json](../supervisor.config.codex.json)
- [supervisor.config.coderabbit.json](../supervisor.config.coderabbit.json)

Either copy one of those files over `supervisor.config.json` or copy only its `reviewBotLogins` into your active config.

At minimum, set these fields before the first run:

- `repoPath`
- `repoSlug`
- `workspaceRoot`
- `codexBinary`
- provider-specific review settings you expect the supervisor to watch

If you need the full field-by-field setup, model policy, durable memory, or provider guidance, use the [Configuration reference](./configuration.md).

## Write execution-ready issues

The scheduler is readiness-driven across the matching open backlog. It does not just pick the newest open issue; it pages through matching open issues using the configured candidate discovery fetch window as the page size, then picks the first issue that is actually runnable in deterministic order.

Candidate discovery now evaluates the matching open backlog rather than stopping after the first page. In large repositories, older runnable issues remain discoverable even when they begin beyond the first page. If the backlog order looks wrong, check the issue metadata before assuming discovery skipped part of the backlog.

Before you run the supervisor, make sure each candidate issue includes:

- a clear `## Summary`
- a bounded `## Scope`
- `Depends on` for prerequisites
- `## Execution order` when sibling issues must run in sequence
- observable `## Acceptance criteria`
- concrete `## Verification`

Minimal example:

```md
## Summary
Refocus the getting-started guide on setup and operator flow.

## Scope
- keep the guide centered on setup and operation
- remove duplicated deep-reference sections
- keep links to the deeper docs accurate

Part of: #259
Depends on: #262
Parallelizable: No

## Execution order
4 of 5

## Acceptance criteria
- the guide reads as an operational setup-and-usage document
- duplicated reference content is removed or shortened
- related doc links are correct

## Verification
- review the getting-started flow for clarity
- run npm run build
```

Use the [Issue metadata reference](./issue-metadata.md) for the canonical field rules and more examples.

Issue readiness is not the same as trust. A perfectly structured issue is still not safe for autonomous execution when the GitHub-authored text comes from an untrusted repo or untrusted author set.

## Run the first pass

Start with a single supervised pass so you can inspect the repo selection, worktree setup, and resulting state before you hand over the loop:

```bash
node dist/index.js run-once --config /path/to/supervisor.config.json
node dist/index.js status --config /path/to/supervisor.config.json
```

What to check after `run-once`:

- the selected issue is the one you expected
- the issue worktree was created under `workspaceRoot`
- any restored issue workspace reused the expected local branch first, otherwise the expected remote branch, instead of silently falling back to a fresh bootstrap
- any untracked orphaned `issue-*` worktree under `workspaceRoot` was not treated like tracked done-workspace cleanup; locked, recent, or manually kept orphan workspaces should be preserved unless you explicitly prune them
- the issue journal shows a sensible hypothesis, blocker, and next step
- any opened PR or status transition matches the actual repo state

If the first pass picks the wrong issue, inspect `status` or `doctor` for the effective candidate discovery settings and then fix the issue metadata before running again. Do not treat issue creation time as the source of truth.
If `status` or `doctor` reports corrupted JSON state, stop treating that file as a safe checkpoint. Inspect the file and recent operator actions first, then explicitly acknowledge the corruption or reset the state before trusting future runs.

## Move from run-once to loop

When one supervised pass behaves correctly, switch to the continuous loop:

```bash
node dist/index.js loop --config /path/to/supervisor.config.json
```

If you want a local operator view over the same supervisor service, you can also run:

```bash
node dist/index.js web --config /path/to/supervisor.config.json
```

The WebUI uses the same `SupervisorService` boundary as the CLI. It reads the same typed status, doctor, explain, and issue-lint data, and it only exposes the current safe command set: `run-once`, `requeue`, `prune-orphaned-workspaces`, and `reset-corrupt-json-state`.

In normal operation, the supervisor will:

1. re-read GitHub and local state
2. resume or select the next runnable issue
3. run a Codex turn in that issue's dedicated worktree
4. open or update the PR when there is a coherent checkpoint
5. wait for CI and reviews, then repair or merge as needed

Use `status` whenever you want the current issue, PR, check, review, and mergeability summary without advancing the loop.
Use `doctor` when you need host and state-file diagnostics, especially to distinguish a missing JSON state file from corrupted JSON state that requires operator recovery.
Use `issue-lint` when you need to inspect whether one issue is actually execution-ready before trusting it as runnable work.
Use the WebUI when you want the same operator state through a local dashboard rather than the CLI.

If you use the CodeRabbit profile, `status` can first show `configured_bot_initial_grace_wait status=active provider=coderabbit pause_reason=awaiting_initial_provider_activity ... configured_wait_seconds=90 wait_until=...` right after required checks turn green. That indicates an intentional startup grace window for CodeRabbit and makes longer tuned waits obvious.

If CodeRabbit's latest earlier signal was only a draft-skip while the PR was still a draft, and the PR later becomes ready for review, `status` can instead show `configured_bot_initial_grace_wait status=active provider=coderabbit pause_reason=awaiting_fresh_provider_review_after_draft_skip recent_observation=ready_for_review_reopened_wait ... configured_wait_seconds=90 wait_until=...`. That means the supervisor intentionally restarted the CodeRabbit grace window from the ready-for-review transition because the earlier draft skip does not count as a fresh ready-state review.

After CodeRabbit posts on the current PR head, `status` can switch to `configured_bot_settled_wait status=active provider=coderabbit pause_reason=recent_current_head_observation ... configured_wait_seconds=5 wait_until=...`. That later line is a separate short quiet period before merge progression resumes.

## Common operator decisions

When should I use GSD first?
Use GSD when the next issue is still a planning problem. Use the supervisor when the next issue is already an execution problem.

When should I open a PR?
Open or update a draft PR as soon as the branch has a coherent checkpoint. The supervisor is designed to publish early rather than waiting for a perfect final state.

When should I enable local review?
Enable it when you want a committed pre-merge review gate or an additional local advisory pass before CI and external reviews. Use the [Local review reference](./local-review.md) for role selection, thresholds, artifacts, and policy choices.

When should orphaned workspaces be cleaned up?
Treat orphaned `issue-*` worktrees as explicit cleanup work, not as the same thing as delayed cleanup for tracked done workspaces. Preserve orphan workspaces that are locked, recently touched, or intentionally kept for manual recovery, and prune abandoned orphan workspaces only when you have made that operator decision explicitly.

What if the backlog order looks wrong?
Fix `Depends on` and `Execution order` in GitHub. The scheduler pages through the matching open backlog and follows runnable order across that full candidate set, not operator intuition or chat history.

What if the loop keeps hitting blocked work?
Stop treating the issue as execution-ready. Tighten the issue body, split the work, or use GSD to rebuild the backlog.

## Common mistakes

- starting with `loop` before validating `run-once`
- asking the supervisor to execute issues that still need planning
- relying on issue creation time instead of explicit dependency metadata
- treating README-level overview content as a substitute for issue metadata
- expecting deep config or local-review details to live in this guide instead of the dedicated references

## Related docs

- [README](../README.md) for the overview, fit, and docs map
- [Agent Bootstrap Protocol](./agent-instructions.md) for the AI-agent bootstrap order, first-run checks, and escalation points
- [Configuration reference](./configuration.md) for config fields, provider setup, model policy, and durable memory
- [Operator dashboard](./operator-dashboard.md) for the local WebUI, panel meanings, safe command surface, and smoke-test harness
- [Local review reference](./local-review.md) for review roles, artifacts, thresholds, and merge policy
- [Issue metadata reference](./issue-metadata.md) for execution-ready issue structure and scheduling inputs
