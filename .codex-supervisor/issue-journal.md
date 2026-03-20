# Issue #722: Remote branch discovery: detect origin issue branches before default-branch bootstrap

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/722
- Branch: codex/issue-722
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: d0761a16c1f89a2f5c4f2d029311e123873e2732
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851xgdP
- Repeated failure signature count: 1
- Updated at: 2026-03-20T17:38:12.389Z

## Latest Codex Summary
Implemented the remote-branch discovery fix in [src/core/workspace.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-722/src/core/workspace.ts) and added the focused remote-only regression in [src/core/workspace.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-722/src/core/workspace.test.ts). `ensureWorkspace()` now fetches the target issue ref into `refs/remotes/origin/<branch>` before bootstrapping, restores from `origin/<issue-branch>` when present, and keeps the default-branch bootstrap path for the remote-missing case.

I committed the code as `2d0db2e`, updated the journal in `d0761a1`, pushed `codex/issue-722`, and opened draft PR #747: https://github.com/TommyKammy/codex-supervisor/pull/747

Summary: Implemented deterministic remote issue-branch discovery before bootstrap, added the focused regression, pushed `codex/issue-722`, and opened draft PR #747.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/core/workspace.test.ts`; `npm run build`
Failure signature: none
Next action: Watch PR #747 on head `d0761a1` for CI and review feedback, then address any fallout on `codex/issue-722`.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/747#discussion_r2967063046
- Details:
  - src/core/workspace.ts:69 _⚠️ Potential issue_ | _🟡 Minor_ <details> <summary>🧩 Analysis chain</summary> 🌐 Web query: `Does git fetch use exit code 128 for missing remote refs?` 💡 Result: Yes—when `git fetch` is asked to fetch a ref that doesn’t exist on the remote (e.g., `fatal: couldn't find remote ref <name>`), it’s treated as a **fatal** error and Git typically exits with **status 128**. Git’s own error-handling docs note that fatal errors use `die()` and “exit with status 128.” [1] Examples in CI logs/community reports show the same “couldn’t find remote ref …” message followed by “exit status 128.” [2][3] **Caveat:** `128` is Git’s generic “fatal error” code, not a code unique to “missing remote refs.” [1] **Sources:** [1] [2] [3] --- 🏁 Script executed: ```shell # Search for the runCommand function definition fd -t f -e ts -e js | xargs grep -l "function runCommand" | head -5 ``` Repository: TommyKammy/codex-supervisor Length of output: 90 --- 🏁 Script executed: ```shell # Also search for runCommand with async keyword rg "export.*function runCommand|export.*const runCommand" -A 10 ``` Repository: TommyKammy/codex-supervisor Length of output: 664 --- 🏁 Script executed: ```shell # Look at the workspace.ts file around the function to understand context head -100 src/core/workspace.ts | tail -70 ``` Repository: TommyKammy/codex-supervisor Length of output: 2231 --- 🏁 Script executed: ```shell # Look at the CommandOptions type definition rg "type CommandOptions|interface CommandOptions" -A 5 src/core/command.ts ``` Repository: TommyKammy/codex-supervisor Length of output: 200 --- 🏁 Script executed: ```shell # See the full runCommand implementation cat -n src/core/command.ts | head -50 ``` Repository: TommyKammy/codex-supervisor Length of output: 2017 --- 🏁 Script executed: ```shell # Check the spawn call to see what options are passed rg "spawn\(command" -A 15 src/core/command.ts ``` Repository: TommyKammy/codex-supervisor Length of output: 561 --- 🏁 Script executed: ```shell # Check if LC_ALL=C is used elsewhere in the codebase rg "LC_ALL" src/ ``` Repository: TommyKammy/codex-supervisor Length of output: 53 --- 🏁 Script executed: ```shell # Check if there are other places in the code that parse stderr from git commands rg "stderr\.includes|stderr\.match" src/ -A 2 ``` Repository: TommyKammy/codex-supervisor Length of output: 570 --- 🏁 Script executed: ```shell # Look at how other git error handling is done in the codebase rg "throw new Error.*stderr" src/ -B 3 -A 2 ``` Repository: TommyKammy/codex-supervisor Length of output: 812 --- </details> **The error message check is locale-dependent and may fail with non-English Git installations.** The string check on line 59 (`couldn't find remote ref refs/heads/${branch}`) will not match if Git is configured with a non-English locale (e.g., `LANG=de_DE.UTF-8`), causing the function to throw an error instead of returning `false` for a missing remote ref. Use `{ allowExitCodes: [0, 128], env: { ...process.env, LC_ALL: "C" } }` to force English output, or alternatively check if the remote tracking ref actually exists after the fetch fails (similar to the existing `remoteTrackingRefExists` pattern). <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/core/workspace.ts` around lines 46 - 69, fetchIssueRemoteTrackingRef currently relies on parsing an English git stderr message which breaks for non-English locales; update the git fetch call in fetchIssueRemoteTrackingRef so it forces C/English output (pass env: { ...process.env, LC_ALL: "C" } to the runCommand options) and include 128 in allowExitCodes as already done, or instead avoid parsing stderr by, after a non-zero fetch result, checking the existence of remoteRef (the refs/remotes/origin/${branch} created/updated by the fetch) with the same remoteTrackingRefExists-style check and only throw when that ref truly doesn't exist; target the runCommand fetch call and the subsequent error-handling branch in fetchIssueRemoteTrackingRef. ``` </details> <!-- fingerprinting:phantom:medusa:ocelot --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: Pinning the issue-branch fetch probe to `LC_ALL=C` resolves the remaining locale-sensitive review risk without changing the restore/bootstrap behavior already covered by the existing integration fixtures.
