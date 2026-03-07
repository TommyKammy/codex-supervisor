# Decisions

## AI thread model

- Codex threads are not the durable memory layer.
- Repo files are the durable memory layer.
- Supervisor prompts should point new sessions to shared repo memory files.

## Automation model

- GitHub is the source of truth for issue, PR, review, and CI state.
- Supervisor state exists to continue loops across sessions, not to replace GitHub facts.
- Issue metadata such as `Depends on` and `Execution order` is authoritative for sequencing.
