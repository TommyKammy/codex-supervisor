# Getting Started with codex-supervisor

Use this guide when you are ready to operate `codex-supervisor` against a real repository.

It focuses on the practical flow:

- decide whether the work is ready for the supervisor
- configure the supervisor for your repo and review provider
- author issues the scheduler can execute safely
- run a first pass, inspect the result, then switch to the loop
- know which reference doc to open when you need deeper detail

For the product overview, fit, and docs map, start with the [README](../README.md).

## Before you start

Confirm these prerequisites before you run the supervisor:

- `gh auth status` succeeds
- `codex` CLI is installed and works from your shell
- the managed repository is already cloned locally
- branch protection and CI are already configured on the managed repository
- you have a repo path where the supervisor can create per-issue worktrees

Build the CLI once in the supervisor repo:

```bash
npm install
npm run build
```

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

The scheduler is readiness-driven. It does not just pick the newest open issue; it picks the first issue that is actually runnable.

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

## Run the first pass

Start with a single supervised pass so you can inspect the repo selection, worktree setup, and resulting state before you hand over the loop:

```bash
node dist/index.js run-once --config /path/to/supervisor.config.json
node dist/index.js status --config /path/to/supervisor.config.json
```

What to check after `run-once`:

- the selected issue is the one you expected
- the issue worktree was created under `workspaceRoot`
- the issue journal shows a sensible hypothesis, blocker, and next step
- any opened PR or status transition matches the actual repo state

If the first pass picks the wrong issue, fix the issue metadata before running again. Do not treat issue creation time as the source of truth.

## Move from run-once to loop

When one supervised pass behaves correctly, switch to the continuous loop:

```bash
node dist/index.js loop --config /path/to/supervisor.config.json
```

In normal operation, the supervisor will:

1. re-read GitHub and local state
2. resume or select the next runnable issue
3. run a Codex turn in that issue's dedicated worktree
4. open or update the PR when there is a coherent checkpoint
5. wait for CI and reviews, then repair or merge as needed

Use `status` whenever you want the current issue, PR, check, review, and mergeability summary without advancing the loop.

## Common operator decisions

When should I use GSD first?
Use GSD when the next issue is still a planning problem. Use the supervisor when the next issue is already an execution problem.

When should I open a PR?
Open or update a draft PR as soon as the branch has a coherent checkpoint. The supervisor is designed to publish early rather than waiting for a perfect final state.

When should I enable local review?
Enable it when you want a committed pre-merge review gate or an additional local advisory pass before CI and external reviews. Use the [Local review reference](./local-review.md) for role selection, thresholds, artifacts, and policy choices.

What if the backlog order looks wrong?
Fix `Depends on` and `Execution order` in GitHub. The scheduler follows runnable order, not operator intuition or chat history.

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
- [Configuration reference](./configuration.md) for config fields, provider setup, model policy, and durable memory
- [Local review reference](./local-review.md) for review roles, artifacts, thresholds, and merge policy
- [Issue metadata reference](./issue-metadata.md) for execution-ready issue structure and scheduling inputs
