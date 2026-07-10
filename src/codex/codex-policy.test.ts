import assert from "node:assert/strict";
import test from "node:test";
import { resolveCodexExecutionPolicy } from "./codex-policy";
import { type SupervisorConfig } from "../core/types";

function createConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    repoPath: "/tmp/repo",
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: "/tmp/workspaces",
    stateBackend: "json",
    stateFile: "/tmp/state.json",
    codexBinary: "/usr/bin/codex",
    codexModelStrategy: "fixed",
    codexModel: "gpt-5-codex",
    boundedRepairModelStrategy: undefined,
    boundedRepairModel: undefined,
    localReviewModelStrategy: undefined,
    localReviewModel: undefined,
    codexReasoningEffortByState: {},
    codexReasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: [],
    gsdEnabled: false,
    gsdAutoInstall: false,
    gsdInstallScope: "global",
    gsdPlanningFiles: [],
    localReviewEnabled: true,
    localReviewAutoDetect: true,
    localReviewRoles: [],
    localReviewArtifactDir: "/tmp/reviews",
    localReviewConfidenceThreshold: 0.7,
    localReviewReviewerThresholds: {
      generic: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
      specialist: {
        confidenceThreshold: 0.7,
        minimumSeverity: "low",
      },
    },
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins: [],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    candidateDiscoveryFetchWindow: 100,
    skipTitlePrefixes: [],
    branchPrefix: "codex/issue-",
    pollIntervalSeconds: 60,
    copilotReviewWaitMinutes: 10,
    copilotReviewTimeoutAction: "continue",
    codexExecTimeoutMinutes: 30,
    maxCodexAttemptsPerIssue: 5,
    maxImplementationAttemptsPerIssue: 5,
    maxRepairAttemptsPerIssue: 5,
    timeoutRetryLimit: 2,
    blockedVerificationRetryLimit: 3,
    sameBlockerRepeatLimit: 2,
    sameFailureSignatureRepeatLimit: 3,
    maxDoneWorkspaces: 24,
    cleanupDoneWorkspacesAfterHours: 24,
    mergeMethod: "squash",
    draftPrAfterAttempt: 1,
    ...overrides,
  };
}

test("resolveCodexExecutionPolicy keeps generic local-review turns on the main model when no local-review routing override is configured", () => {
  const policy = resolveCodexExecutionPolicy(createConfig(), "local_review", null, "local_review_generic");

  assert.deepEqual(policy, {
    model: "gpt-5-codex",
    reasoningEffort: "low",
  });
});

test("resolveCodexExecutionPolicy applies explicit local-review routing only to generic reviewer turns", () => {
  const config = createConfig({
    localReviewModelStrategy: "alias",
    localReviewModel: "local-review-fast",
  });

  assert.deepEqual(resolveCodexExecutionPolicy(config, "local_review", null, "local_review_generic"), {
    model: "local-review-fast",
    reasoningEffort: "low",
  });
  assert.deepEqual(resolveCodexExecutionPolicy(config, "local_review", null, "local_review_specialist"), {
    model: "gpt-5-codex",
    reasoningEffort: "low",
  });
  assert.deepEqual(resolveCodexExecutionPolicy(config, "local_review", null, "local_review_verifier"), {
    model: "gpt-5-codex",
    reasoningEffort: "low",
  });
});

test("resolveCodexExecutionPolicy routes bounded repair states to the explicit mini model without changing broader implementation defaults", () => {
  const config = createConfig({
    boundedRepairModelStrategy: "alias",
    boundedRepairModel: "gpt-5.4-mini",
  });

  assert.deepEqual(resolveCodexExecutionPolicy(config, "repairing_ci"), {
    model: "gpt-5.4-mini",
    reasoningEffort: "medium",
  });
  assert.deepEqual(resolveCodexExecutionPolicy(config, "addressing_review"), {
    model: "gpt-5.4-mini",
    reasoningEffort: "medium",
  });
  assert.deepEqual(resolveCodexExecutionPolicy(config, "implementing"), {
    model: "gpt-5-codex",
    reasoningEffort: "high",
  });
});

