# Issue #759: Orphan age gate follow-up: base recent-orphan safety on actual worktree activity

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/759
- Branch: codex/issue-759
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 18310ce45275e53c3f885bdac25a65609c9c1daa
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8512GIt
- Repeated failure signature count: 1
- Updated at: 2026-03-21T02:19:50Z

## Latest Codex Summary
Addressed the remaining CodeRabbit review on [src/recovery-reconciliation.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-759/src/recovery-reconciliation.ts): missing dirty paths no longer get dropped when `statSync` hits `ENOENT`. The orphan recency check now falls back to the nearest existing ancestor mtime inside the worktree, so staged deletions still count as recent activity without relying on commit history timestamps.

I added focused staged-deletion regression coverage in [src/supervisor/supervisor-execution-cleanup.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-759/src/supervisor/supervisor-execution-cleanup.test.ts) and [src/supervisor/supervisor-diagnostics-status-selection.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-759/src/supervisor/supervisor-diagnostics-status-selection.test.ts). The tests now seed a tracked nested file, stage its deletion in the orphan worktree, keep the worktree directory timestamp stale, and verify the recent-orphan safeguard still preserves the workspace.

Summary: Added staged-deletion activity fallback for orphan recency and covered it with focused orphan prune regressions.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Failure signature: PRRT_kwDORgvdZ8512GIt
Next action: commit and push the review fix for PR #760, then resolve or answer the remaining bot thread if the remote state matches the local fix

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/760#discussion_r2968689501
- Details:
  - src/recovery-reconciliation.ts:176 _⚠️ Potential issue_ | _🟠 Major_ <details> <summary>🧩 Analysis chain</summary> 🌐 Web query: `In Git, does `git diff --name-only --cached -z` include paths for staged deletions, and are those deleted paths expected to be absent on disk?` 💡 Result: Yes. - `git diff --cached --name-only -z` lists the **pathnames of all changes staged in the index** relative to `HEAD` (by default), and “changes” include **deletions**—so a staged deletion’s path **will be included** in the output. [1][2] - Because the output is driven by the **index vs. `HEAD`** comparison, the listed paths are **not required to exist on disk**. For a normal staged deletion (e.g., `git rm` or `rm` + `git add -A`), the file is **expected to be absent from the working tree**. [1] - `-z` only changes formatting (NUL-terminated path output); it doesn’t change which paths are reported. [2] If you want to confirm which entries are deletions, use `--name-status` (you’ll see `D`) or filter explicitly with `--diff-filter=D` / exclude with `--diff-filter=d`. [2][3] **Sources:** [1] Git documentation: `git diff --cached` compares staged changes (index) to `HEAD` [2] Git documentation: `--name-only`, `--name-status`, and `-z` behavior [3] Git documentation: `--diff-filter` includes `D` for deleted paths --- 🏁 Script executed: ```shell cat -n src/recovery-reconciliation.ts | head -200 ``` Repository: TommyKammy/codex-supervisor Length of output: 7828 --- 🏁 Script executed: ```shell # Check the full function and its usage context cat -n src/recovery-reconciliation.ts | sed -n '141,187p' ``` Repository: TommyKammy/codex-supervisor Length of output: 1868 --- 🏁 Script executed: ```shell # Check if there are any other error types we should handle beyond ENOENT # Verify the runCommand implementation to understand timeout behavior rg "runCommand" src/recovery-reconciliation.ts -A 2 -B 2 ``` Repository: TommyKammy/codex-supervisor Length of output: 555 --- 🏁 Script executed: ```shell # Verify what errors fs.statSync can throw and whether the suggested fix covers them # Also check if there are existing error handling patterns in the codebase rg "fs.statSync" src/ -A 2 -B 2 ``` Repository: TommyKammy/codex-supervisor Length of output: 757 --- </details> **Account for staged deletions when deriving activity timestamps.** If a dirty path was deleted (common for staged deletions), `fs.statSync(candidatePath)` throws and the code skips it, which can incorrectly make a recently active orphan look old and prune-eligible. <details> <summary>💡 Suggested fix</summary> ```diff for (const relativePath of dirtyPaths) { const candidatePath = path.resolve(workspacePath, relativePath); if (!candidatePath.startsWith(`${path.resolve(workspacePath)}${path.sep}`)) { continue; } try { const candidateModifiedMs = fs.statSync(candidatePath).mtimeMs; if (Number.isNaN(latestModifiedMs) || candidateModifiedMs > latestModifiedMs) { latestModifiedMs = candidateModifiedMs; } - } catch { - continue; + } catch (error) { + const code = (error as NodeJS.ErrnoException).code; + if (code !== "ENOENT") continue; + try { + const parentModifiedMs = fs.statSync(path.dirname(candidatePath)).mtimeMs; + if (Number.isNaN(latestModifiedMs) || parentModifiedMs > latestModifiedMs) { + latestModifiedMs = parentModifiedMs; + } + } catch { + continue; + } } } ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion for (const relativePath of dirtyPaths) { const candidatePath = path.resolve(workspacePath, relativePath); if (!candidatePath.startsWith(`${path.resolve(workspacePath)}${path.sep}`)) { continue; } try { const candidateModifiedMs = fs.statSync(candidatePath).mtimeMs; if (Number.isNaN(latestModifiedMs) || candidateModifiedMs > latestModifiedMs) { latestModifiedMs = candidateModifiedMs; } } catch (error) { const code = (error as NodeJS.ErrnoException).code; if (code !== "ENOENT") continue; try { const parentModifiedMs = fs.statSync(path.dirname(candidatePath)).mtimeMs; if (Number.isNaN(latestModifiedMs) || parentModifiedMs > latestModifiedMs) { latestModifiedMs = parentModifiedMs; } } catch { continue; } } } ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/recovery-reconciliation.ts` around lines 163 - 176, The loop over dirtyPaths currently skips entries when fs.statSync(candidatePath) throws (e.g., for staged deletions), which can make recently-active deleted files appear old; update the catch path in the loop that iterates dirtyPaths/candidatePath/latestModifiedMs so that when statSync fails you detect a staged deletion and derive a timestamp from Git (e.g., run git log -1 --format=%at -- <relativePath> and convert seconds to ms) and use that value to compare/update latestModifiedMs instead of silently continuing; keep existing behavior for paths that truly have no history. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review thread is valid because staged deletions are emitted by `git diff --name-only --cached -z`, but the orphan activity collector was still dropping those paths on `ENOENT`, which could misclassify a recently used orphan as old.
