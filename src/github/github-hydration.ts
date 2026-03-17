import {
  buildConfiguredBotReviewSummary as summarizeConfiguredBotReviewSignals,
  ConfiguredBotReviewSummary,
  CopilotReviewLifecycleFacts,
} from "./github-review-signals";
import { GitHubPullRequest, PullRequestCheck } from "../core/types";

export interface PullRequestStatusCheckRollupResponse {
  statusCheckRollup?: Array<{
    __typename?: string;
    name?: string;
    workflowName?: string | null;
    detailsUrl?: string | null;
    conclusion?: string | null;
    status?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    context?: string;
    targetUrl?: string | null;
    state?: string | null;
  }>;
}

export interface ReviewActor {
  login?: string | null;
  slug?: string | null;
}

export interface PullRequestCopilotReviewLifecycleResponse {
  reviewRequests?: {
    nodes?: Array<{
      requestedReviewer?: ReviewActor | null;
    } | null>;
  } | null;
  reviews?: {
    nodes?: Array<{
      author?: {
        login?: string | null;
      } | null;
      commit?: {
        oid?: string | null;
      } | null;
      submittedAt?: string | null;
      state?: string | null;
      body?: string | null;
    } | null>;
  } | null;
  comments?: {
    nodes?: Array<{
      createdAt?: string | null;
      body?: string | null;
      author?: {
        login?: string | null;
      } | null;
    } | null>;
  } | null;
  reviewThreads?: {
    nodes?: Array<{
      comments?: {
        nodes?: Array<{
          createdAt?: string | null;
          originalCommit?: {
            oid?: string | null;
          } | null;
          author?: {
            login?: string | null;
          } | null;
        } | null>;
      } | null;
    } | null>;
  } | null;
  timelineItems?: {
    nodes?: Array<{
      __typename?: "ReviewRequestedEvent" | "ReviewRequestRemovedEvent" | string | null;
      createdAt?: string | null;
      requestedReviewer?: ReviewActor | null;
    } | null>;
  } | null;
  commits?: {
    nodes?: Array<{
      commit?: {
        oid?: string | null;
        statusCheckRollup?: {
          contexts?: {
            nodes?: Array<{
              __typename?: string | null;
              context?: string | null;
              description?: string | null;
              createdAt?: string | null;
              creator?: {
                login?: string | null;
              } | null;
            } | null>;
          } | null;
        } | null;
      } | null;
    } | null>;
  } | null;
}

