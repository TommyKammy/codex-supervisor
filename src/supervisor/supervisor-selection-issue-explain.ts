import { GitHubClient } from "../github";
import {
  findBlockingIssue,
  findHighRiskBlockingAmbiguity,
  hasAvailableIssueLabels,
  isRecordDoneForSequencing,
  LABEL_GATED_POLICY_MISSING_LABELS_BLOCKED_BY,
  lintExecutionReadyIssueBody,
  parseIssueMetadata,
} from "../issue-metadata";
import {
  attemptBudgetForLane,
  formatExecutionReadyMissingFields,
  hasAttemptBudgetRemaining,
  isEligibleForSelection,
  shouldAutoRecoverStaleReviewBot,
  shouldAutoRetryBlockedVerification,
  shouldAutoRetryHandoffMissing,
  shouldEnforceExecutionReady,
} from "./supervisor-execution-policy";
import { configuredReviewBotLogins } from "../core/review-providers";
import { shouldAutoRetryTimeout } from "./supervisor-failure-helpers";
import { buildStaleStabilizingNoPrRecoveryWarningLine } from "../no-pull-request-state";
import {
  evaluateAutonomousExecutionTrust,
  isAutonomousExecutionTrustBlockedRecord,
} from "./supervisor-trust-gate";
import {
  buildChangeClassesStatusLine,
  buildExternalReviewFollowUpStatusLine,
  buildVerificationPolicyStatusLine,
  loadStatusChangedFiles,
} from "./supervisor-status-rendering";
import { formatLatestRecoveryStatusLine } from "./supervisor-detailed-status-assembly";
import { externalSignalReadinessDiagnostics } from "./supervisor-status-review-bot";
import { readIssueJournal, resolveTrackedIssueHostPaths, summarizeIssueJournalHandoff } from "../core/journal";
import { formatInventoryRefreshDiagnosticLines, formatInventoryRefreshStatusLine } from "../inventory-refresh-state";
import { buildTrackedPrMismatch } from "./tracked-pr-mismatch";
import {
  BlockedReason,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
  SupervisorStateFile,
} from "../core/types";
import type { ActiveStatusGitHub } from "./supervisor-selection-active-status";
import {
  formatLocalCiStatusLine,
  formatRecoveryLoopSummaryLine,
  formatRetrySummaryLine,
  maybeBuildIssueActivityContext,
  type SupervisorIssueActivityContextDto,
} from "./supervisor-operator-activity-context";
import { formatPreMergeEvaluationStatusLine, loadPreMergeEvaluationDto } from "./supervisor-pre-merge-evaluation";
import { summarizePreservedPartialWork } from "./supervisor-preserved-partial-work";

export type ExplainIssueGitHub = Pick<GitHubClient, "getIssue" | "listAllIssues" | "listCandidateIssues"> &
  Partial<ActiveStatusGitHub>;

export interface SupervisorExplainDto {
  issueNumber: number;
  title: string;
  state: RunState | "untracked";
  blockedReason: BlockedReason | "none";
  runnable: boolean;
  inventoryRefreshSummary?: string | null;
  inventoryRefreshDiagnostics?: string[];
  changeRiskLines: string[];
  externalReviewFollowUpSummary: string | null;
  latestRecoverySummary: string | null;
  staleRecoveryWarningSummary: string | null;
  activityContext: SupervisorIssueActivityContextDto | null;
  trackedPrRetryabilitySummary?: string | null;
  trackedPrMismatchSummary: string | null;
  externalSignalReadinessSummary?: string | null;
  recoveryGuidance: string | null;
  selectionReason: string | null;
  reasons: string[];
  lastError: string | null;
  failureSummary: string | null;
  preservedPartialWorkSummary: string | null;
  runtimeFailureKind?: IssueRunRecord["last_runtime_failure_kind"] | null;
  runtimeFailureSummary?: string | null;
}

async function buildExplainChangeRiskSummary(args: {
  config: SupervisorConfig;
  issue: GitHubIssue;
  record: IssueRunRecord | undefined;
}): Promise<string[]> {
  const changedFiles = args.record?.workspace
    ? await loadStatusChangedFiles(args.config, args.record.workspace)
    : [];
  const lines: string[] = [];
  const changeClassesSummary = buildChangeClassesStatusLine(changedFiles);
  const verificationPolicySummary = buildVerificationPolicyStatusLine({
    issue: args.issue,
    changedFiles,
  });

  if (changeClassesSummary) {
    lines.push(changeClassesSummary);
  }
  if (verificationPolicySummary) {
    lines.push(verificationPolicySummary);
  }

  return lines;
}

