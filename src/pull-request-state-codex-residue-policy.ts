import {
  codexConnectorCurrentHeadReviewReadiness,
} from "./codex-connector-review-request-decision";
import {
  hasProcessedReviewThread,
  reviewLoopRetryBudgetExhaustedForThread,
} from "./review-handling";
import {
  codexConnectorMustFixReviewThreads,
  codexConnectorNitpickOnlyReviewThreads,
  evaluateCodexConnectorConvergencePolicy,
  hasCodexConnectorFindingReviewComment,
  hasCodexConnectorPrSuccessCurrentHeadObservation,
  latestCodexConnectorReviewCommentFingerprint,
} from "./codex-connector-review-policy";
import {
  IssueRunRecord,
  GitHubPullRequest,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
} from "./core/types";
import {
  configuredReviewProviderKinds,
  repoExpectsConfiguredBotReview,
  reviewProviderWaitPolicyFromConfig,
} from "./core/review-providers";
import {
  configuredBotReviewFollowUpState,
  configuredBotReviewThreads,
  latestReviewCommentAuthorIsAllowedBot,
  manualReviewThreads,
} from "./review-thread-reporting";
import {
  mergeConflictDetected,
  summarizeChecks,
} from "./supervisor/supervisor-reporting";
import {
  buildStaleReviewBotRemediation,
  isProvenStaleReviewMetadataClassification,
} from "./supervisor/stale-review-bot-remediation";
import {
  configuredBotCurrentHeadSignalPending,
  copilotReviewPending,
  currentHeadObservationSatisfiesActiveWait,
  determineCopilotReviewTimeout,
  validTimestamp,
} from "./pull-request-state-current-head-policy";

function isIssueJournalThreadPath(thread: Pick<ReviewThread, "path">): boolean {
  const normalizedPath = thread.path?.replace(/\\/g, "/") ?? "";
  return /^\.codex-supervisor\/.+\/issue-journal\.md$/.test(normalizedPath);
}

function allowJournalOnlyConfiguredBotThreadException(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): boolean {
  if (!reviewProviderWaitPolicyFromConfig(config).shouldApplyCurrentHeadQuietPeriod) {
    return false;
  }

  if (
    pr.state !== "OPEN" ||
    pr.isDraft ||
    pr.mergedAt ||
    pr.mergeStateStatus !== "CLEAN" ||
    pr.mergeable !== "MERGEABLE" ||
    pr.configuredBotCurrentHeadStatusState !== "SUCCESS" ||
    pr.configuredBotTopLevelReviewStrength === "blocking"
  ) {
    return false;
  }

  const checkSummary = summarizeChecks(checks);
  if (!checkSummary.allPassing) {
    return false;
  }

  const unresolvedConfiguredBotThreads = configuredBotReviewThreads(config, reviewThreads);
  return unresolvedConfiguredBotThreads.length > 0 && unresolvedConfiguredBotThreads.every(isIssueJournalThreadPath);
}

function effectiveConfiguredBotReviewThreads(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  const unresolvedConfiguredBotThreads = configuredBotReviewThreads(config, reviewThreads);
  const clearOutdatedCodexConnectorThreads = codexConnectorOutdatedThreadClearanceAllowed(
    config,
    record,
    pr,
    checks,
    reviewThreads,
  );
  const effectiveThreads = codexConnectorThreadsAfterConvergencePolicy(config, pr, unresolvedConfiguredBotThreads);
  const threadsAfterOutdatedClearance = clearOutdatedCodexConnectorThreads
    ? effectiveThreads.filter((thread) => !isClearableOutdatedCodexConnectorResidueThread(config, thread))
    : effectiveThreads;
  return allowJournalOnlyConfiguredBotThreadException(config, pr, checks, threadsAfterOutdatedClearance)
    ? threadsAfterOutdatedClearance.filter((thread) => !isIssueJournalThreadPath(thread))
    : threadsAfterOutdatedClearance;
}

function codexConnectorThreadsAfterConvergencePolicy(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  configuredThreads: ReviewThread[],
): ReviewThread[] {
  const codexConnectorPolicy = evaluateCodexConnectorConvergencePolicy(config, pr, configuredThreads);
  if (codexConnectorPolicy?.outcome !== "nitpick_only" && codexConnectorPolicy?.outcome !== "converged") {
    return configuredThreads;
  }

  const codexConnectorNitpickThreads = new Set(codexConnectorNitpickOnlyReviewThreads(configuredThreads));
  return configuredThreads.filter((thread) => !codexConnectorNitpickThreads.has(thread));
}

function isClearableOutdatedCodexConnectorResidueThread(config: SupervisorConfig, thread: ReviewThread): boolean {
  return (
    thread.isOutdated &&
    (latestReviewCommentAuthorIsAllowedBot(config, thread) || hasCodexConnectorFindingReviewComment(thread))
  );
}

export function effectiveConfiguredBotReviewThreadsForState(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  return hasProvenCodexConnectorStaleReviewMetadata({
    config,
    record,
    pr,
    checks,
    reviewThreads,
  })
    ? []
    : effectiveConfiguredBotReviewThreads(config, record, pr, checks, reviewThreads);
}

