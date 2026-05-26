import {
  configuredReviewProviderKinds,
  reviewProviderProfileFromConfig,
} from "../core/review-providers";
import { GitHubPullRequest, IssueRunRecord, ReviewThread, SupervisorConfig } from "../core/types";

export type ReviewThreadClassifier = (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[];

export type ReviewBotProfileId = "none" | "copilot" | "codex" | "coderabbit" | "custom";

export interface ReviewBotProfileSummary {
  profile: ReviewBotProfileId;
  provider: string;
  reviewers: string[];
  signalSource: string;
}

export function configuredBotReviewNotExpectedWhileDraft(config: SupervisorConfig, pr: GitHubPullRequest): boolean {
  return configuredReviewProviderKinds(config).includes("coderabbit") && pr.isDraft && Boolean(pr.configuredBotDraftSkipAt);
}

export function inferReviewBotProfile(config: SupervisorConfig): ReviewBotProfileSummary {
  return reviewProviderProfileFromConfig(config);
}

export function summarizeObservedReviewSignal(
  config: SupervisorConfig,
  activeRecord: IssueRunRecord,
  pr: GitHubPullRequest,
  reviewThreads: ReviewThread[],
  configuredBotReviewThreads: ReviewThreadClassifier,
): { observedReview: string; hasSignal: boolean } {
  const configuredThreads = configuredBotReviewThreads(config, reviewThreads);
  if (configuredThreads.length > 0) {
    return { observedReview: "review_thread", hasSignal: true };
  }

  if (activeRecord.external_review_head_sha === pr.headRefOid) {
    return { observedReview: "external_review_record", hasSignal: true };
  }

  if (pr.configuredBotCurrentHeadObservationSource === "codex_pr_success_comment" && pr.configuredBotCurrentHeadObservedAt) {
    return { observedReview: "codex_pr_success_comment", hasSignal: true };
  }

  const lifecycleState = pr.copilotReviewState ?? "not_requested";
  if (lifecycleState === "arrived") {
    return { observedReview: "copilot_arrived", hasSignal: true };
  }
  if (lifecycleState === "requested") {
    return { observedReview: "copilot_requested", hasSignal: false };
  }
  if (pr.copilotReviewState === null) {
    return { observedReview: "unknown", hasSignal: false };
  }

  return { observedReview: "none", hasSignal: false };
}
