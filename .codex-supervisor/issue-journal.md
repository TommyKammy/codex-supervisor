# Issue #731: Hydration freshness docs: define fresh-vs-cached contract for supervisor action paths

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/731
- Branch: codex/issue-731
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 73eda3197818efbf924eb3c461a3c8ccd29abb67
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8510_c8
- Repeated failure signature count: 1
- Updated at: 2026-03-20T23:02:42Z

## Latest Codex Summary
Addressed the remaining CodeRabbit review on [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md) by removing machine-specific absolute local paths from committed journal content. The journal now records repo-relative file links and portable `.local/memory/...` command paths instead of host-specific home-directory paths.

Focused verification confirmed `.codex-supervisor/issue-journal.md` no longer contains host-specific home-directory absolute paths. The prior docs and test changes for the hydration freshness contract remain unchanged on this branch and were already verified with `npx tsx --test src/hydration-freshness-docs.test.ts` and `npm run build`.

Summary: Normalized committed issue-journal paths to portable relative forms so the remaining review thread can be resolved without changing runtime behavior
State hint: addressing_review
Blocked reason: none
Tests: `node -e "const fs=require('fs'); const s=fs.readFileSync('.codex-supervisor/issue-journal.md','utf8'); process.exit(s.includes('/'+'home/') ? 1 : 0)"`
Failure signature: PRRT_kwDORgvdZ8510_c8
Next action: commit this review fix, push `codex/issue-731`, and resolve PR thread #PRRT_kwDORgvdZ8510_c8 if the review system does not auto-dismiss it

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/754#discussion_r2968285486
- Details:
  - Review thread `PRRT_kwDORgvdZ8510_c8` is valid: the committed journal included machine-specific absolute paths in the logged `sed` commands used to read shared memory files.
  - Local fix: replaced those command paths with portable `.local/memory/TommyKammy-codex-supervisor/issue-731/...` references and normalized the journal's own file links away from absolute worktree paths.
  - Verification target: `.codex-supervisor/issue-journal.md` should contain no host-specific home-directory absolute paths after this repair.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining PR blocker is limited to committed journal portability, not the hydration freshness docs themselves; fixing the logged path forms should clear the last review thread without affecting runtime behavior.
- What changed: normalized `.codex-supervisor/issue-journal.md` so committed command history and file links no longer embed machine-specific home-directory absolute paths.
- Current blocker: none
- Next exact step: commit and push the journal portability fix so PR #754 can clear the outstanding review thread.
- Verification gap: this turn only needs a focused journal portability check; the earlier docs regression test and `npm run build` already passed for the underlying feature work.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this change would reintroduce machine-specific paths into a committed journal artifact and likely keep the review thread open.
- Last focused command: `node -e "const fs=require('fs'); const s=fs.readFileSync('.codex-supervisor/issue-journal.md','utf8'); process.exit(s.includes('/'+'home/') ? 1 : 0)"`
- Last focused failure: `PRRT_kwDORgvdZ8510_c8`
- Last focused commands:
```bash
sed -n '1,220p' .local/memory/TommyKammy-codex-supervisor/issue-731/AGENTS.generated.md
sed -n '1,220p' .local/memory/TommyKammy-codex-supervisor/issue-731/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
node -e "const fs=require('fs'); const s=fs.readFileSync('.codex-supervisor/issue-journal.md','utf8'); process.exit(s.includes('/'+'home/') ? 1 : 0)"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