function mapCheckBucket(args: {
  bucket?: string | null;
  state?: string | null;
  conclusion?: string | null;
}): PullRequestCheck["bucket"] {
  const explicitBucket = args.bucket?.toLowerCase();
  if (explicitBucket) {
    return explicitBucket;
  }

  const outcome = (args.conclusion ?? args.state ?? "").toLowerCase();
  if (["success", "successful", "pass", "passed"].includes(outcome)) {
    return "pass";
  }
  if (["pending", "queued", "in_progress", "expected", "waiting", "requested"].includes(outcome)) {
    return "pending";
  }
  if (["failure", "failed", "error", "timed_out", "action_required", "startup_failure"].includes(outcome)) {
    return "fail";
  }
  if (["cancelled", "canceled", "cancel"].includes(outcome)) {
    return "cancel";
  }
  if (["neutral", "skipped", "stale", "skipping"].includes(outcome)) {
    return "skipping";
  }

  return outcome || "unknown";
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLogin(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function extractReviewerLogin(actor: ReviewActor | null | undefined): string | null {
  return normalizeLogin(actor?.login ?? actor?.slug ?? null);
}

export function normalizeRollupChecks(rollup: PullRequestStatusCheckRollupResponse | null | undefined): PullRequestCheck[] {
  const nodes = rollup?.statusCheckRollup ?? [];
  const checks = nodes
    .map((node): PullRequestCheck | null => {
      if (node.__typename === "CheckRun" || node.name) {
        const state = (node.conclusion ?? node.status ?? "UNKNOWN").toUpperCase();
        return {
          name: node.name ?? "unknown",
          state,
          bucket: mapCheckBucket({ state: node.status, conclusion: node.conclusion }),
          workflow: node.workflowName ?? undefined,
          link: node.detailsUrl ?? undefined,
        };
      }

      if (node.__typename === "StatusContext" || node.context) {
        const state = (node.state ?? "UNKNOWN").toUpperCase();
        return {
          name: node.context ?? "unknown",
          state,
          bucket: mapCheckBucket({ state: node.state }),
          link: node.targetUrl ?? undefined,
        };
      }

      return null;
    })
    .filter((check): check is PullRequestCheck => check !== null);

  const deduped = new Map<string, { check: PullRequestCheck; rank: number }>();
  for (const node of nodes) {
    const check =
      (node.__typename === "CheckRun" || node.name)
        ? {
            name: node.name ?? "unknown",
            state: (node.conclusion ?? node.status ?? "UNKNOWN").toUpperCase(),
            bucket: mapCheckBucket({ state: node.status, conclusion: node.conclusion }),
            workflow: node.workflowName ?? undefined,
            link: node.detailsUrl ?? undefined,
          }
        : (node.__typename === "StatusContext" || node.context)
          ? {
              name: node.context ?? "unknown",
              state: (node.state ?? "UNKNOWN").toUpperCase(),
              bucket: mapCheckBucket({ state: node.state }),
              link: node.targetUrl ?? undefined,
            }
          : null;

    if (!check) {
      continue;
    }

    const key = `${check.workflow ?? ""}::${check.name}`;
    const rank = Math.max(parseTimestamp(node.completedAt), parseTimestamp(node.startedAt));
    const existing = deduped.get(key);
    if (!existing || rank >= existing.rank) {
      deduped.set(key, { check, rank });
    }
  }

  if (deduped.size > 0) {
    return Array.from(deduped.values()).map((entry) => entry.check);
  }

  return checks;
}

export function mapCopilotReviewLifecycleFacts(
  lifecycle: PullRequestCopilotReviewLifecycleResponse | null | undefined,
): CopilotReviewLifecycleFacts {
  return {
    reviewRequests:
      lifecycle?.reviewRequests?.nodes
        ?.map((node) => extractReviewerLogin(node?.requestedReviewer))
        .filter((login): login is string => Boolean(login)) ?? [],
    reviews:
      lifecycle?.reviews?.nodes?.map((node) => ({
        authorLogin: normalizeLogin(node?.author?.login ?? null),
        commitOid: node?.commit?.oid ?? null,
        submittedAt: node?.submittedAt ?? null,
        state: node?.state ?? null,
        body: node?.body ?? null,
      })) ?? [],
    comments:
      lifecycle?.reviewThreads?.nodes?.flatMap((thread) =>
        (thread?.comments?.nodes ?? []).map((comment) => ({
          authorLogin: normalizeLogin(comment?.author?.login ?? null),
          createdAt: comment?.createdAt ?? null,
          originalCommitOid: comment?.originalCommit?.oid ?? null,
        })),
      ) ?? [],
    issueComments:
      lifecycle?.comments?.nodes?.map((comment) => ({
        authorLogin: normalizeLogin(comment?.author?.login ?? null),
        createdAt: comment?.createdAt ?? null,
        body: comment?.body ?? null,
      })) ?? [],
    statusContexts:
      lifecycle?.commits?.nodes?.flatMap((node) => {
        const commitOid = node?.commit?.oid ?? null;
        return (
          node?.commit?.statusCheckRollup?.contexts?.nodes?.flatMap((contextNode) => {
            if (contextNode?.__typename !== "StatusContext" && !contextNode?.context) {
              return [];
            }

            return [{
              creatorLogin: normalizeLogin(contextNode?.creator?.login ?? null),
              context: contextNode?.context ?? null,
              description: contextNode?.description ?? null,
              createdAt: contextNode?.createdAt ?? null,
              commitOid,
            }];
          }) ?? []
        );
      }) ?? [],
    timeline:
      lifecycle?.timelineItems?.nodes
        ?.map((node) => {
          if (node?.__typename === "ReviewRequestedEvent") {
            return {
              type: "requested" as const,
              createdAt: node.createdAt ?? null,
              reviewerLogin: extractReviewerLogin(node.requestedReviewer),
            };
          }

          if (node?.__typename === "ReviewRequestRemovedEvent") {
            return {
              type: "removed" as const,
              createdAt: node.createdAt ?? null,
              reviewerLogin: extractReviewerLogin(node.requestedReviewer),
            };
          }

          return null;
        })
        .filter((event): event is CopilotReviewLifecycleFacts["timeline"][number] => event !== null) ?? [],
  };
}

export function buildConfiguredBotReviewSummary(
  lifecycle: PullRequestCopilotReviewLifecycleResponse | null | undefined,
  reviewBotLogins: string[],
  currentHeadOid?: string | null,
): ConfiguredBotReviewSummary {
  return summarizeConfiguredBotReviewSignals(mapCopilotReviewLifecycleFacts(lifecycle), reviewBotLogins, currentHeadOid);
}

export function applyConfiguredBotReviewSummary(
  pr: GitHubPullRequest,
  summary: ConfiguredBotReviewSummary | null,
): GitHubPullRequest {
  return {
    ...pr,
    copilotReviewState: summary?.lifecycle.state ?? null,
    copilotReviewRequestedAt: summary?.lifecycle.requestedAt ?? null,
    copilotReviewArrivedAt: summary?.lifecycle.arrivedAt ?? null,
    configuredBotCurrentHeadObservedAt: summary?.currentHeadObservedAt ?? null,
    configuredBotRateLimitedAt: summary?.rateLimitWarningAt ?? null,
    configuredBotTopLevelReviewStrength: summary?.topLevelReview.strength ?? null,
    configuredBotTopLevelReviewSubmittedAt: summary?.topLevelReview.submittedAt ?? null,
  };
}