- What changed: updated `fetchIssueRemoteTrackingRef(...)` in `src/core/workspace.ts` so the narrow `git fetch origin +refs/heads/<issue-branch>:refs/remotes/origin/<issue-branch>` probe always runs with `LC_ALL=C` while keeping the existing `[0, 128]` handling and stale tracking-ref cleanup for the missing-remote path; committed the review fix as `a74d400`, pushed `codex/issue-722`, and resolved CodeRabbit thread `PRRT_kwDORgvdZ851xgdP`.
- Current blocker: none
- Next exact step: watch PR #747 on head `a74d400` for CI and any follow-up review activity, then address fallout directly on `codex/issue-722` if anything new appears.
- Verification gap: none; the issue's focused verification commands passed after the locale fix.
- Files touched: `src/core/workspace.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this patch would reintroduce locale-sensitive missing-remote detection, so non-English Git environments could throw instead of preserving the existing bootstrap path.
- Last focused command: `gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -F threadId=PRRT_kwDORgvdZ851xgdP`
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
npx tsx --test src/core/workspace.test.ts
npx tsx -e "import * as m from './src/core/command.ts'; console.log(Object.keys(m)); console.log(typeof (m as any).runCommand); console.log(typeof (m as any).default?.runCommand);"
npx tsx -e "(async()=>{ const m = await import('./src/core/command'); console.log('keys', Object.keys(m)); console.log('default type', typeof (m).default); console.log('module.exports type', typeof (m)['module.exports']); console.log('default keys', (m).default ? Object.keys((m).default) : 'none'); console.log('module.exports keys', (m)['module.exports'] ? Object.keys((m)['module.exports']) : 'none'); })();"
npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/core/workspace.test.ts
npm run build
git status --short
date -u +"%Y-%m-%dT%H:%M:%SZ"
git rev-parse --short HEAD
git add src/core/workspace.ts .codex-supervisor/issue-journal.md && git commit -m "Force C locale for issue branch probe"
git push origin codex/issue-722
gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -F threadId=PRRT_kwDORgvdZ851xgdP
```
### Scratchpad
- 2026-03-21 (JST): Committed the locale-stable fetch probe fix as `a74d400`, pushed `codex/issue-722`, and resolved the last configured CodeRabbit thread on PR #747 after the required focused tests and `npm run build` both passed.
- 2026-03-21 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851xgdP` by forcing the issue-branch discovery fetch in `src/core/workspace.ts` to run with `LC_ALL=C`; the existing integration coverage for remote-present and remote-missing discovery paths still passed, while a mock-based unit regression attempt was dropped because `tsx` exposed an unstable patch target for `runCommand` in this test harness.
- 2026-03-20 (JST): Added a focused status regression for invalid JSON state, reproduced the omission where status only printed normal empty-state lines, then appended explicit `state_diagnostic` and `state_load_finding` lines for JSON `load_findings` so corruption is visible in status without changing loader semantics.
- 2026-03-20 (JST): Added a focused docs regression for the missing JSON corruption contract, confirmed the new assertion failed first, then updated the English operator docs so they consistently say corrupted JSON state is a recovery event requiring explicit acknowledgement/reset and `status`/`doctor` triage before reuse.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
