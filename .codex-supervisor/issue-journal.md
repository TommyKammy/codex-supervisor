# Issue #1004: CLI parser bug: require an explicit file path after --config

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1004
- Branch: codex/issue-1004
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: b8ad23005babc4e963e88a81121a3d826f0edd0b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T15:52:29.413Z

## Latest Codex Summary
- Reproduced the `--config` parser bug with focused `parseArgs` coverage, then tightened parsing so `--config` requires a non-empty non-flag value and fails fast with `The --config flag requires a file path.`. Focused CLI tests and `npm run build` now pass locally.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the CLI parser bug is isolated to `src/cli/parse-args.ts`, where `--config` consumes the next token without validating whether a real file path follows.
- What changed: added focused regressions in `src/cli/parse-args.test.ts` for `--config` with no value and `--config` followed by another flag, then introduced a small parser helper in `src/cli/parse-args.ts` so `--config` throws `The --config flag requires a file path.` unless the next token is a non-empty non-flag path.
- Current blocker: none.
- Next exact step: monitor draft PR `#1023` for CI or review feedback and respond if anything regresses.
- Verification gap: none after `npx tsx --test src/cli/parse-args.test.ts src/cli/entrypoint.test.ts` and `npm run build`.
- Files touched: `src/cli/parse-args.ts`; `src/cli/parse-args.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the runtime change is a narrow argument-shape validation on `--config` and the rest is focused test coverage plus journal state.
- Last focused command: `gh pr create --draft --base main --head codex/issue-1004 --title "Issue #1004: Require explicit --config path" --body "<summary omitted>"`
- Exact failure reproduced: `npx tsx --test src/cli/parse-args.test.ts` failed with `Missing expected exception.` for both `parseArgs(["status", "--config"])` and `parseArgs(["status", "--config", "--why"])`, confirming that the parser silently accepted missing and flag-shaped config values.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1004/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1004/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n -e '--config' -e 'config' src/cli src -g'*.ts'`; `rg --files src | rg 'parse-args|entrypoint|cli'`; `git log --oneline --decorate -5`; `sed -n '1,240p' src/cli/parse-args.ts`; `sed -n '1,260p' src/cli/parse-args.test.ts`; `sed -n '1,280p' src/cli/entrypoint.test.ts`; `npx tsx --test src/cli/parse-args.test.ts`; `git diff -- src/cli/parse-args.ts src/cli/parse-args.test.ts`; `npx tsx --test src/cli/parse-args.test.ts src/cli/entrypoint.test.ts`; `gh pr view --json number,state,isDraft,url,headRefName,baseRefName`; `test -f package-lock.json && echo lock-present || echo no-lock`; `test -d node_modules && echo node_modules-present || echo node_modules-missing`; `git status --short`; `npm ci`; `git diff --check -- src/cli/parse-args.ts src/cli/parse-args.test.ts`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `npm run build`.
- PR status: draft PR `#1023` open at https://github.com/TommyKammy/codex-supervisor/pull/1023.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
