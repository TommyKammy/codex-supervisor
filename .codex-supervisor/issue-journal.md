# Issue #884: Local CI execution gate: run configured pre-PR verification before PR publication

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/884
- Branch: codex/issue-884
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 1fc7138056bf61c8ea73906623bcabfe205bf543
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852JnTS|PRRT_kwDORgvdZ852JnTY|PRRT_kwDORgvdZ852JnTZ
- Repeated failure signature count: 1
- Updated at: 2026-03-23T14:40:35.535Z

## Latest Codex Summary
Pushed `codex/issue-884` and opened draft PR `#901`: https://github.com/TommyKammy/codex-supervisor/pull/901

I also updated the issue journal handoff so the durable state now points at PR `#901` and the next step is to monitor its checks/review. No additional code changes or verification were needed in this turn beyond the already-passing local verification from the prior step. The worktree is still dirty only because of the updated journal and untracked `.codex-supervisor/replay/`.

Summary: Pushed `codex/issue-884`, opened draft PR `#901`, and updated the journal handoff to monitor PR checks
State hint: draft_pr
Blocked reason: none
Tests: not run in this turn; prior verified state already passed `npm run build`, `npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`, and `npx tsx --test src/post-turn-pull-request.test.ts`
Failure signature: none
Next action: monitor draft PR `#901` checks and address any CI or review feedback

## Active Failure Context
- Category: review
- Summary: 3 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/901#discussion_r2975461705
- Details:
  - .codex-supervisor/issue-journal.md:36 _⚠️ Potential issue_ | _🟡 Minor_ **Avoid committing workstation-specific absolute paths in the journal.** These entries bake machine-specific paths into a tracked file, which leaks a local username and makes the command history non-portable for other contributors. Please rewrite them as repo-relative paths or redact the machine-specific prefix before committing. <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md around lines 35 - 36, The journal currently contains workstation-specific absolute paths (e.g., the sed commands referencing <LOCAL_MEMORY_ROOT>/TommyKammy-codex-supervisor/issue-884/...) which leak a local username and harm portability; update the entries in .codex-supervisor/issue-journal.md to use repo-relative paths or redact the machine-specific prefix (replace the machine-specific prefix with ./ or with a placeholder like <REPO_HOME>) so the sed lines read against relative paths or anonymized paths instead of absolute ones. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/local-ci.ts:19 _⚠️ Potential issue_ | _🟠 Major_ **Give the local-CI subprocess a timeout and preserve both output streams on failure.** This new gate runs an arbitrary repo-owned command with no `timeoutMs`, so one hung test runner can stall PR publication indefinitely. It also builds `failureContext.details` from the thrown `Error`, and the current `runCommand` rejection path only includes stderr on non-zero exits, so stdout-only failures won't leave useful diagnostics in the blocked record. Also applies to: 39-40 <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/local-ci.ts` around lines 12 - 19, The executeLocalCiCommand call to runCommand lacks a timeout and may drop stdout on failure; update executeLocalCiCommand to pass a sensible timeoutMs (e.g. 300000 for 5m or a configurable constant) into the runCommand options and ensure runCommand is invoked so that its rejection preserves both stdout and stderr (or throw a new Error that includes error.stdout and error.stderr) so failureContext.details will contain both streams; locate executeLocalCiCommand and the runCommand invocation and add the timeoutMs option and augment error propagation to include error.stdout and error.stderr. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/post-turn-pull-request.ts:263 _⚠️ Potential issue_ | _🟡 Minor_ **Clear stale `last_failure_kind` when the local-CI ready gate blocks.** This path moves the record into a verification block, but it leaves any previous `last_failure_kind` intact. If the issue previously timed out or hit a command error, the saved record will now describe the wrong failure mode. <details> <summary>🧹 Minimal fix</summary> ```diff if (!localCiGate.ok) { const failureContext = localCiGate.failureContext; record = stateStore.touch(record, { state: "blocked", last_error: truncate(failureContext?.summary, 1000), + last_failure_kind: null, last_failure_context: failureContext, ...args.applyFailureSignature(record, failureContext), blocked_reason: "verification", }); ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion if (!localCiGate.ok) { const failureContext = localCiGate.failureContext; record = stateStore.touch(record, { state: "blocked", last_error: truncate(failureContext?.summary, 1000), last_failure_kind: null, last_failure_context: failureContext, ...args.applyFailureSignature(record, failureContext), blocked_reason: "verification", }); ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/post-turn-pull-request.ts` around lines 255 - 263, When localCiGate.ok is false and you set the record to blocked in the local CI ready gate branch, clear any previous last_failure_kind on the record so it no longer misreports an earlier failure mode; update the stateStore.touch call (the block that references localCiGate, failureContext, record, and args.applyFailureSignature) to include last_failure_kind: null (or undefined) alongside the existing fields (state, last_error, last_failure_context, blocked_reason) so the persisted record reflects the current "verification" block state. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review gaps were all valid follow-ups on the new local-CI gate, and they can be closed without changing the publication flow itself by tightening timeout/error reporting, clearing stale failure metadata, and sanitizing tracked journal paths.
