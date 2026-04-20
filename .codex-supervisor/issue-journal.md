# Issue #1607: Add workstation-local path-literal guidance to issue authoring and review prompts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1607
- Branch: codex/issue-1607
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 5c06baf7648e92c7f5c35f94b289a46876264e5c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-20T21:59:16.296Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The gap was limited to missing authoring/prompt guidance, so narrow prompt tests plus doc/template edits should close the issue without changing the detector or publication gate behavior.
- What changed: Added concise workstation-local path-literal hygiene reminders to `docs/issue-metadata.md`, `.github/ISSUE_TEMPLATE/codex-execution-ready.md`, `src/codex/codex-prompt.ts`, and `src/local-review/prompt.ts`; added focused regression coverage in the corresponding prompt tests.
- Current blocker: none
- Next exact step: Commit the verified checkpoint and open a draft PR for `codex/issue-1607`.
- Verification gap: none for the requested local checks; detector/publication-gate behavior stayed unchanged and was covered indirectly by the unchanged `src/run-once-issue-selection.test.ts` pass.
- Files touched: .github/ISSUE_TEMPLATE/codex-execution-ready.md, docs/issue-metadata.md, src/codex/codex-prompt.ts, src/codex/codex-prompt.test.ts, src/local-review/prompt.ts, src/local-review/prompt.test.ts
- Rollback concern: Low; changes are prompt/doc text plus focused assertions only.
- Last focused command: npx tsx --test src/codex/codex-prompt.test.ts src/local-review/prompt.test.ts src/run-once-issue-selection.test.ts && npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
