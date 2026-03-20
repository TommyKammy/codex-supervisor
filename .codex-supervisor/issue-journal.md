# Issue #722: Remote branch discovery: detect origin issue branches before default-branch bootstrap

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/722
- Branch: codex/issue-722
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=1, repair=3)
- Last head SHA: a983e76bc94b3ad17304c7fbb71dc5c1a863488a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-20T17:59:06Z

## Latest Codex Summary
Simplified the stored review context in [.codex-supervisor/issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-722/.codex-supervisor/issue-journal.md) so the journal now records the remaining CodeRabbit concern as a short summary plus direct discussion link instead of embedding the full bot transcript. I committed that cleanup as `a983e76`, pushed `codex/issue-722`, and resolved review thread `PRRT_kwDORgvdZ851xv4Z`.

Focused verification confirmed the reported markdownlint failures are gone for this review context: `npx markdownlint-cli2 .codex-supervisor/issue-journal.md 2>&1 | rg "MD038|MD052"` returned no matches. Full `markdownlint-cli2` still reports longstanding journal-wide style warnings unrelated to this thread. PR #747 now shows `mergeStateStatus: UNSTABLE` because CI and CodeRabbit restarted after the push. The only remaining local dirt is the pre-existing untracked `.codex-supervisor/replay/` directory, which I left untouched.

Summary: Simplified the journal’s stored review context, pushed the review-only cleanup on `codex/issue-722`, and resolved the last configured CodeRabbit thread on PR #747.
State hint: addressing_review
Blocked reason: none
Tests: `npx markdownlint-cli2 .codex-supervisor/issue-journal.md`; `npx markdownlint-cli2 .codex-supervisor/issue-journal.md 2>&1 | rg "MD038|MD052"`
Failure signature: none
Next action: Push this journal sync commit, then watch PR #747 checks and any new review fallout on `codex/issue-722`.

## Active Failure Context
- Category: none
- Summary: No active local failure remains; both configured PR review threads are resolved.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/747
- Details:
  - Resolved `PRRT_kwDORgvdZ851xv4Z` by replacing the inlined CodeRabbit transcript with a concise note that links back to `discussion_r2967063046`.

## Codex Working Notes
### Current Handoff
- Hypothesis: The branch is back to a clean review state; only CI reruns from the journal-only push need watching now.
- What changed: trimmed the oversized `Active Failure Context` entry in `.codex-supervisor/issue-journal.md`, committed the cleanup as `a983e76`, pushed `codex/issue-722`, and resolved thread `PRRT_kwDORgvdZ851xv4Z`.
- Current blocker: none
- Next exact step: push this journal sync commit and then watch PR #747 for CI completion or any new review comments.
- Verification gap: none; the review-specific markdownlint findings are gone and no product code changed in this turn.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this patch would reintroduce the unreadable inline transcript and the missing-reference markdown noise in the journal, but would not affect product behavior.
- Last focused command: `gh api graphql -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{id,isResolved,path}}}}}' -F owner=TommyKammy -F repo=codex-supervisor -F number=747`
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
npx markdownlint-cli2 .codex-supervisor/issue-journal.md
bash -lc 'npx markdownlint-cli2 .codex-supervisor/issue-journal.md 2>&1 | rg "MD038|MD052"'
rg -n '\[3\]' .codex-supervisor/issue-journal.md
git status --short
git add .codex-supervisor/issue-journal.md && git commit -m "Simplify issue journal review context"
git push origin codex/issue-722
gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -F threadId=PRRT_kwDORgvdZ851xv4Z
gh pr view 747 --json number,url,headRefName,isDraft,mergeStateStatus,reviewDecision,statusCheckRollup
gh api graphql -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{id,isResolved,path}}}}}' -F owner=TommyKammy -F repo=codex-supervisor -F number=747
date -u +"%Y-%m-%dT%H:%M:%SZ"
git status --short --branch
```
### Scratchpad
- 2026-03-21 (JST): Committed the journal readability cleanup as `a983e76`, pushed `codex/issue-722`, and resolved CodeRabbit thread `PRRT_kwDORgvdZ851xv4Z`; PR #747 is back to waiting on rerun checks rather than review action.
- 2026-03-21 (JST): Verified PR #747 is otherwise clean and that the only unresolved review thread is `PRRT_kwDORgvdZ851xv4Z` on `.codex-supervisor/issue-journal.md`; simplifying the stored failure context is sufficient because the underlying locale fix in `src/core/workspace.ts` is already merged into this branch head.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
