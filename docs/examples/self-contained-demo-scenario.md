# Self-contained Demo Scenario

This publishable demo uses one realistic `codex` issue and shows the quality artifacts a normal supervised run produces. It is safe to read offline, copy into docs, or use for screenshots because all commands are repo-relative or placeholder-based and no live GitHub credentials are needed to validate the Markdown itself.

For the compact primitive map behind those artifacts, read the [AI coding quality kit](../quality-kit.md).

Use the scenario as a walkthrough script, not as a hidden policy source. The canonical issue-body rules still live in [Issue metadata](../issue-metadata.md).

## Demo issue body

Create a `codex`-labeled issue with this body in a sandbox repository when you want a live walkthrough. For offline validation, read this block and run the local docs test named below.

<!-- self-contained-demo-issue:start -->
```md
## Summary
Add a quick filter to the issue journal viewer so operators can scan only verification notes.

## Scope
- add one filter control to the existing issue journal viewer
- filter journal rows by verification-related text without changing how journal files are written
- keep all existing journal entries visible when the filter is cleared

Part of: #100
Depends on: #99
Parallelizable: No

## Execution order
3 of 4

## Acceptance criteria
- operators can toggle a verification-only view from the issue journal viewer
- the unfiltered journal view still shows every existing note in chronological order
- the filter does not mutate issue journal files or supervisor state

## Verification
- `npm test -- src/issue-journal-viewer.test.ts`
- `npm run verify:paths`
- `npm run build`
```
<!-- self-contained-demo-issue:end -->

Expected metadata properties:

- sequenced child issue using canonical `Part of: #100`
- real dependency on the prior child issue via `Depends on: #99`
- `Parallelizable: No` because this modifies an operator-facing journal view
- concrete `3 of 4` execution order
- one behavior delta: filtering the existing journal viewer

## Expected local verification

Before the supervisor runs the issue, validate the issue body with:

```bash
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
```

During or after the run, the local verification evidence should include:

```bash
npm test -- src/issue-journal-viewer.test.ts
npm run verify:paths
npm run build
```

Equivalent environment-variable form:

```bash
export CODEX_SUPERVISOR_CONFIG=<supervisor-config-path>
node dist/index.js issue-lint <issue-number> --config "$CODEX_SUPERVISOR_CONFIG"
```

Expected local result:

```text
issue-lint: execution_ready=yes issue=#<issue-number>
focused_tests: passed command="npm test -- src/issue-journal-viewer.test.ts"
path_hygiene: passed command="npm run verify:paths"
build: passed command="npm run build"
```

## Expected PR outcome

A successful walkthrough should produce these reviewable artifacts:

- branch: `codex/issue-<issue-number>`
- draft PR title: `Add issue journal quick filter`
- changed files: implementation, focused test, and any narrow docs or fixture update needed for the filter
- issue journal: a per-issue handoff with hypothesis, changed files, commands run, and next action
- local verification: focused test, path hygiene, and build results recorded at the current head
- review: configured provider or local review evidence attached to the current head
- merge: the PR remains draft until configured readiness gates pass, then becomes mergeable only after CI/review policy allows it

The scenario does not require real credentials to inspect the expected artifacts. Live PR creation, CI, review, and merge evidence only appear when the same issue is run against a real configured sandbox repository.

## Evidence timeline references

The supervisor evidence timeline is the public audit trail for the run. A complete demo should be able to point to these event types:

| Event | Expected demo reference |
| --- | --- |
| `reservation` | issue run reservation for `codex/issue-<issue-number>` |
| `issue_body` | snapshot of the execution-ready issue body above |
| `pr_created` | draft PR created for the issue branch |
| `local_ci` | focused test, `npm run verify:paths`, and `npm run build` results |
| `review` | local review or configured review-provider outcome for the current head |
| `github_ci` | sandbox repository CI result, when the live sandbox has CI configured |
| `merge` | merge timestamp, when the sandbox PR is merged |
| `terminal_state` | final supervisor state such as `done` |

Screenshot-friendly timeline line:

```text
timeline_artifact issue=#<issue-number> pr=#<pr-number> type=verification_result gate=local_ci outcome=passed head_sha=<head-sha> next_action=continue command=npm run build summary=Focused test, path hygiene, and build passed.
```

## Offline validation

Validate the demo artifacts without GitHub credentials:

```bash
npx tsx --test src/demo-scenario-docs.test.ts
npm run verify:paths
npm run build
```

The docs test checks that the embedded issue body is execution-ready according to the same issue metadata parser used by `issue-lint`.
