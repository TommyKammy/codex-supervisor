export type PrLifecycleFactSource = "fresh_github" | "cached_github" | "local_state" | "fixture";

export type PrLifecycleHeadFreshness =
  | "no_pull_request"
  | "current_head"
  | "stale_head"
  | "unknown";

export type PrLifecycleReviewPosture =
  | "current_head_review_observed"
  | "missing_current_head_review"
  | "review_blocked"
  | "stale_previous_head_review"
  | "metadata_only_unresolved"
  | "no_unresolved_review"
  | "unknown";

export type PrLifecycleCheckPosture = "green" | "pending" | "failing" | "unknown";

export type PrLifecycleMergeabilityPosture =
  | "mergeable"
  | "conflicted"
  | "draft"
  | "closed"
  | "unknown";

export type PrLifecycleLocalStateFreshness = "fresh" | "stale" | "missing" | "unknown";

export interface PrLifecyclePullRequestFacts {
  number: number;
  headSha: string;
  state: "OPEN" | "CLOSED" | "MERGED" | string;
  isDraft: boolean;
  mergeStateStatus: string | null;
  mergeable: string | null;
  currentHeadReviewObservedAt: string | null;
  currentHeadReviewHeadSha: string | null;
}

export interface PrLifecycleReviewThreadFacts {
  unresolvedManualThreadCount: number;
  unresolvedCurrentHeadConfiguredBotThreadCount: number;
  stalePreviousHeadConfiguredBotThreadCount: number;
  metadataOnlyUnresolvedThreadCount: number;
}

export interface PrLifecycleCheckFacts {
  passingCount: number;
  pendingCount: number;
  failingCount: number;
  unknownCount: number;
}

export interface PrLifecycleLocalStateFacts {
  trackedHeadSha: string | null;
  workspaceHeadSha: string | null;
  lastObservedPrHeadSha: string | null;
}

export interface PrLifecycleFactInventory {
  source: PrLifecycleFactSource;
  observedAt: string | null;
  pullRequest: PrLifecyclePullRequestFacts | null;
  reviewThreads: PrLifecycleReviewThreadFacts;
  checks: PrLifecycleCheckFacts;
  localState: PrLifecycleLocalStateFacts;
  configuredCurrentHeadReviewRequired: boolean;
}

export interface NormalizedPrLifecycleState {
  source: PrLifecycleFactSource;
  observedAt: string | null;
  pullRequestNumber: number | null;
  headSha: string | null;
  headFreshness: PrLifecycleHeadFreshness;
  reviewPosture: PrLifecycleReviewPosture;
  checkPosture: PrLifecycleCheckPosture;
  mergeability: PrLifecycleMergeabilityPosture;
  localStateFreshness: PrLifecycleLocalStateFreshness;
  evidence: {
    manualReviewThreadCount: number;
    currentHeadConfiguredBotThreadCount: number;
    stalePreviousHeadConfiguredBotThreadCount: number;
    metadataOnlyUnresolvedThreadCount: number;
    passingCheckCount: number;
    pendingCheckCount: number;
    failingCheckCount: number;
    unknownCheckCount: number;
    trackedHeadSha: string | null;
    workspaceHeadSha: string | null;
    lastObservedPrHeadSha: string | null;
  };
}

export function normalizePrLifecycleFacts(
  inventory: PrLifecycleFactInventory,
): NormalizedPrLifecycleState {
  const pullRequest = inventory.pullRequest;

  return {
    source: inventory.source,
    observedAt: inventory.observedAt,
    pullRequestNumber: pullRequest?.number ?? null,
    headSha: pullRequest?.headSha ?? null,
    headFreshness: normalizeHeadFreshness(inventory),
    reviewPosture: normalizeReviewPosture(inventory),
    checkPosture: normalizeCheckPosture(inventory.checks),
    mergeability: normalizeMergeability(pullRequest),
    localStateFreshness: normalizeLocalStateFreshness(inventory),
    evidence: {
      manualReviewThreadCount: inventory.reviewThreads.unresolvedManualThreadCount,
      currentHeadConfiguredBotThreadCount:
        inventory.reviewThreads.unresolvedCurrentHeadConfiguredBotThreadCount,
      stalePreviousHeadConfiguredBotThreadCount:
        inventory.reviewThreads.stalePreviousHeadConfiguredBotThreadCount,
      metadataOnlyUnresolvedThreadCount: inventory.reviewThreads.metadataOnlyUnresolvedThreadCount,
      passingCheckCount: inventory.checks.passingCount,
      pendingCheckCount: inventory.checks.pendingCount,
      failingCheckCount: inventory.checks.failingCount,
      unknownCheckCount: inventory.checks.unknownCount,
      trackedHeadSha: inventory.localState.trackedHeadSha,
      workspaceHeadSha: inventory.localState.workspaceHeadSha,
      lastObservedPrHeadSha: inventory.localState.lastObservedPrHeadSha,
    },
  };
}

