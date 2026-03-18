import { GitHubClient } from "../github";
import {
  findBlockingIssue,
  findHighRiskBlockingAmbiguity,
  lintExecutionReadyIssueBody,
  parseIssueMetadata,
} from "../issue-metadata";
import { readIssueJournal, summarizeIssueJournalHandoff } from "../core/journal";
import {
  attemptBudgetForLane,
  hasAttemptBudgetRemaining,
  formatExecutionReadyMissingFields,
  isEligibleForSelection,
  shouldAutoRetryBlockedVerification,
  shouldAutoRetryHandoffMissing,
  shouldEnforceExecutionReady,
} from "./supervisor-execution-policy";
import { shouldAutoRetryTimeout } from "./supervisor-failure-helpers";
import {
  buildChangeClassesStatusLine,
  buildDurableGuardrailStatusLine,
  buildExternalReviewFollowUpStatusLine,
  buildVerificationPolicyStatusLine,
  loadStatusChangedFiles,
} from "./supervisor-status-rendering";
import {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  SupervisorStateFile,
} from "../core/types";

type ReadinessSummaryGitHub = Pick<GitHubClient, "listCandidateIssues">;
type SelectionWhyGitHub = Pick<GitHubClient, "listAllIssues" | "listCandidateIssues">;
type ExplainIssueGitHub = Pick<GitHubClient, "getIssue" | "listAllIssues" | "listCandidateIssues"> &
  Partial<ActiveStatusGitHub>;
type ActiveStatusGitHub = Pick<
  GitHubClient,
  "resolvePullRequestForBranch" | "getChecks" | "getUnresolvedReviewThreads"
>;
type ActiveStatusIssueGitHub = Pick<GitHubClient, "getIssue">;

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
  config: SupervisorConfig;
  record: IssueRunRecord | undefined;
}): Promise<string | null> {
  if (
    !args.record ||
    !args.github.resolvePullRequestForBranch ||
    !args.github.getChecks ||
    !args.github.getUnresolvedReviewThreads
  ) {
    return null;
  }

  const activeStatus = await loadActiveIssueStatusSnapshot({
    github: {
      getIssue: args.github.getIssue,
      resolvePullRequestForBranch: args.github.resolvePullRequestForBranch,
      getChecks: args.github.getChecks,
      getUnresolvedReviewThreads: args.github.getUnresolvedReviewThreads,
    },
    config: args.config,
    activeRecord: args.record,
  });

  return activeStatus.externalReviewFollowUpSummary;
}

export interface SupervisorStatusRecords {
  activeRecord: IssueRunRecord | null;
  latestRecord: IssueRunRecord | null;
  latestRecoveryRecord: IssueRunRecord | null;
  trackedIssueCount: number;
}

export interface ActiveIssueStatusSnapshot {
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  handoffSummary: string | null;
  changeClassesSummary: string | null;
  verificationPolicySummary: string | null;
  durableGuardrailSummary: string | null;
  externalReviewFollowUpSummary: string | null;
  warningMessage: string | null;
}

function isOpenPullRequest(pr: GitHubPullRequest | null): pr is GitHubPullRequest {
  return pr !== null && pr.state === "OPEN" && !pr.mergedAt;
}

export function summarizeSupervisorStatusRecords(state: SupervisorStateFile): SupervisorStatusRecords {
  const activeRecord =
    state.activeIssueNumber !== null ? state.issues[String(state.activeIssueNumber)] ?? null : null;
  let latestRecord: IssueRunRecord | null = null;
  let latestRecoveryRecord: IssueRunRecord | null = null;

  for (const record of Object.values(state.issues)) {
    if (latestRecord === null || record.updated_at.localeCompare(latestRecord.updated_at) > 0) {
      latestRecord = record;
    }
    if (
      record.last_recovery_reason &&
      record.last_recovery_at &&
      (latestRecoveryRecord === null ||
        record.last_recovery_at.localeCompare(latestRecoveryRecord.last_recovery_at ?? "") > 0)
    ) {
      latestRecoveryRecord = record;
    }
  }

  return {
    activeRecord,
    latestRecord,
    latestRecoveryRecord,
    trackedIssueCount: Object.keys(state.issues).length,
  };
}

