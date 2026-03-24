# Issue #949: Path hygiene command: expose the focused path check as `npm run verify:paths`

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/949
- Branch: codex/issue-949
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 0d6ab50f7d0883fbfcc020c5b3ee3fdc63e2a769
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852gXrK
- Repeated failure signature count: 1
- Updated at: 2026-03-24T18:21:41+00:00

## Latest Codex Summary
Sanitized committed workstation-local absolute paths out of [issue-journal.md](.codex-supervisor/issue-journal.md) so the new `npm run verify:paths` command no longer fails on the repository's own durable journal content.

The implementation from PR [#964](https://github.com/TommyKammy/codex-supervisor/pull/964) remains unchanged. This repair only updates the committed journal text so the focused path-hygiene verifier stays self-consistent with the repository contents.

Summary: Removed workstation-local absolute paths from the committed issue journal so `npm run verify:paths` passes on the current tree without excluding `.codex-supervisor/issue-journal.md`.
State hint: local_review_fix
Blocked reason: none
Tests: `npm run verify:paths`
Next action: Push the journal-sanitization review fix to PR #964, resolve the addressed review thread, and monitor for any additional review or CI follow-up.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review thread is satisfied by keeping the implementation unchanged and removing workstation-local absolute paths from the committed journal so `npm run verify:paths` stays focused, self-consistent, and independent from `build` and `test`.
- What changed: sanitized durable journal references that embedded workstation-local absolute paths, preserving the review history with relative links and placeholders instead of broadening `DEFAULT_EXCLUDED_PATHS`.
- Current blocker: none.
- Next exact step: push the repair commit, resolve the addressed CodeRabbit thread if possible, and watch PR #964 for any follow-up.
- Verification gap: none.
- Files touched: [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md).
- Rollback concern: low; the repair only rewrites journal text and does not change the detector or npm scripts.
- Last focused command: `npm run verify:paths`
- Last focused failure: `npm run verify:paths` failed on the current tree because [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md) still contained committed workstation-local absolute paths in the persisted summary, copied review text, and command log.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/964
- Last focused commands:
```bash
sed -n '1,220p' <memory-root>/TommyKammy-codex-supervisor/issue-949/AGENTS.generated.md
sed -n '1,220p' <memory-root>/TommyKammy-codex-supervisor/issue-949/context-index.md
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
printf 'Workspace note: <forbidden-local-absolute-path>\n' > "$tmpdir/README.md"
npm run verify:paths -- --workspace "$tmpdir"
git diff -- src/workstation-local-path-detector.test.ts src/getting-started-docs.test.ts docs/getting-started.md package.json
git rev-parse HEAD
date -Iseconds -u
git add package.json docs/getting-started.md src/getting-started-docs.test.ts src/workstation-local-path-detector.test.ts .codex-supervisor/issue-journal.md
git commit -m "Expose verify:paths command"
git push -u origin codex/issue-949
gh pr view --json url,isDraft,state,headRefName
gh pr create --draft --base main --head codex/issue-949 --title "Expose verify:paths command" --body ...
nl -ba .codex-supervisor/issue-journal.md | sed -n '14,90p'
date -Iseconds -u
git diff -- .codex-supervisor/issue-journal.md
rg -n '<workstation-home-pattern>' .codex-supervisor/issue-journal.md
npm run verify:paths
nl -ba .codex-supervisor/issue-journal.md | sed -n '1,120p'
git diff --stat
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
