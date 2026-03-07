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

These are the recovery points after crashes, process restarts, or thread loss.

## Main safety boundaries

- issue lock: prevents two supervisor processes from acting on the same issue
- session lock: prevents concurrent `resume` on the same Codex session
- branch protection: keeps merge safety on GitHub
- head-SHA match on merge: avoids racing an outdated PR head

## Main reconciliations

- merged PR -> close issue
- closed child issues -> close parent epic
- timeout failure -> bounded retry
- verification blocker -> bounded retry
- stale worktree cleanup -> delayed cleanup for `done` issues
