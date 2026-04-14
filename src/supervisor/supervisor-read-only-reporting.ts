import { summarizeCadenceDiagnostics, summarizeLocalCiContract, summarizeTrustDiagnostics } from "../core/config";
import { StateStore } from "../core/state-store";
import {
  CliOptions,
  GitHubRateLimitTelemetry,
  StateLoadFinding,
  SupervisorConfig,
  SupervisorStateFile,
} from "../core/types";
import { truncate } from "../core/utils";
import { diagnoseSupervisorHost, loadStateReadonlyForDoctor, type DoctorDiagnostics } from "../doctor";
import { GitHubClient } from "../github";
import {
  buildInventoryOperatorStatus,
  formatInventoryOperatorPostureLine,
  formatInventoryRefreshDiagnosticLines,
  formatInventoryRefreshStatusLine,
  formatLastSuccessfulInventorySnapshotStatusLine,
} from "../inventory-refresh-state";
import { configuredBotReviewThreads, manualReviewThreads, pendingBotReviewThreads } from "../review-thread-reporting";
import { type SetupReadinessReport, diagnoseSetupReadiness } from "../setup-readiness";
import { describeGsdIntegration } from "../gsd";
import {
  buildIssueExplainDto,
  type SupervisorExplainDto,
} from "./supervisor-selection-issue-explain";
import { buildDetailedStatusModel, buildDetailedStatusSummaryLines } from "./supervisor-status-model";
import {
  buildInventoryRefreshWarningMessage,
  buildTrackedIssueDtos,
  renderGitHubRateLimitLine,
  type SupervisorStatusDto,
} from "./supervisor-status-report";
import { buildTrackedPrMismatch, shouldHydrateTrackedPrDiagnostics } from "./tracked-pr-mismatch";
import { buildMacOsLoopHostWarning, readSupervisorLoopRuntime } from "./supervisor-loop-runtime-state";
import { loadActiveIssueStatusSnapshot } from "./supervisor-selection-active-status";
import {
  buildCandidateDiscoverySummary,
  buildLastKnownGoodSnapshotReadinessSummary,
  buildReadinessSummary,
  buildSelectionSummary,
  buildSelectionWhySummary,
  formatCandidateDiscoveryBehaviorLine,
} from "./supervisor-selection-readiness-summary";
import { summarizeSupervisorStatusRecords } from "./supervisor-selection-status-records";
import { readCurrentReconciliationPhaseSnapshot } from "./supervisor-reconciliation-phase";
import {
  mergeConflictDetected,
  sanitizeStatusValue,
  summarizeChecks,
} from "./supervisor-status-rendering";
import { buildTrackedMergedButOpenBacklogDiagnosticLine } from "../reconciliation-backlog-diagnostics";

const LONG_RECONCILIATION_WARNING_THRESHOLD_MS = 5 * 60 * 1000;
const MAX_RENDERED_STATUS_STATE_LOAD_FINDINGS = 5;

function buildLongReconciliationWarning(snapshot: {
  phase: string;
  startedAt: string | null;
} | null): string | null {
  if (snapshot === null || snapshot.startedAt === null) {
    return null;
  }

  const startedAtMs = Date.parse(snapshot.startedAt);
  if (Number.isNaN(startedAtMs)) {
    return null;
  }

  const elapsedMs = Date.now() - startedAtMs;
  if (elapsedMs <= LONG_RECONCILIATION_WARNING_THRESHOLD_MS) {
    return null;
  }

  return [
    "reconciliation_warning=long_running",
    `phase=${snapshot.phase}`,
    `elapsed_seconds=${Math.floor(elapsedMs / 1000)}`,
    `threshold_seconds=${Math.floor(LONG_RECONCILIATION_WARNING_THRESHOLD_MS / 1000)}`,
    `started_at=${snapshot.startedAt}`,
  ].join(" ");
}

function formatStatusStateLoadFinding(finding: StateLoadFinding): string {
  const issueNumber = finding.issue_number === null ? "none" : String(finding.issue_number);
  return [
    "state_load_finding",
    `backend=${finding.backend}`,
    `scope=${finding.scope}`,
    `issue_number=${issueNumber}`,
    `location=${sanitizeStatusValue(finding.location)}`,
    `message=${sanitizeStatusValue(finding.message)}`,
  ].join(" ");
}