async function buildExplainExternalReviewFollowUpSummary(args: {
  github: ExplainIssueGitHub;
  record: IssueRunRecord | undefined;
}): Promise<string | null> {
  if (!args.record) {
    return null;
  }

  let pr: GitHubPullRequest | null = null;
  try {
    pr = args.github.resolvePullRequestForBranch
      ? await args.github.resolvePullRequestForBranch(args.record.branch, args.record.pr_number)
      : null;
  } catch {
    pr = null;
  }

  return buildExternalReviewFollowUpStatusLine({
    activeRecord: args.record,
    currentHeadSha: pr?.headRefOid ?? args.record.last_head_sha,
  });
}

export function buildNonRunnableLocalStateReasons(record: IssueRunRecord, config: SupervisorConfig): string[] {
  const reasons: string[] = [];

  if (record.state === "blocked") {
    if (
      record.blocked_reason === "manual_review" ||
      record.blocked_reason === "manual_pr_closed" ||
      (record.blocked_reason === "stale_review_bot" && !shouldAutoRecoverStaleReviewBot(record, config))
    ) {
      reasons.push(`manual_block ${record.blocked_reason}`);
    } else if (record.blocked_reason === "verification" && !shouldAutoRetryBlockedVerification(record, config)) {
      if (!hasAttemptBudgetRemaining(record, config, "implementation")) {
        reasons.push(
          `retry_budget implementation_attempt_count=${record.implementation_attempt_count}/${attemptBudgetForLane(config, "implementation")}`,
        );
      }
      if (record.blocked_verification_retry_count >= config.blockedVerificationRetryLimit) {
        reasons.push(
          `retry_budget blocked_verification_retry_count=${record.blocked_verification_retry_count}/${config.blockedVerificationRetryLimit}`,
        );
      }
      if (record.repeated_blocker_count >= config.sameBlockerRepeatLimit) {
        reasons.push(`retry_budget repeated_blocker_count=${record.repeated_blocker_count}/${config.sameBlockerRepeatLimit}`);
      }
      if (record.repeated_failure_signature_count >= config.sameFailureSignatureRepeatLimit) {
        reasons.push(
          `retry_budget repeated_failure_signature_count=${record.repeated_failure_signature_count}/${config.sameFailureSignatureRepeatLimit}`,
        );
      }
    } else if (record.blocked_reason === "handoff_missing" && !shouldAutoRetryHandoffMissing(record, config)) {
      if (!hasAttemptBudgetRemaining(record, config, "implementation")) {
        reasons.push(
          `retry_budget implementation_attempt_count=${record.implementation_attempt_count}/${attemptBudgetForLane(config, "implementation")}`,
        );
      }
      if (record.repeated_failure_signature_count >= config.sameFailureSignatureRepeatLimit) {
        reasons.push(
          `retry_budget repeated_failure_signature_count=${record.repeated_failure_signature_count}/${config.sameFailureSignatureRepeatLimit}`,
        );
      }
    } else if (
      record.blocked_reason === "requirements" ||
      record.blocked_reason === "clarification" ||
      record.blocked_reason === "permissions" ||
      record.blocked_reason === "secrets" ||
      record.blocked_reason === "review_bot_timeout" ||
      record.blocked_reason === "copilot_timeout" ||
      record.blocked_reason === "unknown"
    ) {
      reasons.push(`blocked_reason ${record.blocked_reason}`);
    }
  } else if (record.state === "failed" && !shouldAutoRetryTimeout(record, config)) {
    if (record.last_failure_kind === "timeout" && record.timeout_retry_count >= config.timeoutRetryLimit) {
      reasons.push(`retry_budget timeout_retry_count=${record.timeout_retry_count}/${config.timeoutRetryLimit}`);
    } else {
      reasons.push(`blocked_failure ${record.last_failure_kind ?? "unknown"}`);
    }
  } else if (record.state === "done") {
    reasons.push("completed done");
  } else {
    reasons.push(`local_state ${record.state}`);
    return reasons;
  }

  reasons.push(`local_state ${record.state}`);
  return reasons;
}

