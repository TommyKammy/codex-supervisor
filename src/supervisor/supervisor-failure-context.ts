import {
  buildChecksFailureContext,
  buildConflictFailureContext,
  buildCurrentHeadLocalReviewPendingFailureContext,
} from "../pull-request-failure-context";
import { shouldRunLocalReview } from "../local-review";
import { buildCopilotReviewTimeoutFailureContext } from "../pull-request-state";
import {
  configuredBotReviewFollowUpState,
  configuredBotReviewThreads,
  buildManualReviewFailureContext,
  buildRequestedChangesFailureContext,
  buildReviewFailureContext,
  buildStalledBotReviewFailureContext,
  manualReviewThreads,
  pendingBotReviewThreads,
} from "../review-thread-reporting";
import {
  localReviewBlocksMerge,
  localReviewDegradedNeedsBlock,
  localReviewFailureContext,
  localReviewHighSeverityNeedsBlock,
  localReviewRetryLoopStalled,
  localReviewStallFailureContext,
} from "../review-handling";
import { mergeConflictDetected, summarizeChecks } from "./supervisor-reporting";
import {
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
} from "../core/types";

export function inferFailureContext(
  config: SupervisorConfig,
  record: IssueRunRecord,
  pr: GitHubPullRequest | null,
  checks: PullRequestCheck[],
  reviewThreads: ReviewThread[],
): FailureContext | null {
  if (pr) {
    const checksContext = buildChecksFailureContext(pr, checks);
    if (checksContext) {
      return checksContext;
    }

    const copilotTimeoutContext = buildCopilotReviewTimeoutFailureContext(config, record, pr);
    if (copilotTimeoutContext) {
      return copilotTimeoutContext;
    }

    if (pr.reviewDecision === "CHANGES_REQUESTED") {
      const manualReviewContext =
        config.humanReviewBlocksMerge ? buildManualReviewFailureContext(manualReviewThreads(config, reviewThreads)) : null;
      if (manualReviewContext) {
        return manualReviewContext;
      }

      const reviewContext = buildReviewFailureContext(pendingBotReviewThreads(config, record, pr, reviewThreads));
      if (reviewContext) {
        return reviewContext;
      }

      const stalledBotReviewContext = buildStalledBotReviewFailureContext(
        configuredBotReviewThreads(config, reviewThreads),
        configuredBotReviewFollowUpState(record, pr, configuredBotReviewThreads(config, reviewThreads)) ===
          "exhausted"
          ? "exhausted_follow_up"
          : "no_progress",
      );
      if (stalledBotReviewContext) {
        return stalledBotReviewContext;
      }

      if (config.humanReviewBlocksMerge) {
        return buildRequestedChangesFailureContext(pr);
      }
    }

    if (
      localReviewRetryLoopStalled(
        config,
        record,
        pr,
        checks,
        reviewThreads,
        manualReviewThreads,
        configuredBotReviewThreads,
        summarizeChecks,
        mergeConflictDetected,
      )
    ) {
      return localReviewStallFailureContext(record);
    }

    if (!pr.isDraft && shouldRunLocalReview(config, record, pr)) {
      return buildCurrentHeadLocalReviewPendingFailureContext({ pr, record });
    }

    if (localReviewHighSeverityNeedsBlock(config, record, pr)) {
      return localReviewFailureContext(record);
    }

    const manualReviewContext =
      config.humanReviewBlocksMerge ? buildManualReviewFailureContext(manualReviewThreads(config, reviewThreads)) : null;
    if (manualReviewContext) {
      return manualReviewContext;
    }

    const reviewContext = buildReviewFailureContext(pendingBotReviewThreads(config, record, pr, reviewThreads));
    if (reviewContext) {
      return reviewContext;
    }

    const stalledBotReviewContext = buildStalledBotReviewFailureContext(
      configuredBotReviewThreads(config, reviewThreads),
      configuredBotReviewFollowUpState(record, pr, configuredBotReviewThreads(config, reviewThreads)) === "exhausted"
        ? "exhausted_follow_up"
        : "no_progress",
    );
    if (stalledBotReviewContext) {
      return stalledBotReviewContext;
    }

    if (localReviewDegradedNeedsBlock(config, record, pr)) {
      return localReviewFailureContext(record);
    }

    if (localReviewBlocksMerge(config, record, pr)) {
      return localReviewFailureContext(record);
    }

    if (mergeConflictDetected(pr)) {
      return buildConflictFailureContext(pr);
    }
  }

  return null;
}
