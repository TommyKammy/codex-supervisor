# Issue #783: Backend adapter MVP: add a read-only HTTP API over SupervisorService

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/783
- Branch: codex/issue-783
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: d113d75190cb342a8bbc9d4ca7993ea72b5b38a3
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8515NrU
- Repeated failure signature count: 1
- Updated at: 2026-03-21T16:26:06.313Z

## Latest Codex Summary
Tightened the backend adapter and hardened the regression test. In [supervisor-http-server.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-783/src/backend/supervisor-http-server.ts), issue routes now only match positive integers, so `/api/issues/0/explain` and `/api/issues/0/issue-lint` correctly return `400` instead of reaching the service. In [supervisor-http-server.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-783/src/backend/supervisor-http-server.test.ts), the stub now records the `why` flag passed to `queryStatus`, varies `whyLines` based on that flag, and asserts that invalid issue IDs do not invoke `queryExplain` or `queryIssueLint`.

Verification passed with `npx tsx --test src/backend/supervisor-http-server.test.ts` and `npm run build`. I committed and pushed the review fix as `d113d75` on `codex/issue-783`, and resolved both GitHub review threads. The only remaining local dirt is the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Rejected issue number `0` at the HTTP route layer, strengthened the endpoint test to prove `why=true` propagation and non-invocation on invalid IDs, pushed commit `d113d75`, and resolved both review threads.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/backend/supervisor-http-server.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor PR #793 for any follow-up CI or review feedback.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/793#discussion_r2969762789
- Details:
  - .codex-supervisor/issue-journal.md:34 _⚠️ Potential issue_ | _🟡 Minor_ **Fix markdownlint MD038 code-span spacing warnings.** Lines 33–34 still trigger `MD038` (“spaces inside code span elements”). Please remove inner padding in affected inline code spans so docs lint stays clean. <details> <summary>🧰 Tools</summary> <details> <summary>🪛 markdownlint-cli2 (0.21.0)</summary> [warning] 33-33: Spaces inside code span elements (MD038, no-space-in-code) --- [warning] 34-34: Spaces inside code span elements (MD038, no-space-in-code) </details> </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md around lines 33 - 34, Remove the extra spaces inside inline code spans that trigger MD038 in .codex-supervisor/issue-journal.md by editing the offending backtick-delimited fragments (e.g., change "`src/backend/supervisor-http-server.test.ts:98 _⚠️ Potential issue_ | _🟡 Minor_ **Assert `why` query propagation, not only payload shape.`" and any other spans containing leading/trailing spaces to use backticks with no inner padding such as "`src/backend/supervisor-http-server.test.ts:98`", and similarly fix "`src/backend/supervisor-http-server.ts:57`" and the regex/code examples like "`^\/api\/issues\/(\d+)\/explain$`" to remove surrounding spaces inside the code spans). ``` </details> <!-- fingerprinting:phantom:triton:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing work for issue #783 was a thin transport adapter, not new supervisor domain logic. A standalone HTTP server over `SupervisorService` should satisfy the MVP without touching CLI behavior.
- What changed: removed the padded inline-code example from the stale CodeRabbit excerpt in `.codex-supervisor/issue-journal.md` so the journal no longer carries the exact `MD038` pattern the review comment pointed at. The HTTP adapter hardening from the prior turn remains unchanged.
- Current blocker: none
- Next exact step: commit the journal-only review fix, push `codex/issue-783`, and resolve the remaining CodeRabbit thread on PR #793 if GitHub still shows it open.
- Verification gap: `markdownlint-cli2` on the whole journal still reports multiple pre-existing journal-formatting rules, so verification for this turn is limited to confirming the specific padded inline-code pattern is gone.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: replacing this adapter with transport-specific domain logic would duplicate `SupervisorService` behavior and undermine the WebUI boundary this issue is meant to establish.
- Last focused command: `npx markdownlint-cli2 .codex-supervisor/issue-journal.md`
- Last focused failure: the remaining review thread pointed at padded inline-code examples in the journal excerpt; the exact `MD038` warning no longer reproduces under the current file, but the stale excerpt still contained the offending pattern.
- Last focused commands:
```bash
npx markdownlint-cli2 .codex-supervisor/issue-journal.md
rg -n '`\s|\s`' .codex-supervisor/issue-journal.md
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Review-fix note: journal verification is intentionally narrow for this turn because the file has many pre-existing markdownlint violations unrelated to the open thread.
- Updated at: 2026-03-21T16:27:05Z
