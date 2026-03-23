# Issue #873: Operator observability contract: add typed retry, recovery, and phase-change context

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/873
- Branch: codex/issue-873
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: bb8af4e24ae7021f419d82cc5d169a6099d88cf5
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852EV-a
- Repeated failure signature count: 1
- Updated at: 2026-03-23T08:54:44Z

## Latest Codex Summary
Patched the journal renderer in [journal.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-873/src/core/journal.ts) so the rendered `Latest Codex Summary` always uses the live snapshot failure signature instead of preserving a stale footer from the prior Codex turn. Added a focused regression in [journal.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-873/src/journal.test.ts) and updated this tracked journal snapshot to the active review-thread signature.

Summary: Aligned the issue-journal failure-signature footer with the live snapshot state, added focused regression coverage, and updated the tracked journal to the active review-thread signature
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/journal.test.ts`
Failure signature: PRRT_kwDORgvdZ852EV-a
Next action: Commit and push the journal canonicalization fix to PR `#880`, then refresh the unresolved review thread state

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/880#discussion_r2973644268
- Details:
  - .codex-supervisor/issue-journal.md:25 _⚠️ Potential issue_ | _🟡 Minor_ **Resolve conflicting failure-signature state in the same snapshot.** This snapshot reports failing checks (Lines 29-35) and a non-empty last failure signature (Line 12), but also sets `Failure signature: none` (Line 25). Keep one canonical value per snapshot to avoid breaking status consumers and handoff decisions. Also applies to: 29-35 <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md around lines 12 - 25, The snapshot has conflicting failure-signature fields: "Last failure signature", "Repeated failure signature" and the separate "Failure signature" (currently set to "none"); pick and persist a single canonical source-of-truth for failures in .codex-supervisor/issue-journal.md (either populate "Failure signature" from "Last failure signature"/"Repeated failure signature" or clear the latter two) and update all three keys consistently so consumers see one authoritative value; locate and fix the fields named "Last failure signature", "Repeated failure signature", and "Failure signature" in the file to enforce the chosen canonical representation. ``` </details> <!-- fingerprinting:phantom:triton:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the journal writer preserves a stale `Failure signature:` footer from `last_codex_summary` even after supervisor state transitions update `last_failure_signature`, so the rendered snapshot needs to canonicalize that footer to the live signature.
- What changed: updated `src/core/journal.ts` to rewrite the rendered `Latest Codex Summary` failure-signature line from `record.last_failure_signature`, added focused regression coverage in `src/journal.test.ts`, and aligned this tracked journal snapshot/footer to the active review-thread signature.
- Current blocker: none
- Next exact step: commit and push the journal canonicalization fix on `codex/issue-873`, then refresh PR `#880` and resolve the remaining review thread if the diff matches the review intent.
- Verification gap: none for the journal-rendering path; `npx tsx --test src/journal.test.ts` passes on the updated diff.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/core/journal.ts`, `src/journal.test.ts`
- Rollback concern: low; the patch only normalizes the rendered summary footer to the already-canonical `last_failure_signature` field and adds focused coverage.
- Last focused command: `npx tsx --test src/journal.test.ts`
- Last focused failure: the rendered journal snapshot kept `Failure signature: none` inside `Latest Codex Summary` while the live snapshot and active failure context had already advanced to review signature `PRRT_kwDORgvdZ852EV-a`.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-873/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-873/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
gh pr checks 880
gh run view 23427540544 --job 68145650746 --log
node -p "JSON.stringify(require('./package.json').scripts, null, 2)"
npm ci
sed -n '430,500p' src/backend/supervisor-http-server.test.ts
sed -n '740,820p' src/backend/supervisor-http-server.test.ts
sed -n '1,290p' src/supervisor/supervisor-service.test.ts
sed -n '1,220p' src/supervisor/supervisor-operator-activity-context.ts
sed -n '220,420p' src/supervisor/supervisor-operator-activity-context.ts
sed -n '1,180p' src/supervisor/supervisor-service.ts
sed -n '1,160p' src/supervisor/supervisor-status-report.ts
sed -n '1,180p' src/supervisor/supervisor-selection-issue-explain.ts
sed -n '1,180p' src/doctor.ts
apply_patch
npm run build
npx tsx --test src/supervisor/supervisor-service.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/backend/supervisor-http-server.test.ts
git status --short --branch
date -u +%Y-%m-%dT%H:%M:%SZ
rg -n "Failure signature|Last failure signature|Repeated failure signature" .codex-supervisor src README.md docs -g '!node_modules'
nl -ba .codex-supervisor/issue-journal.md | sed -n '1,80p'
git diff -- .codex-supervisor/issue-journal.md
sed -n '240,360p' src/core/journal.ts
rg -n "Latest Codex Summary|Failure signature|Last failure signature|Repeated failure signature count" src/core src/supervisor -g '!node_modules'
sed -n '1,260p' src/journal.test.ts
sed -n '1,140p' src/codex/codex-output-parser.ts
apply_patch
npx tsx --test src/journal.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-23T08:54:44Z: fixed the journal-rendering drift by canonicalizing the rendered summary `Failure signature:` line to `last_failure_signature`, added focused coverage in `src/journal.test.ts`, and updated the tracked journal snapshot to the active review-thread signature.
- 2026-03-23T08:38:54Z: reproduced the failing PR build from the GitHub Actions log, fixed the stale test doubles in `supervisor-http-server.test.ts` and `supervisor-service.test.ts`, and re-passed `npm run build` plus `npx tsx --test src/supervisor/supervisor-service.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/backend/supervisor-http-server.test.ts`.
- 2026-03-23T08:10:30Z: reproduced the missing typed observability contract by tightening the focused service/status/explain tests, then passed the requested verification after extending the shared activity-context DTO with retry counts, repeated stale no-PR recovery metadata, and recovery-derived recent phase changes.
- 2026-03-23T07:22:48Z: validated the CodeRabbit flake note, added a DOM-order `waitForFunction` after the first pointer drag in `src/backend/webui-dashboard-browser-smoke.test.ts`, and re-passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts`.
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
