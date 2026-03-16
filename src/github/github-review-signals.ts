import {
  classifyConfiguredBotTopLevelReviewStrength,
  hasActionableReviewText,
  isActionableTopLevelReview,
  isRateLimitReviewText,
} from "../external-review/external-review-signal-heuristics";
import { CopilotReviewState } from "../core/types";

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
  rateLimitWarningAt: string | null;
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

function summarizeConfiguredBotRequestWindow(
  timeline: CopilotReviewLifecycleFacts["timeline"],
  configuredReviewBots: Set<string>,
): {
  latestRequestedAt: string | null;
  activeRequestStartedAt: string | null;
  latestRemovedByBot: Map<string, string | null>;
} {
  const requestedTimes = timeline
    .filter((event) => event.type === "requested" && event.reviewerLogin && configuredReviewBots.has(event.reviewerLogin))
    .map((event) => event.createdAt);
  const latestRequestedAt = latestTimestamp(requestedTimes);

  const activeRequestStarts = Array.from(configuredReviewBots).flatMap((botLogin) => {
    const botLatestRequestedAt = latestTimestamp(
      timeline
        .filter((event) => event.type === "requested" && event.reviewerLogin === botLogin)
        .map((event) => event.createdAt),
    );
    const botLatestRemovedAt = latestTimestamp(
      timeline
        .filter((event) => event.type === "removed" && event.reviewerLogin === botLogin)
        .map((event) => event.createdAt),
    );

    return botLatestRequestedAt !== null &&
      (botLatestRemovedAt === null || parseTimestamp(botLatestRequestedAt) > parseTimestamp(botLatestRemovedAt))
      ? [botLatestRequestedAt]
      : [];
  });

  const latestRemovedByBot = new Map<string, string | null>();
  for (const botLogin of configuredReviewBots) {
    latestRemovedByBot.set(
      botLogin,
      latestTimestamp(
        timeline
          .filter((event) => event.type === "removed" && event.reviewerLogin === botLogin)
          .map((event) => event.createdAt),
      ),
    );
  }

  return {
    latestRequestedAt,
    activeRequestStartedAt: latestTimestamp(activeRequestStarts),
    latestRemovedByBot,
  };
}