export async function buildIssueExplainDto(
  github: ExplainIssueGitHub,
  config: SupervisorConfig,
  state: SupervisorStateFile,
  issueNumber: number,
): Promise<SupervisorExplainDto> {
  const inventoryRefreshDegraded = state.inventory_refresh_failure !== undefined;
  const [issue, loadedIssues, candidateIssues] = await Promise.all([
    github.getIssue(issueNumber),
    inventoryRefreshDegraded ? Promise.resolve(null) : github.listAllIssues(),
    github.listCandidateIssues(),
  ]);
  const issues = loadedIssues ?? [issue];
  const record = state.issues[String(issue.number)];
  const labelsAvailable = hasAvailableIssueLabels(issue);
  const readiness = labelsAvailable ? lintExecutionReadyIssueBody(issue) : null;
  const clarificationBlock = findHighRiskBlockingAmbiguity(issue);
  const blockingIssue = findBlockingIssue(issue, issues, state);
  const matchingSkipPrefix = config.skipTitlePrefixes.find((prefix) => issue.title.startsWith(prefix)) ?? null;
  const candidateIssueNumbers = new Set(candidateIssues.map((candidate) => candidate.number));
  const reasons: string[] = [];
  const inventoryRefreshSummary = formatInventoryRefreshStatusLine(state.inventory_refresh_failure);
  const inventoryRefreshDiagnostics = formatInventoryRefreshDiagnosticLines(state.inventory_refresh_failure);
  const changeRiskLines = await buildExplainChangeRiskSummary({
    config,
    issue,
    record,
  });
  const externalReviewFollowUpSummary = await buildExplainExternalReviewFollowUpSummary({
    github,
    record,
  });
  const latestRecoverySummary = record ? formatLatestRecoveryStatusLine(record) : null;
  const staleRecoveryWarningSummary = record ? buildStaleStabilizingNoPrRecoveryWarningLine(record, config) : null;
  let pr: GitHubPullRequest | null = null;
  if (record && github.resolvePullRequestForBranch) {
    try {
      pr = await github.resolvePullRequestForBranch(record.branch, record.pr_number);
    } catch {
      pr = null;
    }
  }
  let handoffSummary: string | null = null;
  if (record?.journal_path) {
    try {
      handoffSummary = summarizeIssueJournalHandoff(
        await readIssueJournal(resolveTrackedIssueHostPaths(config, record).journal_path),
      );
    } catch {
      handoffSummary = null;
    }
  }
  const preMergeEvaluation = record
    ? await loadPreMergeEvaluationDto({
      config,
      record,
      pr,
    })
    : null;
  let explainChecks: PullRequestCheck[] = [];
  let explainReviewThreads: ReviewThread[] = [];
  let trackedPrHydrationFailed = false;
  if (record && pr) {
    try {
      [explainChecks, explainReviewThreads] = await Promise.all([
        github.getChecks ? github.getChecks(pr.number) : Promise.resolve([]),
        github.getUnresolvedReviewThreads ? github.getUnresolvedReviewThreads(pr.number) : Promise.resolve([]),
      ]);
    } catch {
      trackedPrHydrationFailed = true;
    }
  }
  const trackedPrMismatch =
    record && pr && !trackedPrHydrationFailed
      ? buildTrackedPrMismatch(config, record, pr, explainChecks, explainReviewThreads)
      : null;
  const externalSignalReadinessSummary =
    record && pr && !trackedPrHydrationFailed
      ? (() => {
        const configuredBotLogins = new Set(configuredReviewBotLogins(config));
        const readiness = externalSignalReadinessDiagnostics(
          config,
          record,
          pr,
          explainChecks,
          explainReviewThreads,
          (_innerConfig, innerReviewThreads) =>
            innerReviewThreads.filter((thread) =>
              thread.comments.nodes.some((comment) => {
                const login = comment.author?.login?.toLowerCase();
                return login !== undefined && configuredBotLogins.has(login);
              })
            ),
        );
        return `external_signal_readiness status=${readiness.status} ci=${readiness.ci} review=${readiness.review} workflows=${readiness.workflows}`;
      })()
      : null;

  if (matchingSkipPrefix) {
    reasons.push(`skip_title_prefix ${matchingSkipPrefix}`);
  }

  if (!candidateIssueNumbers.has(issue.number)) {
    reasons.push("candidate filtered_by_candidate_list");
  }

  if (inventoryRefreshSummary) {
    reasons.push("inventory_refresh degraded");
  }

  if (readiness === null) {
    reasons.push(LABEL_GATED_POLICY_MISSING_LABELS_BLOCKED_BY);
  } else if (shouldEnforceExecutionReady(record) && !readiness.isExecutionReady) {
    reasons.push(`requirements missing=${formatExecutionReadyMissingFields(readiness.missingRequired)}`);
  }

  if (clarificationBlock) {
    reasons.push(
      `clarification ambiguity=${clarificationBlock.ambiguityClasses.join("|")} risky_change=${clarificationBlock.riskyChangeClasses.join("|")}`,
    );
  }

  if (blockingIssue) {
    reasons.push(`dependency ${blockingIssue.reason}`);
  }

  const trustDecision = evaluateAutonomousExecutionTrust(config, issue);
  if (!trustDecision.allowed) {
    reasons.push(`trust_gate ${trustDecision.readinessToken}`);
  }

  if (
    record &&
    !isEligibleForSelection(record, config) &&
    !(isAutonomousExecutionTrustBlockedRecord(record) && trustDecision.allowed)
  ) {
    reasons.push(...buildNonRunnableLocalStateReasons(record, config));
  }

  const runnable = reasons.length === 0;
  const selectionReason = runnable && !inventoryRefreshSummary && readiness !== null
    ? formatSelectionReason(issue, issues, state, record, readiness.isExecutionReady, config)
    : null;
  return {
    issueNumber: issue.number,
    title: issue.title,
    state: record?.state ?? "untracked",
    blockedReason: record?.blocked_reason ?? "none",
    runnable,
    inventoryRefreshSummary,
    inventoryRefreshDiagnostics,
    changeRiskLines,
    externalReviewFollowUpSummary,
    latestRecoverySummary,
    staleRecoveryWarningSummary,
    activityContext: record
      ? maybeBuildIssueActivityContext({
        config,
        record,
        pr,
        handoffSummary,
        changeClassesSummary: changeRiskLines.length > 0 ? changeRiskLines.join(" | ") : null,
        externalReviewFollowUpSummary,
        preMergeEvaluation,
      })
      : null,
    trackedPrRetryabilitySummary:
      record?.last_tracked_pr_repeat_failure_decision && record.last_tracked_pr_progress_summary
        ? [
          "tracked_pr_repeat_failure",
          `decision=${record.last_tracked_pr_repeat_failure_decision}`,
          `signal=${record.last_tracked_pr_progress_summary.replace(/\s+/g, "_")}`,
        ].join(" ")
        : null,
    trackedPrMismatchSummary: trackedPrMismatch?.summaryLine ?? null,
    externalSignalReadinessSummary,
    recoveryGuidance: trackedPrMismatch?.guidanceLine ?? null,
    selectionReason,
    reasons,
    lastError: record?.last_error ?? null,
    failureSummary: record?.last_failure_context?.summary ?? null,
    preservedPartialWorkSummary: summarizePreservedPartialWork(record?.last_failure_context),
    runtimeFailureKind: record?.last_runtime_failure_kind ?? null,
    runtimeFailureSummary: record?.last_runtime_failure_context?.summary ?? null,
  };
}

