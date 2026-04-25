# Release Readiness Checklist

Use this advisory checklist before treating `codex-supervisor` as ready for broader use on a repo. It is a release-readiness artifact for operators and maintainers, not an automatic hard gate. A separate explicit release gate must be configured before readiness can block release publication.

Print the same maintained checklist from the built CLI with:

```bash
node dist/index.js readiness-checklist
```

## Readiness levels

### Minimum

Minimum readiness means one trusted repo can complete a controlled first run without surprising the operator.

1. First-run setup is complete: `gh auth status` succeeds, the active `--config <supervisor-config-path>` points at the intended repo, `node dist/index.js doctor --config <supervisor-config-path>` has no blocking host or config failures, and `node dist/index.js status --config <supervisor-config-path> --why` explains the same intended profile.
2. One execution-ready issue passes `node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>` and then completes one-shot execution with `node dist/index.js run-once --config <supervisor-config-path>`.
3. The run creates or updates the expected issue worktree, branch, commit, and draft PR without pushing directly to the default branch.
4. Local CI posture is understood: either `localCiCommand` is configured and the repo-owned command passes, or the missing contract is accepted as an advisory warning for this release decision.
5. Release-readiness posture is understood: `releaseReadinessGate: advisory` keeps this checklist non-blocking, while `releaseReadinessGate: block_release_publication` is an explicit opt-in to block release publication only.

### Recommended

Recommended readiness means the normal operator loop has handled the main product flows at least once.

1. Two or more issues complete in sequence with `node dist/index.js loop --config <supervisor-config-path>` or the supported host loop wrapper.
2. At least one issue exercises review handling: the supervisor detects a current-head review signal, enters the repair path, commits a response, and returns to CI/review waiting.
3. At least one issue reaches merge convergence: required checks, required reviews, branch protection, and fresh PR facts agree before merge progression.
4. WebUI setup and dashboard routes are usable with `node dist/index.js web --config <supervisor-config-path>` and the safe command surface remains limited to documented operator actions.
5. The release has run `npm run verify:supervisor-pre-pr` locally, and any broader repo-owned local CI command configured in `localCiCommand` has also passed.

### Sufficient

Sufficient readiness means broader use is reasonable because the loop has survived both happy paths and expected stop conditions.

1. Three or more issues complete without state drift across `reproducing`, `implementing`, `draft_pr`, `waiting_ci`, `addressing_review`, `ready_to_merge`, `merging`, and `done`.
2. Failure and recovery paths are observed: CI failure, timeout, blocked issue metadata, corrupted state, or manual review produces an explicit blocked or repair state rather than silent progress.
3. Trust boundaries are proven fail-closed: untrusted repo or author context, malformed issue metadata, missing auth, unsafe WebUI mutation attempts, and corrupted JSON state do not trigger autonomous execution.
4. Restart and recovery are clean: status, doctor, journals, state files, PR facts, and issue records agree after process restart or loop host restart.
5. Provider-specific external services are not required to be available at test time. If a review provider is unavailable, the release decision records the missing provider signal separately from local product readiness.

## Checklist

- [ ] `first-run setup`: `node dist/index.js doctor --config <supervisor-config-path>` and `node dist/index.js status --config <supervisor-config-path> --why` show the intended config, repo, workspace root, state backend, review provider, local CI posture, and trust posture.
- [ ] `issue readiness`: `node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>` reports execution-ready metadata before the issue is trusted as runnable work.
- [ ] `one-shot execution`: `node dist/index.js run-once --config <supervisor-config-path>` can select exactly one runnable issue, create or restore the dedicated worktree, run Codex, commit a coherent checkpoint, and publish or update the draft PR.
- [ ] `loop operation`: `node dist/index.js loop --config <supervisor-config-path>` or `./scripts/start-loop-tmux.sh` can keep progressing without losing the active issue journal or workspace state.
- [ ] `review handling`: current-head review signals move the issue into review repair, produce a focused commit, avoid reprocessing already handled threads, and return to waiting for checks and reviews.
- [ ] `merge convergence`: merge progression requires fresh PR facts, green required checks, required reviews, branch protection readiness, and a non-dirty merge state.
- [ ] `next issue selection`: after merge and done-state reconciliation, the active issue is released and the next runnable issue is selected from the open backlog by dependency and execution-order metadata.
- [ ] `WebUI`: `node dist/index.js web --config <supervisor-config-path>` exposes setup and dashboard views for status, doctor, explain, and issue-lint data, and mutation routes require the documented local token.
- [ ] `local CI`: configured `localCiCommand` blocks PR publication or ready-for-review promotion on failure; an unconfigured repo-owned local CI candidate remains advisory until the operator opts in.
- [ ] `release gate`: `doctor_release_readiness_gate` and setup/readiness show whether the checklist is advisory or explicitly configured to block release publication only.
- [ ] `trust boundaries`: GitHub-authored issue bodies and review text are treated as untrusted inputs, autonomous execution is limited to trusted repos and authors, and missing provenance, auth, scope, or boundary signals fail closed.
- [ ] `state recovery`: corrupted JSON state is not mistaken for an empty bootstrap, restore precedence remains explicit, and failed recovery paths do not leave orphan records or partial durable writes.
- [ ] `workspace recovery`: local branch, remote branch, and fresh bootstrap recovery paths keep dedicated worktrees isolated and never push directly to the default branch.
- [ ] `orphan cleanup`: orphaned workspaces are only removed by explicit operator cleanup, with `locked`, `recent`, and `unsafe_target` candidates preserved.
- [ ] `observability`: state files, issue journals, stdout/stderr logs, `status`, `doctor`, WebUI panels, GitHub PR history, and local CI output tell the same story.
- [ ] `release notes source`: `node dist/index.js summarize-post-merge-audits --config <supervisor-config-path>` exposes `releaseNotesSources` entries for merged issue, PR, verification, audit-bundle, finding, and follow-up evidence that can be reused when drafting release notes or development-history updates.

## Advisory boundary

This checklist is advisory unless `releaseReadinessGate: block_release_publication` is explicitly wired into release automation. That configured gate can block release publication only; it must not block PR publication, ready-for-review promotion, merge readiness, local CI, issue verification, or loop operation. Issue-authored verification guidance in `## Verification` helps define the expected work and review evidence, but it is not a repo-owned fail-closed gate by itself. Do not make release readiness depend on provider-specific external services being available at test time. Record unavailable provider signals as release notes or follow-up risks, and keep local product readiness focused on commands, state transitions, WebUI routes, local CI posture, and trust-boundary enforcement.

## Verification

Use this focused command set when changing the checklist or its discoverability:

```bash
npx tsx --test src/validation-checklist-docs.test.ts
npx tsx --test src/readme-docs.test.ts src/getting-started-docs.test.ts src/agent-instructions-docs.test.ts
npm run build
```
