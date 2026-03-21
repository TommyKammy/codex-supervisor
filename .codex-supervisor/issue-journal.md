# Issue #783: Backend adapter MVP: add a read-only HTTP API over SupervisorService

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/783
- Branch: codex/issue-783
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 4f32a67ea608cb6c836b1defe8a88104daf3b2f5
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8515LOp|PRRT_kwDORgvdZ8515LOv
- Repeated failure signature count: 1
- Updated at: 2026-03-21T16:14:25Z

## Latest Codex Summary
Added a standalone read-only HTTP adapter in [src/backend/supervisor-http-server.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-783/src/backend/supervisor-http-server.ts) that serves `SupervisorService` DTOs as JSON on `GET /api/status`, `GET /api/doctor`, `GET /api/issues/:issueNumber/explain`, and `GET /api/issues/:issueNumber/issue-lint`, with minimal JSON `400/404/405` handling. The focused reproducer and regression coverage are in [src/backend/supervisor-http-server.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-783/src/backend/supervisor-http-server.test.ts).

I committed and pushed the work on `codex/issue-783`, updated the journal, and opened draft PR `#793`: https://github.com/TommyKammy/codex-supervisor/pull/793. The only remaining local dirt is the pre-existing untracked `.codex-supervisor/replay/` directory, which I left untouched.

Summary: Added a read-only HTTP JSON adapter over `SupervisorService`, verified it with a focused endpoint test, pushed `codex/issue-783`, and opened draft PR #793.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/backend/supervisor-http-server.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor draft PR #793 for CI/review feedback and follow up on any transport-wiring work needed by the WebUI backend startup path

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/793#discussion_r2969750451
- Details:
  - src/backend/supervisor-http-server.test.ts:98 _⚠️ Potential issue_ | _🟡 Minor_ **Assert `why` query propagation, not only payload shape.** The current stubbed `queryStatus` ignores input, so this test can pass even if `/api/status?why=true` is not wired correctly. <details> <summary>💡 Suggested test hardening</summary> ```diff function createStubService(): SupervisorService { + let lastWhyArg: boolean | null = null; const doctorDiagnostics: DoctorDiagnostics = { @@ - queryStatus: async () => ({ + queryStatus: async ({ why }) => { + lastWhyArg = why; + return { gsdSummary: null, @@ whyLines: ["selected_issue=none"], warning: null, - }), + }; + }, @@ }; } @@ const statusResponse = await readJson({ server, path: "/api/status?why=true" }); assert.equal(statusResponse.statusCode, 200); + assert.equal(lastWhyArg, true); ``` </details> Also applies to: 157-179 <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/backend/supervisor-http-server.test.ts` around lines 78 - 98, The stubbed queryStatus in the test currently ignores incoming query parameters so the test won't fail if the server doesn't wire `/api/status?why=true`; update the test's stub for queryStatus to inspect its input and assert or react to the `why` flag (e.g., check the presence/value of params.why or options.why) so that calling the server with `?why=true` triggers a different stubbed response or an assertion failure; specifically modify the test's queryStatus stub used in supervisor-http-server.test.ts (the async queryStatus function) to validate the incoming request object and return different payloads (or throw) when `why` is missing/false, and apply the same change for the other stub at the second occurrence noted (lines referenced 157-179) so both tests verify propagation of the `why` query parameter. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/backend/supervisor-http-server.ts:57 _⚠️ Potential issue_ | _🟡 Minor_ **`0` is currently accepted despite “positive integer” contract.** `/api/issues/0/explain` and `/api/issues/0/issue-lint` match `(\d+)` and bypass the 400 branch, which contradicts the error contract. <details> <summary>✅ Tighten route validation</summary> ```diff - const explainMatch = pathname.match(/^\/api\/issues\/(\d+)\/explain$/u); + const explainMatch = pathname.match(/^\/api\/issues\/([1-9]\d*)\/explain$/u); @@ - const issueLintMatch = pathname.match(/^\/api\/issues\/(\d+)\/issue-lint$/u); + const issueLintMatch = pathname.match(/^\/api\/issues\/([1-9]\d*)\/issue-lint$/u); ``` </details> Also applies to: 61-64 <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/backend/supervisor-http-server.ts` around lines 49 - 57, The route regexes currently accept "0" because they use (\d+); update validation so issue IDs must be positive integers (reject zero) by changing the two regexes (explainMatch and issueLintMatch) from /^\/api\/issues\/(\d+)\/...$/u to /^\/api\/issues\/([1-9]\d*)\/...$/u (and similarly update the other occurrences around lines 61-64), or alternatively after matching call Number.parseInt(...) and if parsedId <= 0 return a 400 via writeJson; ensure the handlers for service.queryExplain and service.queryIssueLint only run for parsedId > 0. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing work for issue #783 was a thin transport adapter, not new supervisor domain logic. A standalone HTTP server over `SupervisorService` should satisfy the MVP without touching CLI behavior.
- What changed: tightened `src/backend/supervisor-http-server.ts` so issue-number routes only match positive integers, which restores the documented `400` behavior for `/api/issues/0/explain` and `/api/issues/0/issue-lint`. Strengthened `src/backend/supervisor-http-server.test.ts` so the stub service records the `why` flag passed to `queryStatus`, returns `whyLines` only when `why` is true, and asserts invalid issue IDs do not reach `queryExplain` or `queryIssueLint`.
- Current blocker: none
- Next exact step: push the review-fix commit to PR #793, then monitor CI and resolve the addressed review threads.
- Verification gap: this turn covered the changed HTTP adapter behavior with focused endpoint assertions plus a full build; broader runtime wiring for starting the HTTP server remains out of scope for this slice.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.test.ts`, `src/backend/supervisor-http-server.ts`
- Rollback concern: replacing this adapter with transport-specific domain logic would duplicate `SupervisorService` behavior and undermine the WebUI boundary this issue is meant to establish.
- Last focused command: `npm run build`
- Last focused failure: CodeRabbit found two local gaps after the initial transport landed: the endpoint test did not prove `why=true` propagation, and the route regex accepted issue number `0` despite the positive-integer contract.
- Last focused commands:
```bash
npx tsx --test src/backend/supervisor-http-server.test.ts
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Review-fix note: `/api/status?why=true` is now asserted via the stub call arguments, and `/api/issues/0/*` is covered as a `400` path that does not invoke service methods.
- Updated at: 2026-03-21T16:14:25Z
