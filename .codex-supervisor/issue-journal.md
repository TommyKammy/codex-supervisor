# Issue #1502: Improve README guidance for supervisor.config profile-based model policy

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1502
- Branch: codex/issue-1502
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d6c482d5a544c902fdcdf5a057640725db76ec36
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T04:18:14.686Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: README and getting-started were missing an explicit profile-selection rule (`--config` chooses the active file), explicit profile-based `issue-lint` / `status` / `doctor` examples, and the recommended `codexModelStrategy: "inherit"` posture that already lives in the configuration guide.
- What changed: Added a focused docs regression in `src/execution-safety-docs.test.ts`; updated `README.md` and `docs/getting-started.md` to explain profile-based operation, explicit verification commands, and inherited-vs-fixed model routing; added one clarifying `fixed` sentence in `docs/configuration.md` to keep wording aligned.
- Current blocker: None for the docs issue itself. Repo-wide test commands still hit unrelated pre-existing failures outside this change set.
- Next exact step: Review the diff, then commit the docs/test changes as a coherent checkpoint on `codex/issue-1502`.
- Verification gap: The focused added assertions pass via direct regex verification and the build passes. `npm test -- src/execution-safety-docs.test.ts` is not isolated in this repo and still runs unrelated failing tests; direct `npx tsx --test src/execution-safety-docs.test.ts` confirms the new profile-guidance test passes but surfaces older unrelated execution-safety doc failures.
- Files touched: README.md; docs/getting-started.md; docs/configuration.md; src/execution-safety-docs.test.ts; .codex-supervisor/issue-journal.md
- Rollback concern: Low. Changes are doc/test-only and keep the README/getting-started wording anchored to `docs/configuration.md` instead of adding a separate policy source.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
