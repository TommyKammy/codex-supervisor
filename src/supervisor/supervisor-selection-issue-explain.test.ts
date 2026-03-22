import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  GitHubIssue,
  SupervisorStateFile,
} from "../core/types";
import {
  buildIssueExplainDto,
  buildIssueExplainSummary,
  buildNonRunnableLocalStateReasons,
} from "./supervisor-selection-issue-explain";
import { branchName, createConfig, createRecord, createSupervisorFixture } from "./supervisor-test-helpers";

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

test("buildIssueExplainDto exposes typed operator activity context", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 605;
  const journalPath = path.join(fixture.workspaceRoot, "issue-605", ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #605: Typed explain context

## Supervisor Snapshot
- Updated at: 2026-03-22T00:20:00Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Explain should return typed operator-facing issue activity context.
- What changed: Added a focused explain DTO test.
- Current blocker: Waiting on the explain DTO to expose the handoff summary directly.
- Next exact step: Add typed activity context fields on the explain payload.
- Verification gap: Focused explain DTO coverage was missing.
- Files touched: src/supervisor/supervisor-selection-issue-explain.ts
- Rollback concern:
- Last focused command: npx tsx --test src/supervisor/supervisor-selection-issue-explain.test.ts

### Scratchpad
- Keep this section short.
`,
    "utf8",
  );

  const issue = createIssue({
    number: issueNumber,
    title: "Typed explain context",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: journalPath,
        pr_number: 605,
        review_wait_started_at: "2099-01-01T00:00:30.000Z",
        review_wait_head_sha: "head-new-605",
        last_recovery_reason:
          "tracked_pr_head_advanced: resumed issue #605 from blocked to addressing_review after tracked PR #605 advanced from head-old-605 to head-new-605",
        last_recovery_at: "2026-03-22T00:15:00Z",
        blocked_reason: null,
        last_error: null,
      }),
    },
  };
  const config = createConfig({
    reviewBotLogins: ["coderabbitai"],
    workspaceRoot: fixture.workspaceRoot,
    stateFile: fixture.stateFile,
    repoPath: fixture.repoPath,
  });

  const dto = await buildIssueExplainDto(
    {
      getIssue: async () => issue,
      listAllIssues: async () => [issue],
      listCandidateIssues: async () => [issue],
      resolvePullRequestForBranch: async () => ({
        number: 605,
        title: "Typed explain context",
        url: "https://example.test/pull/605",
        state: "OPEN",
        createdAt: "2026-03-22T00:00:00Z",
        updatedAt: "2026-03-22T00:00:00Z",
        isDraft: false,
        reviewDecision: null,
        mergeStateStatus: "CLEAN",
        headRefName: branchName(fixture.config, issueNumber),
        headRefOid: "head-new-605",
        configuredBotDraftSkipAt: "2099-01-01T00:00:00.000Z",
        currentHeadCiGreenAt: "2099-01-01T00:00:30.000Z",
      }),
    },
    config,
    state,
    issueNumber,
  );

  assert.deepEqual(dto.activityContext, {
    handoffSummary:
      "blocker: Waiting on the explain DTO to expose the handoff summary directly. | next: Add typed activity context fields on the explain payload.",
    localReviewRoutingSummary: null,
    changeClassesSummary: null,
    verificationPolicySummary: null,
    durableGuardrailSummary: null,
    externalReviewFollowUpSummary: null,
    latestRecovery: {
      issueNumber,
      at: "2026-03-22T00:15:00Z",
      reason: "tracked_pr_head_advanced",
      detail: "resumed issue #605 from blocked to addressing_review after tracked PR #605 advanced from head-old-605 to head-new-605",
    },
    localReviewSummaryPath: null,
    externalReviewMissesPath: null,
    reviewWaits: [
      {
        kind: "configured_bot_initial_grace_wait",
        status: "active",
        provider: "coderabbit",
        pauseReason: "awaiting_fresh_provider_review_after_draft_skip",
        recentObservation: "ready_for_review_reopened_wait",
        observedAt: "2099-01-01T00:00:30.000Z",
        configuredWaitSeconds: 90,
        waitUntil: "2099-01-01T00:02:00.000Z",
      },
    ],
  });
});
