import test from "node:test";
import assert from "node:assert/strict";
import {
  configuredReviewProviderKinds,
  mapConfiguredReviewProviders,
  reviewProviderProfileFromConfig,
} from "./review-providers";
import { SupervisorConfig } from "./types";

function createConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    repoPath: "/tmp/repo",
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: "/tmp/workspaces",
    stateBackend: "json",
    stateFile: "/tmp/state.json",
    codexBinary: "/usr/bin/codex",
    codexModelStrategy: "inherit",
    codexReasoningEffortByState: {},
    codexReasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: [],
    gsdEnabled: false,
    gsdAutoInstall: false,
    gsdInstallScope: "global",
    gsdPlanningFiles: [],
    localReviewEnabled: false,
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
    configuredBotRateLimitWaitMinutes: 0,
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

test("mapConfiguredReviewProviders preserves compatibility with existing reviewBotLogins patterns", () => {
  assert.deepEqual(mapConfiguredReviewProviders([]), []);

  assert.deepEqual(mapConfiguredReviewProviders([" Copilot-Pull-Request-Reviewer "]), [
    {
      kind: "copilot",
      reviewerLogins: ["copilot-pull-request-reviewer"],
      signalSource: "copilot_lifecycle",
    },
  ]);

  assert.deepEqual(mapConfiguredReviewProviders(["CodeRabbitAI", "coderabbitai[bot]"]), [
    {
      kind: "coderabbit",
      reviewerLogins: ["coderabbitai", "coderabbitai[bot]"],
      signalSource: "review_threads",
    },
  ]);

  assert.deepEqual(mapConfiguredReviewProviders(["chatgpt-codex-connector", "copilot-pull-request-reviewer"]), [
    {
      kind: "codex",
      reviewerLogins: ["chatgpt-codex-connector"],
      signalSource: "review_threads",
    },
    {
      kind: "copilot",
      reviewerLogins: ["copilot-pull-request-reviewer"],
      signalSource: "copilot_lifecycle",
    },
  ]);
});

test("reviewProviderProfileFromConfig summarizes the mapped internal provider model", () => {
  assert.deepEqual(reviewProviderProfileFromConfig(createConfig()), {
    profile: "none",
    provider: "none",
    reviewers: [],
    signalSource: "none",
  });

  assert.deepEqual(
    reviewProviderProfileFromConfig(createConfig({ reviewBotLogins: ["chatgpt-codex-connector"] })),
    {
      profile: "codex",
      provider: "chatgpt-codex-connector",
      reviewers: ["chatgpt-codex-connector"],
      signalSource: "review_threads",
    },
  );

  assert.deepEqual(
    reviewProviderProfileFromConfig(
      createConfig({ reviewBotLogins: ["chatgpt-codex-connector", "copilot-pull-request-reviewer"] }),
    ),
    {
      profile: "custom",
      provider: "chatgpt-codex-connector,copilot-pull-request-reviewer",
      reviewers: ["chatgpt-codex-connector", "copilot-pull-request-reviewer"],
      signalSource: "copilot_lifecycle+review_threads",
    },
  );
});

test("reviewProviderProfileFromConfig uses configuredReviewProviders as the canonical reviewer source", () => {
  assert.deepEqual(
    reviewProviderProfileFromConfig(
      createConfig({
        reviewBotLogins: ["legacy-bot"],
        configuredReviewProviders: [
          {
            kind: "coderabbit",
            reviewerLogins: ["coderabbitai", "coderabbitai[bot]"],
            signalSource: "review_threads",
          },
        ],
      }),
    ),
    {
      profile: "coderabbit",
      provider: "coderabbitai",
      reviewers: ["coderabbitai", "coderabbitai[bot]"],
      signalSource: "review_threads",
    },
  );
});

test("configuredReviewProviderKinds reports the normalized kinds in config order", () => {
  assert.deepEqual(
    configuredReviewProviderKinds(
      createConfig({ reviewBotLogins: ["CodeRabbitAI", "coderabbitai[bot]", "chatgpt-codex-connector"] }),
    ),
    ["coderabbit", "codex"],
  );
});
