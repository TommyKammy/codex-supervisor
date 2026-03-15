import {
  classifyConfiguredBotTopLevelReviewStrength,
  hasActionableReviewText,
  isActionableTopLevelReview,
} from "./external-review-signal-heuristics";
import { CopilotReviewState, GitHubPullRequest, PullRequestCheck } from "./types";

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
}

export interface CopilotReviewLifecycleFacts {
  reviewRequests: string[];
  reviews: Array<{
    authorLogin: string | null;
    submittedAt: string | null;
    state?: string | null;
    body?: string | null;
  }>;
  comments: Array<{
    authorLogin: string | null;
    createdAt: string | null;
  }>;
  issueComments: Array<{
    authorLogin: string | null;
    createdAt: string | null;
    body: string | null;
  }>;
  timeline: Array<{
    type: "requested" | "removed";
    createdAt: string | null;
    reviewerLogin: string | null;
  }>;
}

export interface CopilotReviewLifecycle {
  state: CopilotReviewState;
  requestedAt: string | null;
  arrivedAt: string | null;
}

export interface ConfiguredBotTopLevelReviewSummary {
  strength: "nitpick_only" | "blocking" | null;
  submittedAt: string | null;
}

export interface ConfiguredBotReviewSummary {
  lifecycle: CopilotReviewLifecycle;
  topLevelReview: ConfiguredBotTopLevelReviewSummary;
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

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  let latestMs = 0;

  for (const value of values) {
    const parsed = parseTimestamp(value);
    if (parsed === 0) {
      continue;
    }

    if (!latest || parsed >= latestMs) {
      latest = value ?? null;
      latestMs = parsed;
    }
  }

  return latest;
}

export function inferCopilotReviewLifecycle(
  facts: CopilotReviewLifecycleFacts,
  reviewBotLogins: string[],
): CopilotReviewLifecycle {
  const configuredReviewBots = new Set(reviewBotLogins.map((login) => normalizeLogin(login)).filter((login): login is string => Boolean(login)));
  if (configuredReviewBots.size === 0) {
    return { state: "not_requested", requestedAt: null, arrivedAt: null };
  }

  const matchingReviewTimes = facts.reviews.flatMap((review) => {
    const authorLogin = normalizeLogin(review.authorLogin);
    return authorLogin && configuredReviewBots.has(authorLogin) && isActionableTopLevelReview(review) ? [review.submittedAt] : [];
  });
  const matchingCommentTimes = facts.comments.flatMap((comment) => {
    const authorLogin = normalizeLogin(comment.authorLogin);
    return authorLogin && configuredReviewBots.has(authorLogin) ? [comment.createdAt] : [];
  });
  const matchingIssueCommentTimes = facts.issueComments.flatMap((comment) => {
    const authorLogin = normalizeLogin(comment.authorLogin);
    return authorLogin && configuredReviewBots.has(authorLogin) && hasActionableReviewText(comment.body)
      ? [comment.createdAt]
      : [];
  });
  const arrivedAt = latestTimestamp([...matchingReviewTimes, ...matchingCommentTimes, ...matchingIssueCommentTimes]);
  if (arrivedAt) {
    return {
      state: "arrived",
      requestedAt: latestTimestamp(
        facts.timeline
          .filter((event) => event.type === "requested" && event.reviewerLogin && configuredReviewBots.has(event.reviewerLogin))
          .map((event) => event.createdAt),
      ),
      arrivedAt,
    };
  }

  const matchingRequests = facts.reviewRequests.filter((login) => configuredReviewBots.has(normalizeLogin(login) ?? ""));
  const latestRequestedAt = latestTimestamp(
    facts.timeline
      .filter((event) => event.type === "requested" && event.reviewerLogin && configuredReviewBots.has(event.reviewerLogin))
      .map((event) => event.createdAt),
  );
  const latestRemovedAt = latestTimestamp(
    facts.timeline
      .filter((event) => event.type === "removed" && event.reviewerLogin && configuredReviewBots.has(event.reviewerLogin))
      .map((event) => event.createdAt),
  );

  if (
    matchingRequests.length > 0 ||
    (latestRequestedAt !== null && (latestRemovedAt === null || parseTimestamp(latestRequestedAt) > parseTimestamp(latestRemovedAt)))
  ) {
    return {
      state: "requested",
      requestedAt: latestRequestedAt,
      arrivedAt: null,
    };
  }

  return { state: "not_requested", requestedAt: null, arrivedAt: null };
}

function inferConfiguredBotTopLevelReviewSummary(
  facts: CopilotReviewLifecycleFacts,
  reviewBotLogins: string[],
): ConfiguredBotTopLevelReviewSummary {
  const configuredReviewBots = new Set(
    reviewBotLogins.map((login) => normalizeLogin(login)).filter((login): login is string => Boolean(login)),
  );
  if (configuredReviewBots.size === 0) {
    return { strength: null, submittedAt: null };
  }

  let latestConfiguredReview: ConfiguredBotTopLevelReviewSummary = { strength: null, submittedAt: null };
  let latestConfiguredReviewMs = 0;
  let sawNonConfiguredChangesRequestedReview = false;

  for (const review of facts.reviews) {
    const authorLogin = normalizeLogin(review.authorLogin);
    if (!authorLogin || normalizeLogin(review.state)?.replace(/\s+/g, "_") !== "changes_requested") {
      continue;
    }

    if (!configuredReviewBots.has(authorLogin)) {
      sawNonConfiguredChangesRequestedReview = true;
      continue;
    }

    const submittedAtMs = parseTimestamp(review.submittedAt);
    if (latestConfiguredReview.submittedAt && submittedAtMs < latestConfiguredReviewMs) {
      continue;
    }

    latestConfiguredReview = {
      strength: classifyConfiguredBotTopLevelReviewStrength(review),
      submittedAt: review.submittedAt,
    };
    latestConfiguredReviewMs = submittedAtMs;
  }

  if (!latestConfiguredReview.strength) {
    return { strength: null, submittedAt: null };
  }

  if (sawNonConfiguredChangesRequestedReview) {
    return {
      strength: "blocking",
      submittedAt: latestConfiguredReview.submittedAt,
    };
  }

  return latestConfiguredReview;
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
        submittedAt: node?.submittedAt ?? null,
        state: node?.state ?? null,
        body: node?.body ?? null,
      })) ?? [],
    comments:
      lifecycle?.reviewThreads?.nodes?.flatMap((thread) =>
        (thread?.comments?.nodes ?? []).map((comment) => ({
          authorLogin: normalizeLogin(comment?.author?.login ?? null),
          createdAt: comment?.createdAt ?? null,
        })),
      ) ?? [],
    issueComments:
      lifecycle?.comments?.nodes?.map((comment) => ({
        authorLogin: normalizeLogin(comment?.author?.login ?? null),
        createdAt: comment?.createdAt ?? null,
        body: comment?.body ?? null,
      })) ?? [],
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
): ConfiguredBotReviewSummary {
  const facts = mapCopilotReviewLifecycleFacts(lifecycle);
  return {
    lifecycle: inferCopilotReviewLifecycle(facts, reviewBotLogins),
    topLevelReview: inferConfiguredBotTopLevelReviewSummary(facts, reviewBotLogins),
  };
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
    configuredBotTopLevelReviewStrength: summary?.topLevelReview.strength ?? null,
    configuredBotTopLevelReviewSubmittedAt: summary?.topLevelReview.submittedAt ?? null,
  };
}
