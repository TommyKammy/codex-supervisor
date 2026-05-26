import {
  evaluateCodexConnectorConvergencePolicy,
  hasCodexConnectorFindingReviewComment,
  hasCodexConnectorPrSuccessCurrentHeadObservation,
} from "./codex-connector-review-policy";
import {
  configuredBotReviewThreads,
  latestReviewComment,
  latestReviewCommentAuthorIsAllowedBot,
  manualReviewThreads,
} from "./review-thread-reporting";
import {
  conversationResolutionEvidenceContradictsBlocker,
  conversationResolutionEvidenceDetails,
  conversationResolutionEvidenceToken,
} from "./conversation-resolution-policy";
import type {
  FailureContext,
  GitHubPullRequest,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
} from "./core/types";

export interface ConversationResolutionBlockerDiagnostic {
  blockerSignature: string;
  statusLine: string;
  failureContext: FailureContext;
  persistentCommentEvidence: string[];
  threadIds: string[];
  threads: ReviewThread[];
}

export function buildConversationResolutionFailureContext(args: {
  pr: GitHubPullRequest;
  threads: ReviewThread[];
}): FailureContext {
  const threadIds = args.threads.map((thread) => thread.id).sort();
  return {
    category: "blocked",
    summary:
      `GitHub reports PR #${args.pr.number} as blocked after green checks; unresolved outdated configured-bot conversations remain.`,
    signature: threadIds.map((threadId) => `stalled-bot:${threadId}`).join("|"),
    command: null,
    details: args.threads
      .map((thread) => {
        const latestComment = latestReviewComment(thread);
        return [
          `thread=${thread.id}`,
          `reviewer=${latestComment?.author?.login ?? "unknown"}`,
          `file=${thread.path ?? "unknown"}`,
          `line=${thread.line ?? "unknown"}`,
          "is_outdated=yes",
          "processed_on_current_head=yes",
        ].join(" ");
      })
      .sort(),
    url: latestReviewComment(args.threads[0])?.url ?? args.pr.url,
    updated_at: new Date(0).toISOString(),
  };
}

export function buildRequiredCheckMismatchEvidence(args: {
  pr: Pick<GitHubPullRequest, "mergeStateStatus" | "mergeable" | "requiredConversationResolution">;
  checks: PullRequestCheck[];
}): string[] {
  const sortedChecks = [...args.checks]
    .map((check) => `check=${check.name}:${check.bucket}:${check.state}`)
    .sort();

  return [
    `merge_state=${args.pr.mergeStateStatus}`,
    `mergeable=${args.pr.mergeable ?? "unknown"}`,
    conversationResolutionEvidenceToken(args.pr),
    ...sortedChecks,
    ...conversationResolutionEvidenceDetails(args.pr).slice(1),
  ];
}

function isClearableConversationResolutionResidueThread(
  config: SupervisorConfig,
  pr: GitHubPullRequest,
  thread: ReviewThread,
): boolean {
  if (!thread.isOutdated) {
    return false;
  }

  if (latestReviewCommentAuthorIsAllowedBot(config, thread)) {
    return true;
  }

  return hasCodexConnectorPrSuccessCurrentHeadObservation(pr) && hasCodexConnectorFindingReviewComment(thread);
}

export function buildConversationResolutionBlockerDiagnostic(args: {
  config: SupervisorConfig;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  summarizeChecks: (checks: PullRequestCheck[]) => { hasPending: boolean; hasFailing: boolean };
}): ConversationResolutionBlockerDiagnostic | null {
  const checkSummary = args.summarizeChecks(args.checks);
  if (
    args.pr.mergeStateStatus !== "BLOCKED" ||
    args.pr.mergeable !== "MERGEABLE" ||
    !(
      args.pr.configuredBotCurrentHeadStatusState === "SUCCESS" ||
      hasCodexConnectorPrSuccessCurrentHeadObservation(args.pr)
    ) ||
    checkSummary.hasPending ||
    checkSummary.hasFailing
  ) {
    return null;
  }

  const unresolvedThreads = args.reviewThreads.filter((thread) => !thread.isResolved);
  if (unresolvedThreads.length === 0 || manualReviewThreads(args.config, unresolvedThreads).length > 0) {
    return null;
  }

  const configuredThreads = configuredBotReviewThreads(args.config, unresolvedThreads);
  if (
    configuredThreads.length !== unresolvedThreads.length ||
    configuredThreads.some((thread) => !isClearableConversationResolutionResidueThread(args.config, args.pr, thread))
  ) {
    return null;
  }

  const codexConnectorPolicy = evaluateCodexConnectorConvergencePolicy(args.config, args.pr, configuredThreads);
  if (codexConnectorPolicy && codexConnectorPolicy.mergeEffect !== "ready") {
    return null;
  }
  if (conversationResolutionEvidenceContradictsBlocker(args.pr)) {
    return null;
  }

  const threadIds = configuredThreads.map((thread) => thread.id).sort();
  const failureContext = buildConversationResolutionFailureContext({
    pr: args.pr,
    threads: configuredThreads,
  });
  const persistentCommentEvidence = [
    `merge_state=${args.pr.mergeStateStatus}`,
    `mergeable=${args.pr.mergeable}`,
    ...conversationResolutionEvidenceDetails(args.pr),
    `conversation_threads=${threadIds.join(",")}`,
    ...buildRequiredCheckMismatchEvidence({ pr: args.pr, checks: args.checks }).filter((line) => line.startsWith("check=")),
  ];

  return {
    blockerSignature: `conversation-resolution:${args.pr.headRefOid}:${threadIds.join(",")}`,
    statusLine: [
      "conversation_resolution_blocker state=blocked",
      conversationResolutionEvidenceToken(args.pr),
      `outdated_configured_bot_threads=${configuredThreads.length}`,
      `thread_ids=${threadIds.join(",")}`,
    ].join(" "),
    failureContext,
    persistentCommentEvidence,
    threadIds,
    threads: configuredThreads,
  };
}
