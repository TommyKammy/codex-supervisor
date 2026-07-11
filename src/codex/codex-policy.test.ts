import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexConfigOverrideArgs, resolveCodexExecutionPolicy } from "./codex-policy";
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
    }, "supervisor", {
      reasoningLevelsByModel: new Map([
        ["gpt-5.6-sol", new Set(["high", "xhigh", "max", "ultra"] as const)],
      ]),
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
    reasoningEffortFallbackReason: "unsupported_reasoning_effort",
  });
  assert.deepEqual(
    resolveCodexExecutionPolicy(createConfig({ ...maxConfig, codexModel: "gpt-5-pro" }), "implementing"),
    {
      model: "gpt-5-pro",
      reasoningEffort: "high",
      requestedReasoningEffort: "max",
      reasoningEffortFallbackReason: "unsupported_reasoning_effort",
    },
  );
});

test("resolveCodexExecutionPolicy allows catalog-backed Terra and Luna routes to emit max", () => {
  const capabilities = new Map([
    ["gpt-5.6-terra", new Set(["high", "xhigh", "max"] as const)],
    ["gpt-5.6-luna", new Set(["high", "xhigh", "max"] as const)],
  ]);
  for (const model of capabilities.keys()) {
    const config = createConfig({ codexModel: model, codexReasoningEffortByState: { implementing: "max" } });
    assert.equal(resolveCodexExecutionPolicy(config, "implementing", undefined, "supervisor", {
      reasoningLevelsByModel: capabilities,
    }).reasoningEffort, "max");
  }
});

test("resolveCodexExecutionPolicy uses Codex-style alias and dated-suffix catalog matching", () => {
  const capabilities = new Map([
    ["gpt-5.6", new Set(["high"] as const)],
    ["gpt-5.6-terra", new Set(["high", "xhigh", "max"] as const)],
  ]);
  for (const model of ["openai/gpt-5.6-terra", "gpt-5.6-terra-2026-07-10"]) {
    const config = createConfig({ codexModel: model, codexReasoningEffortByState: { implementing: "max" } });
    assert.equal(resolveCodexExecutionPolicy(config, "implementing", undefined, "supervisor", {
      reasoningLevelsByModel: capabilities,
    }).reasoningEffort, "max");
  }
});

test("resolveCodexExecutionPolicy maps the unsuffixed GPT-5.6 alias to Sol catalog capabilities", () => {
  const capabilities = new Map([
    ["gpt-5.6-sol", new Set(["high", "xhigh", "max"] as const)],
  ]);
  for (const model of ["gpt-5.6", "openai/gpt-5.6"]) {
    const config = createConfig({ codexModel: model, codexReasoningEffortByState: { implementing: "max" } });
    assert.equal(resolveCodexExecutionPolicy(config, "implementing", undefined, "supervisor", {
      reasoningLevelsByModel: capabilities,
    }).reasoningEffort, "max");
  }

  const directAliasCapabilities = new Map(capabilities).set("gpt-5.6", new Set(["high"] as const));
  const directAliasConfig = createConfig({
    codexModel: "gpt-5.6",
    codexReasoningEffortByState: { implementing: "max" },
  });
  assert.equal(resolveCodexExecutionPolicy(directAliasConfig, "implementing", undefined, "supervisor", {
    reasoningLevelsByModel: directAliasCapabilities,
  }).reasoningEffort, "high");
});

test("resolveCodexExecutionPolicy clamps every unsupported effort to the live catalog", () => {
  const capabilities = new Map([
    ["gpt-5.6-terra", new Set(["low", "medium", "high", "xhigh"] as const)],
  ]);
  const noneConfig = createConfig({
    codexModel: "gpt-5.6-terra",
    codexReasoningEffortByState: { implementing: "none" },
  });
  assert.deepEqual(resolveCodexExecutionPolicy(noneConfig, "implementing", undefined, "supervisor", {
    reasoningLevelsByModel: capabilities,
  }), {
    model: "gpt-5.6-terra",
    reasoningEffort: "low",
    requestedReasoningEffort: "none",
    reasoningEffortFallbackReason: "unsupported_reasoning_effort",
  });

  const maxConfig = createConfig({
    codexModel: "gpt-5.6-terra",
    codexReasoningEffortByState: { implementing: "max" },
  });
  assert.equal(resolveCodexExecutionPolicy(maxConfig, "implementing", undefined, "supervisor", {
    reasoningLevelsByModel: capabilities,
  }).reasoningEffort, "xhigh");
});

test("resolveCodexExecutionPolicy lets live catalogs override legacy Pro clamps", () => {
  const policy = resolveCodexExecutionPolicy(
    createConfig({
      codexModel: "gpt-5-pro",
      codexReasoningEffortByState: { implementing: "xhigh" },
    }),
    "implementing",
    undefined,
    "supervisor",
    { reasoningLevelsByModel: new Map([["gpt-5-pro", new Set(["high", "xhigh"] as const)]]) },
  );

  assert.deepEqual(policy, { model: "gpt-5-pro", reasoningEffort: "xhigh" });
});

test("resolveCodexExecutionPolicy suppresses reasoning overrides for empty live capability sets", () => {
  const policy = resolveCodexExecutionPolicy(
    createConfig({
      codexModel: "catalog-model",
      codexReasoningEffortByState: { implementing: "high" },
    }),
    "implementing",
    undefined,
    "supervisor",
    { reasoningLevelsByModel: new Map([["catalog-model", new Set()]]) },
  );

  assert.deepEqual(policy, {
    model: "catalog-model",
    reasoningEffort: null,
    requestedReasoningEffort: "high",
    reasoningEffortFallbackReason: "unsupported_reasoning_effort",
  });
  assert.deepEqual(buildCodexConfigOverrideArgs(policy), ["-m", "catalog-model"]);
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
    reasoningEffortFallbackReason: "unsupported_reasoning_effort",
  });
});

