# codex-supervisor

Deterministic GitHub issue, PR, CI, and review supervision for `codex exec` and `gh`.

`codex-supervisor` keeps the execution loop outside the chat thread: it stores local state, works in per-issue worktrees, and keeps re-reading GitHub before every next action.

Pull-request hydration contract: action-taking supervisor paths must rely on fresh GitHub review facts. Any retained cached hydration data is informational and non-authoritative; it can help diagnostics and operator visibility, but it must not be the authority for review readiness, merge readiness, or similar PR decisions.

Japanese overview: [docs/README.ja.md](./docs/README.ja.md)  
Japanese getting started: [docs/getting-started.ja.md](./docs/getting-started.ja.md)

## What It Is

Use `codex-supervisor` when you want Codex to work through execution-ready GitHub issues in a durable, explicit loop:

- re-read issue, PR, checks, reviews, and mergeability from GitHub
- select the next runnable issue instead of trusting chat history
- run each turn in a dedicated worktree with a persistent issue journal
- keep moving through draft PR, CI repair, review fixes, and merge

GitHub-authored issue bodies, PR review comments, and related GitHub text are execution inputs, not trusted instructions by default. Treat that GitHub-authored text as part of the supervisor trust boundary and use the autonomous loop only in repos where the operator trusts both the repository and the GitHub authors who can supply that text.

If you want the setup flow, first-run commands, and operator decisions, start with [Getting started](./docs/getting-started.md).
If you are an AI agent entering the repo, start with the [AI agent handoff](./docs/agent-instructions.md) before reading the detailed references.

## Who It Is For

Best fit:

- solo development or one clearly owned automation lane
- repos with execution-ready issues and explicit dependency order
- branch-protected repos with a stable PR and CI workflow
- teams that want GitHub, not chat memory, to stay the source of truth

Not a fit:

- multi-author repos with frequent overlapping changes
- backlogs whose priority and dependency order are mostly implicit
- issue trackers full of discussion prompts instead of executable tasks
- workflows that expect the supervisor to invent planning or coordination policy

## Quick Start

1. Install dependencies and build the CLI.

   ```bash
   npm install
   npm run build
   ```

   For the operator dashboard browser smoke suite, run:

   ```bash
   npm run test:webui-smoke
   ```

   The smoke harness launches a local Chrome/Chromium binary through `playwright-core` against an in-process HTTP fixture. If your browser executable is not on a standard `google-chrome`, `google-chrome-stable`, `chromium`, or `chromium-browser` path, set `CHROME_BIN=/path/to/browser`.

2. Create your active config from the base example.

   ```bash
   cp supervisor.config.example.json supervisor.config.json
   ```

3. Choose the review provider profile that matches your PR review flow, then either copy that file over `supervisor.config.json` or copy its `reviewBotLogins` into the `supervisor.config.json` you created in step 2.

   - [supervisor.config.copilot.json](./supervisor.config.copilot.json)
   - [supervisor.config.codex.json](./supervisor.config.codex.json)
   - [supervisor.config.coderabbit.json](./supervisor.config.coderabbit.json)

4. Edit `supervisor.config.json` and set `repoPath`, `repoSlug`, `workspaceRoot`, `codexBinary`, and any review-provider-specific values you want to keep.

5. Run a single pass first, then switch to the loop when the config looks right.

   ```bash
   node dist/index.js run-once --config /path/to/supervisor.config.json
   node dist/index.js status --config /path/to/supervisor.config.json
   node dist/index.js rollup-execution-metrics --config /path/to/supervisor.config.json
   node dist/index.js loop --config /path/to/supervisor.config.json
   ```

   If you want the local operator dashboard, start the WebUI against the same config:

   ```bash
   node dist/index.js web --config /path/to/supervisor.config.json
   ```

Requirements: `gh auth status` must succeed, `codex` CLI must be installed, the managed repository should already have branch protection and CI in place, and the operator should only enable autonomous execution in a trusted repo with trusted GitHub authors. The current Codex runs use `--dangerously-bypass-approvals-and-sandbox`; see [Getting started](./docs/getting-started.md), [Configuration reference](./docs/configuration.md), and [Architecture](./docs/architecture.md) for the execution-safety boundary.

State-file contract: missing JSON state is an empty bootstrap case, but corrupted JSON state is not. Treat corrupted JSON state as a recovery event, not a durable recovery point, until an operator has inspected it and performed an explicit acknowledgement or reset.

Workspace restore contract: `ensureWorkspace()` should prefer an existing local issue branch first, then an existing remote issue branch, and only then bootstrap a fresh issue branch from `origin/<defaultBranch>`. Bootstrapping from the default branch is the fallback path when no existing issue branch can be restored.

Workspace cleanup contract: tracked done workspaces and orphaned workspaces are different cases. Tracked done workspace cleanup is the bounded delayed cleanup controlled by the done-workspace settings. An orphaned workspace is an untracked `issue-*` worktree under `workspaceRoot` that no longer has a live state entry; preserve locked, recent, or manually kept orphan workspaces, and only prune abandoned orphan workspaces through an explicit operator action rather than an implicit background cleanup.

Execution metrics durability contract: terminal run summaries are retained under `<dirname(stateFile)>/execution-metrics/run-summaries/`, so worktree cleanup does not remove the aggregation source. Run `node dist/index.js rollup-execution-metrics --config /path/to/supervisor.config.json` to write the current daily rollup to `<dirname(stateFile)>/execution-metrics/daily-rollups.json`.

## Provider Profiles

Choose the review provider profile that matches how PR feedback arrives in your repo, then keep any provider-side setup aligned with that choice.

- Copilot profile: [supervisor.config.copilot.json](./supervisor.config.copilot.json)
- Codex Connector profile: [supervisor.config.codex.json](./supervisor.config.codex.json)
- CodeRabbit profile: [supervisor.config.coderabbit.json](./supervisor.config.coderabbit.json)

Each profile is a starting point. Copy the review provider profile you want, then adjust the rest of `supervisor.config.json` for your repo.

## Docs Map

- [AI agent handoff](./docs/agent-instructions.md): bootstrap read order, first-run checks, and escalation rules for repo-entering AI agents
- [Getting started](./docs/getting-started.md): setup checklist, execution-ready issue flow, first-run commands, and common operator decisions
- [Configuration reference](./docs/configuration.md): config setup, provider profiles, model/reasoning controls, durable memory, and execution policy
- [Operator dashboard](./docs/operator-dashboard.md): WebUI launch, panel meanings, safe commands, and browser smoke verification
- [Local review reference](./docs/local-review.md): local review policies, role selection, artifacts, thresholds, and committed guardrails
- [Architecture](./docs/architecture.md): core loop, durable state, reconciliations, and safety boundaries
- [Issue metadata](./docs/issue-metadata.md): canonical issue-body fields, sequencing rules, and execution-ready examples
- [GSD to GitHub issues](./docs/examples/gsd-to-github-issues.md): how to hand planning output into execution-ready issues
- [Atlas example](./docs/examples/atlaspm.md): a concrete config and workflow example
- [Validation checklist](./docs/validation-checklist.md): rollout checks and operational readiness