export async function loadActiveIssueStatusSnapshot(args: {
  github: ActiveStatusGitHub & Partial<ActiveStatusIssueGitHub>;
  config: SupervisorConfig;
  activeRecord: IssueRunRecord;
}): Promise<ActiveIssueStatusSnapshot> {
  let handoffSummary: string | null = null;
  let pr: GitHubPullRequest | null = null;
  let checks: PullRequestCheck[] = [];
  let reviewThreads: ReviewThread[] = [];
  let changeClassesSummary: string | null = null;
  let verificationPolicySummary: string | null = null;
  let durableGuardrailSummary: string | null = null;
  let externalReviewFollowUpSummary: string | null = null;
  let warningMessage: string | null = null;

  if (args.activeRecord.journal_path) {
    try {
      handoffSummary = summarizeIssueJournalHandoff(await readIssueJournal(args.activeRecord.journal_path));
    } catch (error) {
      warningMessage = error instanceof Error ? error.message : String(error);
    }
  }

  try {
    const changedFiles = await loadStatusChangedFiles(args.config, args.activeRecord.workspace);
    const issue = args.github.getIssue
      ? await args.github.getIssue(args.activeRecord.issue_number)
      : null;
    pr = await args.github.resolvePullRequestForBranch(args.activeRecord.branch, args.activeRecord.pr_number);
    checks = isOpenPullRequest(pr) ? await args.github.getChecks(pr.number) : [];
    reviewThreads = isOpenPullRequest(pr) ? await args.github.getUnresolvedReviewThreads(pr.number) : [];
    changeClassesSummary = buildChangeClassesStatusLine(changedFiles);
    verificationPolicySummary = buildVerificationPolicyStatusLine({ issue, changedFiles });
    durableGuardrailSummary = await buildDurableGuardrailStatusLine({
      config: args.config,
      activeRecord: args.activeRecord,
      pr,
      changedFiles,
    });
    externalReviewFollowUpSummary = await buildExternalReviewFollowUpStatusLine({
      activeRecord: args.activeRecord,
      currentHeadSha: pr?.headRefOid ?? args.activeRecord.last_head_sha,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warningMessage = warningMessage ? `${warningMessage}; ${message}` : message;
  }

  return {
    pr,
    checks,
    reviewThreads,
    handoffSummary,
    changeClassesSummary,
    verificationPolicySummary,
    durableGuardrailSummary,
    externalReviewFollowUpSummary,
    warningMessage,
  };
}

export async function buildReadinessSummary(
  github: ReadinessSummaryGitHub,
  config: SupervisorConfig,
  state: SupervisorStateFile,
): Promise<string[]> {
  const issues = await github.listCandidateIssues();
  const runnable: string[] = [];
  const blocked: string[] = [];

  for (const issue of issues) {
    if (config.skipTitlePrefixes.some((prefix) => issue.title.startsWith(prefix))) {
      continue;
    }

    const existing = state.issues[String(issue.number)];
    const readiness = lintExecutionReadyIssueBody(issue);
    if (shouldEnforceExecutionReady(existing) && !readiness.isExecutionReady) {
      blocked.push(
        `#${issue.number} blocked_by=requirements:${formatExecutionReadyMissingFields(readiness.missingRequired)}`,
      );
      continue;
    }

    const clarificationBlock = findHighRiskBlockingAmbiguity(issue);
    if (clarificationBlock) {
      blocked.push(
        `#${issue.number} blocked_by=clarification:${clarificationBlock.ambiguityClasses.join("|")}:${clarificationBlock.riskyChangeClasses.join("|")}`,
      );
      continue;
    }

    const blockingIssue = findBlockingIssue(issue, issues, state);
    if (blockingIssue) {
      blocked.push(`#${issue.number} blocked_by=${blockingIssue.reason}`);
      continue;
    }

    if (!isEligibleForSelection(existing, config)) {
      blocked.push(`#${issue.number} blocked_by=local_state:${existing?.state ?? "unknown"}`);
      continue;
    }

    runnable.push(`#${issue.number} ready=${formatRunnableReadinessReason(issue, issues, state, readiness.isExecutionReady)}`);
  }

  return [
    `runnable_issues=${runnable.length > 0 ? runnable.join(",") : "none"}`,
    `blocked_issues=${blocked.length > 0 ? blocked.join("; ") : "none"}`,
  ];
}

export async function buildSelectionWhySummary(
  github: SelectionWhyGitHub,
  config: SupervisorConfig,
  state: SupervisorStateFile,
): Promise<string[]> {
  const candidateIssues = await github.listCandidateIssues();
  const issues = await github.listAllIssues();

  for (const issue of candidateIssues) {
    if (config.skipTitlePrefixes.some((prefix) => issue.title.startsWith(prefix))) {
      continue;
    }

    const existing = state.issues[String(issue.number)];
    const readiness = lintExecutionReadyIssueBody(issue);
    if (shouldEnforceExecutionReady(existing) && !readiness.isExecutionReady) {
      continue;
    }

    if (findHighRiskBlockingAmbiguity(issue)) {
      continue;
    }

    if (findBlockingIssue(issue, issues, state)) {
      continue;
    }

    if (!isEligibleForSelection(existing, config)) {
      continue;
    }

    return [
      `selected_issue=#${issue.number}`,
      `selection_reason=${formatSelectionReason(issue, issues, state, existing, readiness.isExecutionReady, config)}`,
    ];
  }

  return ["selected_issue=none", "selection_reason=no_runnable_issue"];
}

function buildNonRunnableLocalStateReasons(record: IssueRunRecord, config: SupervisorConfig): string[] {
  const reasons: string[] = [];

  if (record.state === "blocked") {
    if (record.blocked_reason === "manual_review" || record.blocked_reason === "manual_pr_closed") {
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

export async function buildIssueExplainSummary(
  github: ExplainIssueGitHub,
  config: SupervisorConfig,
  state: SupervisorStateFile,
  issueNumber: number,
): Promise<string[]> {
  const [issue, issues, candidateIssues] = await Promise.all([
    github.getIssue(issueNumber),
    github.listAllIssues(),
    github.listCandidateIssues(),
  ]);
  const record = state.issues[String(issue.number)];
  const readiness = lintExecutionReadyIssueBody(issue);
  const clarificationBlock = findHighRiskBlockingAmbiguity(issue);
  const blockingIssue = findBlockingIssue(issue, issues, state);
  const matchingSkipPrefix = config.skipTitlePrefixes.find((prefix) => issue.title.startsWith(prefix)) ?? null;
  const candidateIssueNumbers = new Set(candidateIssues.map((candidate) => candidate.number));
  const reasons: string[] = [];
  const changeRiskLines = await buildExplainChangeRiskSummary({
    config,
    issue,
    record,
  });
  const externalReviewFollowUpSummary = await buildExplainExternalReviewFollowUpSummary({
    github,
    config,
    record,
  });

  if (matchingSkipPrefix) {
    reasons.push(`skip_title_prefix ${matchingSkipPrefix}`);
  }

  if (!candidateIssueNumbers.has(issue.number)) {
    reasons.push("candidate filtered_by_candidate_list");
  }

  if (shouldEnforceExecutionReady(record) && !readiness.isExecutionReady) {
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

  if (record && !isEligibleForSelection(record, config)) {
    reasons.push(...buildNonRunnableLocalStateReasons(record, config));
  }

  const runnable = reasons.length === 0;
  const lines = [
    `issue=#${issue.number}`,
    `title=${issue.title}`,
    `state=${record?.state ?? "untracked"}`,
    `blocked_reason=${record?.blocked_reason ?? "none"}`,
    `runnable=${runnable ? "yes" : "no"}`,
    ...changeRiskLines,
    ...(externalReviewFollowUpSummary ? [externalReviewFollowUpSummary] : []),
  ];

  if (runnable) {
    lines.push(`selection_reason=${formatSelectionReason(issue, issues, state, record, readiness.isExecutionReady, config)}`);
  } else {
    reasons.forEach((reason, index) => {
      lines.push(`reason_${index + 1}=${reason}`);
    });
  }

  if (record?.last_error) {
    lines.push(`last_error=${record.last_error}`);
  }
  if (record?.last_failure_context?.summary) {
    lines.push(`failure_summary=${record.last_failure_context.summary}`);
  }

  return lines;
}

function formatRunnableReadinessReason(
  issue: GitHubIssue,
  issues: GitHubIssue[],
  state: SupervisorStateFile,
  isExecutionReady: boolean,
): string {
  const metadata = parseIssueMetadata(issue);
  const reasons = [isExecutionReady ? "execution_ready" : "requirements_skipped"];

  if (metadata.dependsOn.length > 0) {
    const satisfiedDependencies = metadata.dependsOn.filter(
      (dependencyNumber) => state.issues[String(dependencyNumber)]?.state === "done",
    );

    if (satisfiedDependencies.length > 0) {
      reasons.push(`depends_on_satisfied:${satisfiedDependencies.join("|")}`);
    }
  }

  if (
    metadata.parentIssueNumber !== null &&
    metadata.executionOrderIndex !== null &&
    metadata.executionOrderIndex > 1
  ) {
    const clearedPredecessors = issues
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
      .map(({ issue: predecessorIssue }) => predecessorIssue.number)
      .filter((predecessorNumber) => state.issues[String(predecessorNumber)]?.state === "done");

    if (clearedPredecessors.length > 0) {
      reasons.push(`execution_order_satisfied:${clearedPredecessors.join("|")}`);
    }
  }

  return reasons.join("+");
}

function formatSelectionReason(
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
      : `${metadata.dependsOn.join("|")}:${metadata.dependsOn.every((dependencyNumber) => state.issues[String(dependencyNumber)]?.state === "done") ? "done" : "pending"}`;

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
        predecessors.every((predecessorNumber) => state.issues[String(predecessorNumber)]?.state === "done")
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

  return `resume:${record.state}`;
}
