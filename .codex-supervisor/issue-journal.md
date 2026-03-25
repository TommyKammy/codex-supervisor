# Issue #1005: Atomic write durability: use unique temporary file names for JSON state writes

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1005
- Branch: codex/issue-1005
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 12df3764d28f05fe1e216eecfbc6e6d74e02007b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T16:07:21Z

## Latest Codex Summary
- Reproduced that `writeJsonAtomic` reused the fixed `${filePath}.tmp` path across multiple writes, added a focused regression in `src/core/utils.test.ts`, and changed the helper to append a per-write UUID suffix before the atomic rename. Focused tests and `npm run build` now pass.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the atomic JSON helper in `src/core/utils.ts` is the only code path that needs changing for this issue, because it currently writes through a fixed `${filePath}.tmp` path and therefore reuses the same temp name on every attempt.
- What changed: added `src/core/utils.test.ts` with a focused regression asserting repeated `writeJsonAtomic` calls targeting the same file use distinct temp paths and leave only the final JSON file behind after success. Updated `src/core/utils.ts` to generate temp paths as `${filePath}.tmp.${randomUUID()}` while preserving the existing write-then-rename flow.
- Current blocker: none.
- Next exact step: monitor draft PR `#1024` for CI or review feedback and respond if anything regresses.
- Verification gap: none after `npx tsx --test src/core/utils.test.ts src/core/state-store.test.ts` and `npm run build`.
- Files touched: `src/core/utils.ts`; `src/core/utils.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the runtime change is limited to temp-file naming inside the existing atomic JSON write helper, and the rest is direct regression coverage plus journal state.
- Last focused command: `gh pr create --draft --base main --head codex/issue-1005 --title 'Issue #1005: Use unique temp names for atomic JSON writes' --body-file -`
- Exact failure reproduced: `npx tsx --test src/core/utils.test.ts` failed with `AssertionError [ERR_ASSERTION]: Expected "actual" to be strictly unequal to: '/tmp/.../state.json.tmp'`, confirming that consecutive atomic writes reused the same fixed temp path instead of generating distinct temp files.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1005/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1005/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "tmp|atomic|writeJson|write.*JSON|rename" src -g'*.ts'`; `rg --files src | rg 'utils|state-store'`; `sed -n '1,240p' src/core/utils.ts`; `sed -n '1,320p' src/core/state-store.test.ts`; `rg --files src/core`; `rg -n "writeJsonAtomic|parseJson|truncatePreservingStartAndEnd|nowIso" src/core -g'*.test.ts'`; `sed -n '1,260p' src/core/state-store.ts`; `rg -n "writeJsonAtomic" src/core src -g'*.ts'`; `npx tsx --test src/core/utils.test.ts`; `npx tsx --test src/core/utils.test.ts`; `npx tsx --test src/core/state-store.test.ts`; `git diff --check -- src/core/utils.ts src/core/utils.test.ts .codex-supervisor/issue-journal.md`; `npm run build`; `test -d node_modules && echo node_modules-present || echo node_modules-missing`; `test -f package-lock.json && echo lock-present || echo no-lock`; `npm ci`; `npx tsx --test src/core/utils.test.ts src/core/state-store.test.ts`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `gh pr view --json number,state,isDraft,url,headRefName,baseRefName`; `git status --short`.
- PR status: draft PR `#1024` open at https://github.com/TommyKammy/codex-supervisor/pull/1024.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
