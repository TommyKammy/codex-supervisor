import assert from "node:assert/strict";
import test from "node:test";
import {
  GitHubIssue,
  PullRequestCheck,
  ReviewThread,
  SupervisorStateFile,
} from "../core/types";
import {
  buildReadinessSummary,
  buildSelectionWhySummary,
} from "./supervisor-selection-readiness-summary";
import { createConfig, createPullRequest, createRecord } from "./supervisor-test-helpers";
import { STILL_VALID_REVIEW_THREAD_REPAIR_TARGET } from "../codex-connector-valid-review-repair";
import {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
} from "../codex-connector-tracked-pr-test-helpers";

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

test("buildReadinessSummary shares the Codex Connector request recovery override with selection", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const issueNumber = 2072;
  const prNumber = 177;
  const branch = "codex/issue-2072";
  const currentHead = "ad2a7f2d9c62f52f190d42884f1844c5b5da2072";
  const staleReviewHead = "1bd7511632c6db5bf1f1bbe91f0b5c4cebad1770";
  const issue = createIssue({
    number: issueNumber,
    title: "Codex Connector request eligible manual review recovery",
    body: `## Summary
Request current-head Codex review when stale manual review residue is request eligible.

## Scope
- keep readiness and selection diagnostics consistent

Depends on: none
Parallelizable: No

## Execution order
1 of 1

## Acceptance criteria
- the issue is not reported as both selected and blocked

## Verification
- npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts`,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        pr_number: prNumber,
        blocked_reason: "manual_review",
        last_head_sha: currentHead,
        review_wait_started_at: "2026-05-22T00:00:00Z",
        review_wait_head_sha: currentHead,
        provider_success_head_sha: staleReviewHead,
        provider_success_observed_at: "2026-05-21T23:50:00Z",
        copilot_review_timed_out_at: "2026-05-22T00:10:00.000Z",
        copilot_review_timeout_action: "request_review_comment",
        codex_connector_review_requested_observed_at: null,
        codex_connector_review_requested_head_sha: null,
      }),
    },
  };
  const pr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: currentHead,
    isDraft: false,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    currentHeadCiGreenAt: "2026-05-22T00:00:00Z",
    configuredBotLatestReviewedCommitSha: staleReviewHead,
    configuredBotCurrentHeadObservedAt: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
  });
  const github = {
    listCandidateIssues: async () => [issue],
    listAllIssues: async () => [issue],
    getPullRequestIfExists: async () => pr,
    getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const readinessSummary = await buildReadinessSummary(github, config, state);

  assert.deepEqual(readinessSummary.blockedIssues, []);
  assert.deepEqual(readinessSummary.runnableIssues, [
    {
      issueNumber,
      title: "Codex Connector request eligible manual review recovery",
      readiness: "execution_ready",
    },
  ]);
  assert.deepEqual(readinessSummary.readinessLines, [
    "runnable_issues=#2072 ready=execution_ready",
    "blocked_issues=none",
  ]);

  const whyLines = await buildSelectionWhySummary(github, config, state);

  assert.match(whyLines.join("\n"), /^selected_issue=#2072$/m);
  assert.doesNotMatch(readinessSummary.readinessLines.join("\n"), /^blocked_issues=#2072 blocked_by=local_state:blocked$/m);
});

test("buildReadinessSummary selects still-valid Codex review repair target after retry exhaustion", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
  });
  const issueNumber = 2385;
  const prNumber = 45;
  const branch = "codex/issue-2385";
  const currentHead = "190f9fd34d4ffc4534c1927e91c7a53ae17535d5";
  const issue = createIssue({
    number: issueNumber,
    title: "Continue repair when unresolved Codex threads are still substantively valid",
    body: `## Summary
Continue repair for a still-valid unresolved Codex Connector thread.

## Scope
- route failed thread-scoped probes back into review repair

Depends on: none
Parallelizable: No

## Execution order
1 of 1

## Acceptance criteria
- the tracked PR is selected for another focused repair pass

## Verification
- npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts`,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        pr_number: prNumber,
        blocked_reason: "manual_review",
        last_head_sha: currentHead,
        processed_review_thread_ids: [`thread-query-code@${currentHead}`],
        processed_review_thread_fingerprints: [`thread-query-code@${currentHead}#comment-query-code`],
        review_loop_retry_state: [
          {
            fingerprint: `pr=${prNumber}|head=${currentHead}|thread=thread-query-code|comment=comment-query-code`,
            pr_number: prNumber,
            head_sha: currentHead,
            thread_id: "thread-query-code",
            latest_comment_fingerprint: "comment-query-code",
            attempts: 1,
            first_attempted_at: "2026-06-22T21:00:00Z",
            last_attempted_at: "2026-06-22T21:00:00Z",
          },
        ],
        timeline_artifacts: [
          {
            type: "verification_result",
            gate: "codex_turn",
            command: "python -m pytest tests/test_llm_conversion_plan.py -k query_code",
            head_sha: currentHead,
            outcome: "failed",
            remediation_target: null,
            next_action: "repair still-valid review thread",
            summary: "query_params code probe still leaks.",
            recorded_at: "2026-06-22T21:05:00Z",
            repair_targets: [STILL_VALID_REVIEW_THREAD_REPAIR_TARGET],
            processed_review_thread_ids: [`thread-query-code@${currentHead}`],
            processed_review_thread_fingerprints: [`thread-query-code@${currentHead}#comment-query-code`],
          },
        ],
      }),
    },
  };
  const pr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: currentHead,
    isDraft: false,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    currentHeadCiGreenAt: "2026-06-22T20:40:44Z",
    configuredBotCurrentHeadObservedAt: "2026-06-22T20:53:59Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
    configuredBotLatestReviewedCommitSha: currentHead,
  });
  const reviewThreads: ReviewThread[] = [
    {
      id: "thread-query-code",
      isResolved: false,
      isOutdated: false,
      path: "core/llm/conversion_plan.py",
      line: 699,
      comments: {
        nodes: [
          {
            id: "comment-query-code",
            body: "P2: Redact query-only credential names such as ?key=... or ?code=...",
            createdAt: "2026-06-22T20:50:00Z",
            url: "https://example.test/pr/45#discussion_r3455261710",
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    },
  ];
  const github = {
    pr,
    reviewThreads,
    checks: [] as PullRequestCheck[],
    listCandidateIssues: async () => [issue],
    listAllIssues: async () => [issue],
    getPullRequestIfExists: async function(this: { pr: typeof pr }, prNumber: number) {
      assert.equal(this.pr.number, prNumber);
      return this.pr;
    },
    getChecks: async function(this: { checks: PullRequestCheck[] }) {
      return this.checks;
    },
    getUnresolvedReviewThreads: async function(this: { reviewThreads: ReviewThread[] }) {
      return this.reviewThreads;
    },
  };

  const readinessSummary = await buildReadinessSummary(github, config, state);
  const whyLines = await buildSelectionWhySummary(github, config, state);

  assert.deepEqual(readinessSummary.blockedIssues, []);
  assert.deepEqual(readinessSummary.runnableIssues, [
    {
      issueNumber,
      title: "Continue repair when unresolved Codex threads are still substantively valid",
      readiness: "execution_ready",
    },
  ]);
  assert.match(whyLines.join("\n"), /^selected_issue=#2385$/m);
});

test("buildReadinessSummary selects verified manual-review residue for auto-resolve", async () => {
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const issueNumber = 2401;
  const prNumber = 174;
  const headSha = "68401b26947918f0ce2280a9526ab68298b1a25c";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_verified_residue",
    commentId: "comment-verified-residue",
    path: "src/writeback-ingest.ts",
    line: 42,
    commentBody: "P2: Update the published writeback response schema.",
    discussionUrl: "https://example.test/pr/174#discussion_r2401",
    verifiedRepair: {
      summary: "verify-pre-pr passed with 96 tests.",
      ranAt: "2026-05-18T07:18:00Z",
      command: "npm run verify:pre-pr",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-18T07:12:00Z",
      observedAt: "2026-05-18T07:17:00Z",
    },
  });
  const issue = createIssue({
    number: issueNumber,
    title: "Auto-resolve verified manual-review residue",
    body: `## Summary
Resolve verified stale Codex review residue after manual review fallthrough.

## Scope
- route verified manual-review residue into auto-resolution

Depends on: none
Parallelizable: No

## Execution order
1 of 1

## Acceptance criteria
- verified residue is selected instead of reported as no runnable issue

## Verification
- npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts`,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        ...scenario.recordPatch,
        state: "blocked",
        blocked_reason: "manual_review",
      }),
    },
  };
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  });
  const github = {
    listCandidateIssues: async () => [issue],
    listAllIssues: async () => [issue],
    getPullRequestIfExists: async () => pr,
    getChecks: async () => scenario.passingChecks,
    getUnresolvedReviewThreads: async () => [scenario.reviewThread],
  };

  const readinessSummary = await buildReadinessSummary(github, config, state);
  const whyLines = await buildSelectionWhySummary(github, config, state);

  assert.deepEqual(readinessSummary.blockedIssues, []);
  assert.deepEqual(readinessSummary.runnableIssues, [
    {
      issueNumber,
      title: "Auto-resolve verified manual-review residue",
      readiness: "execution_ready",
    },
  ]);
  assert.match(whyLines.join("\n"), /^selected_issue=#2401$/m);
  assert.doesNotMatch(whyLines.join("\n"), /^selected_issue=none$/m);
});

