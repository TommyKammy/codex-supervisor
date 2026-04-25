import assert from "node:assert/strict";
import test from "node:test";
import {
  GitHubIssue,
  SupervisorStateFile,
} from "../core/types";
import {
  buildReadinessSummary,
  buildSelectionWhySummary,
} from "./supervisor-selection-readiness-summary";
import { createConfig, createRecord } from "./supervisor-test-helpers";

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 604,
    title: "Extract readiness summary helpers",
    body: `## Summary
Preserve readiness and selection-why summary output.

## Scope
- move readiness summary helpers into a dedicated module

## Acceptance criteria
- direct summary output remains stable

## Verification
- npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts`,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/604",
    state: "OPEN",
    labels: [],
    ...overrides,
  };
}

test("buildReadinessSummary keeps runnable and blocked formatting stable", async () => {
  const config = createConfig({
    skipTitlePrefixes: ["Done:"],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
      }),
      "92": createRecord({
        issue_number: 92,
        state: "queued",
        attempt_count: 1,
        implementation_attempt_count: 1,
      }),
    },
  };
  const runnableIssue = createIssue({
    number: 92,
    title: "Execution order ready",
    body: `## Summary
Ready after its dependency and predecessor complete.

## Scope
- build on the finished predecessor

## Acceptance criteria
- scheduler can run this issue now

## Verification
- npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts

Depends on: #91
Part of: #600
Execution order: 2 of 2`,
  });
  const predecessorIssue = createIssue({
    number: 91,
    title: "Done: Step 1",
    body: `## Summary
Ship the first step.

## Scope
- complete the first execution-order step

## Acceptance criteria
- step one lands before step two

## Verification
- npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts

Part of: #600
Execution order: 1 of 2`,
    state: "CLOSED",
  });
  const missingMetadataIssue = createIssue({
    number: 93,
    title: "Missing readiness sections",
    body: `## Summary
This issue is not execution-ready.`,
  });
  const clarificationBlockedIssue = createIssue({
    number: 94,
    title: "Choose auth approach",
    body: `## Summary
Choose whether to keep the production auth path or replace it before rollout.

## Scope
- choose the production authentication path

## Acceptance criteria
- the operator confirms which auth flow should ship

## Verification
- npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts`,
  });

  const summary = await buildReadinessSummary(
    {
      listCandidateIssues: async () => [runnableIssue, missingMetadataIssue, clarificationBlockedIssue],
      listAllIssues: async () => [predecessorIssue, runnableIssue, missingMetadataIssue, clarificationBlockedIssue],
    },
    config,
    state,
  );

  assert.deepEqual(summary, {
    runnableIssues: [
      {
        issueNumber: 92,
        title: "Execution order ready",
        readiness: "execution_ready+depends_on_satisfied:91+execution_order_satisfied:91",
      },
    ],
    blockedIssues: [
      {
        issueNumber: 93,
        title: "Missing readiness sections",
        blockedBy: "requirements:scope, acceptance criteria, verification",
      },
      {
        issueNumber: 94,
        title: "Choose auth approach",
        blockedBy: "clarification:unresolved_choice:auth",
      },
    ],
    readinessLines: [
      "runnable_issues=#92 ready=execution_ready+depends_on_satisfied:91+execution_order_satisfied:91",
      "blocked_issues=#93 blocked_by=requirements:scope, acceptance criteria, verification; #94 blocked_by=clarification:unresolved_choice:auth",
    ],
  });
});

test("buildReadinessSummary emits degraded selection_reason without a snapshot", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
    inventory_refresh_failure: {
      source: "gh issue list",
      message: "Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1",
      recorded_at: "2026-03-26T00:10:00Z",
    },
  };

  const summary = await buildReadinessSummary(
    {
      listCandidateIssues: async () => {
        throw new Error("unexpected listCandidateIssues call");
      },
      listAllIssues: async () => {
        throw new Error("unexpected listAllIssues call");
      },
    },
    config,
    state,
  );

  assert.deepEqual(summary, {
    runnableIssues: [],
    blockedIssues: [],
    readinessLines: [
      "inventory_refresh=degraded source=gh issue list recorded_at=2026-03-26T00:10:00Z message=Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1",
      "selection_reason=inventory_refresh_degraded",
    ],
  });
});

