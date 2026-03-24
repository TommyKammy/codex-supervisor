# Issue #949: Path hygiene command: expose the focused path check as `npm run verify:paths`

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/949
- Branch: codex/issue-949
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 1d9733adff915ddf64af947cbfc3c4e6939bf2cf
- Blocked reason: none
- Last failure signature: missing-verify-paths-script
- Repeated failure signature count: 0
- Updated at: 2026-03-24T18:07:20+00:00

## Latest Codex Summary
- Reproduced the issue as `npm run verify:paths` missing from `package.json`, added a focused package-entrypoint regression test, exposed the detector as `npm run verify:paths`, documented it in getting-started as a lightweight pre-PR check independent from `build` and `test`, and verified the command passes on the current tree and fails on an injected tracked violation after installing dependencies.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #949 is addressed by exposing the existing focused detector through `npm run verify:paths`, keeping `build` and `test` unchanged, and pinning that behavior with a package-level regression plus lightweight docs coverage.
- What changed: added `verify:paths` to [package.json](package.json), added package-entrypoint coverage in [src/workstation-local-path-detector.test.ts](src/workstation-local-path-detector.test.ts), documented the command in [docs/getting-started.md](docs/getting-started.md) as a lightweight pre-PR path-hygiene step independent from `build` and `test`, and tightened [src/getting-started-docs.test.ts](src/getting-started-docs.test.ts) to keep that guidance present.
- Current blocker: none.
- Next exact step: watch draft PR #964 for review or CI feedback and respond if new failures appear.
- Verification gap: none for the focused command; local command-level verification required `npm install` because `node_modules` was absent and `npm run verify:paths` initially failed with `sh: 1: tsx: not found`.
- Files touched: [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md), [docs/getting-started.md](docs/getting-started.md), [package.json](package.json), [src/getting-started-docs.test.ts](src/getting-started-docs.test.ts), and [src/workstation-local-path-detector.test.ts](src/workstation-local-path-detector.test.ts).
- Rollback concern: low; the behavior change is limited to exposing an existing detector behind a new npm script plus focused tests/docs.
- Last focused command: `npm run verify:paths`
- Last focused failure: `npm run verify:paths` initially failed before `npm install` because the workspace did not have `node_modules` yet, producing `sh: 1: tsx: not found`; after `npm install`, the command passed on the current tree and failed as expected on an injected tracked violation.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/964
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-949/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-949/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
sed -n '1,240p' package.json
sed -n '1,260p' scripts/check-workstation-local-paths.ts
sed -n '1,280p' src/workstation-local-path-detector.test.ts
npm run verify:paths
rg -n "verify:paths|check-workstation-local-paths|pre-PR|pre PR|build|test" README.md docs/getting-started.md src scripts package.json
sed -n '236,272p' docs/getting-started.md
sed -n '40,70p' README.md
sed -n '1,220p' src/readme-docs.test.ts
sed -n '1,220p' src/getting-started-docs.test.ts
npx tsx --test src/workstation-local-path-detector.test.ts
npx tsx --test src/getting-started-docs.test.ts
ls node_modules/.bin/tsx
test -f package-lock.json && echo yes || echo no
npm install
npm run verify:paths
tmpdir=$(mktemp -d)
git -C "$tmpdir" init -b main >/dev/null
git -C "$tmpdir" config user.name 'Codex Supervisor'
git -C "$tmpdir" config user.email 'codex@example.test'
printf '# fixture\n' > "$tmpdir/README.md"
git -C "$tmpdir" add README.md
git -C "$tmpdir" commit -m seed >/dev/null
npm run verify:paths -- --workspace "$tmpdir"
printf 'Workspace note: /home/alice/dev/private-repo\n' > "$tmpdir/README.md"
npm run verify:paths -- --workspace "$tmpdir"
git diff -- src/workstation-local-path-detector.test.ts src/getting-started-docs.test.ts docs/getting-started.md package.json
git rev-parse HEAD
date -Iseconds -u
git add package.json docs/getting-started.md src/getting-started-docs.test.ts src/workstation-local-path-detector.test.ts .codex-supervisor/issue-journal.md
git commit -m "Expose verify:paths command"
git push -u origin codex/issue-949
gh pr view --json url,isDraft,state,headRefName
gh pr create --draft --base main --head codex/issue-949 --title "Expose verify:paths command" --body ...
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
