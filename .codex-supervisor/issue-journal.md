# Issue #1081: Expose GitHub REST and GraphQL rate-limit telemetry in supervisor status surfaces

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1081
- Branch: codex/issue-1081
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 5 (implementation=2, repair=3)
- Last head SHA: be1595c6a214f822447ea09821bb78599e46e5b9
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-26T17:26:24Z

## Latest Codex Summary
Updated [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md) to match the live `Supervisor.statusReport()` control flow more precisely: the summary now states that GitHub rate-limit telemetry is fetched at the end of each branch after branch-specific reads when present, and explicitly notes that the `inventory_refresh_failure` inactive early-return path has no selection-read step before telemetry.

Sanitized the recorded command log to use `<local-memory>/...` placeholders instead of machine-specific absolute paths, committed the review fix as `be1595c`, pushed `codex/issue-1081`, and resolved review threads `PRRT_kwDORgvdZ853FiOT` and `PRRT_kwDORgvdZ853FiOZ` on PR `#1087`.

Summary: Clarified the journal’s rate-limit telemetry wording, removed machine-specific paths from the command log, pushed the review fix, and resolved the remaining automated review threads
State hint: waiting_ci
Blocked reason: none
Tests: not run (journal-only review fix)
Next action: Watch PR #1087 for any follow-up review or CI signal after the journal-only review fix
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: both open review comments are valid against the committed journal state and only require a journal-only follow-up: tighten the control-flow wording to cover branch-specific status reads accurately and replace machine-specific command paths with stable placeholders.
- What changed: updated the journal summary to say `Supervisor.statusReport()` fetches rate-limit telemetry at the end of each branch after branch-specific reads when they occur, explicitly called out the `inventory_refresh_failure` inactive early return as a no-selection-read exception, replaced command-log absolute paths with `<local-memory>/...` placeholders, committed the review fix as `be1595c`, pushed `codex/issue-1081`, and resolved review threads `PRRT_kwDORgvdZ853FiOT` plus `PRRT_kwDORgvdZ853FiOZ`.
- Current blocker: none locally.
- Next exact step: watch PR `#1087` for any follow-up review or CI signal after the journal-only review fix.
- Verification gap: no tests were rerun this turn because the fix is journal-only.
- Files touched: `.codex-supervisor/issue-journal.md`.
- Rollback concern: minimal. The change only updates journal wording and command-log placeholders.
- Last focused command: `gh api graphql -f query='mutation($thread1: ID!, $thread2: ID!) { first: resolveReviewThread(input: {threadId: $thread1}) { thread { id isResolved } } second: resolveReviewThread(input: {threadId: $thread2}) { thread { id isResolved } } }' -F thread1=PRRT_kwDORgvdZ853FiOT -F thread2=PRRT_kwDORgvdZ853FiOZ`
- What changed this turn: reread the required memory files and journal, confirmed both automated review comments against the live journal content, patched the summary/control-flow wording plus command-log placeholders, committed `be1595c`, pushed `codex/issue-1081`, and resolved the two remaining CodeRabbit threads on PR `#1087`.
- Exact failure reproduced this turn: journal inspection confirmed that the previous summary wording overstated the inactive-path behavior because `inventory_refresh_failure` skips selection reads before telemetry, and the recorded commands still included machine-specific absolute memory paths.
- Commands run this turn: `sed -n '1,220p' <local-memory>/TommyKammy-codex-supervisor/issue-1081/AGENTS.generated.md`; `sed -n '1,220p' <local-memory>/TommyKammy-codex-supervisor/issue-1081/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short`; `git diff -- .codex-supervisor/issue-journal.md`; `rg -n "<user-home>/|<redacted-local-path>|statusReport\\(\\) now fetches telemetry after inactive selection reads and active issue status reads|Commands run this turn:" .codex-supervisor/issue-journal.md`; `apply_patch ...`; `rg -n "<user-home>/|<redacted-local-path>|<local-memory>" .codex-supervisor/issue-journal.md`; `git status --short`; `git diff -- .codex-supervisor/issue-journal.md`; `git add .codex-supervisor/issue-journal.md && git commit -m "Clarify issue journal review notes"`; `git rev-parse HEAD`; `git push origin codex/issue-1081`; `gh api graphql -f query='mutation($thread1: ID!, $thread2: ID!) { first: resolveReviewThread(input: {threadId: $thread1}) { thread { id isResolved } } second: resolveReviewThread(input: {threadId: $thread2}) { thread { id isResolved } } }' -F thread1=PRRT_kwDORgvdZ853FiOT -F thread2=PRRT_kwDORgvdZ853FiOZ`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