- What changed: `readOrphanedWorkspaceActivityTimestamp` now keeps the resolved workspace root once, updates `latestModifiedMs` through a helper, and on `ENOENT` walks up to the nearest existing ancestor under the worktree to reuse that directory mtime as the deletion-activity signal. Focused prune tests now cover staged deletion of a tracked nested file while the orphan worktree directory timestamp stays stale.
- Current blocker: none
- Next exact step: stage `src/recovery-reconciliation.ts`, the two focused tests, and this journal update; commit on `codex/issue-759`; push to update PR #760; then resolve or reply to the CodeRabbit thread.
- Verification gap: none for the requested scope; the targeted tests and build both pass locally after the staged-deletion regression update.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-execution-cleanup.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`
- Rollback concern: reverting the new `ENOENT` fallback would reintroduce false-positive orphan pruning for orphan worktrees whose only recent activity is a staged deletion or removed nested path.
- Last focused command: `npm run build`
- Last focused failure: `staged-delete-empty-dir-stat-enoent`
- Last focused commands:
```bash
sed -n '1,260p' .codex-supervisor/issue-journal.md
sed -n '1,260p' src/recovery-reconciliation.ts
sed -n '654,785p' src/supervisor/supervisor-execution-cleanup.test.ts
sed -n '524,590p' src/supervisor/supervisor-diagnostics-status-selection.test.ts
npx tsx --test src/supervisor/supervisor-execution-cleanup.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
npm run build
git diff -- src/recovery-reconciliation.ts src/supervisor/supervisor-execution-cleanup.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts .codex-supervisor/issue-journal.md
git status --short --branch
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
