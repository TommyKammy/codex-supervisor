# Issue #1011: Execution-safety docs guard: extend orphan-cleanup negative wording checks across every contract doc

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1011
- Branch: codex/issue-1011
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=1, repair=3)
- Last head SHA: 6af35419ebad08883750173467b12c2e448a8c14
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852zXjJ
- Repeated failure signature count: 1
- Updated at: 2026-03-25T18:19:30Z

## Latest Codex Summary
Reformatted the embedded review-thread snapshot in [issue-journal.md](.codex-supervisor/issue-journal.md) so the Active Failure Context no longer uses MD038-triggering inline code spans with padded spaces. The underlying review metadata stayed intact; only the markdown presentation changed.

Focused verification with `npx markdownlint-cli2 .codex-supervisor/issue-journal.md` still reports the journal's unrelated baseline markdownlint findings, but it no longer reports `MD038`. I committed the repair as `6af3541` (`Fix journal MD038 snapshot`) and pushed it to `origin/codex/issue-1011`; PR `#1029` now points at that head and is `UNSTABLE` while GitHub refreshes checks.

Summary: Reformatted the embedded review snapshot in the issue journal to remove the MD038-triggering inline code padding and pushed commit `6af3541`
State hint: waiting_ci
Blocked reason: none
Tests: `npx markdownlint-cli2 .codex-supervisor/issue-journal.md` (targeted `MD038` cleared; unrelated baseline journal lint findings remain)
Next action: Monitor PR `#1029` checks/review state and confirm the MD038 thread clears on the pushed head
Failure signature: PRRT_kwDORgvdZ852zXjJ

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1029#discussion_r2990101779
- Details:
  - `.codex-supervisor/issue-journal.md:33` _⚠️ Potential issue_ | _🟡 Minor_ **Fix markdownlint MD038 in embedded thread snapshot.** Line 33 includes inline code spans with spacing that trips `MD038` (“spaces inside code span elements”). Please normalize those code spans (remove leading/trailing spaces inside backticks) to keep lint clean.
    <details>
    <summary>🧰 Tools</summary>
    <details>
    <summary>🪛 markdownlint-cli2 (0.21.0)</summary>
    [warning] 33-33: Spaces inside code span elements (MD038, no-space-in-code)
    ---
    [warning] 33-33: Spaces inside code span elements (MD038, no-space-in-code)
    </details>
    </details>
    <details>
    <summary>🤖 Prompt for AI Agents</summary>

    ```text
    Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md at line 33, the MD038 lint error is caused by inline code spans on the embedded thread snapshot that include leading/trailing spaces inside backticks; open the snippet containing the inline code like `automatic(?:ally)? [^.]{0,40}prun` and similar backticked fragments and remove the extra spaces so each code span has no internal padding (e.g., change ` automatic` to `automatic` and ` prun ` to `prun`), ensuring all backticked text in that thread snapshot is normalized and the MD038 warning is resolved.
    ```

    </details>
    <!-- fingerprinting:phantom:poseidon:hawk -->
    <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the code/test change from `641e2bc` already addressed the contract-doc wording gap, and the only remaining review blocker is the journal's embedded prompt snapshot still containing padded inline code spans that trigger `MD038`.
- What changed: reformatted the Active Failure Context review detail into a multiline block with a fenced prompt snippet so markdownlint no longer sees padded inline code spans on the embedded snapshot line.
- Current blocker: none locally.
- Next exact step: monitor PR `#1029` on head `6af3541` and confirm the MD038 review thread clears once GitHub reprocesses the push.
- Verification gap: full-file markdownlint on the journal still reports unrelated baseline `MD013`, `MD022`, `MD032`, `MD033`, and `MD034` findings, but the targeted `MD038` warning no longer appears.
- Files touched: `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only reformats the persisted review snapshot for lint hygiene.
- Last focused command: `gh pr view 1029 --json url,isDraft,headRefName,headRefOid,mergeStateStatus`
- Exact failure reproduced: the live journal still contained padded inline code spans inside the embedded prompt snapshot on the Active Failure Context line, matching the CodeRabbit `MD038` complaint.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1011/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1011/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `nl -ba .codex-supervisor/issue-journal.md | sed -n '24,42p'`; `git status --short --branch`; `rg -n "automatic\\(\\?:ally\\)\\?|prun" .codex-supervisor/issue-journal.md`; `git diff -- .codex-supervisor/issue-journal.md`; `node - <<'NODE' ... NODE`; `npx markdownlint-cli2 .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `sed -n '1,120p' .codex-supervisor/issue-journal.md`; `git add .codex-supervisor/issue-journal.md`; `git commit -m "Fix journal MD038 snapshot"`; `git rev-parse HEAD`; `git push origin codex/issue-1011`; `gh pr view 1029 --json url,isDraft,headRefName,headRefOid,mergeStateStatus`.
- PR status: PR `#1029` is open at `https://github.com/TommyKammy/codex-supervisor/pull/1029`, is not a draft, points to head `6af3541`, and currently reports merge state `UNSTABLE`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