test("buildReadinessSummary selects stale review-commit residue recovery without timeout metadata", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const issueNumber = 2199;
  const prNumber = 2200;
  const branch = "codex/issue-2199";
  const currentHead = "7d2a6e42f0a28a176463bda1c2cff4001e6aeb5a";
  const staleReviewHead = "707f0eb2b95722c1c60bc3773a17a272957d775c";
  const issue = createIssue({
    number: issueNumber,
    title: "Recover stale Codex review residue",
    body: `## Summary
Request current-head Codex review for stale review-commit residue.

## Scope
- keep recovery selectable before timeout metadata is recorded

Depends on: none
Parallelizable: No

## Execution order
1 of 1

## Acceptance criteria
- stale review residue can re-enter the request lane

## Verification
- npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts`,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        pr_number: prNumber,
        blocked_reason: "manual_review",
        last_head_sha: currentHead,
        review_wait_started_at: "2026-05-26T22:00:00Z",
        review_wait_head_sha: currentHead,
        codex_connector_review_requested_observed_at: null,
        codex_connector_review_requested_head_sha: null,
      }),
    },
  };
  const pr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: currentHead,
    isDraft: false,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    currentHeadCiGreenAt: "2026-05-26T22:00:00Z",
    configuredBotLatestReviewedCommitSha: staleReviewHead,
    configuredBotCurrentHeadObservedAt: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
  });
  const reviewThreads: ReviewThread[] = [
    {
      id: "thread-stale-review-commit",
      isResolved: false,
      isOutdated: false,
      path: "src/codex-connector-review-request-decision.ts",
      line: 284,
      comments: {
        nodes: [
          {
            id: "comment-stale-review-commit",
            body: "P1: Verify the repair on the current head.",
            createdAt: "2026-05-26T21:55:00Z",
            url: `https://example.test/pr/${prNumber}#discussion_r2199`,
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    },
  ];
  const github = {
    listCandidateIssues: async () => [issue],
    listAllIssues: async () => [issue],
    getPullRequestIfExists: async () => pr,
    getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => reviewThreads,
  };

  const readinessSummary = await buildReadinessSummary(github, config, state);
  const whyLines = await buildSelectionWhySummary(github, config, state);

  assert.deepEqual(readinessSummary.blockedIssues, []);
  assert.deepEqual(readinessSummary.runnableIssues, [
    {
      issueNumber,
      title: "Recover stale Codex review residue",
      readiness: "execution_ready",
    },
  ]);
  assert.match(whyLines.join("\n"), /^selected_issue=#2199$/m);
});

test("buildReadinessSummary keeps manual-review recovery blocked when GitHub recovery data fails", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const issueNumber = 2072;
  const issue = createIssue({
    number: issueNumber,
    title: "Codex Connector request fetch failure",
    body: `## Summary
Keep recovery fail-closed when GitHub status data cannot be loaded.

## Scope
- avoid selecting uncertain recovery states

Depends on: none
Parallelizable: No

## Execution order
1 of 1

## Acceptance criteria
- the issue remains locally blocked

## Verification
- npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts`,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: "codex/issue-2072",
        pr_number: 177,
        blocked_reason: "manual_review",
        copilot_review_timed_out_at: "2026-05-22T00:10:00.000Z",
        copilot_review_timeout_action: "request_review_comment",
      }),
    },
  };
  const github = {
    listCandidateIssues: async () => [issue],
    listAllIssues: async () => [issue],
    getPullRequestIfExists: async () => {
      throw new Error("GitHub PR fetch failed");
    },
    getChecks: async () => {
      throw new Error("unexpected getChecks call");
    },
    getUnresolvedReviewThreads: async () => {
      throw new Error("unexpected getUnresolvedReviewThreads call");
    },
  };

  const readinessSummary = await buildReadinessSummary(github, config, state);
  const whyLines = await buildSelectionWhySummary(github, config, state);

  assert.deepEqual(readinessSummary.runnableIssues, []);
  assert.deepEqual(readinessSummary.blockedIssues, [
    {
      issueNumber,
      title: "Codex Connector request fetch failure",
      blockedBy: "local_state:blocked",
    },
  ]);
  assert.deepEqual(whyLines, [
    "selected_issue=none",
    "selection_reason=no_runnable_issue",
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
