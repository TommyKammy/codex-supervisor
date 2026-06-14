import assert from "node:assert/strict";
import test from "node:test";
import type { GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig } from "../core/types";
import { buildDecisionKernelV2ExplainDto, renderDecisionKernelV2ExplainDto } from "./v2-explain";

function record(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 2301,
    state: "pr_open",
    branch: "codex/issue-2301",
    pr_number: 2306,
    workspace: "/tmp/workspace",
    journal_path: null,
    review_wait_started_at: null,
    review_wait_head_sha: null,
    copilot_review_requested_observed_at: null,
    copilot_review_requested_head_sha: null,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    codex_session_id: null,
    local_review_head_sha: null,
    local_review_blocker_summary: null,
    local_review_summary_path: null,
    local_review_run_at: null,
    local_review_max_severity: null,
    local_review_findings_count: 0,
    last_head_sha: "head-current",
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    timeout_retry_count: 0,
    blocked_reason: null,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    last_blocker_signature: null,
    last_failure_signature: null,
    updated_at: "2026-06-08T00:00:00.000Z",
    ...overrides,
  } as IssueRunRecord;
}

function pullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 2306,
    title: "PR",
    url: "https://example.test/pull/2306",
    state: "OPEN",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:01:00.000Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "codex/issue-2301",
    headRefOid: "head-current",
    configuredBotCurrentHeadObservedAt: "2026-06-08T00:02:00.000Z",
    configuredBotLatestReviewedCommitSha: "head-stale",
    currentHeadCiGreenAt: "2026-06-08T00:03:00.000Z",
    ...overrides,
  };
}

function codexConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredReviewProviders: [{ kind: "codex", reviewerLogins: ["chatgpt-codex-connector"], signalSource: "review_threads" }],
    localCiCommand: undefined,
    ...overrides,
  } as unknown as SupervisorConfig;
}

function codexMustFixThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "thread-codex-p2",
    isResolved: false,
    isOutdated: false,
    path: "src/decision-kernel/v2-explain.ts",
    line: 231,
    comments: {
      nodes: [
        {
          id: "comment-codex-p2",
          body: "![P2 Badge](https://img.shields.io/badge/P2-yellow) Current-head review evidence should be requested first.",
          createdAt: "2026-06-08T00:04:00.000Z",
          url: "https://example.test/comment",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
    ...overrides,
  };
}

function codexSoftenedP3Thread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return codexMustFixThread({
    id: "thread-codex-p3",
    comments: {
      nodes: [
        {
          id: "comment-codex-p3",
          body: "![P3 Badge](https://img.shields.io/badge/P3-blue) Cosmetic note only.",
          createdAt: "2026-06-08T00:04:00.000Z",
          url: "https://example.test/comment-p3",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
    ...overrides,
  });
}

function manualThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "thread-human",
    isResolved: false,
    isOutdated: false,
    path: "src/decision-kernel/v2-explain.ts",
    line: 300,
    comments: {
      nodes: [
        {
          id: "comment-human",
          body: "Please take another look.",
          createdAt: "2026-06-08T00:04:00.000Z",
          url: "https://example.test/comment-human",
          author: {
            login: "maintainer",
            typeName: "User",
          },
        },
      ],
    },
    ...overrides,
  };
}

test("buildDecisionKernelV2ExplainDto uses PR head for current-head review observations", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig(),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest(),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.inventory?.pullRequest?.currentHeadReviewHeadSha, "head-current");
  assert.equal(dto.decision?.normalizedState.reviewPosture, "current_head_review_observed");
  assert.equal(dto.decision?.action, "merge");
  assert.equal(dto.comparison?.current.state, "ready_to_merge");
  assert.equal(dto.comparison?.current.actionEquivalent, "no_action");
  assert.equal(dto.comparison?.category, "manual_review_required");
  assert.deepEqual(dto.comparison?.differences, [
    {
      field: "action",
      current: "no_action",
      v2: "merge",
    },
  ]);
});