- What changed: added `CommandExecutionError` in `src/core/command.ts` so failed commands retain `stdout`, `stderr`, `exitCode`, and timeout metadata; updated `src/local-ci.ts` to enforce a 5-minute timeout and include `stdout`/`stderr` sections in blocked failure details; cleared stale `last_failure_kind` when the draft-to-ready local-CI gate blocks in `src/post-turn-pull-request.ts`; added focused regressions in `src/core/command.test.ts`, `src/local-ci.test.ts`, and `src/post-turn-pull-request.test.ts`; and redacted machine-specific paths in this journal entry.
- Current blocker: none
- Next exact step: commit this review-fix patch, push `codex/issue-884`, and update PR `#901`.
- Verification gap: none on the requested issue verification surface.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/core/command.test.ts`, `src/core/command.ts`, `src/local-ci.test.ts`, `src/local-ci.ts`, `src/post-turn-pull-request.test.ts`, `src/post-turn-pull-request.ts`
- Rollback concern: low; the production behavior change is limited to bounding local-CI runtime and improving blocked diagnostics, but reverting only one half of the `command`/`local-ci` pair would reintroduce missing stdout diagnostics.
- Last focused command: `npx tsx --test src/core/command.test.ts src/local-ci.test.ts src/post-turn-pull-request.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`
- Last focused failure: none; the focused tests and `npm run build` both passed after the review fixes.
- Last focused commands:
```bash
sed -n '1,220p' <LOCAL_MEMORY_ROOT>/TommyKammy-codex-supervisor/issue-884/AGENTS.generated.md
sed -n '1,240p' <LOCAL_MEMORY_ROOT>/TommyKammy-codex-supervisor/issue-884/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
sed -n '1,220p' src/local-ci.ts
sed -n '220,320p' src/post-turn-pull-request.ts
rg -n "<LOCAL_HOME>|localCiGate\.ok|last_failure_kind|executeLocalCiCommand|runCommand\(" .codex-supervisor/issue-journal.md src -g '*.ts'
sed -n '1,260p' src/core/command.ts
sed -n '1,260p' src/post-turn-pull-request.test.ts
sed -n '1,260p' src/run-once-turn-execution.test.ts
rg -n "runLocalCiGate|local-ci|runLocalCiCommand|last_failure_context|last_failure_kind" src/post-turn-pull-request.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts src/local-ci.ts
sed -n '412,450p' src/run-once-turn-execution.ts
sed -n '1,140p' src/supervisor/supervisor-failure-helpers.ts
nl -ba .codex-supervisor/issue-journal.md | sed -n '28,90p'
rg --files src | rg 'command.*test\.ts$|core/command'
sed -n '1,260p' src/core/command.test.ts
apply_patch
npx tsx --test src/core/command.test.ts src/local-ci.test.ts src/post-turn-pull-request.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
npm run build
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
