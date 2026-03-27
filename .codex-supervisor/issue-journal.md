# Issue #1096: Promote journal hygiene findings into shared memory

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1096
- Branch: codex/issue-1096
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bf7d80e2ff84ca9015c7b76ea77693f4626e5f4d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T03:07:51.000Z

## Latest Codex Summary
- Added two repo-wide external-review guardrails for committed journal hygiene: one banning workstation-local absolute paths in durable journals, and one requiring Supervisor Snapshot, Latest Codex Summary, Active Failure Context, and Current Handoff to stay internally consistent. Added a focused regression test that asserts both shared-memory entries exist.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing durable guidance belongs in committed external-review guardrails, and the narrowest proof is a test that fails until both journal-hygiene rules exist in `docs/shared-memory/external-review-guardrails.json`.
- What changed: added two repo-wide `coderabbitai` shared-memory patterns for committed journal hygiene in `docs/shared-memory/external-review-guardrails.json` and added a focused regression test in `src/committed-guardrails.test.ts` that asserts both entries exist with the intended file, summary, and rationale.
- Current blocker: none locally.
- Next exact step: review the journal update, commit the focused shared-memory/test changes, and optionally open a draft PR if the branch should be published immediately.
- Verification gap: I have not run the full repo suite. Focused verification covers the shared-memory presence test, committed-guardrails validation, and the workstation-local path detector with one explicit exclusion for a pre-existing fixture in `src/backend/webui-dashboard.test.ts`.
- Files touched: `docs/shared-memory/external-review-guardrails.json`; `src/committed-guardrails.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The change only promotes durable guidance and adds a repository-content assertion; runtime behavior is unchanged.
- Last focused command: `npx tsx scripts/check-workstation-local-paths.ts --exclude-path src/backend/webui-dashboard.test.ts`
- What changed this turn: reread the required memory files, traced the committed shared-memory guardrail format and validators, reproduced the missing guidance with a new focused test, added two repo-wide journal hygiene patterns, rewrote the stale issue journal handoff to match `#1096`, and reran the focused checks.
- Exact failure reproduced this turn: `src/committed-guardrails.test.ts` failed because `docs/shared-memory/external-review-guardrails.json` had no entries covering committed journal absolute-path leakage or contradictory committed journal sections.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1096/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1096/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git branch --show-current`; `git status --short`; `rg -n "shared memory|shared-memory|journal hygiene|absolute path|Supervisor Snapshot|Latest Codex Summary|Active Failure Context|Current Handoff|issue-journal|memory" .`; `rg --files . | rg "memory|journal|handoff|context|guidance|shared"`; `sed -n '1,240p' docs/shared-memory/verifier-guardrails.json`; `sed -n '1,260p' docs/shared-memory/external-review-guardrails.json`; `sed -n '1,240p' src/committed-guardrails.ts`; `cat package.json`; `rg -n "committed guardrails|verifier-guardrails|external-review-guardrails|guardrails:check|check-workstation-local-paths|shared_memory" src docs scripts`; `rg --files src | rg "committed-guardrails.*test|guardrails.*test|workstation-local-path-detector.test|post-merge-audit-summary.test"`; `sed -n '1,260p' src/workstation-local-path-detector.test.ts`; `sed -n '1,260p' src/committed-guardrails.test.ts`; `sed -n '260,420p' src/committed-guardrails.test.ts`; `npx tsx --test src/committed-guardrails.test.ts`; `npx tsx src/committed-guardrails-cli.ts check`; `npx tsx scripts/check-workstation-local-paths.ts`; `date -u +%Y-%m-%dT%H:%M:%S.000Z`; `git diff -- docs/shared-memory/external-review-guardrails.json src/committed-guardrails.test.ts .codex-supervisor/issue-journal.md`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
