# Issue #937: Stale already-landed convergence misclassifies replay artifacts and blocks issue #924

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/937
- Branch: codex/issue-937
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=1, repair=3)
- Last head SHA: 0ad332aeb60fbfa9c2147134401d4d6378c55681
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852bn9D
- Repeated failure signature count: 1
- Updated at: 2026-03-24T14:02:12Z

## Latest Codex Summary
Verified the remaining CodeRabbit thread on [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts) was still valid on head `0ad332a`, because `parseGitStatusPorcelainV1Paths()` trimmed NUL-delimited porcelain path fields. Removed those `.trim()` calls so `git status --porcelain=v1 -z` paths stay byte-for-byte intact, and added a regression in [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts) that creates an untracked path named ` .codex-supervisor/replay/...` to prove leading whitespace is preserved and still treated as a meaningful workspace change.

Focused verification passed after the patch: `npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts` and `npm run build`.

Summary: Removed unsafe trimming from porcelain `-z` path parsing and added a regression for leading-whitespace replay-like paths.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npm run build`
Next action: Commit and push the review fix to `codex/issue-937`, then recheck PR #945 and resolve the remaining automated review thread if GitHub leaves it open.
Failure signature: PRRT_kwDORgvdZ852bn9D

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/945#discussion_r2981774401
- Details:
  - src/supervisor/supervisor.ts:216 _⚠️ Potential issue_ | _🟠 Major_ <details> <summary>🧩 Analysis chain</summary> 🌐 Web query: `For `git status --porcelain=v1 -z`, are path fields emitted verbatim without quoting, including leading/trailing whitespace and embedded newlines, such that trimming those NUL-delimited fields would change the filename?` 💡 Result: Yes. With `git status --porcelain=v1 -z`, Git prints each pathname **“as is”**, performing **no quoting or backslash-escaping**, and terminates path fields with **NUL (`0x00`)** instead of newline. Therefore **leading/trailing whitespace and embedded newlines are emitted verbatim** as part of the pathname, and trimming a NUL-delimited field **can change the filename**. The only byte you can rely on *not* appearing inside a pathname in this output is the NUL delimiter itself. [1] **Source:** `git-status` documentation, “Porcelain Format Version 1” and “Pathname Format Notes and -z”. [1] --- </details> **Remove `.trim()` calls on NUL-delimited git porcelain paths.** Lines 211 and 213 call `.trim()` on paths from `git status --porcelain=v1 -z` output. The `-z` format emits path fields **verbatim**, including any leading/trailing whitespace and newlines—these are part of the actual filename, not formatting artifacts. Trimming changes the filename; for example, a path ` .codex-supervisor/replay/foo` becomes `.codex-supervisor/replay/foo`, gets misclassified as supervisor-owned, and bypasses the manual-recovery guard. <details> <summary>Proposed fix</summary> ```diff - const paths = [field.slice(3).trim()].filter((entry) => entry.length > 0); + const paths = [field.slice(3)].filter((entry) => entry.length > 0); if (statusCode.includes("R") || statusCode.includes("C")) { - const pairedPath = fields[index + 1]?.trim() ?? ""; + const pairedPath = fields[index + 1] ?? ""; if (pairedPath.length > 0) { paths.push(pairedPath); index += 1; } } ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/supervisor/supervisor.ts` around lines 211 - 216, The code is trimming NUL-delimited git porcelain paths and thereby altering legitimate filenames; update the path extraction in supervisor.ts by removing the .trim() calls so you use field.slice(3) (not field.slice(3).trim()) and pairedPath = fields[index + 1] ?? "" (not fields[index + 1]?.trim() ?? ""), retaining the existing filter(entry => entry.length > 0) and the rest of the logic (statusCode check, pushing to paths, incrementing index) so paths are preserved verbatim. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the last open review thread is fully addressed by preserving raw NUL-delimited porcelain paths; once the new head is pushed, PR #945 should no longer have a valid parser complaint.
- What changed: removed `.trim()` from `parseGitStatusPorcelainV1Paths()` in [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts) so leading/trailing whitespace in filenames is preserved; added a regression in [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts) covering an untracked path that starts with a space and visually resembles `.codex-supervisor/replay/...`; left the earlier replay-rename fix intact.
- Current blocker: none.
- Next exact step: commit and push `codex/issue-937`, then recheck PR #945 and resolve thread `PRRT_kwDORgvdZ852bn9D` if it remains open on the updated head.
- Verification gap: none for the addressed review feedback; the targeted stale branch-state/orchestration tests and `npm run build` pass after removing the trim calls and adding the whitespace regression.
- Files touched: [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md), [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts), and [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts).
- Rollback concern: low; reverting this patch would reintroduce incorrect pathname normalization for porcelain `-z` output and reopen the false ignore path where a leading-space filename can masquerade as a supervisor-owned replay artifact.
- Last focused command: `npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`
- Last focused failure: none; focused tests and `npm run build` both passed after the parser change.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/945
- Last focused commands:
```bash
sed -n '1,220p' .local/memory/TommyKammy-codex-supervisor/issue-937/AGENTS.generated.md
sed -n '1,220p' .local/memory/TommyKammy-codex-supervisor/issue-937/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
sed -n '180,250p' src/supervisor/supervisor.ts
sed -n '1,260p' src/supervisor/supervisor-stale-no-pr-branch-state.test.ts
gh pr view 945 --json headRefOid,mergeStateStatus,reviewDecision,isDraft,comments,reviews
date -Iseconds -u
git diff -- src/supervisor/supervisor.ts src/supervisor/supervisor-stale-no-pr-branch-state.test.ts .codex-supervisor/issue-journal.md
npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
npm run build
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
