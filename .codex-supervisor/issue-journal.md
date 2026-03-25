# Issue #958: CodeRabbit starter profile bug: replace the shipped live repoSlug with a fail-fast placeholder

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/958
- Branch: codex/issue-958
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0b34911e3926f11cb2fcb44f41948f5c34404657
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T02:16:59.825Z

## Latest Codex Summary
- Reproduced the CodeRabbit starter-profile bug with a focused shipped-config regression: `src/config.test.ts` failed because `supervisor.config.coderabbit.json` still used the syntactically valid placeholder `OWNER/REPO`, which does not fail fast at config load.
- Replaced the shipped CodeRabbit `repoSlug` with the intentionally non-loadable placeholder `REPLACE_WITH_OWNER_AND_REPO` and aligned README/getting-started/configuration docs in English and Japanese to describe the profile as a starting point that must be customized before use.
- Focused verification passed with `npx tsx --test src/config.test.ts`, and `npm run build` passed after restoring local tool dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the shipped CodeRabbit starter profile still allowed a syntactically valid `repoSlug`, so copying it without customization could pass config parsing instead of failing fast and forcing the operator to set the managed repository explicitly.
- What changed: added a focused shipped-config regression in `src/config.test.ts`; changed `supervisor.config.coderabbit.json` to use the invalid placeholder `REPLACE_WITH_OWNER_AND_REPO`; updated `README.md`, `docs/getting-started.md`, `docs/configuration.md`, `docs/getting-started.ja.md`, and `docs/README.ja.md` so the starter profile is described as a starting point that must be customized before first run.
- Current blocker: none.
- Next exact step: stage the starter-profile/doc updates, commit them on `codex/issue-958`, and open or update the branch PR if needed.
- Verification gap: none in the requested local scope after rerunning the focused config test and build.
- Files touched: `src/config.test.ts`, `supervisor.config.coderabbit.json`, `README.md`, `docs/getting-started.md`, `docs/configuration.md`, `docs/getting-started.ja.md`, `docs/README.ja.md`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change is limited to starter-profile defaults, docs, and a focused regression test.
- Last focused command: `npx tsx --test src/config.test.ts`
- PR status: no PR opened from `codex/issue-958` yet in this turn.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
