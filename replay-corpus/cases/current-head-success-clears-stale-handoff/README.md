# Current-Head Success Clears Stale Handoff

This companion replay case keeps the current-head review-success path separate from the clustered repair case. It starts from stale local `handoff_missing` state and verifies that fresh PR facts, green checks, no unresolved review threads, and current-head configured review evidence converge to `ready_to_merge`.
