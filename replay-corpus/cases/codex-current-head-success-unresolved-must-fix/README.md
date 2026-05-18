# Codex current-head success with unresolved must-fix threads

Synthetic regression replay for the AegisOps PR #1328 pattern: a Codex Connector current-head success comment and green checks are present, but current-diff P1/P2 inline threads remain unresolved.

The case keeps the external PR reference as provenance only. Runtime behavior must derive from the captured PR facts and review threads, not from the source repository or PR number.

Representative thread themes:
- simulator production-truth denylist gaps
- production workflow delegation or launch wording
- direct ad-hoc execution wording
- standalone authoritative claims
- `production_exclusion` default mismatch

Expected replay result: the issue remains blocked with `stale_review_bot` after the repeat-stop/no-progress state, instead of becoming merge-ready because of the top-level success signal.
