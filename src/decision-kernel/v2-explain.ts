import {
  buildReviewPolicyInput,
  commitShasEqualForComparison,
  hasCodexConnectorPrSuccessCurrentHeadObservation,
  type ReviewPolicyInput,
} from "../codex-connector-review-policy";
import { displayLocalCiCommand } from "../core/config-parsing";
import type {
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
} from "../core/types";
import {
  DECISION_KERNEL_V2_READ_ONLY_SCHEMA_VERSION,
  evaluateDecisionKernelV2ReadOnlyFromFacts,
  type DecisionKernelV2ReadOnlyDecision,
} from "../decision-kernel-v2";
import {
  currentHeadObservationSatisfiesActiveWait,
  hasCurrentHeadProviderSuccess,
  requiresConfiguredBotCurrentHeadSignal,
} from "../pull-request-state-current-head-policy";
import { effectiveConfiguredBotReviewThreadsForState } from "../pull-request-state-codex-residue-policy";
import { manualReviewThreads } from "../review-thread-reporting";
import type { PrLifecycleFactInventory } from "./pr-lifecycle-state";

export interface DecisionKernelV2ExplainDto {
  issueNumber: number;
  title: string;
  prNumber: number | null;
  targetStatus: "ready" | "missing_tracked_record" | "missing_pull_request" | "hydration_failed";
  guidance: string | null;
  inventory: PrLifecycleFactInventory | null;
  reviewPolicyInput: ReviewPolicyInput | null;
  decision: DecisionKernelV2ReadOnlyDecision | null;
}

export function buildDecisionKernelV2ExplainDto(args: {
  config: SupervisorConfig;
  issueNumber: number;
  title: string;
  record: IssueRunRecord | null;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  hydrationFailed?: boolean;
}): DecisionKernelV2ExplainDto {
  if (!args.record) {
    return missingTarget(args, "missing_tracked_record", "Track the issue through the supervisor before running v2 explain.");
  }

  if (args.hydrationFailed) {
    return missingTarget(args, "hydration_failed", "Refresh PR checks and review threads before relying on v2 diagnostics.");
  }

  if (!args.pr) {
    return missingTarget(args, "missing_pull_request", "Open or restore the tracked pull request before running v2 explain.");
  }

  const effectiveReviewThreads = effectiveReviewThreadsForV2Explain({
    config: args.config,
    pr: args.pr,
    record: args.record,
    checks: args.checks,
    reviewThreads: args.reviewThreads,
  });
  const reviewPolicyInput = buildReviewPolicyInput({
    config: args.config,
    pr: args.pr,
    record: args.record,
    reviewThreads: effectiveReviewThreads,
  });
  const inventory = buildPrLifecycleFactInventory({
    config: args.config,
    record: args.record,
    pr: args.pr,
    checks: args.checks,
    reviewPolicyInput,
  });
  const currentHeadLocalCiPassed = localCiPassedCurrentHead({
    record: args.record,
    pr: args.pr,
  });
  const localCiConfigured = Boolean(displayLocalCiCommand(args.config.localCiCommand));
  const decision = evaluateDecisionKernelV2ReadOnlyFromFacts({
    inventory,
    reviewPolicyInput,
    checkPolicyInput: {
      noChecksAndNoLocalCi: args.checks.length === 0 && (!localCiConfigured || currentHeadLocalCiPassed),
      mergeReadyBlockedByRequiredChecks: args.checks.length === 0,
      mergeReadyBlockedByLocalCi: mergeReadyBlockedByLocalCi({
        config: args.config,
        record: args.record,
        pr: args.pr,
      }),
      mergeReadyBlockedByFinalGuard: mergeReadyBlockedByFinalGuard({
        config: args.config,
        record: args.record,
        pr: args.pr,
        checks: args.checks,
        reviewThreads: args.reviewThreads,
      }),
    },
  });

  return {
    issueNumber: args.issueNumber,
    title: args.title,
    prNumber: args.pr.number,
    targetStatus: "ready",
    guidance: null,
    inventory,
    reviewPolicyInput,
    decision,
  };
}