test("renderDecisionKernelV2ExplainDto surfaces core action routing without granting mutation authority", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig(),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest(),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  const rendered = renderDecisionKernelV2ExplainDto(dto);

  assert.match(
    rendered,
    /^v2_routing action=merge routing_category=core_action mutation_authority=none external_handoff=prepare_evidence core_safety_gates=preserved$/m,
  );
});

test("renderDecisionKernelV2ExplainDto surfaces operator-action routing for manual gates", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({ localCiCommand: "npm run verify:pre-pr" }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest(),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  const rendered = renderDecisionKernelV2ExplainDto(dto);

  assert.match(
    rendered,
    /^v2_routing action=ask_operator routing_category=operator_action mutation_authority=none external_handoff=prepare_evidence core_safety_gates=preserved$/m,
  );
});

test("buildDecisionKernelV2ExplainDto ignores malformed current-head review timestamps", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig(),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest({
      configuredBotCurrentHeadObservedAt: "not-a-date",
      configuredBotLatestReviewedCommitSha: "head-current",
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.inventory?.pullRequest?.currentHeadReviewObservedAt, null);
  assert.equal(dto.inventory?.pullRequest?.currentHeadReviewHeadSha, null);
  assert.equal(dto.decision?.normalizedState.reviewPosture, "missing_current_head_review");
  assert.equal(dto.decision?.action, "request_review");
  assert.equal(dto.comparison?.category, "manual_review_required");
  assert.deepEqual(dto.comparison?.differences.map((difference) => difference.field), ["action", "reason"]);
});

test("buildDecisionKernelV2ExplainDto compares merge as agreement only when auto-merge is configured", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({
      reviewBotLogins: ["coderabbitai"],
      configuredReviewProviders: [{ kind: "coderabbit", reviewerLogins: ["coderabbitai"], signalSource: "review_threads" }],
    }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest({ configuredBotCurrentHeadObservationSource: "review_thread" }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.decision?.action, "merge");
  assert.equal(dto.comparison?.current.state, "ready_to_merge");
  assert.equal(dto.comparison?.current.actionEquivalent, "merge");
  assert.equal(dto.comparison?.category, "agreement");
  assert.deepEqual(dto.comparison?.differences, []);
});

test("buildDecisionKernelV2ExplainDto accepts external review records as current-head review evidence", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig(),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record({ external_review_head_sha: "head-current" }),
    pr: pullRequest({
      configuredBotCurrentHeadObservedAt: null,
      configuredBotLatestReviewedCommitSha: null,
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.inventory?.pullRequest?.currentHeadReviewObservedAt, "2026-06-08T00:01:00.000Z");
  assert.equal(dto.inventory?.pullRequest?.currentHeadReviewHeadSha, "head-current");
  assert.equal(dto.decision?.normalizedState.reviewPosture, "current_head_review_observed");
  assert.equal(dto.decision?.action, "merge");
});

test("buildDecisionKernelV2ExplainDto blocks merge-ready diagnostics until configured local CI passes current head", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({ localCiCommand: "npm run verify:pre-pr" }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest(),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.decision?.normalizedState.reviewPosture, "current_head_review_observed");
  assert.equal(dto.decision?.action, "ask_operator");
  assert.deepEqual(dto.decision?.reasons, ["insufficient_merge_evidence"]);
});

test("buildDecisionKernelV2ExplainDto allows merge-ready diagnostics after configured local CI passes current head", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({ localCiCommand: "npm run verify:pre-pr" }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record({
      latest_local_ci_result: {
        outcome: "passed",
        summary: "Configured local CI command passed.",
        ran_at: "2026-06-08T00:05:00.000Z",
        head_sha: "head-current",
        execution_mode: "legacy_shell_string",
        command: "npm run verify:pre-pr",
        failure_class: null,
        remediation_target: null,
      },
    }),
    pr: pullRequest(),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.decision?.action, "merge");
});