export function renderIssueExplainDto(dto: SupervisorExplainDto): string {
  const localCiStatusLine = formatLocalCiStatusLine(dto.activityContext);
  const preMergeEvaluationLine = formatPreMergeEvaluationStatusLine(dto.activityContext?.preMergeEvaluation ?? null);
  const retrySummaryLine = formatRetrySummaryLine(dto.activityContext);
  const recoveryLoopSummaryLine = formatRecoveryLoopSummaryLine(dto.activityContext);
  const lines = [
    `issue=#${dto.issueNumber}`,
    `title=${dto.title}`,
    `state=${dto.state}`,
    `blocked_reason=${dto.blockedReason}`,
    `runnable=${dto.runnable ? "yes" : "no"}`,
    ...(dto.inventoryRefreshSummary ? [dto.inventoryRefreshSummary] : []),
    ...(dto.inventoryRefreshDiagnostics ?? []),
    ...dto.changeRiskLines,
    ...(dto.externalReviewFollowUpSummary ? [dto.externalReviewFollowUpSummary] : []),
    ...(preMergeEvaluationLine ? [preMergeEvaluationLine] : []),
    ...(localCiStatusLine ? [localCiStatusLine] : []),
    ...(dto.trackedPrRetryabilitySummary ? [dto.trackedPrRetryabilitySummary] : []),
    ...(dto.trackedPrMismatchSummary ? [dto.trackedPrMismatchSummary] : []),
    ...(dto.externalSignalReadinessSummary ? [dto.externalSignalReadinessSummary] : []),
    ...(dto.recoveryGuidance ? [dto.recoveryGuidance] : []),
    ...(retrySummaryLine ? [retrySummaryLine] : []),
    ...(recoveryLoopSummaryLine ? [recoveryLoopSummaryLine] : []),
    ...(dto.latestRecoverySummary ? [dto.latestRecoverySummary] : []),
    ...(dto.staleRecoveryWarningSummary ? [dto.staleRecoveryWarningSummary] : []),
  ];

  if (dto.selectionReason) {
    lines.push(`selection_reason=${dto.selectionReason}`);
  } else {
    dto.reasons.forEach((reason, index) => {
      lines.push(`reason_${index + 1}=${reason}`);
    });
  }

  if (dto.lastError) {
    lines.push(`last_error=${dto.lastError}`);
  }
  if (dto.failureSummary) {
    lines.push(`failure_summary=${dto.failureSummary}`);
  }
  if (dto.preservedPartialWorkSummary) {
    lines.push(dto.preservedPartialWorkSummary);
  }
  if (dto.runtimeFailureKind) {
    lines.push(`runtime_failure_kind=${dto.runtimeFailureKind}`);
  }
  if (dto.runtimeFailureSummary) {
    lines.push(`runtime_failure_summary=${dto.runtimeFailureSummary}`);
  }

  return lines.join("\n");
}

