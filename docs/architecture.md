# Architecture

`codex-supervisor` is a thin state machine around three external systems:

- the managed Git repository
- GitHub via `gh`
- Codex via `codex exec` / `codex exec resume`

## Core loop

1. load local state
2. refresh GitHub facts
3. decide the next phase
4. optionally run one Codex turn
5. refresh GitHub facts again
6. persist state and journal handoff

Pull-request hydration freshness contract:

- marking a PR ready, advancing or unblocking review-driven state, and merging must use fresh GitHub review facts
- cached pull-request hydration may remain available for diagnostics, status rendering, and operator context, but it is informational and non-authoritative
- do not assume every hydration consumer has the same contract: action-taking paths are fresh-only, while retained cache is safe only for non-decision support

## Durable state

- `.local/state.json`
- per-issue worktree
- per-issue journal

These are the recovery points after crashes, process restarts, or thread loss, but only while the persisted data remains readable.

For issue workspaces, the intended restore precedence is: prefer an existing local issue branch first, then an existing remote issue branch, and only then bootstrap a fresh issue branch from an authoritative fresh default-branch ref such as `origin/<defaultBranch>`. That default-branch bootstrap is the fallback path when no existing issue branch can be restored.

For workspace cleanup, keep tracked done workspaces separate from orphaned workspaces. Tracked done cleanup is the bounded cleanup policy for issue workspaces that still have supervisor state and have reached `done`. An orphaned workspace is an untracked canonical `issue-*` worktree under `workspaceRoot` that no longer has a live state entry. The explicit orphan prune path only preserves candidates marked `locked`, `recent`, or `unsafe_target`; there is no separate manual-keep state. Orphan pruning is an explicit operator action; the orphan grace setting only affects candidate eligibility for diagnostics and explicit prune commands, not background `runOnce` cleanup.

For the JSON backend, missing JSON state means there is no durable state yet and the supervisor can bootstrap from empty state. Corrupted JSON state is different: it is a recovery event, not a normal bootstrap case, and it is not safe to treat as durable state until an operator has inspected the file and explicitly acknowledged or reset it.

## Main safety boundaries

- issue lock: prevents two supervisor processes from acting on the same issue
- session lock: prevents concurrent `resume` on the same Codex session
- branch protection: keeps merge safety on GitHub
- head-SHA match on merge: avoids racing an outdated PR head

GitHub-authored issue bodies, review comments, review summaries, and similar GitHub text are also an explicit trust boundary. They are execution inputs that shape what Codex does next, so treat them as untrusted unless the operator explicitly trusts the repository and the GitHub authors who can write that text.

Today the supervisor invokes Codex with `--dangerously-bypass-approvals-and-sandbox`. That means the trust decision happens before the turn starts: autonomous execution is only acceptable when the repo, issue content, and review content all come from a trusted lane. If that trust is missing, the safe posture is to stay out of autonomous execution and use a manually supervised workflow instead.

The same fail-open vs fail-closed distinction applies to state recovery guidance: missing JSON state can bootstrap, but corrupted JSON state should be surfaced to the operator through diagnostics and recovery flow, not silently reused as if it were trustworthy state.

## Main reconciliations

- merged PR -> close issue
- closed child issues -> close parent epic
- timeout failure -> bounded retry
- verification blocker -> bounded retry
- tracked done workspace cleanup -> delayed cleanup for `done` issues
- orphaned workspace prune action -> explicit operator action with preservation rules for `locked`, `recent`, or `unsafe_target` candidates
