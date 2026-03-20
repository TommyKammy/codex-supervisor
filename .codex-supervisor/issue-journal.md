# Issue #722: Remote branch discovery: detect origin issue branches before default-branch bootstrap

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/722
- Branch: codex/issue-722
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: 71d37a09f95b80118bac8599474037f9e37865a8
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851xv4Z
- Repeated failure signature count: 1
- Updated at: 2026-03-20T17:55:33.861Z

## Latest Codex Summary
Pinned the issue-branch probe in [workspace.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-722/src/core/workspace.ts) to `LC_ALL=C` so the existing missing-remote `stderr` check stays deterministic on non-English Git installs. I updated the issue journal in [.codex-supervisor/issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-722/.codex-supervisor/issue-journal.md), committed the fix as `a74d400`, followed with the journal sync commit `71d37a0`, pushed `codex/issue-722`, and resolved the remaining CodeRabbit thread.

Verification passed with `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/core/workspace.test.ts` and `npm run build`. PR #747 is now on head `71d37a0`; GitHub reports `mergeStateStatus: UNSTABLE`, which is consistent with checks rerunning after the push. The only remaining local dirt is the pre-existing untracked `.codex-supervisor/replay/` directory, which I left untouched.

Summary: Forced the remote issue-branch fetch probe to run under `LC_ALL=C`, pushed the fix on `codex/issue-722`, and resolved the outstanding CodeRabbit review thread.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-issue-selection.test.ts src/core/workspace.test.ts`; `npm run build`
Failure signature: none
Next action: Watch PR #747 checks on head `71d37a0` and address any new CI or review fallout if it appears.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/747#discussion_r2967148689
- Details:
  - `.codex-supervisor/issue-journal.md:33`: the journal copied the full CodeRabbit locale review into this section, which made the file hard to scan and introduced markdownlint noise (`MD038`, `MD052` for the missing `[3]` definition). Keep only a concise summary here and link back to the original review at `discussion_r2967063046`: https://github.com/TommyKammy/codex-supervisor/pull/747#discussion_r2967063046

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining PR feedback is purely about journal readability, so replacing the embedded bot transcript with a short summary and direct discussion link should satisfy thread `PRRT_kwDORgvdZ851xv4Z` without changing runtime behavior.
- What changed: trimmed `Active Failure Context` in `.codex-supervisor/issue-journal.md` down to a short description of the journal-specific review issue and linked the original locale discussion at `discussion_r2967063046` instead of copying its full body into this file.
- Current blocker: none
- Next exact step: run focused markdown verification on `.codex-supervisor/issue-journal.md`, commit the journal cleanup, push `codex/issue-722`, and resolve thread `PRRT_kwDORgvdZ851xv4Z` if the rendered diff is clean.
- Verification gap: none beyond confirming the journal no longer trips the reported markdownlint warnings.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this patch would reintroduce the unreadable inline transcript and the missing-reference markdown noise in the journal, but would not affect product behavior.
- Last focused command: `gh api graphql -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{id,isResolved,path,comments(first:10){nodes{databaseId,url,body}}}}}}}' -F owner=TommyKammy -F repo=codex-supervisor -F number=747`
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
git status --short --branch
git diff -- .codex-supervisor/issue-journal.md
gh pr view 747 --json number,url,headRefName,isDraft,mergeStateStatus,reviewDecision,statusCheckRollup
gh api graphql -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{id,isResolved,path,comments(first:10){nodes{databaseId,url,body}}}}}}}' -F owner=TommyKammy -F repo=codex-supervisor -F number=747
nl -ba .codex-supervisor/issue-journal.md | sed -n '1,140p'
git rev-parse --short HEAD
```
### Scratchpad
- 2026-03-21 (JST): Verified PR #747 is otherwise clean and that the only unresolved review thread is `PRRT_kwDORgvdZ851xv4Z` on `.codex-supervisor/issue-journal.md`; simplifying the stored failure context is sufficient because the underlying locale fix in `src/core/workspace.ts` is already merged into this branch head.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
