# Issue #1299: [codex] Distinguish external-provider CI from missing provider setup in readiness diagnostics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1299
- Branch: codex/issue-1299
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2382b76cad60f3beba86e0adef300e9858b55091
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-04T03:40:55.151Z

## Latest Codex Summary
- Refined external signal readiness diagnostics so missing local GitHub Actions workflows no longer imply missing provider setup when authoritative external CI or provider activity is already present for the current head.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `externalSignalReadinessDiagnostics` was overusing `.github/workflows/*` absence as a bootstrap proxy for missing CI/provider setup, even when current-head external provider success or provider review activity had already been observed.
- What changed: Added focused regression coverage for absent-workflow repos with softened provider review activity and persisted current-head provider success; updated readiness diagnostics to treat those as authoritative external-provider signals and emit `ci=awaiting_external_signal` or `ci=passing` instead of `repo_not_configured`.
- Current blocker: none
- Next exact step: Commit the readiness diagnostic fix on `codex/issue-1299`.
- Verification gap: none after focused tests and build passed.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-status-review-bot.ts`, `src/supervisor/supervisor-status-review-bot.test.ts`
- Rollback concern: Low; behavior only changes when workflows are absent but current-head external-provider evidence already exists, so bootstrap repos with no signals still fail closed.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