export function renderDecisionKernelV2ExplainDto(dto: DecisionKernelV2ExplainDto): string {
  const lines = [
    `issue=#${dto.issueNumber}`,
    `title=${dto.title}`,
    `v2_schema=${DECISION_KERNEL_V2_READ_ONLY_SCHEMA_VERSION}`,
    "v2_status=diagnostic_only",
    "v2_authoritative=false",
    "v2_mutation_allowed=false",
    `v2_target_status=${dto.targetStatus}`,
    `pr=${dto.prNumber === null ? "none" : `#${dto.prNumber}`}`,
  ];

  if (dto.guidance) {
    lines.push(`v2_guidance=${dto.guidance}`);
  }

  if (dto.inventory) {
    lines.push(
      [
        "v2_facts",
        `head=${dto.inventory.pullRequest?.headSha ?? "none"}`,
        `source=${dto.inventory.source}`,
        `review_required=${dto.inventory.configuredCurrentHeadReviewRequired ? "yes" : "no"}`,
        `checks=pass:${dto.inventory.checks.passingCount},pending:${dto.inventory.checks.pendingCount},fail:${dto.inventory.checks.failingCount},unknown:${dto.inventory.checks.unknownCount}`,
        `threads=manual:${dto.inventory.reviewThreads.unresolvedManualThreadCount},current_bot:${dto.inventory.reviewThreads.unresolvedCurrentHeadConfiguredBotThreadCount},stale_bot:${dto.inventory.reviewThreads.stalePreviousHeadConfiguredBotThreadCount},metadata:${dto.inventory.reviewThreads.metadataOnlyUnresolvedThreadCount}`,
        `local=tracked:${dto.inventory.localState.trackedHeadSha ?? "none"},workspace:${dto.inventory.localState.workspaceHeadSha ?? "none"},last_pr:${dto.inventory.localState.lastObservedPrHeadSha ?? "none"}`,
      ].join(" "),
    );
  }

  if (dto.decision) {
    const state = dto.decision.normalizedState;
    lines.push(
      [
        "v2_normalized",
        `head_freshness=${state.headFreshness}`,
        `local_state=${state.localStateFreshness}`,
        `review=${state.reviewPosture}`,
        `checks=${state.checkPosture}`,
        `mergeability=${state.mergeability}`,
      ].join(" "),
      [
        "v2_decision",
        `action=${dto.decision.action}`,
        `reasons=${dto.decision.reasons.length === 0 ? "none" : dto.decision.reasons.join("|")}`,
        `required_evidence=${dto.decision.requiredEvidence.length === 0 ? "none" : dto.decision.requiredEvidence.join("|")}`,
        `summary=${dto.decision.summary.replace(/\s+/g, "_")}`,
      ].join(" "),
    );
  }

  return lines.join("\n");
}

function missingTarget(
  args: {
    issueNumber: number;
    title: string;
    record: IssueRunRecord | null;
  },
  targetStatus: DecisionKernelV2ExplainDto["targetStatus"],
  guidance: string,
): DecisionKernelV2ExplainDto {
  return {
    issueNumber: args.issueNumber,
    title: args.title,
    prNumber: args.record?.pr_number ?? null,
    targetStatus,
    guidance,
    inventory: null,
    reviewPolicyInput: null,
    decision: null,
  };
}

function buildPrLifecycleFactInventory(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewPolicyInput: ReviewPolicyInput;
}): PrLifecycleFactInventory {
  const currentHeadReviewEvidence = currentHeadReviewEvidenceFromPolicyInput({
    pr: args.pr,
    record: args.record,
    reviewPolicyInput: args.reviewPolicyInput,
  });

  return {
    source: args.pr.hydrationProvenance === "cached" ? "cached_github" : "fresh_github",
    observedAt: args.pr.updatedAt ?? args.pr.createdAt ?? null,
    pullRequest: {
      number: args.pr.number,
      headSha: args.pr.headRefOid,
      state: args.pr.state,
      isDraft: args.pr.isDraft,
      mergeStateStatus: args.pr.mergeStateStatus,
      mergeable: args.pr.mergeable ?? null,
      currentHeadReviewObservedAt: currentHeadReviewEvidence.observedAt,
      currentHeadReviewHeadSha: currentHeadReviewEvidence.headSha,
    },
    reviewThreads: summarizeReviewThreads(args.reviewPolicyInput, {
      currentHeadReviewObserved: currentHeadReviewEvidence.headSha === args.pr.headRefOid,
    }),
    checks: summarizeCheckFacts(args.checks),
    localState: {
      trackedHeadSha: args.record.last_head_sha ?? null,
      workspaceHeadSha: null,
      lastObservedPrHeadSha: args.record.last_head_sha ?? null,
    },
    configuredCurrentHeadReviewRequired: requiresConfiguredBotCurrentHeadSignal(args.config),
  };
}

function currentHeadReviewEvidenceFromPolicyInput(args: {
  pr: GitHubPullRequest;
  record: IssueRunRecord;
  reviewPolicyInput: ReviewPolicyInput;
}): { observedAt: string | null; headSha: string | null } {
  if (
    args.reviewPolicyInput.pr.currentHeadObservedAt &&
    currentHeadObservationSatisfiesActiveWait(args.record, args.pr)
  ) {
    return {
      observedAt: args.reviewPolicyInput.pr.currentHeadObservedAt,
      headSha: args.pr.headRefOid,
    };
  }

  if (hasCurrentHeadProviderSuccess(args.record, args.pr)) {
    return {
      observedAt: args.record.provider_success_observed_at ?? null,
      headSha: args.pr.headRefOid,
    };
  }

  if (commitShasEqualForComparison(args.reviewPolicyInput.pr.externalReviewHeadSha, args.pr.headRefOid)) {
    return {
      observedAt: args.pr.updatedAt ?? args.pr.createdAt ?? null,
      headSha: args.pr.headRefOid,
    };
  }

  return {
    observedAt: null,
    headSha: null,
  };
}

