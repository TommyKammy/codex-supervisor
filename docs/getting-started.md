# Getting Started with codex-supervisor

Use this guide when you are ready to operate `codex-supervisor` against a real repository.

It focuses on the practical flow:

- decide whether the work is ready for the supervisor
- configure the supervisor for your repo and review provider
- author issues the scheduler can execute safely
- run a first pass, inspect the result, then switch to the loop
- know which reference doc to open when you need deeper detail

For the product overview, fit, and docs map, start with the [README](../README.md). If you are handing the repo to an AI operator, send it to the [Agent Bootstrap Protocol](./agent-instructions.md) instead of duplicating that bootstrap sequence here.

If you want one disposable supervised pass before operating on production work, use the [Playground smoke run](./playground-smoke-run.md) first.

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

For a lightweight pre-PR path-hygiene check that stays independent from `build` and `test`, run:

```bash
npm run verify:paths
```

That check stays fail closed for ordinary publishable tracked content. At runtime, the publication gates can auto-normalize supervisor-owned issue journals and other trusted generated durable artifacts before rechecking blockers, but they still block when ordinary docs or other publishable files keep workstation-local absolute paths.

If you want to run the WebUI browser smoke suite locally or in CI, see the browser requirements in the [Operator dashboard guide](./operator-dashboard.md#browser-smoke-suite).

Current execution-safety rule: GitHub-authored issue bodies, review comments, and similar GitHub text are part of the supervisor trust boundary because they become execution inputs for Codex. The current runtime uses `--dangerously-bypass-approvals-and-sandbox`, so autonomous execution is safe enough to enable only in a trusted repo with trusted authors. If that trust is not present, autonomous execution is not safe for the current posture.
Current fail-closed implementation rule: when provenance, scope, auth context, or trust-boundary signals are missing, malformed, or only partially trusted, the supervisor and its durable guidance should block or escalate rather than infer a permissive success path.

Current state-recovery rule: missing JSON state means there is no durable state yet, so the supervisor can bootstrap from empty state. Corrupted JSON state is not the same thing. Treat corrupted JSON state as a recovery event and not a durable recovery point until an operator has inspected the problem and completed an explicit acknowledgement or reset.

Current workspace-recovery rule: when `ensureWorkspace()` needs to restore an issue workspace, it should prefer an existing local issue branch first, then an existing remote issue branch, and only then bootstrap a fresh issue branch from an authoritative fresh default-branch ref such as `origin/<defaultBranch>`. Treat that default-branch bootstrap as the fallback when no existing issue branch can be restored, not as the normal response to every missing local branch.

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

Then choose the review provider profile that matches your PR review flow. The active config is whichever file you pass with `--config`, so you can either edit a single `supervisor.config.json` file or keep several named profiles and choose between them at runtime:

- [supervisor.config.copilot.json](../supervisor.config.copilot.json)
- [supervisor.config.codex.json](../supervisor.config.codex.json)
- [supervisor.config.coderabbit.json](../supervisor.config.coderabbit.json)

Either copy one of those files over `supervisor.config.json` as a starting point, copy it to a separate profile such as `supervisor.config.local.json`, or copy only its `reviewBotLogins` into your active config.

At minimum, set these first-run fields before the first run:

- `repoPath`
- `repoSlug`
- `workspaceRoot`
- `codexBinary`
- `trustMode`
- `executionSafetyMode`
- provider-specific review settings you expect the supervisor to watch

The setup/readiness report stays `ready: false` until these required first-run blockers, including the explicit trust posture decisions, are resolved.

The shipped CodeRabbit profile intentionally uses a non-loadable `repoSlug` placeholder so operators must replace it before the first run.

For TypeScript and Node repositories, [supervisor.config.typescript-node.json](../supervisor.config.typescript-node.json) publishes an npm-oriented starter profile. It uses `npm ci` for worktree preparation and `npm run verify:pre-pr` for the repo-owned local CI gate; see the [TypeScript and Node starter profile](./examples/typescript-node.md) for the expected scripts and a first issue example.

For Next.js app repositories, [supervisor.config.nextjs.json](../supervisor.config.nextjs.json) publishes the same npm-owned setup and local CI posture with Next.js-specific script guidance; see the [Next.js starter profile](./examples/nextjs.md) for common `build`, `lint`, and `test` mappings and a first issue example.

For Python packages and CLI tools, [supervisor.config.python-cli.json](../supervisor.config.python-cli.json) publishes a command-substitution starter profile. Replace its setup and pre-PR command placeholders with repo-owned commands before the first run; see the [Python and CLI starter profile](./examples/python-cli.md) for common `pytest`, `build`, and task-runner mappings and a first issue example.

### Explicit trust posture setup

Trust posture setup is a product primitive for trusted solo-lane automation. It packages the authority choices that decide whether the supervisor may turn GitHub-authored text, local repo state, review signals, and configured commands into autonomous Codex work.

Treat these as operator-owned decisions:

- repo trust: the managed repository is the repo you intend to let the supervisor mutate
- author trust: the GitHub authors who can edit issues, review comments, and related execution text are trusted for that repo
- sandbox posture: `executionSafetyMode` is chosen deliberately, especially when the runtime is unsandboxed autonomous execution
- local CI posture: `localCiCommand` is absent, dismissed, or configured as the repo-owned fail-closed gate
- review provider posture: `reviewBotLogins` and provider wait settings match the review source you intend to trust
- auto-merge posture: merge progression remains bounded by branch protection, fresh PR facts, and the configured merge policy
- follow-up issue posture: automatic follow-up issue creation stays disabled unless the operator explicitly wants that route

Automation-owned decisions start only after those operator-owned decisions are explicit. The supervisor can lint issue metadata, report setup/readiness, run the configured local CI command, wait for configured review providers, block on stale or missing signals, and advance the loop inside the chosen posture. It should not expand authority by inferring trust from repo names, author comments, nearby config, provider presence, or detected scripts.

Dangerous or authority-expanding choices remain explicit opt-ins. Unsandboxed autonomous execution, local CI as a publication gate, local review as a merge gate, high-severity auto-repair, automatic follow-up issue creation, and any auto-merge path must be visible config or operator action rather than hidden authority. Local CI and review-provider posture contribute to trust by adding observable gates and signals without becoming hidden authority: a detected script is advisory until configured, and provider activity matters only for the configured provider identities.

Before choosing those two fields, read the compact [trust mode and execution safety mode combinations](./configuration.md#trust-mode-and-execution-safety-mode-combinations). It labels the safe, cautious, and dangerous postures without duplicating the full configuration reference here.

Use the same vocabulary across setup/readiness, `doctor`, `status`, and WebUI:

- setup/readiness answers whether the required trust posture fields are configured, missing, or invalid before first run
- `doctor` reports host, state, local CI candidate, release-readiness, and config health without rewriting the trust decision
- `status` reports the active issue, external signal readiness, loop runtime, and operator actions inside the chosen posture
- WebUI setup edits the same config-backed fields and should not imply a separate run mode or broader authority

Recommended model posture for a first operator profile:

- keep `codexModelStrategy: "inherit"` so the supervisor follows the host Codex CLI/App default model
- set the host Codex default model intentionally before you trust `loop`
- leave the bounded repair and local-review model overrides unset unless you intentionally want a separate route
- switch to `fixed` only when this profile must pin one model and ignore the host default model

Use the configuration guide as the source of truth for model routing details and validation rules rather than copying a second policy into local notes.

If you need the full field-by-field setup, model policy, durable memory, or provider guidance, use the [Configuration reference](./configuration.md).

## Write execution-ready issues

The scheduler is readiness-driven across the matching open backlog. It does not just pick the newest open issue; it pages through matching open issues using the configured candidate discovery fetch window as the page size, then picks the first issue that is actually runnable in deterministic order.

Candidate discovery now evaluates the matching open backlog rather than stopping after the first page. In large repositories, older runnable issues remain discoverable even when they begin beyond the first page. If the backlog order looks wrong, check the issue metadata before assuming discovery skipped part of the backlog.

Before you run the supervisor, make sure each candidate issue includes:

- a clear `## Summary`
- a bounded `## Scope`
- explicit `Depends on` metadata such as `Depends on: none` or `Depends on: #123`
- explicit `Parallelizable: Yes/No`
- explicit `## Execution order`, including `1 of 1` for standalone `codex` issues
- canonical `Part of: #...` metadata when the issue is a sequenced child
- observable `## Acceptance criteria`
- concrete `## Verification`

Fastest safe path for a beginner:

1. start from the standalone template in [README](../README.md) or the templates in [Issue metadata reference](./issue-metadata.md)
2. write `Depends on: none`, `Parallelizable: No`, and `Execution order: 1 of 1` unless the issue is truly part of a sequence
3. run `issue-lint` on that issue number before trusting it as runnable work

Minimal standalone runnable issue:

```md
## Summary
Refocus the getting-started guide on setup and operator flow.

## Scope
- keep the guide centered on setup and operation
- remove duplicated deep-reference sections
- keep links to deeper docs accurate

Depends on: none
Parallelizable: No

## Execution order
1 of 1

## Acceptance criteria
- the guide reads as a first-run setup and operation document
- duplicated reference content is removed or shortened
- related doc links are correct

## Verification
- review the getting-started flow for clarity
- run `npm run build`
```

Minimal sequenced child issue:

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

Use the standalone form unless the work is truly one child in a series. Only add `Part of: #...` for sequenced child work.

Use the [Issue metadata reference](./issue-metadata.md) for the canonical field rules and more examples.

Before `run-once`, do this quick check:

1. copy a minimal template and replace the placeholders with real behavior
2. run `issue-lint` on the issue number
3. if `issue-lint` is clean, run `run-once`
4. if `run-once` still behaves strangely, inspect `status`, `explain`, or `doctor`

Validate one issue before the loop. This example uses the shipped CodeRabbit profile; use the matching shipped profile for your review provider.

```bash
node dist/index.js issue-lint <issue-number> --config supervisor.config.coderabbit.json
```

What to do with the result:

- if `issue-lint` reports `missing_required=...`, fix the issue body before `run-once`
- if `issue-lint` reports `metadata_errors=...`, normalize the issue body instead of guessing what the supervisor will infer
- if `issue-lint` is clean but selection still looks wrong, use `status` or `doctor` to inspect candidate discovery and host health
- if one issue keeps getting picked unexpectedly, run `node dist/index.js explain <issue-number> --config <supervisor-config-path>` to compare the issue body with the current runtime state

Representative blocking messages:

- `missing_required=scope, acceptance criteria, verification`
  Fix the issue body by adding those sections.
- `metadata_errors=depends on must appear exactly once; execution order must appear exactly once; parallelizable must appear exactly once`
  Fix duplicate scheduling lines in the issue body.
- `metadata_errors=depends on duplicates parent epic #900; remove it and keep only real blocking issues`
  Keep `Part of: #900` for the epic and use `Depends on:` only for true prerequisites.
- `metadata_errors=issue labels are missing; cannot evaluate label-gated execution policy`
  Refresh the fetched issue payload or labels before trusting the result.

Use `repair_guidance_N=...` as the direct next step. Those lines are generated specifically to tell you what to add or rewrite.

How to tell “fix the issue” from “fix the host or config”:

- If `issue-lint` says `execution_ready=no`, `missing_required=...`, or `metadata_errors=...`, fix the GitHub issue body.
- If `doctor` says `doctor_check name=github_auth status=fail`, fix GitHub auth on the host.
- If `doctor` says `doctor_check name=codex_cli status=fail`, fix the `codexBinary` path or install `codex`.
- If `doctor` says `doctor_check name=state_file status=fail`, inspect or repair the local state file before trusting more runs.
- If `doctor` says `doctor_warning kind=config detail=Active config still uses legacy shared issue journal path ...`, fix the supervisor config rather than the issue body.

Issue readiness is not the same as trust. A perfectly structured issue is still not safe for autonomous execution when the GitHub-authored text comes from an untrusted repo or untrusted author set.

## First-run command flow

Start with read-only or dry-run commands, then run a single supervised pass so you can inspect repo selection, worktree setup, and resulting state before you hand over the loop.

```bash
node dist/index.js help
node dist/index.js web --config <supervisor-config-path>
# In the WebUI, open /setup. The same typed setup surface is available as:
# GET /api/setup-readiness
node dist/index.js doctor --config <supervisor-config-path>
node dist/index.js status --config <supervisor-config-path> --why
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
node dist/index.js run-once --config <supervisor-config-path> --dry-run
node dist/index.js run-once --config <supervisor-config-path>
./scripts/start-loop-tmux.sh
```

For a concrete shipped profile, run the same checks against the matching config, for example: `node dist/index.js issue-lint <issue-number> --config supervisor.config.coderabbit.json`, `node dist/index.js status --config supervisor.config.coderabbit.json --why`, and `node dist/index.js doctor --config supervisor.config.coderabbit.json`. For the TypeScript/Node starter, use `supervisor.config.typescript-node.json` after replacing the placeholders and confirming the repo owns `npm run verify:pre-pr`. For the Next.js starter, use `supervisor.config.nextjs.json` after replacing the placeholders and mapping `verify:pre-pr` to the app scripts that actually exist. For the Python/CLI starter, use `supervisor.config.python-cli.json` only after replacing the setup and pre-PR command placeholders with commands the managed repo owns.

Read the command output as a sequence of decisions, not as unrelated logs:

- `help` should show the same first-run shape: `doctor`, `status --why`, `run-once --dry-run`, `run-once`, then `loop`.
- `/setup` and `GET /api/setup-readiness` return a typed setup report. `ready: false`, `blockers: [...]`, or fields in `missing` or `invalid` state mean setup is not complete yet. Fix those config fields before trusting `run-once`.
- `doctor` reports host and state health. A line such as `doctor_check name=github_auth status=fail` means the host is not ready; fix `gh` auth rather than editing the GitHub issue body.
- `doctor_release_readiness_gate posture=...` reports whether the release-readiness checklist is advisory or explicitly configured to block release publication only.
- `status --why` reports queue, PR, CI, review, and loop state. Use `current_issue=...`, candidate details, and `operator_action action=...` lines to decide the next operator step.
- `issue-lint` reports issue-body readiness. `missing_required=...` or `metadata_errors=...` means the issue body is not execution-ready; fix the GitHub issue body before `run-once`.
- `run-once --dry-run` should explain the next cycle without running Codex. Use it when the selected issue, worktree, or PR state is surprising.
- `run-once` should execute exactly one supervisor cycle. Inspect `status` and the issue journal before starting a background loop.
- `./scripts/start-loop-tmux.sh` is the supported macOS loop start path. It uses `CODEX_SUPERVISOR_CONFIG`; set that environment variable to the same config path you validated above.

Phase 5 operator-action vocabulary is intentionally small:

- `operator_action action=fix_config` or `doctor_operator_action action=fix_config`: repair host prerequisites, setup fields, or workspace-preparation configuration before continuing.
- `operator_action action=restart_loop`: tracked work exists but the background loop is off; restart the supported loop host after confirming the config. The matching `loop_runtime_blocker` line explains that restart is safe for recoverable tracked work, should converge to `loop_runtime state=running` before the tracked issue advances, and falls back to `status --why`, `doctor`, and runtime marker/config inspection if the blocker remains.
- `operator_action action=provider_outage_suspected`: required checks are green but the configured review provider has not produced a current-head signal; wait, verify provider delivery, or escalate to manual review.
- `operator_action action=resolve_stale_review_bot`: code or CI is green, but stale configured-bot review thread metadata still blocks the tracked PR; inspect the exact thread URL reported by `stale_review_bot_remediation`, then resolve it or leave a manual note without changing merge policy.
- `operator_action action=manual_review`: a tracked path has a manual-review blocker; do not let the loop infer success.
- `operator_action action=continue`: no blocking operator action was detected on that surface.
- `doctor_operator_action action=adopt_local_ci`: a repo-owned local CI candidate exists; configure it or explicitly dismiss it before treating the local CI posture as settled.
- `doctor_operator_action action=safe_to_ignore`: a repo-owned local CI candidate was intentionally dismissed and is no longer an unresolved setup ambiguity.

Read the release-readiness posture separately from local CI and issue verification:

- `releaseReadinessGate: advisory` is the default. The release-readiness checklist remains visible but cannot block PR publication, merge readiness, loop operation, or release publication.
- `releaseReadinessGate: block_release_publication` is an explicit repo-owned opt-in. It can block release publication only; it does not change PR publication, ready-for-review promotion, local CI, issue verification, merge readiness, or loop behavior.

If you keep multiple profiles side by side, `status`, `doctor`, and `/api/setup-readiness` are the fastest way to confirm that you are inspecting the same config file you plan to use for `run-once` and `loop`.

What to check after the first successful `run-once`:

- the selected issue is the one you expected
- the issue worktree was created under `workspaceRoot`
- any restored issue workspace reused the expected local branch first, otherwise the expected remote branch, instead of silently falling back to a fresh bootstrap
- any untracked orphaned `issue-*` worktree under `workspaceRoot` was not treated like tracked done-workspace cleanup; `doctor_orphan_policy mode=explicit_only ...` should make it obvious that orphan cleanup is operator-driven, and only orphan candidates marked `locked`, `recent`, or `unsafe_target` should be preserved when you explicitly run `prune-orphaned-workspaces`
- the issue journal shows a sensible hypothesis, blocker, and next step
- any opened PR or status transition matches the actual repo state

If the first pass picks the wrong issue, inspect `status` or `doctor` for the effective candidate discovery settings and then fix the issue metadata before running again. Do not treat issue creation time as the source of truth.
If `status` or `doctor` reports corrupted JSON state, stop treating that file as a safe checkpoint. Inspect the file and recent operator actions first, then explicitly acknowledge the corruption or reset the state before trusting future runs.
If full inventory refreshes intermittently fail with malformed JSON during `run-once` or `loop`, the supervisor automatically captures the raw failing payloads under `<dirname(stateFile)>/inventory-refresh-failures`. Each parse failure writes one timestamped JSON artifact such as `20260327T001537.030Z-gh-issue-list.json` or `20260327T001537.030Z-rest-page-2.json`, and the supervisor prunes older files after the newest 10 by default. Use `CODEX_SUPERVISOR_MALFORMED_INVENTORY_CAPTURE_LIMIT=<n>` if you need a different bound, then inspect or copy that directory from the host after the next failure.

Beginner troubleshooting shortcut:

- `issue-lint` answers “is this issue body execution-ready?”
- `status` answers “what is the supervisor doing right now?”
- `doctor` answers “is the host or state unhealthy?”
- `explain <issue-number>` answers “why is this specific issue blocked, skipped, or not selected?”

Host-migration note for worktree-local journals:

- If a tracked issue was moved to a new host and the persisted `workspace` or `journal_path` still points at the old absolute path, `status`, `doctor`, and `explain` can emit `issue_host_paths ... guidance=no_manual_action_required` to show that the supervisor repaired the stale path to the canonical local worktree.
- If the old host-local journal could not be recovered and the supervisor recreated the issue-scoped local journal, the same surfaces can emit `issue_journal_state ... status=rehydrated guidance=no_manual_action_required detail=prior_local_only_handoff_unavailable`. Treat that as an informational repair, not a blocking failure.
- If those diagnostics instead say `guidance=manual_action_required`, the canonical local journal is still missing and the operator should inspect the current worktree before resuming autonomous execution.

Execution metrics are retained independently of issue worktree cleanup. Terminal run summaries live under `<dirname(stateFile)>/execution-metrics/run-summaries/`, and `node dist/index.js rollup-execution-metrics --config <supervisor-config-path>` writes `<dirname(stateFile)>/execution-metrics/daily-rollups.json` from those retained summaries.

### Setup/readiness contract for first-run UX

A first-run setup flow needs a narrower backend surface than `doctor`. The setup/readiness contract should answer what is configured, what is missing, what is invalid, and what still blocks first-run operation. Doctor is not that setup/readiness contract: `doctor` remains the broader operator diagnostic view for host checks, state-file recovery, workspace findings, and ongoing environment triage.

The core setup-specific portion of that typed surface is:

```ts
type SetupFieldState = "configured" | "missing" | "invalid";
type SetupReadinessFieldKey =
  | "repoPath"
  | "repoSlug"
  | "defaultBranch"
  | "workspaceRoot"
  | "stateFile"
  | "codexBinary"
  | "branchPrefix"
  | "localCiCommand"
  | "trustMode"
  | "executionSafetyMode"
  | "reviewProvider";
type SetupReadinessFieldValueType =
  | "directory_path"
  | "repo_slug"
  | "git_ref"
  | "file_path"
  | "executable_path"
  | "text"
  | "trust_mode"
  | "execution_safety_mode"
  | "review_provider";
type SetupReadinessRemediationKind =
  | "edit_config"
  | "configure_review_provider"
  | "authenticate_github"
  | "verify_codex_cli"
  | "repair_worktree_layout";

interface SetupReadinessReport {
  kind: "setup_readiness";
  ready: boolean;
  overallStatus: "configured" | "missing" | "invalid";
  fields: SetupReadinessField[];
  blockers: SetupReadinessBlocker[];
  localCiContract?: LocalCiContractSummary;
}

interface SetupReadinessField {
  key: SetupReadinessFieldKey;
  label: string;
  state: SetupFieldState;
  value: string | null;
  message: string;
  required: boolean;
  metadata: {
    source: "config";
    editable: true;
    valueType: SetupReadinessFieldValueType;
  };
}

interface SetupReadinessBlocker {
  code: string;
  message: string;
  fieldKeys: SetupReadinessField["key"][];
  remediation: {
    kind: SetupReadinessRemediationKind;
    summary: string;
    fieldKeys: SetupReadinessField["key"][];
  };
}
```

Minimum rules for that contract:

- `fields` is the setup inventory a future UI needs for first-run guidance, not a dump of every doctor diagnostic
- each field reports a typed state of `configured | missing | invalid` plus typed metadata the UI can use to render editable setup inputs without inferring from labels
- `blockers` lists only the conditions that still prevent a safe first run
- each blocker carries typed remediation guidance so the browser does not have to reverse-engineer next actions from free-form text
- the setup flow and WebUI should surface whether the repo-owned local CI contract is configured so operators know whether PR publication depends on a canonical repo-owned pre-PR command or on issue-level verification guidance
- the setup flow and WebUI should surface `trustMode` and `executionSafetyMode` as explicit first-run decisions; inferred runtime defaults remain compatibility behavior, not a completed setup decision
- `ready` becomes `true` only when no first-run blockers remain
- ongoing diagnostics such as GitHub auth details, corrupted state-file findings, orphaned worktree candidates, and other repair-oriented host checks stay in `doctor`

### Repo-owned local CI contract for pre-PR verification

When a managed repo wants a canonical local verification step before PR publication or update, use a repo-owned local CI contract. The repo-owned local CI contract is a single repo-defined entrypoint such as `npm run ci:local` or `npm run verify:pre-pr`.

Issue-level `## Verification` is issue-authored guidance for the operator and Codex turn. It is not a repo-owned fail-closed gate by itself. Status and doctor wording should name the active repo-owned gate, such as `localCiCommand`, workstation-local path hygiene, release-readiness posture, or ready-for-review promotion, instead of implying that issue-authored verification text has become a configured repository gate.

The repo remains the source of truth for what that command does. codex-supervisor only runs the configured entrypoint. It does not decompose the command, append inferred subtasks, or try to decide which subset of checks matters for the current diff.

Minimum expectations for that contract:

- the entrypoint is owned by the managed repo, not synthesized by the supervisor
- the command may run any repo-chosen mix of tests, builds, linters, schema checks, or other local verification steps
- exit code 0 means the configured local verification passed
- any non-zero exit code means the configured local verification failed and the supervisor should treat that failure as the repo-declared result of the contract
- stdout and stderr are informative logs from the repo command, not a second machine-readable protocol the supervisor needs to interpret

When that repo-owned command includes Ruff or similar static-analysis checks for `tests/` or `scripts/`, keep intentional fixture exceptions explicit and narrow:

- prefer fixing the finding outright when possible
- when a fixture truly needs an exception, use an inline suppression with the exact rule code and a short rationale, for example `# noqa: S106 - dummy fixture credential` or `# noqa: S104 - test fixture requires wildcard bind`
- avoid broad file-level ignores or silent drift for intentional fixture patterns

Backward compatibility stays simple: if no local CI contract is configured, `codex-supervisor` keeps the existing behavior. It does not invent a fallback verification command, and it continues to rely on the issue's `## Verification` guidance plus normal operator/repo workflow instead of pretending a canonical local CI entrypoint exists when the repo has not declared one.

Steady-state posture to read after setup:

- `No repo-owned local CI contract is configured.` That means no canonical repo-owned pre-PR command is active, so PR publication does not depend on `localCiCommand` yet.
- `Repo-owned local CI candidate exists but localCiCommand is unset.` That means the repo already exposes a likely script candidate, but the supervisor has not opted into it yet. This warning is advisory only. Setup readiness stays unchanged until you configure `localCiCommand`, and codex-supervisor will not run the candidate just because it exists.
- `Repo-owned local CI candidate was intentionally dismissed; localCiCommand remains unset and non-blocking.` That means an operator acknowledged the recommendation and chose not to make it the publication gate for this profile. The dismissed candidate is still reported for visibility, but it should not keep appearing as an unresolved setup ambiguity.
- `Repo-owned local CI contract is configured.` That means the configured command is the active fail-closed gate before PR publication or ready-for-review promotion.

Operator impact: candidate detection is advisory, dismissal is an explicit non-blocking acknowledgement, and adoption is the point where local CI becomes a fail-closed gate. When configured local CI fails, PR publication stays blocked and ready-for-review promotion stays blocked until the repo-owned command passes again. Setup/readiness and WebUI guidance should make that visible so operators can tell the difference between a missing contract, a dismissed candidate, and a failing configured contract.

Explicit non-goal: `codex-supervisor` does not infer or reconstruct workflow logic from GitHub Actions YAML, other workflow YAML, or changed-file heuristics as a substitute for this contract. If a repo wants a canonical pre-PR local verification command, the repo must expose that command directly.

## Move from run-once to loop

When one supervised pass behaves correctly, switch to the continuous loop:

```bash
node dist/index.js loop --config <supervisor-config-path>
```

If you want a local operator view over the same supervisor service, you can also run:

```bash
node dist/index.js web --config <supervisor-config-path>
```

Host-specific loop guidance:

- On macOS, the supported background loop host is `tmux`. Start it with `./scripts/start-loop-tmux.sh` and stop it with `./scripts/stop-loop-tmux.sh`.
- `./scripts/install-launchd.sh` now fails closed because a direct launchd-hosted loop is not a supported macOS path.
- If you want a launcher-managed background loop on Linux, use `./scripts/install-systemd.sh`.
- For a launcher-managed WebUI on macOS, use `./scripts/install-launchd-web.sh`. That launchd path is still supported because it hosts the WebUI entrypoint rather than the loop.

Supported run-mode vocabulary:

- `one_shot_manual`: a manually invoked CLI command such as `run-once`, `status`, or `doctor`; it does not own a background loop and has no safe automatic restart action.
- `macos_tmux_loop`: the macOS loop hosted by `./scripts/start-loop-tmux.sh`; safe recovery is to stop it with `./scripts/stop-loop-tmux.sh`, inspect any ambiguous direct loop PIDs reported by diagnostics, and restart with the same `CODEX_SUPERVISOR_CONFIG`.
- `linux_systemd_loop`: the Linux user service installed by `./scripts/install-systemd.sh`; safe recovery is through `systemctl --user status|restart codex-supervisor.service` after confirming `status` or `doctor` points at the intended config.

`status` and `doctor` report `run_mode=...` next to the loop runtime marker fields when the mode can be inferred from the loop's own runtime marker. If diagnostics show `run_mode=unknown`, `ownership_confidence=ambiguous_owner`, or duplicate loop processes, inspect the marker and listed PIDs instead of deleting marker files or killing processes automatically.

The WebUI uses the same `SupervisorService` boundary as the CLI. It reads the same typed status, doctor, explain, and issue-lint data, and it only exposes the current safe command set: `run-once`, `requeue`, `prune-orphaned-workspaces`, and `reset-corrupt-json-state`. A WebUI session is an operator surface, not a loop run mode; launcher-backed WebUI restart capability applies to the WebUI process only and does not imply ownership of the background loop.

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
Local review is disabled by default in the shipped starter configs. Enable it when you want a committed pre-merge review gate or an additional local advisory pass before CI and external reviews. The recommended once-enabled posture is `localReviewAutoDetect: true`, `localReviewRoles: []`, `localReviewPolicy: "block_merge"`, `trackedPrCurrentHeadLocalReviewRequired: false`, `localReviewFollowUpRepairEnabled: false`, `localReviewManualReviewRepairEnabled: false`, `localReviewFollowUpIssueCreationEnabled: false`, and `localReviewHighSeverityAction: "blocked"`. Leave `localReviewFollowUpRepairEnabled` at `false` unless you explicitly want same-PR repair for `follow_up_eligible` local-review residuals, leave `localReviewManualReviewRepairEnabled` at `false` unless you explicitly want same-PR repair for current-head `manual_review_blocked` local-review residuals when GitHub is otherwise clear, and leave `localReviewFollowUpIssueCreationEnabled` at `false` unless you explicitly want local-review findings to open follow-up issues automatically. Do not enable the follow-up repair flag and follow-up issue creation flag together. Use the [Local review reference](./local-review.md) for role selection, thresholds, artifacts, and policy choices.

When should orphaned workspaces be cleaned up?
Treat orphaned `issue-*` worktrees as explicit cleanup work, not as the same thing as delayed cleanup for tracked done workspaces. Use `doctor` to confirm the effective policy: `doctor_orphan_policy mode=explicit_only background_prune=false operator_prune=true grace_hours=... preserved=locked,recent,unsafe_target`. The explicit `prune-orphaned-workspaces` action only preserves orphan candidates marked `locked`, `recent`, or `unsafe_target`; there is no separate manual-keep state. The orphan grace setting only controls when `doctor` and `prune-orphaned-workspaces` consider an orphan old enough to avoid the `recent` state; it does not make `run-once` prune orphan workspaces in the background.

What if the backlog order looks wrong?
Fix `Depends on` and `Execution order` in GitHub. The scheduler pages through the matching open backlog and follows runnable order across that full candidate set, not operator intuition or chat history.

What if the loop keeps hitting blocked work?
Stop treating the issue as execution-ready. Tighten the issue body, split the work, or use GSD to rebuild the backlog.

## Common mistakes

- starting with `loop` before validating `run-once`
- asking the supervisor to execute issues that still need planning
- relying on issue creation time instead of explicit dependency metadata
- treating a malformed or incomplete issue body as “probably good enough”
- skipping `issue-lint` and debugging selection blind
- treating README-level overview content as a substitute for issue metadata
- expecting deep config or local-review details to live in this guide instead of the dedicated references

## Related docs

- [README](../README.md) for the overview, fit, and docs map
- [Agent Bootstrap Protocol](./agent-instructions.md) for the AI-agent bootstrap order, first-run checks, and escalation points
- [Playground smoke run](./playground-smoke-run.md) for a sandbox-only first supervised pass and sample issue body
- [Configuration reference](./configuration.md) for config fields, provider setup, model policy, and durable memory
- [Operator dashboard](./operator-dashboard.md) for the local WebUI, panel meanings, safe command surface, and smoke-test harness
- [Local review reference](./local-review.md) for review roles, artifacts, thresholds, and merge policy
- [Issue metadata reference](./issue-metadata.md) for execution-ready issue structure and scheduling inputs
- [Release readiness checklist](./validation-checklist.md) for advisory minimum, recommended, and sufficient readiness checks before broader use