test("buildReadinessSummary emits degraded selection_reason once with snapshot-backed readiness", async () => {
  const config = createConfig();
  const snapshotIssue = createIssue();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
    inventory_refresh_failure: {
      source: "gh issue list",
      message: "Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1",
      recorded_at: "2026-03-26T00:10:00Z",
    },
    last_successful_inventory_snapshot: {
      source: "gh issue list",
      recorded_at: "2026-03-26T00:05:00Z",
      issue_count: 1,
      issues: [snapshotIssue],
    },
  };

  const summary = await buildReadinessSummary(
    {
      listCandidateIssues: async () => {
        throw new Error("unexpected listCandidateIssues call");
      },
      listAllIssues: async () => {
        throw new Error("unexpected listAllIssues call");
      },
    },
    config,
    state,
  );

  assert.deepEqual(summary, {
    runnableIssues: [{
      issueNumber: 604,
      title: "Extract readiness summary helpers",
      readiness: "execution_ready",
    }],
    blockedIssues: [],
    readinessLines: [
      "inventory_refresh=degraded source=gh issue list recorded_at=2026-03-26T00:10:00Z message=Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1",
      "selection_reason=inventory_refresh_degraded",
      "inventory_snapshot=last_known_good source=gh issue list recorded_at=2026-03-26T00:05:00Z issue_count=1 authority=non_authoritative",
      "runnable_issues=#604 ready=execution_ready",
      "blocked_issues=none",
    ],
  });
});

test("buildSelectionWhySummary keeps the selected issue explanation stable", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
      }),
      "92": createRecord({
        issue_number: 92,
        state: "done",
      }),
      "95": createRecord({
        issue_number: 95,
        state: "blocked",
        blocked_reason: "verification",
        last_error: "verification still failing",
        blocked_verification_retry_count: 1,
        repeated_blocker_count: config.sameBlockerRepeatLimit,
      }),
    },
  };
  const blockedIssue = createIssue({
    number: 95,
    title: "Blocked verification retry",
  });
  const predecessorOne = createIssue({
    number: 91,
    title: "Step 1",
    body: `## Summary
Ship the first step.

## Scope
- start the execution order chain

## Acceptance criteria
- step one lands first

## Verification
- npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts

Part of: #150
Execution order: 1 of 3`,
    state: "CLOSED",
  });
  const predecessorTwo = createIssue({
    number: 92,
    title: "Step 2",
    body: `## Summary
Ship the second step.

## Scope
- continue the execution order chain

## Acceptance criteria
- step two lands after step one

## Verification
- npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts

Part of: #150
Execution order: 2 of 3`,
    state: "CLOSED",
  });
  const selectedIssue = createIssue({
    number: 96,
    title: "Step 3",
    body: `## Summary
Ship the third step.

## Scope
- finish the execution order chain

## Acceptance criteria
- step three lands after the first two steps

## Verification
- npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts

Depends on: #91, #92
Part of: #150
Execution order: 3 of 3`,
  });

  const lines = await buildSelectionWhySummary(
    {
      listCandidateIssues: async () => [blockedIssue, selectedIssue],
      listAllIssues: async () => [blockedIssue, predecessorOne, predecessorTwo, selectedIssue],
    },
    config,
    state,
  );

  assert.deepEqual(lines, [
    "selected_issue=#96",
    "selection_reason=ready execution_ready=yes depends_on=91|92:done execution_order=150/3 predecessors=91|92:done retry_state=fresh",
  ]);
});

