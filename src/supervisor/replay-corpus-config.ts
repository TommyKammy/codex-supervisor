import path from "node:path";
import { mapConfiguredReviewProviders } from "../core/review-providers";
import type { SupervisorConfig } from "../core/types";

export function createCheckedInReplayCorpusConfig(repoRoot: string): SupervisorConfig {
  const reviewBotLogins = ["copilot-pull-request-reviewer", "coderabbitai", "coderabbitai[bot]"];
  const replayStateRoot = path.join(repoRoot, ".codex-supervisor", "replay");

  return {
    repoPath: repoRoot,
    repoSlug: "TommyKammy/codex-supervisor",
    defaultBranch: "main",
    workspaceRoot: path.join(replayStateRoot, "workspaces"),
    stateBackend: "json",
    stateFile: path.join(replayStateRoot, "state.json"),
    codexBinary: "codex",
    codexModelStrategy: "inherit",
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
    localReviewArtifactDir: path.join(replayStateRoot, "reviews"),
    localReviewConfidenceThreshold: 0.7,
    localReviewReviewerThresholds: {
      generic: { confidenceThreshold: 0.7, minimumSeverity: "low" },
      specialist: { confidenceThreshold: 0.7, minimumSeverity: "low" },
    },
    localReviewPolicy: "block_ready",
    localReviewHighSeverityAction: "retry",
    reviewBotLogins,
    configuredReviewProviders: mapConfiguredReviewProviders(reviewBotLogins),
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".codex-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "codex/issue-",
    pollIntervalSeconds: 60,
    copilotReviewWaitMinutes: 10,
    copilotReviewTimeoutAction: "continue",
    configuredBotInitialGraceWaitSeconds: 90,
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
  };
}
