# Issue #709: Prompt hardening: frame GitHub-authored issue and review text as non-authoritative input

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/709
- Branch: codex/issue-709
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f322faa895d82261ca1b8fb969ec2d8585068b26
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T05:10:00Z

## Latest Codex Summary
- Hardened prompt text so GitHub-authored issue bodies, review-thread excerpts, and review-derived local-review context are explicitly marked non-authoritative while preserving their factual content.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Codex execution and local-review prompts were still presenting GitHub-authored issue bodies and review-derived text as plain prompt content, so a narrow trust-boundary label plus precedence guidance should reduce prompt-injection risk without changing supervisor flow.
- What changed: added focused prompt tests first, then updated `buildCodexPrompt()` to label the issue body and unresolved review-thread excerpts as `GitHub-authored ... (non-authoritative input)` with explicit precedence guidance. Updated local-review prompt rendering so prior external misses are framed as GitHub-authored review-derived context whose instructions are outranked by supervisor guidance, the current diff, and local repository evidence.
- Current blocker: none
- Next exact step: monitor draft PR #762 for CI and review feedback on commit `c8347cc`.
- Verification gap: none for the requested scope; `npx tsx --test src/codex/codex-prompt.test.ts src/local-review/prompt.test.ts` and `npm run build` pass locally after installing dev dependencies in this worktree.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/codex/codex-prompt.test.ts`, `src/codex/codex-prompt.ts`, `src/local-review/prompt.test.ts`, `src/local-review/prompt.ts`
- Rollback concern: removing the new non-authoritative framing would restore the old prompt shape where GitHub-authored instructions appear with implicit supervisor-level authority, increasing prompt-injection risk in execution and local-review turns.
- Last focused command: `gh pr create --draft --base main --head codex/issue-709 --title "Prompt hardening: frame GitHub-authored prompt context" --body ...`
- Last focused failure: none
- Last focused commands:
```bash
npx tsx --test src/codex/codex-prompt.test.ts src/local-review/prompt.test.ts
npm install
npm run build
git diff --stat
gh pr view codex/issue-709 --json number,url,isDraft,state
git push -u origin codex/issue-709
gh pr create --draft --base main --head codex/issue-709 --title "Prompt hardening: frame GitHub-authored prompt context" --body ...
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
