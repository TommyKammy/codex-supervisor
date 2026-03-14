# GSD to GitHub Issues

This template shows how to use `get-shit-done` as the planning layer and `codex-supervisor` as the execution layer.

Upstream project: [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done)

The boundary is simple:

- GSD owns project understanding, requirements, roadmap, and phase planning
- GitHub Issues become the execution queue
- `codex-supervisor` owns worktrees, PRs, CI/review repair, and merge

## Recommended workflow

1. Run GSD upstream planning in the managed repo.
2. Freeze one implementation phase into execution-ready GitHub issues.
3. Add explicit dependency metadata to every issue.
4. Let `codex-supervisor` execute those issues from GitHub.

Typical GSD inputs:

- `PROJECT.md`
- `REQUIREMENTS.md`
- `ROADMAP.md`
- `STATE.md`
- `{phase}-CONTEXT.md`
- `{phase}-RESEARCH.md`
- `{phase}-{N}-PLAN.md`

Typical GitHub outputs:

- one epic issue per phase
- multiple child issues sized for one PR each
- explicit `Depends on`, `Part of`, and `Execution order`

## Mapping rules

Use these mapping rules when converting GSD output into GitHub Issues.

### Phase to epic

- one roadmap phase -> one epic issue
- the epic should summarize phase goal, scope, and definition of done
- the epic itself should not be directly executable by the supervisor

### Atomic plan to child issue

- one atomic execution unit -> one child issue
- each child issue should be small enough to finish as one PR
- if a plan is still too large, split it before issue creation

### Requirements to acceptance criteria

- take the requirement bullets from GSD and rewrite them as observable acceptance criteria
- avoid vague language like "improve", "support better", or "handle properly"

### Research to durable memory

- keep deep architecture, constraints, and decisions in repo docs
- link the relevant GSD docs in the issue body
- do not paste entire research documents into every issue

## Epic template

```md
## Summary

Phase 2: Persist timeline manual layout across swimlane modes.

## Why

`ROADMAP.md` phase 2 requires manual layout to survive view-mode switches and page reloads.

## Scope

- persist manual layout independently for each swimlane mode
- keep current `section` behavior backward-compatible
- add focused API, domain, and E2E coverage

## Out of scope

- new timeline drag interactions
- unrelated timeline performance work

## Source planning docs

- GSD roadmap: `ROADMAP.md`
- phase context: `2-CONTEXT.md`
- phase research: `2-RESEARCH.md`

## Child issues

- [ ] #232 Persist task order model and API contract
- [ ] #233 Restore manual layout independently per swimlane mode
- [ ] #234 Add focused status and assignee persistence coverage

## Definition of done

- all child issues are merged
- CI is green on every merged PR
- no unresolved follow-up issue is required for this phase
```

Recommended title:

```md
Epic: Persist timeline manual layout across swimlane modes
```

## Child issue template

```md
## Summary

Restore manual timeline row layout independently for `section`, `assignee`, and `status` swimlanes so each mode reopens with its own saved state.

## Why

The GSD phase requires each swimlane mode to keep its own persisted layout instead of reusing the `section` layout globally.

## Scope

- extend the saved layout shape to be keyed by swimlane mode
- hydrate the correct layout when the mode changes
- keep `section` migrations backward-compatible

## Out of scope

- redesigning the timeline drag interaction
- adding new grouping modes

## Depends on planning

- `ROADMAP.md` phase 2
- `2-CONTEXT.md`
- `2-2-PLAN.md`

Depends on: #232
Part of #227
Parallelizable: No

## Execution order

2 of 3

## Acceptance criteria

- switching between `section`, `assignee`, and `status` restores each mode's own saved manual layout
- existing `section` layout data is still read correctly after migration
- a focused E2E proves cross-mode persistence
- the relevant API and domain tests pass

## Verification

- `npm test -- src/timeline-layout.test.ts`
- run the focused cross-mode persistence E2E
```

## Splitting checklist

Before opening child issues, check these questions.

- Can this issue reasonably end in one PR?
- Does it have a clear `Depends on` relationship?
- Does it change one coherent thing?
- Can the acceptance criteria be verified by tests or CI?
- Would a failure here block later issues? If yes, make that dependency explicit.

If any answer is "no", split the issue again.

## What not to do

Avoid these anti-patterns.

- one child issue per entire GSD phase
- issues that only restate roadmap language without executable acceptance criteria
- relying on the supervisor to infer order from code structure
- pasting full GSD research into every issue body
- mixing multiple unrelated plans into one issue because they are "all in the same file"

## Suggested repo memory layout

This combination works best when GSD artifacts stay in the managed repo as durable memory.

```text
repo/
  README.md
  PROJECT.md
  REQUIREMENTS.md
  ROADMAP.md
  STATE.md
  docs/
    architecture.md
    workflow.md
    decisions.md
  .planning/
    research/
```

Then point `codex-supervisor` at a compact subset through `sharedMemoryFiles`, for example:

```json
[
  "README.md",
  "PROJECT.md",
  "REQUIREMENTS.md",
  "ROADMAP.md",
  "STATE.md",
  "docs/architecture.md",
  "docs/workflow.md",
  "docs/decisions.md"
]
```

## Practical operating model

- use GSD when the work is still ambiguous
- convert the approved phase into GitHub issues
- let `codex-supervisor` run the execution loop
- if an issue blocks on unclear requirements, go back to GSD planning instead of forcing the supervisor to invent policy