test("buildDecisionKernelV2ExplainDto keeps zero-check PRs out of merge-ready diagnostics", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({ localCiCommand: "npm run verify:pre-pr" }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record({
      latest_local_ci_result: {
        outcome: "passed",
        summary: "Configured local CI command passed.",
        ran_at: "2026-06-08T00:05:00.000Z",
        head_sha: "head-current",
        execution_mode: "legacy_shell_string",
        command: "npm run verify:pre-pr",
        failure_class: null,
        remediation_target: null,
      },
    }),
    pr: pullRequest(),
    checks: [],
    reviewThreads: [],
  });

  assert.equal(dto.decision?.normalizedState.checkPosture, "unknown");
  assert.equal(dto.decision?.action, "ask_operator");
  assert.deepEqual(dto.decision?.reasons, ["insufficient_merge_evidence"]);
});

test("buildDecisionKernelV2ExplainDto accepts durable provider success as current-head review evidence", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig(),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record({
      provider_success_observed_at: "2026-06-08T00:06:00.000Z",
      provider_success_head_sha: "head-current",
    }),
    pr: pullRequest({
      configuredBotCurrentHeadObservedAt: null,
      configuredBotLatestReviewedCommitSha: null,
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.inventory?.pullRequest?.currentHeadReviewObservedAt, "2026-06-08T00:06:00.000Z");
  assert.equal(dto.inventory?.pullRequest?.currentHeadReviewHeadSha, "head-current");
  assert.equal(dto.decision?.normalizedState.reviewPosture, "current_head_review_observed");
  assert.equal(dto.decision?.action, "merge");
});

test("buildDecisionKernelV2ExplainDto accepts top-level configured-provider success signals as current-head review evidence", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({
      reviewBotLogins: ["coderabbitai"],
      configuredReviewProviders: [{ kind: "coderabbit", reviewerLogins: ["coderabbitai"], signalSource: "review_threads" }],
      configuredBotRequireCurrentHeadSignal: true,
    }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest({
      configuredBotCurrentHeadObservedAt: null,
      configuredBotLatestReviewedCommitSha: null,
      configuredBotTopLevelReviewSubmittedAt: "2026-06-08T00:06:00.000Z",
      configuredBotTopLevelReviewStrength: "nitpick_only",
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.inventory?.pullRequest?.currentHeadReviewObservedAt, "2026-06-08T00:06:00.000Z");
  assert.equal(dto.inventory?.pullRequest?.currentHeadReviewHeadSha, "head-current");
  assert.equal(dto.decision?.normalizedState.reviewPosture, "current_head_review_observed");
  assert.equal(dto.decision?.action, "merge");
});

test("buildDecisionKernelV2ExplainDto blocks merge-ready diagnostics on blocking human review decisions", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({ humanReviewBlocksMerge: true }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest({ reviewDecision: "REVIEW_REQUIRED" }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.decision?.normalizedState.reviewPosture, "current_head_review_observed");
  assert.equal(dto.decision?.action, "ask_operator");
  assert.deepEqual(dto.decision?.reasons, ["insufficient_merge_evidence"]);
});

test("buildDecisionKernelV2ExplainDto honors Codex-path changes-requested decisions even when the top-level review is nitpick-only", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({ codexConnectorAutoMergeEnabled: true, humanReviewBlocksMerge: true }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record({
      provider_success_observed_at: "2026-06-08T00:06:00.000Z",
      provider_success_head_sha: "head-current",
    }),
    pr: pullRequest({
      reviewDecision: "CHANGES_REQUESTED",
      configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
      configuredBotTopLevelReviewStrength: "nitpick_only",
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.decision?.normalizedState.reviewPosture, "current_head_review_observed");
  assert.equal(dto.decision?.action, "ask_operator");
  assert.deepEqual(dto.decision?.reasons, ["insufficient_merge_evidence"]);
});

test("buildDecisionKernelV2ExplainDto ignores manual review threads when human review is advisory", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({ humanReviewBlocksMerge: false }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest(),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [manualThread()],
  });

  assert.equal(dto.reviewPolicyInput?.threads.length, 0);
  assert.equal(dto.inventory?.reviewThreads.unresolvedManualThreadCount, 0);
  assert.equal(dto.decision?.action, "merge");
});

