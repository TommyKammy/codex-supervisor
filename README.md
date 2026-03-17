# codex-supervisor

Deterministic GitHub issue, PR, CI, and review supervision for `codex exec` and `gh`.

`codex-supervisor` keeps the execution loop outside the chat thread: it stores local state, works in per-issue worktrees, and keeps re-reading GitHub before every next action.

Japanese overview: [docs/README.ja.md](./docs/README.ja.md)  
Japanese getting started: [docs/getting-started.ja.md](./docs/getting-started.ja.md)

## What It Is

Use `codex-supervisor` when you want Codex to work through execution-ready GitHub issues in a durable, explicit loop:

- re-read issue, PR, checks, reviews, and mergeability from GitHub
- select the next runnable issue instead of trusting chat history
- run each turn in a dedicated worktree with a persistent issue journal
- keep moving through draft PR, CI repair, review fixes, and merge

If you want the setup flow, first-run commands, and operator decisions, start with [Getting started](./docs/getting-started.md).

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
   node dist/index.js loop --config /path/to/supervisor.config.json
   ```

Requirements: `gh auth status` must succeed, `codex` CLI must be installed, and the managed repository should already have branch protection and CI in place.

## Provider Profiles

`supervisor.config.json` is always the active file. The shipped provider profiles are starting points that set the expected review signal identities for each provider.

- Copilot profile: start from [supervisor.config.copilot.json](./supervisor.config.copilot.json), enable GitHub Copilot review for the target repo or org, and verify a ready PR receives review activity from `copilot-pull-request-reviewer`.
- Codex Connector profile: start from [supervisor.config.codex.json](./supervisor.config.codex.json), connect the repo to Codex in ChatGPT/OpenAI, and verify PR review activity arrives from `chatgpt-codex-connector`.
- CodeRabbit profile: start from [supervisor.config.coderabbit.json](./supervisor.config.coderabbit.json), install CodeRabbit, and verify review activity arrives from `coderabbitai` or `coderabbitai[bot]`. The shipped profile also waits up to 30 minutes after a CodeRabbit `Rate limit exceeded` warning before continuing, and it briefly holds merge progression after a fresh current-head CodeRabbit observation; `status` shows that short hold as `configured_bot_settled_wait status=active provider=coderabbit pause_reason=recent_current_head_observation ... wait_until=...` so operators can see why the pause is active and when it will end.

If the provider never posts a usable PR review signal, fix the provider-side setup before treating the profile as working.

## Docs Map

- [Getting started](./docs/getting-started.md): setup checklist, execution-ready issue flow, first-run commands, and common operator decisions
- [Configuration reference](./docs/configuration.md): config setup, provider profiles, model/reasoning controls, durable memory, and execution policy
- [Local review reference](./docs/local-review.md): local review policies, role selection, artifacts, thresholds, and committed guardrails
- [Architecture](./docs/architecture.md): core loop, durable state, reconciliations, and safety boundaries
- [Issue metadata](./docs/issue-metadata.md): canonical issue-body fields, sequencing rules, and execution-ready examples
- [GSD to GitHub issues](./docs/examples/gsd-to-github-issues.md): how to hand planning output into execution-ready issues
- [Atlas example](./docs/examples/atlaspm.md): a concrete config and workflow example
- [Validation checklist](./docs/validation-checklist.md): rollout checks and operational readiness
