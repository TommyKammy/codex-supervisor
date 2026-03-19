import assert from "node:assert/strict";
import test from "node:test";
import {
  GitHubIssue,
  SupervisorStateFile,
} from "../core/types";
import {
  buildIssueExplainSummary,
  buildNonRunnableLocalStateReasons,
} from "./supervisor-selection-issue-explain";
import { createConfig, createRecord } from "./supervisor-test-helpers";

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 603,
    title: "Extract issue explain diagnostics",
    body: `## Summary
Preserve issue-explain behavior during helper extraction.

## Scope
- move issue-explain diagnostics into a dedicated helper module

## Acceptance criteria
- explain output remains unchanged

## Verification
- npx tsx --test src/supervisor/supervisor-selection-issue-explain.test.ts

Part of: #600
Depends on: #602
Execution order: 3 of 5
Parallelizable: No`,
    createdAt: "2026-03-19T00:00:00Z",
    updatedAt: "2026-03-19T00:00:00Z",
    url: "https://example.test/issues/603",
    state: "OPEN",
    ...overrides,
  };
}

test("buildIssueExplainSummary keeps non-runnable explain output stable", async () => {
  const config = createConfig({
    maxImplementationAttemptsPerIssue: 5,
    blockedVerificationRetryLimit: 3,
    sameBlockerRepeatLimit: 2,
    sameFailureSignatureRepeatLimit: 3,
  });
  const issue = createIssue();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issue.number)]: createRecord({
        issue_number: issue.number,
        blocked_reason: "verification",
        last_error: "verification still failing",
        attempt_count: 5,
        implementation_attempt_count: 5,
        blocked_verification_retry_count: 3,
        repeated_blocker_count: 2,
        repeated_failure_signature_count: 3,
        last_failure_context: null,
        last_failure_signature: "verification-failure",
      }),
    },
  };

  const lines = await buildIssueExplainSummary(
    {
      getIssue: async () => issue,
      listAllIssues: async () => [issue],
      listCandidateIssues: async () => [issue],
    },
    config,
    state,
    issue.number,
  );

  assert.deepEqual(lines, [
    "issue=#603",
    "title=Extract issue explain diagnostics",
    "state=blocked",
    "blocked_reason=verification",
    "runnable=no",
    "reason_1=retry_budget implementation_attempt_count=5/5",
    "reason_2=retry_budget blocked_verification_retry_count=3/3",
    "reason_3=retry_budget repeated_blocker_count=2/2",
    "reason_4=retry_budget repeated_failure_signature_count=3/3",
    "reason_5=local_state blocked",
    "last_error=verification still failing",
  ]);
});

test("buildNonRunnableLocalStateReasons keeps retry-budget ordering stable", () => {
  const config = createConfig({
    maxImplementationAttemptsPerIssue: 5,
    blockedVerificationRetryLimit: 3,
    sameFailureSignatureRepeatLimit: 3,
  });
  const reasons = buildNonRunnableLocalStateReasons(
    createRecord({
      issue_number: 604,
      blocked_reason: "verification",
      attempt_count: 5,
      implementation_attempt_count: 5,
      blocked_verification_retry_count: config.blockedVerificationRetryLimit,
      repeated_blocker_count: 1,
      repeated_failure_signature_count: config.sameFailureSignatureRepeatLimit,
    }),
    config,
  );

  assert.deepEqual(reasons, [
    "retry_budget implementation_attempt_count=5/5",
    `retry_budget blocked_verification_retry_count=${config.blockedVerificationRetryLimit}/${config.blockedVerificationRetryLimit}`,
    `retry_budget repeated_failure_signature_count=${config.sameFailureSignatureRepeatLimit}/${config.sameFailureSignatureRepeatLimit}`,
    "local_state blocked",
  ]);
});