test("buildDecisionKernelV2ExplainDto waits out configured-bot settled windows before merge-ready diagnostics", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({ configuredBotSettledWaitSeconds: 5 }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest(),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
    nowMs: Date.parse("2026-06-08T00:02:03.000Z"),
  });

  assert.equal(dto.decision?.normalizedState.reviewPosture, "current_head_review_observed");
  assert.equal(dto.decision?.action, "ask_operator");
  assert.deepEqual(dto.decision?.reasons, ["insufficient_merge_evidence"]);
});

test("buildDecisionKernelV2ExplainDto requires active-wait-satisfying current-head observations", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig(),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record({
      review_wait_started_at: "2026-06-08T00:05:00.000Z",
      review_wait_head_sha: "head-current",
    }),
    pr: pullRequest({
      configuredBotCurrentHeadObservedAt: "2026-06-08T00:02:00.000Z",
      configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.inventory?.pullRequest?.currentHeadReviewObservedAt, null);
  assert.equal(dto.decision?.normalizedState.reviewPosture, "missing_current_head_review");
  assert.equal(dto.decision?.action, "request_review");
});

test("buildDecisionKernelV2ExplainDto applies journal-only configured-bot clearance before blocking facts", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig(),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest({
      configuredBotCurrentHeadStatusState: "SUCCESS",
      configuredBotTopLevelReviewStrength: "nitpick_only",
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [codexMustFixThread({ path: ".codex-supervisor/2301/issue-journal.md" })],
  });

  assert.equal(dto.reviewPolicyInput?.threads.length, 0);
  assert.equal(dto.inventory?.reviewThreads.unresolvedCurrentHeadConfiguredBotThreadCount, 0);
  assert.equal(dto.decision?.action, "merge");
});

test("buildDecisionKernelV2ExplainDto blocks merge-ready diagnostics until mergeable is MERGEABLE", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig(),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest({ mergeable: "UNKNOWN" }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.decision?.normalizedState.mergeability, "unknown");
  assert.equal(dto.decision?.action, "ask_operator");
  assert.deepEqual(dto.decision?.reasons, ["insufficient_merge_evidence"]);
});