test("resolveCodexExecutionPolicy forwards explicit ultra only for catalog-supported supervisor routes", () => {
  const capabilities = new Map([
    ["gpt-5.6-sol", new Set(["high", "xhigh", "max", "ultra"] as const)],
    ["gpt-5.6-terra", new Set(["high", "xhigh", "max", "ultra"] as const)],
    ["gpt-5.6-luna", new Set(["high", "xhigh", "max"] as const)],
  ]);

  for (const model of ["gpt-5.6-sol", "gpt-5.6-terra"]) {
    const policy = resolveCodexExecutionPolicy(
      createConfig({ codexModel: model, codexReasoningEffortByState: { implementing: "ultra" } }),
      "implementing",
      undefined,
      "supervisor",
      { reasoningLevelsByModel: capabilities },
    );
    assert.deepEqual(policy, { model, reasoningEffort: "ultra" });
    assert.deepEqual(buildCodexConfigOverrideArgs(policy), [
      "-m",
      model,
      "-c",
      'model_reasoning_effort="ultra"',
    ]);
  }

  assert.deepEqual(
    resolveCodexExecutionPolicy(
      createConfig({
        codexModel: "gpt-5.6-luna",
        codexReasoningEffortByState: { implementing: "ultra" },
      }),
      "implementing",
      undefined,
      "supervisor",
      { reasoningLevelsByModel: capabilities },
    ),
    {
      model: "gpt-5.6-luna",
      reasoningEffort: "max",
      requestedReasoningEffort: "ultra",
      reasoningEffortFallbackReason: "unsupported_reasoning_effort",
    },
  );

  assert.deepEqual(
    resolveCodexExecutionPolicy(
      createConfig({
        codexModel: "future-model",
        codexReasoningEffortByState: { implementing: "ultra" },
      }),
      "implementing",
      undefined,
      "supervisor",
      { reasoningLevelsByModel: capabilities },
    ),
    {
      model: "future-model",
      reasoningEffort: "xhigh",
      requestedReasoningEffort: "ultra",
      reasoningEffortFallbackReason: "unsupported_reasoning_effort",
    },
  );
});

test("resolveCodexExecutionPolicy blocks ultra for every local-review execution target", () => {
  const capabilities = new Map([
    ["gpt-5.6-sol", new Set(["high", "xhigh", "max", "ultra"] as const)],
  ]);
  const config = createConfig({
    codexModel: "gpt-5.6-sol",
    codexReasoningEffortByState: { local_review: "ultra" },
  });

  for (const target of ["local_review_generic", "local_review_specialist", "local_review_verifier"] as const) {
    assert.deepEqual(
      resolveCodexExecutionPolicy(config, "local_review", undefined, target, {
        reasoningLevelsByModel: capabilities,
      }),
      {
        model: "gpt-5.6-sol",
        reasoningEffort: "max",
        requestedReasoningEffort: "ultra",
        reasoningEffortFallbackReason: "nested_delegation_blocked",
      },
    );
  }

  assert.deepEqual(
    resolveCodexExecutionPolicy(config, "local_review", undefined, "local_review_specialist", {
      reasoningLevelsByModel: new Map([
        ["gpt-5.6-sol", new Set(["high", "ultra"] as const)],
      ]),
    }),
    {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      requestedReasoningEffort: "ultra",
      reasoningEffortFallbackReason: "nested_delegation_blocked",
    },
  );
});

test("resolveCodexExecutionPolicy never upgrades non-ultra requests or escalation beyond max", () => {
  const capabilities = new Map([
    ["ultra-only", new Set(["ultra"] as const)],
    ["gpt-5.6-sol", new Set(["high", "xhigh", "max", "ultra"] as const)],
  ]);
  const unsupportedPolicy = resolveCodexExecutionPolicy(
    createConfig({ codexModel: "ultra-only", codexReasoningEffortByState: { implementing: "max" } }),
    "implementing",
    undefined,
    "supervisor",
    { reasoningLevelsByModel: capabilities },
  );
  assert.deepEqual(unsupportedPolicy, {
    model: "ultra-only",
    reasoningEffort: null,
    requestedReasoningEffort: "max",
    reasoningEffortFallbackReason: "unsupported_reasoning_effort",
  });

  for (const configured of ["max", "ultra"] as const) {
    const policy = resolveCodexExecutionPolicy(
      createConfig({
        codexModel: "gpt-5.6-sol",
        codexReasoningEffortByState: { implementing: configured },
      }),
      "implementing",
      {
        repeated_failure_signature_count: 1,
        blocked_verification_retry_count: 0,
        timeout_retry_count: 0,
      },
      "supervisor",
      { reasoningLevelsByModel: capabilities },
    );
    assert.equal(policy.reasoningEffort, configured);
  }
});

test("resolveCodexExecutionPolicy preserves inherited catalog-supported ultra without forcing a model override", () => {
  const config = createConfig({
    codexModelStrategy: "inherit",
    codexModel: undefined,
    codexReasoningEffortByState: { implementing: "ultra" },
  });
  assert.deepEqual(
    resolveCodexExecutionPolicy(config, "implementing", undefined, "supervisor", {
      inheritedModel: "gpt-5.6-sol",
      reasoningLevelsByModel: new Map([
        ["gpt-5.6-sol", new Set(["high", "xhigh", "max", "ultra"] as const)],
      ]),
    }),
    { model: null, reasoningEffort: "ultra" },
  );
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
