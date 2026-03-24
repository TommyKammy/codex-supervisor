# Issue #948: Path hygiene check: add a focused detector for workstation-local absolute paths

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/948
- Branch: codex/issue-948
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: d88c032746f0fd1dc3fba16800023ed1fc9470e2
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T16:37:01+00:00

## Latest Codex Summary
- Added a focused repository hygiene detector in [scripts/check-workstation-local-paths.ts](scripts/check-workstation-local-paths.ts) that scans tracked text artifacts for common workstation-local absolute path prefixes across Linux, macOS, and Windows while allowing intentional fixture/example exemptions by repo-relative path. Added a focused runtime regression in [src/workstation-local-path-detector.test.ts](src/workstation-local-path-detector.test.ts) that proves the clean pass, injected failure, and explicit exclusion behavior against a temporary git repository.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: a narrow standalone script is sufficient for issue #948 because the acceptance criteria only require detecting workstation-local absolute paths in durable committed artifacts without changing supervisor execution behavior.
- What changed: added [scripts/check-workstation-local-paths.ts](scripts/check-workstation-local-paths.ts) with a default repo-relative exclusion surface for intentionally committed examples/tests, `git ls-files`-based tracked-file scanning, binary-file skipping, and clear usage/error output; added [src/workstation-local-path-detector.test.ts](src/workstation-local-path-detector.test.ts) to exercise a clean repository pass, a tracked injected workstation-local path failure, and an explicit `--exclude-path` exemption.
- Current blocker: none.
- Next exact step: commit the new script, test, and journal update on `codex/issue-948`, then push the branch and open a draft PR because there is not yet a PR for this branch.
- Verification gap: focused coverage is complete for the new detector, but full TypeScript build verification is currently unavailable in this worktree because `tsc`/`typescript` is not installed locally.
- Files touched: [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md), [scripts/check-workstation-local-paths.ts](scripts/check-workstation-local-paths.ts), and [src/workstation-local-path-detector.test.ts](src/workstation-local-path-detector.test.ts).
- Rollback concern: low; reverting would remove only the new repo hygiene check and its focused test, restoring the previous lack of detection for committed workstation-local paths.
- Last focused command: `npx tsx --test src/workstation-local-path-detector.test.ts`
- Last focused failure: `npm run build` and `npx tsc -p tsconfig.json` cannot run to completion in this worktree because the TypeScript compiler is not installed; the targeted detector test and direct script execution both pass.
- Draft PR: none
- Last focused commands:
```bash
sed -n '1,220p' ../codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-948/AGENTS.generated.md
sed -n '1,220p' ../codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-948/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
rg --files scripts src
rg -n "hygiene|path hygiene|absolute path|workstation-local" -S .
sed -n '1,240p' scripts/check-workstation-local-paths.ts
sed -n '1,260p' src/workstation-local-path-detector.test.ts
cat package.json
npx tsx --test src/workstation-local-path-detector.test.ts
npx tsx scripts/check-workstation-local-paths.ts
npx tsx scripts/check-workstation-local-paths.ts --help
sed -n '1,240p' src/committed-guardrails.ts
sed -n '1,260p' src/committed-guardrails.test.ts
rg -n "check-workstation-local-paths|guardrails:check|committed-guardrails-cli" package.json src scripts README.md docs -S
date -Iseconds -u
git diff -- .codex-supervisor/issue-journal.md scripts/check-workstation-local-paths.ts src/workstation-local-path-detector.test.ts
npm run build
npx tsc -p tsconfig.json
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