export async function buildIssueExplainSummary(
  github: ExplainIssueGitHub,
  config: SupervisorConfig,
  state: SupervisorStateFile,
  issueNumber: number,
): Promise<string[]> {
  return renderIssueExplainDto(await buildIssueExplainDto(github, config, state, issueNumber)).split("\n");
}

export function formatSelectionReason(
  issue: GitHubIssue,
  issues: GitHubIssue[],
  state: SupervisorStateFile,
  existing: IssueRunRecord | undefined,
  isExecutionReady: boolean,
  config: SupervisorConfig,
): string {
  const metadata = parseIssueMetadata(issue);
  const dependencyStatus =
    metadata.dependsOn.length === 0
      ? "none"
      : `${metadata.dependsOn.join("|")}:${metadata.dependsOn.every((dependencyNumber) => isRecordDoneForSequencing(state.issues[String(dependencyNumber)])) ? "done" : "pending"}`;

  let executionOrderStatus = "none";
  let predecessorStatus = "none";
  if (metadata.parentIssueNumber !== null && metadata.executionOrderIndex !== null) {
    executionOrderStatus = `${metadata.parentIssueNumber}/${metadata.executionOrderIndex}`;
    const predecessors = issues
      .filter((candidate) => candidate.number !== issue.number)
      .map((candidate) => ({
        issue: candidate,
        metadata: parseIssueMetadata(candidate),
      }))
      .filter(
        ({ metadata: candidateMetadata }) =>
          candidateMetadata.parentIssueNumber === metadata.parentIssueNumber &&
          candidateMetadata.executionOrderIndex !== null &&
          candidateMetadata.executionOrderIndex < metadata.executionOrderIndex!,
      )
      .sort(
        (left, right) =>
          (left.metadata.executionOrderIndex ?? Number.MAX_SAFE_INTEGER) -
          (right.metadata.executionOrderIndex ?? Number.MAX_SAFE_INTEGER),
      )
      .map(({ issue: predecessorIssue }) => predecessorIssue.number);

    if (predecessors.length > 0) {
      predecessorStatus = `${predecessors.join("|")}:${
        predecessors.every((predecessorNumber) => isRecordDoneForSequencing(state.issues[String(predecessorNumber)]))
          ? "done"
          : "pending"
      }`;
    }
  }

  return [
    "ready",
    `execution_ready=${isExecutionReady ? "yes" : "skipped"}`,
    `depends_on=${dependencyStatus}`,
    `execution_order=${executionOrderStatus}`,
    `predecessors=${predecessorStatus}`,
    `retry_state=${formatRetryState(existing, config)}`,
  ].join(" ");
}

function formatRetryState(record: IssueRunRecord | undefined, config: SupervisorConfig): string {
  if (!record || record.attempt_count === 0) {
    return "fresh";
  }

  if (shouldAutoRetryTimeout(record, config)) {
    return `timeout_retry:${record.timeout_retry_count}/${config.timeoutRetryLimit}`;
  }

  if (shouldAutoRetryBlockedVerification(record, config)) {
    return `blocked_verification_retry:${record.blocked_verification_retry_count}/${config.blockedVerificationRetryLimit}`;
  }

  if (shouldAutoRetryHandoffMissing(record, config)) {
    return "handoff_missing_retry";
  }

  if (shouldAutoRecoverStaleReviewBot(record, config)) {
    return `stale_review_bot_recovery:${config.staleConfiguredBotReviewPolicy}`;
  }

  return `resume:${record.state}`;
}
