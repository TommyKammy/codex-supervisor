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