test("buildReadinessSummary and buildSelectionWhySummary distinguish blocked preserved partial work from an empty backlog", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "145": createRecord({
        issue_number: 145,
        state: "blocked",
        blocked_reason: "manual_review",
        updated_at: "2026-04-12T00:10:00Z",
        last_failure_context: {
          category: "manual",
          summary: "Issue #145 needs manual review because the preserved workspace contains partial work.",
          signature: "manual-review-preserved-partial-work",
          command: null,
          details: [
            "preserved_partial_work=yes",
            "tracked_files=feature.txt|src/workflow.ts",
          ],
          url: "https://example.test/issues/145",
          updated_at: "2026-04-12T00:10:00Z",
        },
      }),
    },
  };
  const blockedIssue = createIssue({
    number: 145,
    title: "Manual review for preserved partial work",
    body: `## Summary
Hold the preserved workspace for manual review.

## Scope
- keep the preserved worktree available for operator inspection

## Acceptance criteria
- selection output stays explicit about the manual-review hold

## Verification
- npm test -- src/supervisor/supervisor-selection-readiness-summary.test.ts`,
  });

  const readinessSummary = await buildReadinessSummary(
    {
      listCandidateIssues: async () => [blockedIssue],
      listAllIssues: async () => [blockedIssue],
    },
    config,
    state,
  );

  assert.deepEqual(readinessSummary, {
    runnableIssues: [],
    blockedIssues: [
      {
        issueNumber: 145,
        title: "Manual review for preserved partial work",
        blockedBy: "local_state:blocked",
      },
    ],
    readinessLines: [
      "runnable_issues=none",
      "blocked_issues=#145 blocked_by=local_state:blocked",
      "blocked_partial_work issue=#145 blocked_reason=manual_review partial_work=preserved tracked_files=feature.txt|src/workflow.ts",
    ],
  });

  const whyLines = await buildSelectionWhySummary(
    {
      listCandidateIssues: async () => [blockedIssue],
      listAllIssues: async () => [blockedIssue],
    },
    config,
    state,
  );

  assert.deepEqual(whyLines, [
    "selected_issue=none",
    "selection_reason=blocked_partial_work_manual_review issue=#145",
    "blocked_partial_work issue=#145 blocked_reason=manual_review partial_work=preserved tracked_files=feature.txt|src/workflow.ts",
  ]);
});

test("buildReadinessSummary keeps merged PR convergence events scoped to idle queues", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "240": createRecord({
        issue_number: 240,
        state: "done",
        last_recovery_reason: "merged_pr_convergence: tracked PR #340 merged; marked issue #240 done",
        last_recovery_at: "2026-04-25T00:20:00Z",
      }),
    },
  };
  const blockedIssue = createIssue({
    number: 241,
    title: "Missing execution metadata",
    body: `## Summary
This candidate is intentionally not execution-ready.`,
  });

  const summary = await buildReadinessSummary(
    {
      listCandidateIssues: async () => [blockedIssue],
      listAllIssues: async () => [blockedIssue],
    },
    config,
    state,
  );

  assert.deepEqual(summary, {
    runnableIssues: [],
    blockedIssues: [
      {
        issueNumber: 241,
        title: "Missing execution metadata",
        blockedBy: "requirements:scope, acceptance criteria, verification",
      },
    ],
    readinessLines: [
      "runnable_issues=none",
      "blocked_issues=#241 blocked_by=requirements:scope, acceptance criteria, verification",
    ],
  });
});

test("buildReadinessSummary keeps downstream siblings blocked while predecessor final evaluation is unresolved", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
        local_review_head_sha: "head-91",
        pre_merge_evaluation_outcome: null,
      }),
    },
  };
  const predecessorIssue = createIssue({
    number: 91,
    title: "Step 1",
    body: `## Summary
Ship the first step.

## Scope
- finish the predecessor implementation

## Acceptance criteria
- step one lands before step two

## Verification
- npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts

Part of: #610
Execution order: 1 of 2`,
    state: "CLOSED",
  });
  const blockedIssue = createIssue({
    number: 92,
    title: "Step 2",
    body: `## Summary
Wait for step one final evaluation to resolve.

## Scope
- continue after the predecessor fully clears

## Acceptance criteria
- scheduler keeps this blocked until step one final evaluation resolves

## Verification
- npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts

Part of: #610
Execution order: 2 of 2`,
  });

  const summary = await buildReadinessSummary(
    {
      listCandidateIssues: async () => [blockedIssue],
      listAllIssues: async () => [predecessorIssue, blockedIssue],
    },
    config,
    state,
  );

  assert.deepEqual(summary, {
    runnableIssues: [],
    blockedIssues: [
      {
        issueNumber: 92,
        title: "Step 2",
        blockedBy: "execution order requires #91 first",
      },
    ],
    readinessLines: [
      "runnable_issues=none",
      "blocked_issues=#92 blocked_by=execution order requires #91 first",
    ],
  });
});