export function inferCopilotReviewLifecycle(
  facts: CopilotReviewLifecycleFacts,
  reviewBotLogins: string[],
): CopilotReviewLifecycle {
  const configuredReviewBots = new Set(reviewBotLogins.map((login) => normalizeLogin(login)).filter((login): login is string => Boolean(login)));
  if (configuredReviewBots.size === 0) {
    return { state: "not_requested", requestedAt: null, arrivedAt: null };
  }

  const { latestRequestedAt, activeRequestStartedAt, latestRemovedByBot } = summarizeConfiguredBotRequestWindow(
    facts.timeline,
    configuredReviewBots,
  );
  const activeRequestStartedAtMs = parseTimestamp(activeRequestStartedAt);
  const scopedToActiveRequest = (value: string | null | undefined): value is string =>
    value !== null &&
    value !== undefined &&
    (activeRequestStartedAt === null || parseTimestamp(value) >= activeRequestStartedAtMs);

  const matchingReviewTimes = facts.reviews.flatMap((review) => {
    const authorLogin = normalizeLogin(review.authorLogin);
    return authorLogin && configuredReviewBots.has(authorLogin) && isActionableTopLevelReview(review) && scopedToActiveRequest(review.submittedAt)
      ? [review.submittedAt]
      : [];
  });
  const matchingCommentTimes = facts.comments.flatMap((comment) => {
    const authorLogin = normalizeLogin(comment.authorLogin);
    return authorLogin && configuredReviewBots.has(authorLogin) && scopedToActiveRequest(comment.createdAt) ? [comment.createdAt] : [];
  });
  const matchingIssueCommentTimes = facts.issueComments.flatMap((comment) => {
    const authorLogin = normalizeLogin(comment.authorLogin);
    return authorLogin && configuredReviewBots.has(authorLogin) && hasActionableReviewText(comment.body) && scopedToActiveRequest(comment.createdAt)
      ? [comment.createdAt]
      : [];
  });
  const rateLimitWarningTimes = facts.issueComments.flatMap((comment) => {
    const authorLogin = normalizeLogin(comment.authorLogin);
    const latestRemovedAt = authorLogin ? latestRemovedByBot.get(authorLogin) ?? null : null;
    return authorLogin && configuredReviewBots.has(authorLogin) && isRateLimitReviewText(comment.body) && scopedToActiveRequest(comment.createdAt)
      && (latestRemovedAt === null || parseTimestamp(comment.createdAt) > parseTimestamp(latestRemovedAt))
      ? [comment.createdAt]
      : [];
  });
  const arrivedAt = latestTimestamp([...matchingReviewTimes, ...matchingCommentTimes, ...matchingIssueCommentTimes]);
  if (arrivedAt) {
    return {
      state: "arrived",
      requestedAt: activeRequestStartedAt ?? latestRequestedAt,
      arrivedAt,
    };
  }

  const latestRateLimitWarningAt = latestTimestamp(rateLimitWarningTimes);
  if (latestRateLimitWarningAt) {
    return {
      state: "requested",
      requestedAt: latestRateLimitWarningAt,
      arrivedAt: null,
    };
  }

  const matchingRequests = facts.reviewRequests.filter((login) => configuredReviewBots.has(normalizeLogin(login) ?? ""));
  if (matchingRequests.length > 0 || activeRequestStartedAt !== null) {
    return {
      state: "requested",
      requestedAt: activeRequestStartedAt ?? latestRequestedAt,
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

  for (const review of facts.reviews) {
    const authorLogin = normalizeLogin(review.authorLogin);
    if (!authorLogin || normalizeLogin(review.state)?.replace(/\s+/g, "_") !== "changes_requested") {
      continue;
    }

    if (!configuredReviewBots.has(authorLogin)) {
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

  return latestConfiguredReview;
}

function inferConfiguredBotRateLimitWarningAt(
  facts: CopilotReviewLifecycleFacts,
  reviewBotLogins: string[],
): string | null {
  const configuredReviewBots = new Set(
    reviewBotLogins.map((login) => normalizeLogin(login)).filter((login): login is string => Boolean(login)),
  );
  if (configuredReviewBots.size === 0) {
    return null;
  }

  const { activeRequestStartedAt, latestRemovedByBot } = summarizeConfiguredBotRequestWindow(facts.timeline, configuredReviewBots);
  const activeRequestStartedAtMs = parseTimestamp(activeRequestStartedAt);
  const scopedToActiveRequest = (value: string | null | undefined): value is string =>
    value !== null &&
    value !== undefined &&
    (activeRequestStartedAt === null || parseTimestamp(value) >= activeRequestStartedAtMs);

  return latestTimestamp(
    facts.issueComments.flatMap((comment) => {
      const authorLogin = normalizeLogin(comment.authorLogin);
      const latestRemovedAt = authorLogin ? latestRemovedByBot.get(authorLogin) ?? null : null;
      return authorLogin &&
        configuredReviewBots.has(authorLogin) &&
        isRateLimitReviewText(comment.body) &&
        scopedToActiveRequest(comment.createdAt) &&
        (latestRemovedAt === null || parseTimestamp(comment.createdAt) > parseTimestamp(latestRemovedAt))
        ? [comment.createdAt]
        : [];
    }),
  );
}

export function buildConfiguredBotReviewSummary(
  facts: CopilotReviewLifecycleFacts,
  reviewBotLogins: string[],
): ConfiguredBotReviewSummary {
  return {
    lifecycle: inferCopilotReviewLifecycle(facts, reviewBotLogins),
    topLevelReview: inferConfiguredBotTopLevelReviewSummary(facts, reviewBotLogins),
    rateLimitWarningAt: inferConfiguredBotRateLimitWarningAt(facts, reviewBotLogins),
  };
}
