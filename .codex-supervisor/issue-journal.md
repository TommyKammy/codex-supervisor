# Issue #708: Trust diagnostics: surface trust-mode and execution-safety warnings in config/status/doctor

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/708
- Branch: codex/issue-708
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0e5f2c681c2cbc269dd6926d60225f7666a300e7
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T04:36:29.971Z

## Latest Codex Summary
- Added diagnostics-only trust posture surfacing across config summaries, status output, and doctor output. The current default posture renders `trust_mode=trusted_repo_and_authors`, `execution_safety_mode=unsandboxed_autonomous`, and a conservative warning that unsandboxed autonomous execution assumes trusted GitHub-authored inputs; explicit safer overrides suppress that warning without changing execution behavior.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #708 was still open because config summaries, `status`, and `doctor` had no explicit trust posture surface, so operators could not tell whether the current supervisor was relying on trusted GitHub-authored inputs while running in the current unsandboxed autonomous mode.
- What changed: added optional diagnostics-only `trustMode` and `executionSafetyMode` config fields with default posture summarization in `summarizeTrustDiagnostics()`. `loadConfigSummary()` now exposes `trustDiagnostics`, `status` renders trust posture lines plus a conservative execution-safety warning, and `doctor` exposes the same posture in both the structured object and CLI output. Focused tests cover the default warning posture and an explicit safer override that clears the warning without altering execution behavior.
- Current blocker: none
- Next exact step: monitor draft PR #761 for CI and review feedback on commit `d89184d`.
- Verification gap: none for the requested scope; the targeted tests and build both pass locally after the trust posture diagnostics update.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/config.test.ts`, `src/core/config.ts`, `src/core/types.ts`, `src/doctor.test.ts`, `src/doctor.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-status-model.test.ts`, `src/supervisor/supervisor-status-report.ts`, `src/supervisor/supervisor-test-helpers.ts`, `src/supervisor/supervisor.ts`, `src/turn-execution-test-helpers.ts`
- Rollback concern: removing the new trust posture defaults or warning rendering would hide when the current unsandboxed autonomous runtime is relying on trusted GitHub-authored inputs, which is the operator-facing safety signal this issue adds.
- Last focused command: `gh pr create --draft --base main --head codex/issue-708 --title "Trust diagnostics: surface trust mode and execution-safety posture" --body ...`
- Last focused failure: `trust-diagnostics-missing`
- Last focused commands:
```bash
npx tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
npm install
npm run build
git diff --stat
git status --short --branch
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
