# Issue #1101: CI path gate: block PRs that commit workstation-local absolute paths

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1101
- Branch: codex/issue-1101
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bf7d80e2ff84ca9015c7b76ea77693f4626e5f4d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T03:56:14.205Z

## Latest Codex Summary
- Added a focused CI workflow regression test proving GitHub Actions did not run the workstation-local path detector on PR jobs, updated `.github/workflows/ci.yml` to run `npm run verify:paths` on Ubuntu CI before the other Ubuntu-only checks, committed the change as `cd251a1`, and opened draft PR `#1104`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the repository already has a focused workstation-local path detector and package-level pre-PR contract, but the shared GitHub Actions workflow never invokes that detector on pull requests, so violating durable artifacts can still merge if local verification is skipped.
- What changed: added a focused `src/ci-workflow.test.ts` assertion that Ubuntu CI must run `npm run verify:paths`, reproduced the failure against the current workflow, then inserted the new Ubuntu-only `verify:paths` step immediately after `npm ci` in `.github/workflows/ci.yml`.
- Current blocker: none locally.
- Next exact step: watch draft PR `#1104` and confirm GitHub Actions passes the new path-hygiene gate on a clean branch; if CI reports an unexpected regression, repair the workflow without changing the detector exemption model.
- Verification gap: I have not run the full repository suite or a live GitHub Actions run; verification so far is focused on the workflow contract and the detector itself.
- Files touched: `.github/workflows/ci.yml`; `src/ci-workflow.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The change only adds an existing repo-owned verification command to the Ubuntu CI leg and constrains it with a focused workflow test.
- Last focused command: `npx tsx --test src/ci-workflow.test.ts src/workstation-local-path-detector.test.ts`
- What changed this turn: reread the required memory files and issue journal, located the existing workstation-local path detector and CI workflow coverage, added the narrow failing workflow assertion for `npm run verify:paths`, reproduced the missing-gate failure, added the Ubuntu CI step, and reran the focused workflow plus detector tests.
- Exact failure reproduced this turn: `src/ci-workflow.test.ts` failed because `.github/workflows/ci.yml` lacked any `npm run verify:paths` step, so pull request CI would not enforce the workstation-local path gate.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' <redacted-local-path>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git branch --show-current`; `git status --short`; `rg -n "workstation-local|absolute path|path hygiene|path-hygiene|local path|absolute paths|durable artifact|repo-owned exclusions" .github src test package.json`; `rg --files .github src test | rg "workflow|path|hygiene|absolute|ci|actions|durable|scan|guard"`; `sed -n '1,260p' .github/workflows/ci.yml`; `sed -n '1,260p' src/ci-workflow.test.ts`; `sed -n '1,220p' src/workstation-local-path-detector.test.ts`; `sed -n '1,220p' scripts/check-workstation-local-paths.ts`; `sed -n '1,220p' package.json`; `sed -n '1,260p' src/local-ci.test.ts`; `sed -n '1,260p' src/pre-pr-verification-contract.test.ts`; `npx tsx --test src/ci-workflow.test.ts`; `git diff --stat`; `git diff -- .github/workflows/ci.yml src/ci-workflow.test.ts`; `npx tsx --test src/ci-workflow.test.ts src/workstation-local-path-detector.test.ts`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git add .github/workflows/ci.yml src/ci-workflow.test.ts .codex-supervisor/issue-journal.md`; `git commit -m "Add CI workstation-local path gate"`; `git remote -v`; `gh pr view --json number,state,isDraft,headRefName,baseRefName,url`; `git push -u github codex/issue-1101`; `gh pr create --draft --base main --head codex/issue-1101 --title "CI path gate: block PRs that commit workstation-local absolute paths" --body ...`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