function codexConnectorOutdatedThreadClearanceAllowed(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): boolean {
  const providerKinds = configuredReviewProviderKinds(config);
  const checkSummary = summarizeChecks(checks);
  const configuredThreads = configuredBotReviewThreads(config, reviewThreads);
  const codexConnectorPolicy = evaluateCodexConnectorConvergencePolicy(config, pr, configuredThreads);
  const threadsAfterConvergencePolicy = codexConnectorThreadsAfterConvergencePolicy(config, pr, configuredThreads);
  const onlyOutdatedCodexConnectorThreads =
    threadsAfterConvergencePolicy.length > 0 &&
    threadsAfterConvergencePolicy.every((thread) => isClearableOutdatedCodexConnectorResidueThread(config, thread));
  const currentHeadCodexSuccess = hasCodexConnectorPrSuccessCurrentHeadObservation(pr);
  const convergedOutdatedResidueCanClear =
    providerKinds.includes("codex") &&
    providerKinds.every((kind) => kind === "codex") &&
    currentHeadCodexSuccess &&
    pullRequestHeadMatchesRecord(record, pr) &&
    checkSummary.allPassing &&
    manualReviewThreads(config, reviewThreads).length === 0 &&
    !mergeConflictDetected(pr) &&
    onlyOutdatedCodexConnectorThreads &&
    (codexConnectorPolicy?.outcome === "converged" || codexConnectorPolicy?.outcome === "nitpick_only");

  return Boolean(
    providerKinds.includes("codex") &&
      currentHeadCodexSuccess &&
      (currentHeadObservationSatisfiesActiveWait(record, pr) ||
        staleSameHeadCodexWaitHasOnlyOutdatedResidue(config, record, pr, checks, reviewThreads) ||
        convergedOutdatedResidueCanClear) &&
      checkSummary.allPassing,
  );
}

export function staleSameHeadCodexWaitHasOnlyOutdatedResidue(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): boolean {
  const providerKinds = configuredReviewProviderKinds(config);
  if (
    !providerKinds.includes("codex") ||
    providerKinds.some((kind) => kind !== "codex") ||
    !hasCodexConnectorPrSuccessCurrentHeadObservation(pr)
  ) {
    return false;
  }

  if (copilotReviewPending(config, record, pr)) {
    return false;
  }

  const observedAt = validTimestamp(pr.configuredBotCurrentHeadObservedAt);
  const waitStartedAt = validTimestamp(record.review_wait_started_at);
  if (!observedAt || !waitStartedAt || record.review_wait_head_sha !== pr.headRefOid) {
    return false;
  }

  if (Date.parse(observedAt) >= Date.parse(waitStartedAt)) {
    return false;
  }

  if (!pullRequestHeadMatchesRecord(record, pr) || mergeConflictDetected(pr) || !summarizeChecks(checks).allPassing) {
    return false;
  }

  if (manualReviewThreads(config, reviewThreads).length > 0) {
    return false;
  }

  const configuredThreads = configuredBotReviewThreads(config, reviewThreads);
  const threadsAfterConvergencePolicy = codexConnectorThreadsAfterConvergencePolicy(config, pr, configuredThreads);
  return (
    threadsAfterConvergencePolicy.length > 0 &&
    threadsAfterConvergencePolicy.every((thread) => isClearableOutdatedCodexConnectorResidueThread(config, thread))
  );
}

export function hasProvenCodexConnectorStaleReviewMetadata(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): boolean {
  const remediation = buildStaleReviewBotRemediation({
    config: args.config,
    record: args.record,
    pr: args.pr,
    checks: args.checks,
    reviewThreads: args.reviewThreads,
  });
  return remediation ? isProvenStaleReviewMetadataClassification(remediation.classification) : false;
}

function configuredBotThreadsAllowCodexConnectorCurrentHeadWait(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  configuredThreads: ReviewThread[];
}): boolean {
  if (codexConnectorMustFixReviewThreads(args.configuredThreads).length > 0) {
    return false;
  }

  if (configuredBotReviewFollowUpState(args.config, args.record, args.pr, args.configuredThreads) === "eligible") {
    return false;
  }

  return args.configuredThreads.every(
    (thread) =>
      hasProcessedReviewThread(args.record, args.pr, thread) ||
      !latestReviewCommentAuthorIsAllowedBot(args.config, thread),
  );
}