test("buildDecisionKernelV2ExplainDto requires Codex no-major evidence for Codex auto-merge diagnostics", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({ codexConnectorAutoMergeEnabled: true }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record({
      provider_success_observed_at: "2026-06-08T00:06:00.000Z",
      provider_success_head_sha: "head-current",
    }),
    pr: pullRequest({
      configuredBotCurrentHeadObservedAt: "2026-06-08T00:06:00.000Z",
      configuredBotCurrentHeadObservationSource: "review_thread",
      configuredBotCurrentHeadStatusState: "SUCCESS",
      configuredBotLatestReviewedCommitSha: null,
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.decision?.normalizedState.reviewPosture, "current_head_review_observed");
  assert.equal(dto.decision?.action, "ask_operator");
  assert.deepEqual(dto.decision?.reasons, ["insufficient_merge_evidence"]);
});

test("buildDecisionKernelV2ExplainDto treats verified current-head repair residue as Codex no-major evidence", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({
      codexConnectorAutoMergeEnabled: true,
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotSettledWaitSeconds: 0,
      verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
      localCiCommand: "npm run verify:pre-pr",
    }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record({
      blocked_reason: "verification",
      last_failure_signature: "auto-merge-refused:head-current:missing_current_head_codex_no_major",
      processed_review_thread_ids: ["thread-codex-p2@head-current"],
      processed_review_thread_fingerprints: ["thread-codex-p2@head-current#comment-codex-p2"],
      latest_local_ci_result: {
        outcome: "passed",
        summary: "Configured local CI command passed before auto-merging PR.",
        ran_at: "2026-06-08T00:06:30.000Z",
        head_sha: "head-current",
        execution_mode: "shell",
        command: "npm run verify:pre-pr",
        failure_class: null,
        remediation_target: null,
      },
      timeline_artifacts: [
        {
          type: "verification_result",
          gate: "codex_turn",
          command: "npm test -- src/decision-kernel/v2-explain.test.ts",
          head_sha: "head-current",
          outcome: "passed",
          remediation_target: null,
          next_action: "continue",
          summary: "Focused verifier passed after the repair commit.",
          recorded_at: "2026-06-08T00:06:00.000Z",
        },
      ],
    }),
    pr: pullRequest({
      configuredBotCurrentHeadObservedAt: "2026-06-08T00:06:00.000Z",
      configuredBotCurrentHeadObservationSource: "review_thread",
      configuredBotCurrentHeadStatusState: "SUCCESS",
      configuredBotLatestReviewedCommitSha: null,
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [codexMustFixThread()],
  });

  assert.equal(dto.decision?.normalizedState.reviewPosture, "current_head_review_observed");
  assert.equal(dto.decision?.action, "merge");
});

test("buildDecisionKernelV2ExplainDto does not require Codex no-major evidence on configured-provider auto-merge paths", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({
      codexConnectorAutoMergeEnabled: true,
      reviewBotLogins: ["coderabbitai"],
      configuredReviewProviders: [{ kind: "coderabbit", reviewerLogins: ["coderabbitai"], signalSource: "review_threads" }],
    }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest({
      configuredBotCurrentHeadObservationSource: "review_thread",
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.decision?.normalizedState.reviewPosture, "current_head_review_observed");
  assert.equal(dto.decision?.action, "merge");
});

test("buildDecisionKernelV2ExplainDto respects explicit current-head signal requirements for non-Codex providers", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig({
      reviewBotLogins: ["coderabbitai"],
      configuredReviewProviders: [{ kind: "coderabbit", reviewerLogins: ["coderabbitai"], signalSource: "review_threads" }],
      configuredBotRequireCurrentHeadSignal: true,
    }),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest({
      configuredBotCurrentHeadObservedAt: null,
      configuredBotLatestReviewedCommitSha: null,
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [],
  });

  assert.equal(dto.inventory?.configuredCurrentHeadReviewRequired, true);
  assert.equal(dto.decision?.normalizedState.reviewPosture, "missing_current_head_review");
  assert.equal(dto.decision?.action, "request_review");
});

test("buildDecisionKernelV2ExplainDto requests review before metadata-only residue without current-head evidence", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig(),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest({
      configuredBotCurrentHeadObservedAt: null,
      configuredBotLatestReviewedCommitSha: null,
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [codexMustFixThread()],
  });

  assert.equal(dto.reviewPolicyInput?.threads[0]?.boundaryOutcome, "metadata_only_unresolved");
  assert.equal(dto.inventory?.reviewThreads.metadataOnlyUnresolvedThreadCount, 0);
  assert.equal(dto.decision?.normalizedState.reviewPosture, "missing_current_head_review");
  assert.equal(dto.decision?.action, "request_review");
});

test("buildDecisionKernelV2ExplainDto requests review before advisory-only nitpicks without current-head evidence", () => {
  const dto = buildDecisionKernelV2ExplainDto({
    config: codexConfig(),
    issueNumber: 2301,
    title: "Phase 3.2",
    record: record(),
    pr: pullRequest({
      configuredBotCurrentHeadObservedAt: null,
      configuredBotLatestReviewedCommitSha: null,
    }),
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass" }],
    reviewThreads: [codexSoftenedP3Thread()],
  });

  assert.equal(dto.reviewPolicyInput?.threads[0]?.boundaryOutcome, "softened_p3_advisory");
  assert.equal(dto.inventory?.reviewThreads.unresolvedCurrentHeadConfiguredBotThreadCount, 0);
  assert.equal(dto.decision?.normalizedState.reviewPosture, "missing_current_head_review");
  assert.equal(dto.decision?.action, "request_review");
});
