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

## Durable state

- `.local/state.json`
- per-issue worktree
- per-issue journal

These are the recovery points after crashes, process restarts, or thread loss, but only while the persisted data remains readable.

For issue workspaces, the intended restore precedence is: prefer an existing local issue branch first, then an existing remote issue branch, and only then bootstrap a fresh issue branch from `origin/<defaultBranch>`. That default-branch bootstrap is the fallback path when no existing issue branch can be restored.

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
- stale worktree cleanup -> delayed cleanup for `done` issues
