# Getting Started with codex-supervisor

This guide is for people who have just installed Codex CLI or started using the Codex desktop app.

The goal is to explain:

- what `codex-supervisor` is
- when to use `codex-supervisor` alone
- when to use `get-shit-done` (GSD) before the supervisor
- how to talk to Codex as your operator console
- how the supervisor actually chooses the next issue

## Mental model

Treat Codex as your operator console.

- You talk to Codex.
- Codex can help you use GSD when requirements are still ambiguous.
- Codex can help you run `codex-supervisor` when issues are already execution-ready.

`codex-supervisor` is the execution engine.

- It keeps local state.
- It creates issue worktrees.
- It runs `codex exec`.
- It tracks PRs, CI, reviews, and mergeability.
- It advances only when the current issue is actually runnable.

GSD is an optional planning layer.

- It is useful before execution starts.
- It is useful when a large issue needs to be split.
- It is useful when a blocked issue needs to be reframed.

## Full picture

```mermaid
flowchart LR
  U["User"] --> C["Codex CLI / Codex App"]
  C --> P["GSD planning flow (optional)"]
  C --> S["codex-supervisor"]

  P --> M["Repo memory\nPROJECT.md / REQUIREMENTS.md / ROADMAP.md / STATE.md"]
  P --> I["GitHub Issues\nEpic / child issues / Depends on / Execution order"]

  S --> M
  S --> I
  S --> W["Issue worktrees + local state"]
  S --> G["GitHub PR / CI / Reviews / Merge"]

  G --> S
  I --> S
```

## What codex-supervisor does

At a high level, the supervisor runs this loop:

1. Re-read GitHub and local state.
2. Select the first runnable issue.
3. Create or resume the issue worktree.
4. Run a Codex turn.
5. Push a branch and open or update a PR.
6. Wait for CI and reviews.
7. Repair CI or address valid review findings.
8. Merge when the gate conditions are satisfied.
9. Move to the next runnable issue.

## Best fit

`codex-supervisor` works best when:

- one person, or one execution lane, owns the repo automation
- issues are execution-ready
- dependencies are written down
- execution order is explicit
- CI and branch protection are already in place

Typical example:

- one epic
- several child issues
- `Depends on`
- `Part of`
- `Execution order`
- clear acceptance criteria

## Not a fit

It is a weak fit when:

- issue priority changes constantly
- issue descriptions are mostly discussion, not execution
- multiple people change the same code paths at once
- the backlog has no explicit dependencies or ordering

In those cases, use GSD first to improve the backlog before asking the supervisor to execute it.

## Two operating modes

### Mode A: Without GSD

Use this when your GitHub issues are already clear and sequenced.

Flow:

```mermaid
flowchart LR
  A["Execution-ready issues"] --> B["codex-supervisor"]
  B --> C["Implement"]
  C --> D["Draft PR"]
  D --> E["Local review / CI / PR review"]
  E --> F["Merge"]
```

Typical prompts to Codex:

- "Build the supervisor and start working on the next runnable issue."
- "Show me the current supervisor status."
- "Check the PR review comments and fix valid ones."
- "Check the failing CI for the current PR and repair it."

### Mode B: With GSD

Use this when the work is still ambiguous.

Flow:

```mermaid
flowchart LR
  A["Ambiguous request"] --> B["Codex using GSD"]
  B --> C["Repo memory docs"]
  B --> D["Epic + child issues"]
  C --> E["codex-supervisor"]
  D --> E
  E --> F["PR / CI / Review / Merge loop"]
```

Typical prompts to Codex:

- "Use GSD to break this feature into an epic and child issues."
- "Use GSD to turn this vague request into execution-ready issues."
- "Update PROJECT.md, REQUIREMENTS.md, ROADMAP.md, and STATE.md, then show me the proposed issue breakdown."
- "This issue is too large. Use GSD to split it into smaller dependent issues."

## How GSD hands off to codex-supervisor

GSD should not replace the supervisor's execution loop.

Use GSD for:

- feature framing
- phase planning
- dependency design
- acceptance criteria
- repo memory updates

Do not use GSD for:

- PR monitoring
- CI repair loops
- merge gating
- issue-by-issue execution orchestration

The hand-off boundary is:

1. GSD updates planning docs.
2. GSD output becomes GitHub epic and child issues.
3. Those issues become the supervisor's queue.

## Recommended repo memory when using GSD

These files work well as durable shared memory:

- `PROJECT.md`
- `REQUIREMENTS.md`
- `ROADMAP.md`
- `STATE.md`
- `README.md`
- `docs/architecture.md`
- `docs/constitution.md`
- `docs/workflow.md`
- `docs/decisions.md`

The supervisor reads a compact context index first, then opens durable memory files only on demand.

## Focused reference guides

Use the high-level flow in this guide, then jump to the reference that matches the task:

- [Configuration reference](./configuration.md) for config fields, provider profiles, model strategy, durable memory, and execution policy
- [Local review reference](./local-review.md) for review policies, role selection, artifacts, thresholds, and committed guardrails
- [Issue metadata reference](./issue-metadata.md) for the canonical field guide, sequencing rules, and execution-ready issue template

## How issue scheduling actually works

This is the most important concept.

The supervisor is not primarily "issue-created driven".

It is "readiness-driven".

That means it does not simply pick the newest open issue. It looks for the next issue that is actually runnable.

## Why open issue order is not enough

Consider this backlog:

```text
#101 Epic
#102 1 of 3
#103 2 of 3 Depends on: #102
#104 3 of 3 Depends on: #103
```

All three child issues may already be open. But only `#102` is runnable.

So the supervisor should not use:

- "latest open issue"
- "first open issue"
- "issue creation time only"

It should use:

- "first runnable issue"

## How readiness-driven scheduling works

```mermaid
flowchart TD
  A["Poll GitHub + local state"] --> B["List open candidate issues"]
  B --> C["Skip non-work items\n(example: Epic:)"]
  C --> D["Check Depends on / Execution order"]
  D --> E["Check local terminal state\n(blocked / failed / retry budget)"]
  E --> F["Select next runnable issue"]
  F --> G["Create or resume worktree"]
  G --> H["Run Codex turn"]
```

The scheduler considers:

- issue is open
- issue matches the configured label or search
- issue title is not skipped
- dependencies are satisfied
- execution order is satisfied
- local record is not terminal in a way that blocks retry
- stale PR or stale failure state has been reconciled

For the detailed issue format, examples, and field-by-field rules, use the [Issue metadata reference](./issue-metadata.md).

## State machine

The supervisor is built around explicit state transitions.

```mermaid
flowchart TD
  Q["queued"] --> R["reproducing"]
  R --> S["stabilizing"]
  S --> D["draft_pr"]
  D --> L["local_review"]
  L --> F["local_review_fix"]
  F --> D
  L --> W["waiting_ci"]
  W --> A["addressing_review"]
  W --> C["repairing_ci"]
  W --> X["resolving_conflict"]
  W --> F
  W --> M["ready_to_merge"]
  A --> W
  C --> W
  X --> W
  M --> G["merging"]
  G --> O["done"]
  R --> B["blocked"]
  S --> Z["failed"]
```

Short interpretation:

- `reproducing`: make the problem concrete
- `stabilizing`: move toward a clean checkpoint
- `draft_pr`: publish early when the checkpoint is coherent
- `local_review`: run a local advisory review swarm
- `local_review_fix`: apply the smallest repair that clears the active compressed local-review root causes
- `waiting_ci`: checks or review grace window
- `addressing_review`: fix valid bot review findings
- `repairing_ci`: fix failing checks
- `resolving_conflict`: fix a dirty merge state
- `ready_to_merge`: all gates are satisfied
- `blocked`: needs manual clarification
- `failed`: retry budget exhausted or unrecoverable condition

## What to ask Codex

### To use the supervisor

- "Build the supervisor and start the next runnable issue."
- "Show me the current supervisor status."
- "Resume the current issue and report the PR, CI, and review state."

### To use GSD before the supervisor

- "Use GSD to turn this feature into an epic and child issues."
- "Use GSD to update the planning docs and propose a dependency order."
- "Use GSD to split this blocked issue into smaller execution-ready issues."

### To bridge GSD into the supervisor

- "Use GSD to refine the plan, update repo memory, create the issues, then hand off to codex-supervisor."

## Suggested first-run workflow

1. Install Codex CLI.
2. Clone your repo.
3. Prepare `supervisor.config.json`.
   Use the [Configuration reference](./configuration.md) for the full field guide, the [Local review reference](./local-review.md) when you want to enable or tune the local review swarm, and the [Issue metadata reference](./issue-metadata.md) when you need to author or review execution-ready issues.
4. Create execution-ready issues.
5. Run:

```bash
npm install
npm run build
node dist/index.js run-once --config /path/to/supervisor.config.json
node dist/index.js status --config /path/to/supervisor.config.json
```

6. When the behavior looks correct, switch to:

```bash
node dist/index.js loop --config /path/to/supervisor.config.json
```

## Common mistakes

- using the supervisor before the backlog is execution-ready
- expecting issue creation time to define execution order
- mixing GSD execution flows into the supervisor loop
- relying on chat memory instead of repo memory
- starting with `loop` before validating `run-once`

## Rule of thumb

Use this simple rule:

- if the issue is clear, use `codex-supervisor`
- if the issue is vague, use GSD first
- when GSD output becomes explicit issues, hand back to the supervisor

In one sentence:

**GSD designs the backlog. codex-supervisor executes the backlog.**