function mergeReadyBlockedByLocalCi(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
}): boolean {
  if (!displayLocalCiCommand(args.config.localCiCommand)) {
    return false;
  }

  return !localCiPassedCurrentHead(args);
}

function localCiPassedCurrentHead(args: {
  record: IssueRunRecord;
  pr: GitHubPullRequest;
}): boolean {
  const latestLocalCi = args.record.latest_local_ci_result ?? null;
  return latestLocalCi?.outcome === "passed" && commitShasEqualForComparison(latestLocalCi.head_sha, args.pr.headRefOid);
}

function effectiveReviewThreadsForV2Explain(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): ReviewThread[] {
  return [
    ...manualReviewThreads(args.config, args.reviewThreads),
    ...effectiveConfiguredBotReviewThreadsForState(
      args.config,
      args.record,
      args.pr,
      args.checks,
      args.reviewThreads,
    ),
  ];
}

function mergeReadyBlockedByFinalGuard(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): boolean {
  if (args.pr.mergeable !== "MERGEABLE") {
    return true;
  }

  if (args.config.humanReviewBlocksMerge && isBlockingHumanReviewDecision(args.pr)) {
    return true;
  }

  if (args.config.codexConnectorAutoMergeEnabled === true && !hasCurrentHeadCodexNoMajor(args.record, args.pr)) {
    return true;
  }

  return effectiveConfiguredBotReviewThreadsForState(
    args.config,
    args.record,
    args.pr,
    args.checks,
    args.reviewThreads,
  ).length > 0;
}

function isBlockingHumanReviewDecision(pr: GitHubPullRequest): boolean {
  return (
    pr.reviewDecision === "REVIEW_REQUIRED" ||
    (pr.reviewDecision === "CHANGES_REQUESTED" && pr.configuredBotTopLevelReviewStrength !== "nitpick_only")
  );
}

function hasCurrentHeadCodexNoMajor(record: IssueRunRecord, pr: GitHubPullRequest): boolean {
  return hasCurrentHeadProviderSuccess(record, pr) && hasCodexConnectorPrSuccessCurrentHeadObservation(pr);
}

function summarizeCheckFacts(checks: PullRequestCheck[]): PrLifecycleFactInventory["checks"] {
  const facts: PrLifecycleFactInventory["checks"] = {
    passingCount: 0,
    pendingCount: 0,
    failingCount: 0,
    unknownCount: 0,
  };

  for (const check of checks) {
    if (check.bucket === "pass" || check.bucket === "skipping") {
      facts.passingCount += 1;
    } else if (check.bucket === "pending" || check.bucket === "cancel") {
      facts.pendingCount += 1;
    } else if (check.bucket === "fail") {
      facts.failingCount += 1;
    } else {
      facts.unknownCount += 1;
    }
  }

  return facts;
}

function summarizeReviewThreads(
  input: ReviewPolicyInput,
  options: { currentHeadReviewObserved: boolean },
): PrLifecycleFactInventory["reviewThreads"] {
  const facts: PrLifecycleFactInventory["reviewThreads"] = {
    unresolvedManualThreadCount: 0,
    unresolvedCurrentHeadConfiguredBotThreadCount: 0,
    stalePreviousHeadConfiguredBotThreadCount: 0,
    metadataOnlyUnresolvedThreadCount: 0,
  };

  for (const thread of input.threads) {
    if (thread.isResolved) {
      continue;
    }

    if (thread.boundaryOutcome === "manual_thread") {
      facts.unresolvedManualThreadCount += 1;
    } else if (thread.boundaryOutcome === "stale_commit_thread") {
      facts.stalePreviousHeadConfiguredBotThreadCount += 1;
    } else if (thread.boundaryOutcome === "metadata_only_unresolved") {
      if (options.currentHeadReviewObserved) {
        facts.metadataOnlyUnresolvedThreadCount += 1;
      }
    } else if (thread.boundaryOutcome === "softened_p3_advisory") {
      if (options.currentHeadReviewObserved) {
        facts.unresolvedCurrentHeadConfiguredBotThreadCount += 1;
      }
    } else if (
      thread.boundaryOutcome === "must_fix_current_head" ||
      thread.boundaryOutcome === "escalated_p3" ||
      thread.boundaryOutcome === "configured_bot_thread"
    ) {
      facts.unresolvedCurrentHeadConfiguredBotThreadCount += 1;
    }
  }

  return facts;
}