export function shouldWaitForCodexConnectorCurrentHeadReview(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  manualThreads: ReviewThread[];
  unresolvedBotThreads: ReviewThread[];
  nowMs: number;
}): boolean {
  if (
    !configuredReviewProviderKinds(args.config).includes("codex") ||
    args.pr.isDraft ||
    mergeConflictDetected(args.pr) ||
    args.manualThreads.length > 0 ||
    validTimestamp(args.pr.configuredBotCurrentHeadObservedAt)
  ) {
    return false;
  }

  const configuredThreadsAreSafe = configuredBotThreadsAllowCodexConnectorCurrentHeadWait({
    config: args.config,
    record: args.record,
    pr: args.pr,
    configuredThreads: args.unresolvedBotThreads,
  });
  if (
    codexConnectorCurrentHeadReviewReadiness({
      config: args.config,
      pr: args.pr,
      checks: args.checks,
      manualThreadCount: args.manualThreads.length,
      configuredThreadsAreSafe,
      checkSummary: summarizeChecks(args.checks),
      mergeConflict: mergeConflictDetected(args.pr),
    }).kind !== "eligible"
  ) {
    return false;
  }

  const timeout = determineCopilotReviewTimeout(args.config, args.record, args.pr, args.nowMs);
  return (
    (configuredBotCurrentHeadSignalPending(args.config, args.record, args.pr) && !timeout.timedOut) ||
    (timeout.timedOut && timeout.action === "request_review_comment")
  );
}

export function processedCodexConnectorMustFixThreadsExhaustedRepeatBudget(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  manualThreads: ReviewThread[];
  codexConnectorMustFixThreads: ReviewThread[];
}): boolean {
  if (
    !configuredReviewProviderKinds(args.config).includes("codex") ||
    args.codexConnectorMustFixThreads.length === 0 ||
    args.manualThreads.length > 0
  ) {
    return false;
  }

  const checkSummary = summarizeChecks(args.checks);
  if (checkSummary.hasFailing || checkSummary.hasPending || mergeConflictDetected(args.pr)) {
    return false;
  }

  const exhaustedByReviewLoopRetryState = args.codexConnectorMustFixThreads.every((thread) =>
    reviewLoopRetryBudgetExhaustedForThread(
      args.record,
      args.pr,
      thread,
      1,
      latestCodexConnectorReviewCommentFingerprint(thread),
    ),
  );
  const exhaustedByLegacyRepeatStop =
    args.record.last_tracked_pr_repeat_failure_decision === "stop_no_progress" &&
    args.codexConnectorMustFixThreads.every((thread) =>
      hasProcessedReviewThread(args.record, args.pr, thread, latestCodexConnectorReviewCommentFingerprint(thread)),
    );

  return exhaustedByReviewLoopRetryState || exhaustedByLegacyRepeatStop;
}

function isMergeCriticalPullRequest(pr: GitHubPullRequest): boolean {
  return pr.state === "OPEN" && !pr.isDraft && !pr.mergedAt;
}

export function hasConfiguredProviderSuccess(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): boolean {
  if (!repoExpectsConfiguredBotReview(config) || !isMergeCriticalPullRequest(pr)) {
    return false;
  }

  const codexConnectorPolicy = evaluateCodexConnectorConvergencePolicy(config, pr, reviewThreads);
  if (codexConnectorPolicy?.outcome === "must_fix_remaining" || codexConnectorPolicy?.outcome === "missing_current_head_review") {
    return false;
  }

  const clearOutdatedCodexConnectorThreads = codexConnectorOutdatedThreadClearanceAllowed(
    config,
    record,
    pr,
    checks,
    reviewThreads,
  );
  const configuredBotThreads = configuredBotReviewThreads(config, reviewThreads).filter(
    (thread) =>
      !clearOutdatedCodexConnectorThreads ||
      !isClearableOutdatedCodexConnectorResidueThread(config, thread),
  );
  const codexConnectorNitpickThreads = new Set(codexConnectorNitpickOnlyReviewThreads(configuredBotThreads));
  if (configuredBotThreads.filter((thread) => !codexConnectorNitpickThreads.has(thread)).length > 0) {
    return false;
  }

  if (pr.reviewDecision === "CHANGES_REQUESTED" && pr.configuredBotTopLevelReviewStrength !== "nitpick_only") {
    return false;
  }

  const hasConfiguredBotCurrentHeadObservation = validTimestamp(pr.configuredBotCurrentHeadObservedAt) !== null;
  const isStaleCodexPrSuccessComment =
    pr.configuredBotCurrentHeadObservationSource === "codex_pr_success_comment" &&
    !currentHeadObservationSatisfiesActiveWait(record, pr);
  const hasCurrentHeadObservation =
    hasConfiguredBotCurrentHeadObservation &&
    (!isStaleCodexPrSuccessComment ||
      clearOutdatedCodexConnectorThreads ||
      pr.configuredBotCurrentHeadStatusState === "SUCCESS" ||
      pr.configuredBotTopLevelReviewStrength === "nitpick_only");

  return Boolean(
    hasCurrentHeadObservation ||
      validTimestamp(pr.copilotReviewArrivedAt) ||
      (pr.configuredBotTopLevelReviewStrength === "nitpick_only" && validTimestamp(pr.configuredBotTopLevelReviewSubmittedAt)),
  );
}

function pullRequestHeadMatchesRecord(record: Pick<IssueRunRecord, "last_head_sha">, pr: GitHubPullRequest): boolean {
  return record.last_head_sha === null || record.last_head_sha === pr.headRefOid;
}
