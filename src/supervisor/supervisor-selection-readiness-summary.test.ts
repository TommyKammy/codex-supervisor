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
