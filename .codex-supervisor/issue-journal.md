# Issue #782: WebUI prep: split loop process control from supervisor application service

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/782
- Branch: codex/issue-782
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 8bb08533e4d2baf3e8c14332d96f3bdbbc1f603a
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8515Clw|PRRT_kwDORgvdZ8515Clx
- Repeated failure signature count: 1
- Updated at: 2026-03-21T15:30:53.983Z

## Latest Codex Summary
Separated loop/runtime control from the shared supervisor application boundary. `SupervisorService` no longer exposes lock acquisition; a new [`src/supervisor/supervisor-loop-controller.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-782/src/supervisor/supervisor-loop-controller.ts) owns lock-wrapped cycle execution, and the CLI now injects that controller only for `loop` and `run-once` via [`src/cli/entrypoint.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-782/src/cli/entrypoint.ts) and [`src/cli/supervisor-runtime.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-782/src/cli/supervisor-runtime.ts). The focused tests in [`src/cli/entrypoint.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-782/src/cli/entrypoint.test.ts) and [`src/cli/supervisor-runtime.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-782/src/cli/supervisor-runtime.test.ts) now make that split explicit.

I committed and pushed the change on `codex/issue-782` (`f056086`, plus journal update `8bb0853`) and opened draft PR #792: https://github.com/TommyKammy/codex-supervisor/pull/792. Initial PR checks are already green. `.codex-supervisor/replay/` remains untracked and untouched.

Summary: Split loop process control into a dedicated controller boundary, kept shared service/query paths intact, passed targeted tests and build, and opened draft PR #792
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/cli/supervisor-runtime.test.ts src/cli/entrypoint.test.ts`; `npm ci`; `npm run build`
Failure signature: none
Next action: monitor draft PR #792 for CI or review feedback and address any follow-up if it appears

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/792#discussion_r2969707829
- Details:
  - src/cli/supervisor-runtime.ts:152 _⚠️ Potential issue_ | _🟡 Minor_ **Fail fast before side effects when `loopController` is required.** For `"run-once"` and `"loop"`, these guards run after Lines 94-105. A wiring mistake now registers process signal handlers and may run `ensureGsdInstalled()` before throwing. Please validate the required controller earlier so this path errors without side effects. <details> <summary>💡 Example shape</summary> ```diff } = dependencies; + + if (options.command === "run-once" && !loopController) { + throw new Error("Missing supervisor loop controller for run-once command"); + } + + if (options.command === "loop" && !loopController) { + throw new Error("Missing supervisor loop controller for loop command"); + } let shouldStop = false; ``` Later duplicate guards can then be removed. </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/cli/supervisor-runtime.ts` around lines 142 - 152, The code checks for a missing loopController too late (after side effects like registering signal handlers and calling ensureGsdInstalled), causing potential wiring side effects before throwing; move the guard that validates loopController for both options.command === "run-once" and the "loop" path up so it runs before any side effects (e.g., before registering signal handlers and before calling ensureGsdInstalled), remove the later duplicate checks, and ensure any use sites such as runSupervisorCycle reference the now-validated loopController so the process fails fast when loopController is absent. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/supervisor/supervisor-loop-controller.ts:25 _⚠️ Potential issue_ | _🟡 Minor_ <details> <summary>🧩 Analysis chain</summary> 🏁 Script executed: ```shell #!/bin/bash # Verify that acquireSupervisorLock always provides a reason when acquired is false # Search for LockHandle type definition and acquireSupervisorLock implementation echo "=== Searching for LockHandle type definition ===" rg -n "interface LockHandle|type LockHandle" --type=ts echo "" echo "=== Checking acquireFileLock return scenarios ===" ast-grep --pattern $'async function acquireFileLock($_): Promise<$_> { $$$ }' echo "" echo "=== Checking lock.reason usage patterns ===" rg -n "lock\.reason" --type=ts -C2 ``` Repository: TommyKammy/codex-supervisor Length of output: 3847 --- 🏁 Script executed: ```shell #!/bin/bash # View the LockHandle interface definition echo "=== LockHandle type definition ===" sed -n '19,30p' src/core/lock.ts echo "" echo "=== acquireSupervisorLock implementation ===" rg -n "acquireSupervisorLock" src/supervisor/supervisor.ts -A 15 -B 2 | head -40 ``` Repository: TommyKammy/codex-supervisor Length of output: 948 --- </details> **Add a fallback message for undefined lock reason.** The `reason` field in `LockHandle` is optional (`reason?: string`), and the `acquireSupervisorLock` implementation can return a lock with an undefined reason when `acquired` is false (see lines 781-782 in supervisor.ts). This would produce "Skipped supervisor cycle: undefined." on line 17. Align with the pattern used elsewhere in the codebase (supervisor.ts lines 947, 976, 1002) by using a fallback: ``` return `Skipped supervisor cycle: ${lock.reason ?? "lock unavailable"}.`; ``` <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/supervisor/supervisor-loop-controller.ts` around lines 14 - 25, The runCycle method may interpolate an undefined LockHandle.reason, producing "Skipped supervisor cycle: undefined."; update the return statement in runCycle (method name: runCycle, acquisition call: supervisor.acquireSupervisorLock) to use a fallback when lock.reason is undefined (e.g., use a default string like "lock unavailable" via a nullish-coalescing style fallback) so the message reads "Skipped supervisor cycle: lock unavailable." instead of ending with "undefined.". ``` </details> <!-- fingerprinting:phantom:poseidon:ocelot --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review blockers were both real and localised: `runSupervisorCommand()` validated `loopController` too late, and `SupervisorLoopController.runCycle()` could still surface an undefined lock reason.
- What changed: moved `loop`/`run-once` controller validation to the start of `src/cli/supervisor-runtime.ts` via `requireLoopController()` so those commands now fail before registering signal handlers or running `ensureGsdInstalled()`, removed the late duplicate guards, added fail-fast regression tests in `src/cli/supervisor-runtime.test.ts`, changed `src/supervisor/supervisor-loop-controller.ts` to fall back to `"lock unavailable"` when `lock.reason` is missing, and added `src/supervisor/supervisor-loop-controller.test.ts` to cover that fallback.
- Current blocker: none
- Next exact step: commit the review fixes, push `codex/issue-782`, and resolve the two automated review threads on PR #792.
- Verification gap: none for the requested local scope after installing repo dependencies with `npm ci`; `.codex-supervisor/replay/` remains untracked and untouched.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/cli/entrypoint.test.ts`, `src/cli/entrypoint.ts`, `src/cli/supervisor-runtime.test.ts`, `src/cli/supervisor-runtime.ts`, `src/supervisor/index.ts`, `src/supervisor/supervisor-loop-controller.test.ts`, `src/supervisor/supervisor-loop-controller.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor.test.ts`
- Rollback concern: putting lock/process control back on `SupervisorService` would re-couple the shared application boundary to CLI runtime orchestration, which is exactly what the WebUI transport needs to avoid.
- Last focused command: `npm run build`
- Last focused failure: `npm run build` briefly failed with `TS2345` after the fail-fast refactor because TypeScript could not narrow the prevalidated `cycleController`; adding an explicit non-null assertion at the loop/run-once call sites fixed the compile-only issue without changing runtime behavior.
- Last focused commands:
```bash
npx tsx --test src/cli/supervisor-runtime.test.ts src/cli/entrypoint.test.ts src/supervisor/supervisor-loop-controller.test.ts
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Updated at: 2026-03-21T15:33:10Z
