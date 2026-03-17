import {
  classifyConfiguredBotTopLevelReviewStrength,
  hasActionableReviewText,
  isActionableTopLevelReview,
  isDraftSkipReviewText,
  isRateLimitReviewText,
} from "../external-review/external-review-signal-heuristics";
import { normalizeReviewBotLogins } from "../core/review-providers";
import { CopilotReviewState } from "../core/types";

export interface CopilotReviewLifecycleFacts {
  reviewRequests: string[];
  reviews: Array<{
    authorLogin: string | null;
    submittedAt: string | null;
    commitOid?: string | null;
    state?: string | null;
    body?: string | null;
  }>;
  comments: Array<{
    authorLogin: string | null;
    createdAt: string | null;
    originalCommitOid?: string | null;
  }>;
  issueComments: Array<{
    authorLogin: string | null;
    createdAt: string | null;
    body: string | null;
  }>;
  statusContexts?: Array<{
    creatorLogin: string | null;
    context: string | null;
    description?: string | null;
    state?: string | null;
    createdAt: string | null;
    isRequired?: boolean | null;
    commitOid?: string | null;
  }>;
  checkRuns?: Array<{
    name: string | null;
    status: string | null;
    conclusion?: string | null;
    startedAt?: string | null;
    completedAt: string | null;
    isRequired?: boolean | null;
    commitOid?: string | null;
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
  currentHeadObservedAt: string | null;
  currentHeadCiGreenAt: string | null;
  rateLimitWarningAt: string | null;
  draftSkipAt: string | null;
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

function isCodeRabbitLogin(value: string | null | undefined): boolean {
  return (normalizeLogin(value) ?? "").includes("coderabbit");
}

function isConfiguredBotStatusContextActivity(args: {
  creatorLogin: string | null | undefined;
  context: string | null | undefined;
  description?: string | null | undefined;
  configuredReviewBots: Set<string>;
}): boolean {
  const creatorLogin = normalizeLogin(args.creatorLogin);
  if (creatorLogin && args.configuredReviewBots.has(creatorLogin)) {
    return true;
  }

  const normalizedContext = (args.context ?? "").trim().toLowerCase();
  const normalizedDescription = (args.description ?? "").trim().toLowerCase();
  return normalizedContext.includes("coderabbit") || normalizedDescription.includes("coderabbit");
}

function mapCheckBucket(args: {
  state?: string | null;
  conclusion?: string | null;
}): "pass" | "fail" | "pending" | "skipping" | "cancel" | string {
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
  const configuredReviewBots = new Set(normalizeReviewBotLogins(reviewBotLogins));
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
  const configuredReviewBots = new Set(normalizeReviewBotLogins(reviewBotLogins));
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

function inferConfiguredBotCurrentHeadObservedAt(
  facts: CopilotReviewLifecycleFacts,
  reviewBotLogins: string[],
  currentHeadOid: string | null | undefined,
): string | null {
  const normalizedCurrentHeadOid = currentHeadOid?.trim();
  if (!normalizedCurrentHeadOid) {
    return null;
  }

  const configuredReviewBots = new Set(normalizeReviewBotLogins(reviewBotLogins));
  if (configuredReviewBots.size === 0) {
    return null;
  }

  const currentHeadReviewTimes = facts.reviews.flatMap((review) => {
    const authorLogin = normalizeLogin(review.authorLogin);
    return authorLogin &&
      configuredReviewBots.has(authorLogin) &&
      review.commitOid === normalizedCurrentHeadOid
      ? [review.submittedAt]
      : [];
  });

  const currentHeadCommentTimes = facts.comments.flatMap((comment) => {
    const authorLogin = normalizeLogin(comment.authorLogin);
    return authorLogin &&
      configuredReviewBots.has(authorLogin) &&
      comment.originalCommitOid === normalizedCurrentHeadOid
      ? [comment.createdAt]
      : [];
  });

  const currentHeadStatusContextTimes = (facts.statusContexts ?? []).flatMap((statusContext) =>
    statusContext.commitOid === normalizedCurrentHeadOid &&
    isConfiguredBotStatusContextActivity({
      creatorLogin: statusContext.creatorLogin,
      context: statusContext.context,
      description: statusContext.description,
      configuredReviewBots,
    })
      ? [statusContext.createdAt]
      : [],
  );

  const latestStrongCurrentHeadObservedAt = latestTimestamp([
    ...currentHeadReviewTimes,
    ...currentHeadCommentTimes,
    ...currentHeadStatusContextTimes,
  ]);
  if (!latestStrongCurrentHeadObservedAt) {
    return null;
  }

  const latestStrongCurrentHeadObservedAtMs = parseTimestamp(latestStrongCurrentHeadObservedAt);
  const weaklyAnchoredCodeRabbitCommentTimes = facts.comments.flatMap((comment) => {
    const authorLogin = normalizeLogin(comment.authorLogin);
    return authorLogin &&
      configuredReviewBots.has(authorLogin) &&
      isCodeRabbitLogin(authorLogin) &&
      !comment.originalCommitOid &&
      parseTimestamp(comment.createdAt) >= latestStrongCurrentHeadObservedAtMs
      ? [comment.createdAt]
      : [];
  });
  const followUpIssueCommentTimes = facts.issueComments.flatMap((comment) => {
    const authorLogin = normalizeLogin(comment.authorLogin);
    return authorLogin &&
      configuredReviewBots.has(authorLogin) &&
      hasActionableReviewText(comment.body) &&
      parseTimestamp(comment.createdAt) >= latestStrongCurrentHeadObservedAtMs
      ? [comment.createdAt]
      : [];
  });

  return latestTimestamp([
    latestStrongCurrentHeadObservedAt,
    ...weaklyAnchoredCodeRabbitCommentTimes,
    ...followUpIssueCommentTimes,
  ]);
}

function inferCurrentHeadCiGreenAt(
  facts: CopilotReviewLifecycleFacts,
  currentHeadOid: string | null | undefined,
): string | null {
  const normalizedCurrentHeadOid = currentHeadOid?.trim();
  if (!normalizedCurrentHeadOid) {
    return null;
  }

  const requiredChecks = [
    ...(facts.statusContexts ?? [])
      .filter((statusContext) => statusContext.isRequired && statusContext.commitOid === normalizedCurrentHeadOid)
      .map((statusContext) => ({
        bucket: mapCheckBucket({ state: statusContext.state }),
        completedAt: statusContext.createdAt,
      })),
    ...(facts.checkRuns ?? [])
      .filter((checkRun) => checkRun.isRequired && checkRun.commitOid === normalizedCurrentHeadOid)
      .map((checkRun) => ({
        bucket: mapCheckBucket({ state: checkRun.status, conclusion: checkRun.conclusion }),
        completedAt: checkRun.completedAt ?? checkRun.startedAt ?? null,
      })),
  ];

  if (requiredChecks.length === 0) {
    return null;
  }

  let ciGreenAt: string | null = null;
  let ciGreenAtMs = 0;
  for (const check of requiredChecks) {
    if (check.bucket !== "pass" && check.bucket !== "skipping") {
      return null;
    }

    const completedAtMs = parseTimestamp(check.completedAt);
    if (!check.completedAt || completedAtMs === 0) {
      return null;
    }

    if (!ciGreenAt || completedAtMs >= ciGreenAtMs) {
      ciGreenAt = check.completedAt;
      ciGreenAtMs = completedAtMs;
    }
  }

  return ciGreenAt;
}

function inferConfiguredBotRateLimitWarningAt(
  facts: CopilotReviewLifecycleFacts,
  reviewBotLogins: string[],
): string | null {
  const configuredReviewBots = new Set(normalizeReviewBotLogins(reviewBotLogins));
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

function inferConfiguredBotDraftSkipAt(
  facts: CopilotReviewLifecycleFacts,
  reviewBotLogins: string[],
): string | null {
  const configuredReviewBots = new Set(normalizeReviewBotLogins(reviewBotLogins));
  if (configuredReviewBots.size === 0) {
    return null;
  }

  const { activeRequestStartedAt } = summarizeConfiguredBotRequestWindow(facts.timeline, configuredReviewBots);
  const activeRequestStartedAtMs = parseTimestamp(activeRequestStartedAt);
  const scopedToActiveRequest = (value: string | null | undefined): value is string =>
    value !== null &&
    value !== undefined &&
    (activeRequestStartedAt === null || parseTimestamp(value) >= activeRequestStartedAtMs);

  return latestTimestamp(
    facts.issueComments.flatMap((comment) => {
      const authorLogin = normalizeLogin(comment.authorLogin);
      return authorLogin &&
        configuredReviewBots.has(authorLogin) &&
        isDraftSkipReviewText(comment.body) &&
        scopedToActiveRequest(comment.createdAt)
        ? [comment.createdAt]
        : [];
    }),
  );
}

export function buildConfiguredBotReviewSummary(
  facts: CopilotReviewLifecycleFacts,
  reviewBotLogins: string[],
  currentHeadOid?: string | null,
): ConfiguredBotReviewSummary {
  return {
    lifecycle: inferCopilotReviewLifecycle(facts, reviewBotLogins),
    topLevelReview: inferConfiguredBotTopLevelReviewSummary(facts, reviewBotLogins),
    currentHeadObservedAt: inferConfiguredBotCurrentHeadObservedAt(facts, reviewBotLogins, currentHeadOid),
    currentHeadCiGreenAt: inferCurrentHeadCiGreenAt(facts, currentHeadOid),
    rateLimitWarningAt: inferConfiguredBotRateLimitWarningAt(facts, reviewBotLogins),
    draftSkipAt: inferConfiguredBotDraftSkipAt(facts, reviewBotLogins),
  };
}