function normalizeHeadFreshness(inventory: PrLifecycleFactInventory): PrLifecycleHeadFreshness {
  const prHeadSha = inventory.pullRequest?.headSha ?? null;
  if (!prHeadSha) {
    return "no_pull_request";
  }

  const localHeadSha = inventory.localState.workspaceHeadSha ?? inventory.localState.trackedHeadSha;
  if (!localHeadSha) {
    return "unknown";
  }

  return localHeadSha === prHeadSha ? "current_head" : "stale_head";
}

function normalizeReviewPosture(inventory: PrLifecycleFactInventory): PrLifecycleReviewPosture {
  const prHeadSha = inventory.pullRequest?.headSha ?? null;
  if (!prHeadSha) {
    return "unknown";
  }

  if (inventory.reviewThreads.unresolvedManualThreadCount > 0) {
    return "review_blocked";
  }

  if (inventory.reviewThreads.unresolvedCurrentHeadConfiguredBotThreadCount > 0) {
    return "review_blocked";
  }

  if (inventory.reviewThreads.metadataOnlyUnresolvedThreadCount > 0) {
    return "metadata_only_unresolved";
  }

  const observedHeadSha = inventory.pullRequest?.currentHeadReviewHeadSha ?? null;
  if (observedHeadSha === prHeadSha && inventory.pullRequest?.currentHeadReviewObservedAt) {
    return "current_head_review_observed";
  }

  if (inventory.reviewThreads.stalePreviousHeadConfiguredBotThreadCount > 0) {
    return "stale_previous_head_review";
  }

  return inventory.configuredCurrentHeadReviewRequired
    ? "missing_current_head_review"
    : "no_unresolved_review";
}

function normalizeCheckPosture(checks: PrLifecycleCheckFacts): PrLifecycleCheckPosture {
  if (checks.failingCount > 0) {
    return "failing";
  }

  if (checks.pendingCount > 0) {
    return "pending";
  }

  if (checks.unknownCount > 0) {
    return "unknown";
  }

  return checks.passingCount > 0 ? "green" : "unknown";
}

function normalizeMergeability(
  pullRequest: PrLifecyclePullRequestFacts | null,
): PrLifecycleMergeabilityPosture {
  if (!pullRequest) {
    return "unknown";
  }

  if (pullRequest.state !== "OPEN") {
    return "closed";
  }

  if (pullRequest.isDraft) {
    return "draft";
  }

  if (pullRequest.mergeStateStatus === "DIRTY" || pullRequest.mergeable === "CONFLICTING") {
    return "conflicted";
  }

  if (pullRequest.mergeStateStatus === "CLEAN" || pullRequest.mergeable === "MERGEABLE") {
    return "mergeable";
  }

  return "unknown";
}

function normalizeLocalStateFreshness(
  inventory: PrLifecycleFactInventory,
): PrLifecycleLocalStateFreshness {
  const prHeadSha = inventory.pullRequest?.headSha ?? null;
  const lastObservedPrHeadSha = inventory.localState.lastObservedPrHeadSha;
  if (!prHeadSha || !lastObservedPrHeadSha) {
    return "missing";
  }

  if (lastObservedPrHeadSha !== prHeadSha) {
    return "stale";
  }

  const localHeadSha = inventory.localState.workspaceHeadSha ?? inventory.localState.trackedHeadSha;
  if (!localHeadSha) {
    return "unknown";
  }

  return localHeadSha === prHeadSha ? "fresh" : "stale";
}
