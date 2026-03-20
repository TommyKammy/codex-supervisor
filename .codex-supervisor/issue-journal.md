# Issue #722: Remote branch discovery: detect origin issue branches before default-branch bootstrap

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/722
- Branch: codex/issue-722
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2d0db2e8871d5bc0aeecf2c3e953d98f66f61f6b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T17:27:27Z

## Latest Codex Summary
- Reproduced that `ensureWorkspace()` bootstrapped from `origin/main` even when `origin/codex/issue-723` existed remotely, added a focused remote-only regression in `src/core/workspace.test.ts`, and narrowed `src/core/workspace.ts` so it fetches the target issue ref into `refs/remotes/origin/<branch>` before branch creation. The restore path now reports `remote_branch` and restores from `origin/<issue-branch>` when that ref exists; the requested issue test set and `npm run build` passed after installing the missing local dev dependencies in this worktree, the checkpoint landed as `2d0db2e`, and draft PR #747 is open.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The narrow fetch-to-`refs/remotes/origin/<issue-branch>` check resolves the remote-only restore gap without changing the no-remote bootstrap behavior; the remaining risk is standard CI/review fallout rather than another local restore-path gap.
- What changed: added a focused remote-only fixture regression in `src/core/workspace.test.ts`; introduced `fetchIssueRemoteTrackingRef(...)` in `src/core/workspace.ts` to fetch only the target issue ref, treat a missing remote ref as a discovery result, delete stale tracking refs on that path, and restore from `origin/<issue-branch>` when present; committed the patch as `2d0db2e`, pushed `codex/issue-722`, and opened draft PR #747.
- Current blocker: none
- Next exact step: watch PR #747 checks and review feedback on head `2d0db2e`, then address any CI or review fallout directly on `codex/issue-722`.
- Verification gap: `npm run build` initially failed because `node_modules` was absent and `tsc` was unavailable in the worktree; reran after `npm install` and it passed, so there is no remaining known local verification gap.
- Files touched: `src/core/workspace.ts`, `src/core/workspace.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this patch would reintroduce the bug where a remote-only issue branch is ignored and `ensureWorkspace()` deterministically bootstraps from `origin/<defaultBranch>` instead of restoring the discovered remote branch.
- Last focused command: `gh pr create --draft --base main --head codex/issue-722 --title "Remote branch discovery before bootstrap" --body "..."`
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-722/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-722/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
rg -n "ensureWorkspace|defaultBranch|origin/" src
rg -n "ensureWorkspace|workspace restore|origin/" src/*.test.ts src/core/*.test.ts src/**/*.test.ts
sed -n '1,220p' src/core/workspace.ts
sed -n '1,220p' src/core/workspace.test.ts
sed -n '70,140p' src/execution-safety-docs.test.ts
rg -n "WorkspaceRestoreMetadata|restore.source|bootstrap_default_branch|local_branch|remote_branch" src/core src | head -n 200
sed -n '1,220p' src/core/types.ts
sed -n '320,360p' src/core/types.ts
npx tsx --test src/core/workspace.test.ts
sed -n '1,220p' src/core/command.ts
git --version
tmpdir=$(mktemp -d) && origin="$tmpdir/origin.git" && repo="$tmpdir/repo" && git init --bare "$origin" >/dev/null && git clone "$origin" "$repo" >/dev/null && git -C "$repo" config user.name test && git -C "$repo" config user.email test@example.com && git -C "$repo" checkout -b main >/dev/null && printf 'x\n' > "$repo/README.md" && git -C "$repo" add README.md && git -C "$repo" commit -m init >/dev/null && git -C "$repo" push -u origin main >/dev/null && git -C "$repo" fetch origin +refs/heads/missing:refs/remotes/origin/missing; status=$?; printf 'exit=%s\n' "$status"
npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/core/workspace.test.ts
npm run build
test -d node_modules && echo present || echo missing
cat package.json
npm install
date -u +"%Y-%m-%dT%H:%M:%SZ"
git add src/core/workspace.ts src/core/workspace.test.ts .codex-supervisor/issue-journal.md && git commit -m "Discover remote issue branches before bootstrap"
git status --short
gh pr view --json number,isDraft,headRefName,url
git branch --show-current
git rev-parse --short HEAD
git remote -v
git push -u origin codex/issue-722
gh pr create --draft --base main --head codex/issue-722 --title "Remote branch discovery before bootstrap" --body "## Summary ..."
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- 2026-03-21 (JST): Committed the remote-branch discovery fix as `2d0db2e`, pushed `codex/issue-722`, and opened draft PR #747 after the requested issue test set and `npm run build` both passed; the unrelated untracked `.codex-supervisor/replay/` directory remains untouched.
- 2026-03-21 (JST): Reproduced the remote-only restore bug with a focused `src/core/workspace.test.ts` fixture where `origin/codex/issue-723` existed but the local branch did not, implemented a narrow target-branch fetch in `ensureWorkspace()`, verified the remote/local/bootstrap restore paths with the requested issue test set, and reran `npm run build` successfully after `npm install` restored the missing local `tsc` dependency in this worktree.
- 2026-03-21 (JST): Pushed `5fe2de7` with the journal-only fenced-command-log fix, resolved CodeRabbit thread `PRRT_kwDORgvdZ851w4ly`, and confirmed via `gh pr view` that both CI build jobs were green while the refreshed CodeRabbit status was still pending on the new head.
- 2026-03-21 (JST): Reproduced the remaining PR #746 review finding locally, confirmed the journal still had inline command-log spans in `Tests:` and `Last focused commands:`, and converted those logs to fenced `bash` blocks while keeping the failure context and handoff notes concise.
- 2026-03-21 (JST): Fixed the journal-only review fallout in `.codex-supervisor/issue-journal.md`, verified the summary no longer uses machine-local Markdown links and that inline code spans have no leading/trailing spaces, pushed `1707486` to `origin/codex/issue-721`, and resolved CodeRabbit threads `PRRT_kwDORgvdZ851wrHP`, `PRRT_kwDORgvdZ851wrHV`, and `PRRT_kwDORgvdZ851wrHX`.
- 2026-03-21 (JST): Reverified the fail-closed checkpoint with the issue test set and `npm run build`, pushed `codex/issue-718`, and opened draft PR #744 so the branch now has a tracked review artifact; the unrelated untracked `.codex-supervisor/replay/` directory remains untouched.
- 2026-03-21 (JST): Added focused fail-closed regressions for quarantined JSON state, reproduced that `runOnce()` still reached issue selection, `requeue` still mutated against the forced-empty fallback, and `loop` kept sleeping after a fail-closed result, then implemented a narrow supervisor/runtime gate that blocks execution-changing commands until `reset-corrupt-json-state` and reran the issue verification plus `npm run build` successfully after `npm install`.
- 2026-03-20 (JST): Added a focused status regression for invalid JSON state, reproduced the omission where status only printed normal empty-state lines, then appended explicit `state_diagnostic` and `state_load_finding` lines for JSON `load_findings` so corruption is visible in status without changing loader semantics.
- 2026-03-20 (JST): Added a focused docs regression for the missing JSON corruption contract, confirmed the new assertion failed first, then updated the English operator docs so they consistently say corrupted JSON state is a recovery event requiring explicit acknowledgement/reset and `status`/`doctor` triage before reuse.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