function buildStateLoadDiagnosticLines(config: SupervisorConfig, state: SupervisorStateFile): string[] {
  if (config.stateBackend !== "json") {
    return [];
  }

  const findings = (state.load_findings ?? []).filter((finding) => finding.backend === "json");
  if (findings.length === 0) {
    return [];
  }

  const lines = [
    [
      "state_diagnostic",
      "severity=hard",
      "backend=json",
      "summary=corrupted_json_state_forced_empty_fallback_not_missing_bootstrap",
      `findings=${findings.length}`,
      `location=${sanitizeStatusValue(config.stateFile)}`,
    ].join(" "),
    ...findings.slice(0, MAX_RENDERED_STATUS_STATE_LOAD_FINDINGS).map((finding) => formatStatusStateLoadFinding(finding)),
  ];

  if (findings.length > MAX_RENDERED_STATUS_STATE_LOAD_FINDINGS) {
    lines.push(`state_load_finding_omitted count=${findings.length - MAX_RENDERED_STATUS_STATE_LOAD_FINDINGS}`);
  }

  return lines;
}

async function loadGitHubRateLimitStatus(github: GitHubClient) {
  const githubWithRateLimitTelemetry = github as GitHubClient & {
    getRateLimitTelemetry?: () => Promise<GitHubRateLimitTelemetry>;
  };

  let githubRateLimit: GitHubRateLimitTelemetry | null = null;
  let githubRateLimitWarning: string | null = null;
  if (typeof githubWithRateLimitTelemetry.getRateLimitTelemetry === "function") {
    try {
      githubRateLimit = await githubWithRateLimitTelemetry.getRateLimitTelemetry();
    } catch (error) {
      githubRateLimitWarning = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    githubRateLimit,
    githubRateLimitWarning,
    githubRateLimitLines: githubRateLimit
      ? [
        renderGitHubRateLimitLine("rest", githubRateLimit.rest),
        renderGitHubRateLimitLine("graphql", githubRateLimit.graphql),
      ]
      : [],
  };
}

export async function buildSupervisorStatusReport(args: {
  config: SupervisorConfig;
  github: GitHubClient;
  stateStore: StateStore;
  options: Pick<CliOptions, "why">;
}): Promise<SupervisorStatusDto> {
  const { config, github, stateStore, options } = args;
  const state = await stateStore.load();
  const stateDiagnosticLines = buildStateLoadDiagnosticLines(config, state);
  const trustDiagnostics = summarizeTrustDiagnostics(config);
  const cadenceDiagnostics = summarizeCadenceDiagnostics(config);
  const candidateDiscoverySummary = formatCandidateDiscoveryBehaviorLine(config);
  const localCiContract = summarizeLocalCiContract(config);
  const loopRuntime = await readSupervisorLoopRuntime(config.stateFile);
  const loopHostWarning = buildMacOsLoopHostWarning(loopRuntime);
  const gsdSummary = await describeGsdIntegration(config);
  const statusRecords = summarizeSupervisorStatusRecords(state);
  const trackedIssues = buildTrackedIssueDtos(state);
  const inventoryStatus = buildInventoryOperatorStatus({
    state,
    activeRecord: statusRecords.activeRecord,
    trackedRecords: trackedIssues.map((issue) => ({ pr_number: issue.prNumber ?? null })),
  });
  const inventoryPostureLine = formatInventoryOperatorPostureLine(inventoryStatus);
  const inventoryRefreshStatusLine = formatInventoryRefreshStatusLine(state.inventory_refresh_failure);
  const inventoryRefreshDiagnosticLines = formatInventoryRefreshDiagnosticLines(state.inventory_refresh_failure);
  const inventorySnapshotStatusLine = formatLastSuccessfulInventorySnapshotStatusLine(
    state.last_successful_inventory_snapshot,
  );
  const inventoryRefreshWarning = buildInventoryRefreshWarningMessage(state);
  const reconciliationSnapshot = await readCurrentReconciliationPhaseSnapshot(config);
  const reconciliationPhase = reconciliationSnapshot?.phase ?? null;
  const reconciliationWarning = buildLongReconciliationWarning(reconciliationSnapshot);
  const reconciliationProgress = reconciliationSnapshot === null
    ? null
    : {
      phase: reconciliationSnapshot.phase,
      startedAt: reconciliationSnapshot.startedAt,
      targetIssueNumber: reconciliationSnapshot.targetIssueNumber,
      targetPrNumber: reconciliationSnapshot.targetPrNumber,
      waitStep: reconciliationSnapshot.waitStep,
    };
  const trackedPrMismatchLines: string[] = [];
  const trackedMergedBacklogLine = buildTrackedMergedButOpenBacklogDiagnosticLine(state);

  for (const record of Object.values(state.issues)) {
    if (!shouldHydrateTrackedPrDiagnostics(record)) {
      continue;
    }

    try {
      const pr = await github.getPullRequestIfExists(record.pr_number);
      if (!pr || pr.state !== "OPEN" || pr.mergedAt) {
        continue;
      }

      const checks = await github.getChecks(pr.number);
      const reviewThreads = await github.getUnresolvedReviewThreads(pr.number);
      const mismatch = buildTrackedPrMismatch(config, record, pr, checks, reviewThreads);
      if (!mismatch) {
        continue;
      }

      trackedPrMismatchLines.push(mismatch.summaryLine, ...mismatch.detailLines, mismatch.guidanceLine);
    } catch {
      // Degrade status diagnostics if tracked PR hydration fails.
    }
  }

  if (!statusRecords.activeRecord) {
    const detailedStatusLines = buildDetailedStatusModel({
      config,
      activeRecord: null,
      latestRecord: statusRecords.latestRecord,
      latestRecoveryRecord: statusRecords.latestRecoveryRecord,
      trackedIssueCount: statusRecords.trackedIssueCount,
      pr: null,
      checks: [],
      reviewThreads: [],
      manualReviewThreads,
      configuredBotReviewThreads,
      pendingBotReviewThreads,
      summarizeChecks,
      mergeConflictDetected,
    });

    if (state.inventory_refresh_failure) {
      const readinessSummary = buildLastKnownGoodSnapshotReadinessSummary(config, state);
      const whyLines = options.why ? await buildSelectionWhySummary(github, config, state) : [];
      const githubRateLimitStatus = await loadGitHubRateLimitStatus(github);
      const inactiveDetailedStatusLines = [
        ...detailedStatusLines,
        inventoryPostureLine,
        ...(inventoryRefreshStatusLine === null ? [] : [inventoryRefreshStatusLine]),
        ...inventoryRefreshDiagnosticLines,
        ...(inventorySnapshotStatusLine === null ? [] : [inventorySnapshotStatusLine]),
        ...(trackedMergedBacklogLine === null ? [] : [trackedMergedBacklogLine]),
        ...githubRateLimitStatus.githubRateLimitLines,
      ];

      return {
        gsdSummary,
        trustDiagnostics,
        cadenceDiagnostics,
        githubRateLimit: githubRateLimitStatus.githubRateLimit,
        inventoryStatus,
        candidateDiscoverySummary,
        candidateDiscovery: buildCandidateDiscoverySummary(config, null),
        localCiContract,
        loopRuntime,
        activeIssue: null,
        selectionSummary: null,
        trackedIssues,
        runnableIssues: readinessSummary?.runnableIssues ?? [],
        blockedIssues: readinessSummary?.blockedIssues ?? [],
        detailedStatusLines: [...inactiveDetailedStatusLines, ...trackedPrMismatchLines, ...stateDiagnosticLines],
        reconciliationPhase,
        reconciliationProgress,
        reconciliationWarning,
        readinessLines: readinessSummary?.readinessLines ?? [],
        whyLines,
        warning: loopHostWarning || inventoryRefreshWarning || githubRateLimitStatus.githubRateLimitWarning
          ? {
            kind: loopHostWarning ? "status" : "readiness",
            message: truncate(
              sanitizeStatusValue(
                [loopHostWarning, inventoryRefreshWarning, githubRateLimitStatus.githubRateLimitWarning]
                  .filter(Boolean)
                  .join(" | "),
              ),
              200,
            ) ?? "",
          }
          : null,
      };
    }

    try {
      const candidateDiscoveryDiagnostics =
        typeof github.getCandidateDiscoveryDiagnostics === "function"
          ? await github.getCandidateDiscoveryDiagnostics()
          : null;
      const candidateDiscovery = buildCandidateDiscoverySummary(config, candidateDiscoveryDiagnostics);
      const readinessSummary = await buildReadinessSummary(github, config, state, candidateDiscoveryDiagnostics);
      const whyLines = options.why ? await buildSelectionWhySummary(github, config, state) : [];
      const selectionSummary = options.why ? await buildSelectionSummary(github, config, state) : null;
      const githubRateLimitStatus = await loadGitHubRateLimitStatus(github);
      const inactiveDetailedStatusLines = [
        ...detailedStatusLines,
        inventoryPostureLine,
        ...(inventoryRefreshStatusLine === null ? [] : [inventoryRefreshStatusLine]),
        ...inventoryRefreshDiagnosticLines,
        ...(inventorySnapshotStatusLine === null ? [] : [inventorySnapshotStatusLine]),
        ...(trackedMergedBacklogLine === null ? [] : [trackedMergedBacklogLine]),
        ...githubRateLimitStatus.githubRateLimitLines,
      ];

      return {
        gsdSummary,
        trustDiagnostics,
        cadenceDiagnostics,
        githubRateLimit: githubRateLimitStatus.githubRateLimit,
        inventoryStatus,
        candidateDiscoverySummary,
        candidateDiscovery,
        localCiContract,
        loopRuntime,
        activeIssue: null,
        selectionSummary,
        trackedIssues,
        runnableIssues: readinessSummary.runnableIssues,
        blockedIssues: readinessSummary.blockedIssues,
        detailedStatusLines: [...inactiveDetailedStatusLines, ...trackedPrMismatchLines, ...stateDiagnosticLines],
        reconciliationPhase,
        reconciliationProgress,
        reconciliationWarning,
        readinessLines: readinessSummary.readinessLines,
        whyLines,
        warning: loopHostWarning
          ? {
            kind: "status",
            message: truncate(sanitizeStatusValue(loopHostWarning), 200) ?? "",
          }
          : null,
      };
    } catch (error) {
      const message = sanitizeStatusValue(error instanceof Error ? error.message : String(error));
      const githubRateLimitStatus = await loadGitHubRateLimitStatus(github);
      const inactiveDetailedStatusLines = [
        ...detailedStatusLines,
        inventoryPostureLine,
        ...(inventoryRefreshStatusLine === null ? [] : [inventoryRefreshStatusLine]),
        ...inventoryRefreshDiagnosticLines,
        ...(trackedMergedBacklogLine === null ? [] : [trackedMergedBacklogLine]),
        ...githubRateLimitStatus.githubRateLimitLines,
      ];

      return {
        gsdSummary,
        trustDiagnostics,
        cadenceDiagnostics,
        githubRateLimit: githubRateLimitStatus.githubRateLimit,
        inventoryStatus,
        candidateDiscoverySummary,
        candidateDiscovery: buildCandidateDiscoverySummary(config, null),
        localCiContract,
        loopRuntime,
        activeIssue: null,
        selectionSummary: null,
        trackedIssues,
        runnableIssues: [],
        blockedIssues: [],
        detailedStatusLines: [...inactiveDetailedStatusLines, ...trackedPrMismatchLines, ...stateDiagnosticLines],
        reconciliationPhase,
        reconciliationProgress,
        reconciliationWarning,
        readinessLines: [],
        whyLines: [],
        warning: {
          kind: loopHostWarning ? "status" : "readiness",
          message: truncate(
            sanitizeStatusValue(
              [loopHostWarning, message, githubRateLimitStatus.githubRateLimitWarning].filter(Boolean).join(" | "),
            ),
            200,
          ) ?? "",
        },
      };
    }
  }

  const activeStatus = await loadActiveIssueStatusSnapshot({
    github,
    config,
    activeRecord: statusRecords.activeRecord,
  });
  const detailedStatusLines = buildDetailedStatusModel({
    config,
    activeRecord: statusRecords.activeRecord,
    latestRecord: statusRecords.latestRecord,
    latestRecoveryRecord: statusRecords.latestRecoveryRecord,
    trackedIssueCount: statusRecords.trackedIssueCount,
    pr: activeStatus.pr,
    checks: activeStatus.checks,
    reviewThreads: activeStatus.reviewThreads,
    manualReviewThreads,
    configuredBotReviewThreads,
    pendingBotReviewThreads,
    summarizeChecks,
    mergeConflictDetected,
  });
  const summaryLines = buildDetailedStatusSummaryLines({
    config,
    activeRecord: statusRecords.activeRecord,
    latestRecoveryRecord: statusRecords.latestRecoveryRecord,
    activityContext: activeStatus.activityContext,
    handoffSummary: activeStatus.handoffSummary,
    codexModelPolicySummaryLines: activeStatus.codexModelPolicySummaryLines,
    localReviewRoutingSummary: activeStatus.localReviewRoutingSummary,
    changeClassesSummary: activeStatus.changeClassesSummary,
    verificationPolicySummary: activeStatus.verificationPolicySummary,
    durableGuardrailSummary: activeStatus.durableGuardrailSummary,
    externalReviewFollowUpSummary: activeStatus.externalReviewFollowUpSummary,
    executionMetricsSummaryLines: activeStatus.executionMetricsSummaryLines,
  });
  const githubRateLimitStatus = await loadGitHubRateLimitStatus(github);
  const detailedStatusLinesWithInventory = [
    ...detailedStatusLines,
    inventoryPostureLine,
    ...(inventoryRefreshStatusLine === null ? [] : [inventoryRefreshStatusLine]),
    ...inventoryRefreshDiagnosticLines,
    ...(inventorySnapshotStatusLine === null ? [] : [inventorySnapshotStatusLine]),
    ...(trackedMergedBacklogLine === null ? [] : [trackedMergedBacklogLine]),
    ...githubRateLimitStatus.githubRateLimitLines,
  ];

  return {
    gsdSummary,
    trustDiagnostics,
    cadenceDiagnostics,
    githubRateLimit: githubRateLimitStatus.githubRateLimit,
    inventoryStatus,
    candidateDiscoverySummary,
    candidateDiscovery: buildCandidateDiscoverySummary(config, null),
    localCiContract,
    loopRuntime,
    activeIssue: {
      issueNumber: statusRecords.activeRecord.issue_number,
      state: statusRecords.activeRecord.state,
      branch: statusRecords.activeRecord.branch,
      prNumber: statusRecords.activeRecord.pr_number,
      blockedReason: statusRecords.activeRecord.blocked_reason,
      activityContext: activeStatus.activityContext,
    },
    selectionSummary: {
      selectedIssueNumber: null,
      selectionReason: null,
    },
    trackedIssues,
    runnableIssues: [],
    blockedIssues: [],
    detailedStatusLines: [...detailedStatusLinesWithInventory, ...summaryLines, ...trackedPrMismatchLines, ...stateDiagnosticLines],
    reconciliationPhase,
    reconciliationProgress,
    reconciliationWarning,
    readinessLines: [],
    whyLines: [],
    warning: activeStatus.warningMessage || inventoryRefreshWarning
      || loopHostWarning
      ? {
        kind: "status",
        message: truncate(
          sanitizeStatusValue(
            [
              loopHostWarning,
              activeStatus.warningMessage,
              inventoryRefreshWarning,
              githubRateLimitStatus.githubRateLimitWarning,
            ].filter(Boolean).join(" | "),
          ),
          200,
        ) ?? "",
      }
      : githubRateLimitStatus.githubRateLimitWarning
        ? {
          kind: "status",
          message: truncate(sanitizeStatusValue(githubRateLimitStatus.githubRateLimitWarning), 200) ?? "",
        }
        : null,
  };
}

export async function buildSupervisorExplainReport(args: {
  config: SupervisorConfig;
  github: GitHubClient;
  stateStore: StateStore;
  issueNumber: number;
}): Promise<SupervisorExplainDto> {
  const state = await args.stateStore.load();
  return buildIssueExplainDto(args.github, args.config, state, args.issueNumber);
}

export async function buildSupervisorDoctorReport(args: {
  config: SupervisorConfig;
  github: Pick<GitHubClient, "authStatus">;
}): Promise<DoctorDiagnostics> {
  return diagnoseSupervisorHost({
    config: args.config,
    authStatus: () => args.github.authStatus(),
    loadState: () => loadStateReadonlyForDoctor(args.config),
  });
}

export async function buildSupervisorSetupReadinessReport(args: {
  configPath?: string;
  github: Pick<GitHubClient, "authStatus">;
}): Promise<SetupReadinessReport> {
  return diagnoseSetupReadiness({
    configPath: args.configPath,
    authStatus: () => args.github.authStatus(),
  });
}