test("resolveCodexExecutionPolicy escalates only an unconsumed stable Codex Connector churn dossier repair turn", () => {
  const config = createConfig({
    boundedRepairModelStrategy: "alias",
    boundedRepairModel: "gpt-5.4-mini",
  });
  const stableSnapshot = JSON.stringify({
    headRefOid: "head-current-2250",
    checks: [],
    unresolvedReviewThreadIds: [],
    codexConnectorStableSameFileChurn: {
      streak: 3,
      dominantFile: "src/release-readiness.ts",
      clusterCategorySignature: "claim_detection+truth_source",
      currentEffectiveMustFixCount: 4,
      reviewedHeadShas: ["head-previous-2250", "head-middle-2250", "head-current-2250"],
      representativeThreadIds: ["thread-current-0", "thread-current-1"],
    },
  });
  const consumedSignature =
    "codex-connector-stable-same-file-churn:src/release-readiness.ts:claim_detection_truth_source:head-previous-2250_head-middle-2250_head-current-2250";

  assert.deepEqual(
    resolveCodexExecutionPolicy(config, "addressing_review", {
      repeated_failure_signature_count: 0,
      blocked_verification_retry_count: 0,
      timeout_retry_count: 0,
      last_tracked_pr_progress_snapshot: stableSnapshot,
      codex_connector_stable_churn_dossier_consumed_signature: null,
    }),
    {
      model: "gpt-5.4-mini",
      reasoningEffort: "xhigh",
    },
  );
  assert.deepEqual(
    resolveCodexExecutionPolicy(config, "addressing_review", {
      repeated_failure_signature_count: 0,
      blocked_verification_retry_count: 0,
      timeout_retry_count: 0,
      last_tracked_pr_progress_snapshot: stableSnapshot,
      codex_connector_stable_churn_dossier_consumed_signature: consumedSignature,
    }),
    {
      model: "gpt-5.4-mini",
      reasoningEffort: "medium",
    },
  );
  assert.deepEqual(
    resolveCodexExecutionPolicy(config, "repairing_ci", {
      repeated_failure_signature_count: 0,
      blocked_verification_retry_count: 0,
      timeout_retry_count: 0,
      last_tracked_pr_progress_snapshot: stableSnapshot,
      codex_connector_stable_churn_dossier_consumed_signature: null,
    }),
    {
      model: "gpt-5.4-mini",
      reasoningEffort: "medium",
    },
  );
  assert.deepEqual(
    resolveCodexExecutionPolicy(
      createConfig({
        codexModel: "gpt-5.6-sol",
        codexReasoningEffortByState: { addressing_review: "max" },
      }),
      "addressing_review",
      {
        repeated_failure_signature_count: 0,
        blocked_verification_retry_count: 0,
        timeout_retry_count: 0,
        last_tracked_pr_progress_snapshot: stableSnapshot,
        codex_connector_stable_churn_dossier_consumed_signature: null,
      },
    ),
    {
      model: "gpt-5.6-sol",
      reasoningEffort: "max",
    },
  );
});

test("resolveCodexExecutionPolicy escalates xhigh to max for GPT-5.6 Sol", () => {
  const config = createConfig({
    codexModel: "gpt-5.6-sol",
    codexReasoningEffortByState: { implementing: "xhigh" },
  });

  assert.deepEqual(
    resolveCodexExecutionPolicy(config, "implementing", {
      repeated_failure_signature_count: 1,
      blocked_verification_retry_count: 0,
      timeout_retry_count: 0,
    }),
    {
      model: "gpt-5.6-sol",
      reasoningEffort: "max",
    },
  );
});

test("resolveCodexExecutionPolicy clamps max to each model family's highest supported effort", () => {
  const maxConfig = {
    codexReasoningEffortByState: { implementing: "max" as const },
  };

  assert.deepEqual(resolveCodexExecutionPolicy(createConfig(maxConfig), "implementing"), {
    model: "gpt-5-codex",
    reasoningEffort: "xhigh",
    requestedReasoningEffort: "max",
  });
  assert.deepEqual(
    resolveCodexExecutionPolicy(createConfig({ ...maxConfig, codexModel: "gpt-5-pro" }), "implementing"),
    {
      model: "gpt-5-pro",
      reasoningEffort: "high",
      requestedReasoningEffort: "max",
    },
  );
});

test("resolveCodexExecutionPolicy applies inherited host-model capabilities without forcing a model override", () => {
  const config = createConfig({
    codexModelStrategy: "inherit",
    codexModel: undefined,
    codexReasoningEffortByState: { implementing: "max" },
  });

  assert.deepEqual(
    resolveCodexExecutionPolicy(config, "implementing", undefined, "supervisor", {
      inheritedModel: "gpt-5.6-sol",
    }),
    {
      model: null,
      reasoningEffort: "max",
    },
  );
  assert.deepEqual(resolveCodexExecutionPolicy(config, "implementing"), {
    model: null,
    reasoningEffort: "xhigh",
    requestedReasoningEffort: "max",
  });
});

test("resolveCodexExecutionPolicy inherits a fixed default model for explicit route-level inherit", () => {
  const config = createConfig({
    codexModel: "gpt-5.6-sol",
    boundedRepairModelStrategy: "inherit",
    localReviewModelStrategy: "inherit",
    codexReasoningEffortByState: {
      repairing_ci: "max",
      local_review: "max",
    },
  });

  assert.deepEqual(resolveCodexExecutionPolicy(config, "repairing_ci"), {
    model: "gpt-5.6-sol",
    reasoningEffort: "max",
  });
  assert.deepEqual(resolveCodexExecutionPolicy(config, "local_review", undefined, "local_review_generic"), {
    model: "gpt-5.6-sol",
    reasoningEffort: "max",
  });
});
