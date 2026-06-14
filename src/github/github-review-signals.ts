import {
  classifyConfiguredBotTopLevelReviewStrength,
  hasActionableReviewText,
  isActionableTopLevelReview,
  isDraftSkipReviewText,
  isRateLimitReviewText,
} from "../external-review/external-review-signal-heuristics";
import {
  isCodexConnectorLogin,
  normalizeReviewBotLogins,
  normalizeReviewProviderLogin,
} from "../core/review-providers";
import type { CopilotReviewState } from "./types";

export interface CopilotReviewLifecycleFacts {
  reviewsComplete?: boolean;
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
    id?: string | null;
    databaseId?: number | null;
    authorLogin: string | null;
    createdAt: string | null;
    body: string | null;
    url?: string | null;
    viewerDidAuthor?: boolean | null;
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
  configuredBotOnlyChangesRequestedReview?: boolean | null;
}

export interface ConfiguredBotReviewSummary {
  lifecycle: CopilotReviewLifecycle;
  topLevelReview: ConfiguredBotTopLevelReviewSummary;
  codexConnectorReviewRequest?: CodexConnectorReviewRequestObservation | null;
  currentHeadObservedAt: string | null;
  currentHeadObservationSource: ConfiguredBotCurrentHeadObservationSource;
  currentHeadStatusState: string | null;
  latestReviewedCommitSha: string | null;
  currentHeadCiGreenAt: string | null;
  rateLimitWarningAt: string | null;
  draftSkipAt: string | null;
}

export type ConfiguredBotCurrentHeadObservationSource =
  | "review"
  | "review_thread_comment"
  | "status_context"
  | "codex_pr_success_comment"
  | null;

export interface CodexConnectorReviewRequestObservation {
  requestedAt: string | null;
  headSha: string;
  commentDatabaseId: number | null;
  commentNodeId: string | null;
  commentUrl: string | null;
}

export interface CodexConnectorReviewRequestIdentity {
  issueNumber?: number | null;
  prNumber: number;
  headSha: string;
}

const CODEX_CONNECTOR_REVIEW_REQUEST_MARKER = "codex-supervisor:codex-connector-review-request";

function markerValue(value: string | number): string {
  return String(value).replace(/[\s<>]/g, "");
}

export function renderCodexConnectorReviewRequestComment(
  identity: CodexConnectorReviewRequestIdentity & { issueNumber: number },
): string {
  const issue = markerValue(identity.issueNumber);
  const pr = markerValue(identity.prNumber);
  const head = markerValue(identity.headSha);
  return [
    "@codex review",
    "",
    `<!-- ${CODEX_CONNECTOR_REVIEW_REQUEST_MARKER} issue=${issue} pr=${pr} head=${head} -->`,
  ].join("\n");
}

function parseCodexConnectorReviewRequestMarker(
  body: string | null | undefined,
): { issueNumber: number | null; prNumber: number; headSha: string } | null {
  const markerPattern =
    /<!--\s*codex-supervisor:codex-connector-review-request\s+issue=(\d+)\s+pr=(\d+)\s+head=([^\s>]+)\s*-->/;
  const match = markerPattern.exec(body ?? "");
  if (!match) {
    return null;
  }

  const issueNumber = Number.parseInt(match[1] ?? "", 10);
  const prNumber = Number.parseInt(match[2] ?? "", 10);
  const headSha = match[3]?.trim() ?? "";
  if (!Number.isInteger(issueNumber) || !Number.isInteger(prNumber) || !headSha) {
    return null;
  }

  return { issueNumber, prNumber, headSha };
}

export function findCodexConnectorReviewRequest(
  issueComments: CopilotReviewLifecycleFacts["issueComments"],
  identity: CodexConnectorReviewRequestIdentity,
): CodexConnectorReviewRequestObservation | null {
  const normalizedHeadSha = identity.headSha.trim();
  if (!normalizedHeadSha || !Number.isInteger(identity.prNumber)) {
    return null;
  }

  let latest: CodexConnectorReviewRequestObservation | null = null;
  let latestMs = 0;
  for (const comment of issueComments) {
    if (comment.viewerDidAuthor !== true || !/^@codex review$/m.test(comment.body ?? "")) {
      continue;
    }

    const marker = parseCodexConnectorReviewRequestMarker(comment.body);
    if (
      !marker ||
      marker.prNumber !== identity.prNumber ||
      marker.headSha !== normalizedHeadSha ||
      (identity.issueNumber !== undefined && identity.issueNumber !== null && marker.issueNumber !== identity.issueNumber)
    ) {
      continue;
    }

    const createdAtMs = parseTimestamp(comment.createdAt);
    if (!latest || createdAtMs >= latestMs) {
      latest = {
        requestedAt: comment.createdAt,
        headSha: marker.headSha,
        commentDatabaseId: typeof comment.databaseId === "number" ? comment.databaseId : null,
        commentNodeId: comment.id ?? null,
        commentUrl: comment.url ?? null,
      };
      latestMs = createdAtMs;
    }
  }

  return latest;
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLogin(value: string | null | undefined): string | null {
  return normalizeReviewProviderLogin(value);
}

function isCodeRabbitLogin(value: string | null | undefined): boolean {
  return (normalizeLogin(value) ?? "").includes("coderabbit");
}

function hasConfiguredCodexConnectorLogin(configuredReviewBots: Set<string>): boolean {
  return Array.from(configuredReviewBots).some((login) => isCodexConnectorLogin(login));
}

function hasConfiguredCodeRabbitLogin(configuredReviewBots: Set<string>): boolean {
  return Array.from(configuredReviewBots).some((login) => isCodeRabbitLogin(login));
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
  return (
    hasConfiguredCodeRabbitLogin(args.configuredReviewBots) &&
    (normalizedContext.includes("coderabbit") || normalizedDescription.includes("coderabbit"))
  );
}

function isCodeRabbitStatusContext(args: {
  creatorLogin: string | null | undefined;
  context: string | null | undefined;
  description?: string | null | undefined;
}): boolean {
  return (
    isCodeRabbitLogin(args.creatorLogin) ||
    (args.context ?? "").trim().toLowerCase().includes("coderabbit") ||
    (args.description ?? "").trim().toLowerCase().includes("coderabbit")
  );
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

function isCodexConnectorPrSuccessCommentText(value: string | null | undefined): boolean {
  const normalized = value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
  if (!normalized) {
    return false;
  }

  const mentionsReviewScope = /\b(review|reviewed|analysis|checked|pull request|pr)\b/.test(normalized);
  const mentionsNoIssueSuccess =
    /\bno\s+(?:major|actionable|blocking|critical)\s+issues?\b/.test(normalized) ||
    /\bno\s+(?:major|actionable|blocking|critical)?\s*issues?\s+(?:found|detected|identified|reported)\b/.test(normalized) ||
    /\b(?:didn't|did not|doesn't|does not)\s+(?:find|detect|identify|see)\s+(?:any\s+)?(?:major|actionable|blocking|critical)?\s*issues?\b/.test(
      normalized,
    );
  const issueReportText = normalized
    .replace(/\bno\s+(?:major|actionable|blocking|critical)\s+issues?\b/g, " ")
    .replace(/\bno\s+(?:major|actionable|blocking|critical)?\s*issues?\s+(?:found|detected|identified|reported)\b/g, " ")
    .replace(
      /\b(?:didn't|did not|doesn't|does not)\s+(?:find|detect|identify|see)\s+(?:any\s+)?(?:major|actionable|blocking|critical)?\s*issues?\b/g,
      " ",
    );

  const reportsIssues =
    /\b(?:found|identified|detected)\s+(?:\w+\s+){0,3}(?:issues?|problems?|concerns?)\b/.test(issueReportText) ||
    /\b(?:critical|major|blocking|actionable)\s+(?:issues?|problems?|concerns?)\s+(?:found|identified|detected|reported)\b/.test(
      issueReportText,
    );
  if (reportsIssues) {
    return false;
  }
  if (mentionsNoIssueSuccess) {
    return mentionsReviewScope;
  }

  const mentionsCompletion =
    /\b(successfully completed|completed successfully|review completed|finished review|review is complete|reviewed this pull request)\b/.test(
      normalized,
    );
  const mentionsSuccess = /\b(success|successful|no issues found|no actionable issues|looks good)\b/.test(normalized);

  return mentionsReviewScope && mentionsCompletion && mentionsSuccess;
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
    .filter((event) => {
      const reviewerLogin = normalizeLogin(event.reviewerLogin);
      return event.type === "requested" && reviewerLogin && configuredReviewBots.has(reviewerLogin);
    })
    .map((event) => event.createdAt);
  const latestRequestedAt = latestTimestamp(requestedTimes);

  const activeRequestStarts = Array.from(configuredReviewBots).flatMap((botLogin) => {
    const botLatestRequestedAt = latestTimestamp(
      timeline
        .filter((event) => event.type === "requested" && normalizeLogin(event.reviewerLogin) === botLogin)
        .map((event) => event.createdAt),
    );
    const botLatestRemovedAt = latestTimestamp(
      timeline
        .filter((event) => event.type === "removed" && normalizeLogin(event.reviewerLogin) === botLogin)
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
          .filter((event) => event.type === "removed" && normalizeLogin(event.reviewerLogin) === botLogin)
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

function normalizeReviewState(state: string | null | undefined): string | null {
  return normalizeLogin(state)?.replace(/\s+/g, "_") ?? null;
}

function inferConfiguredBotOnlyChangesRequestedReview(
  facts: CopilotReviewLifecycleFacts,
  reviewBotLogins: string[],
): boolean | null {
  const configuredReviewBots = new Set(normalizeReviewBotLogins(reviewBotLogins));
  if (configuredReviewBots.size === 0) {
    return null;
  }
  if (facts.reviewsComplete === false) {
    return null;
  }

  const changesRequestedAuthors = new Set<string>();
  const chronologicalReviews = facts.reviews
    .map((review, index) => ({
      ...review,
      index,
      submittedAtMs: parseTimestamp(review.submittedAt),
      state: normalizeReviewState(review.state),
    }))
    .sort((left, right) =>
      left.submittedAtMs === right.submittedAtMs ? left.index - right.index : left.submittedAtMs - right.submittedAtMs,
    );

  for (const review of chronologicalReviews) {
    const authorLogin = normalizeLogin(review.authorLogin);
    if (!authorLogin) {
      continue;
    }

    if (review.state === "changes_requested") {
      changesRequestedAuthors.add(authorLogin);
      continue;
    }

    if (review.state === "approved" || review.state === "dismissed") {
      changesRequestedAuthors.delete(authorLogin);
    }
  }

  if (changesRequestedAuthors.size === 0) {
    return null;
  }

  return Array.from(changesRequestedAuthors).every((authorLogin) => configuredReviewBots.has(authorLogin));
}

function reviewedCommitFromBody(body: string | null | undefined): string | null {
  const match = body?.match(/\bReviewed commit:\s*([0-9a-f]{7,40})\b/i);
  return match?.[1] ?? null;
}

function inferLatestConfiguredBotReviewedCommitSha(
  facts: CopilotReviewLifecycleFacts,
  reviewBotLogins: string[],
): string | null {
  const configuredReviewBots = new Set(normalizeReviewBotLogins(reviewBotLogins));
  if (configuredReviewBots.size === 0) {
    return null;
  }

  let latest: { submittedAtMs: number; reviewedCommitSha: string | null } | null = null;
  for (const review of facts.reviews) {
    const authorLogin = normalizeLogin(review.authorLogin);
    if (!authorLogin || !configuredReviewBots.has(authorLogin)) {
      continue;
    }

    const submittedAtMs = parseTimestamp(review.submittedAt);
    if (submittedAtMs === 0) {
      continue;
    }

    const reviewedCommitSha = reviewedCommitFromBody(review.body) ?? review.commitOid?.trim() ?? null;
    if (!reviewedCommitSha) {
      continue;
    }

    if (!latest || submittedAtMs >= latest.submittedAtMs) {
      latest = { submittedAtMs, reviewedCommitSha };
    }
  }

  return latest?.reviewedCommitSha ?? null;
}

function inferConfiguredBotCurrentHeadObservation(
  facts: CopilotReviewLifecycleFacts,
  reviewBotLogins: string[],
  currentHeadOid: string | null | undefined,
): { observedAt: string | null; source: ConfiguredBotCurrentHeadObservationSource } {
  const normalizedCurrentHeadOid = currentHeadOid?.trim();
  if (!normalizedCurrentHeadOid) {
    return { observedAt: null, source: null };
  }

  const configuredReviewBots = new Set(normalizeReviewBotLogins(reviewBotLogins));
  if (configuredReviewBots.size === 0) {
    return { observedAt: null, source: null };
  }

  const currentHeadObservations: Array<{ observedAt: string | null | undefined; source: NonNullable<ConfiguredBotCurrentHeadObservationSource> }> = [];
  for (const review of facts.reviews) {
    const authorLogin = normalizeLogin(review.authorLogin);
    if (
      authorLogin &&
      configuredReviewBots.has(authorLogin) &&
      review.commitOid === normalizedCurrentHeadOid
    ) {
      currentHeadObservations.push({ observedAt: review.submittedAt, source: "review" });
    }
  }

  for (const comment of facts.comments) {
    const authorLogin = normalizeLogin(comment.authorLogin);
    if (
      authorLogin &&
      configuredReviewBots.has(authorLogin) &&
      comment.originalCommitOid === normalizedCurrentHeadOid
    ) {
      currentHeadObservations.push({ observedAt: comment.createdAt, source: "review_thread_comment" });
    }
  }

  for (const statusContext of facts.statusContexts ?? []) {
    if (
      statusContext.commitOid === normalizedCurrentHeadOid &&
      isConfiguredBotStatusContextActivity({
        creatorLogin: statusContext.creatorLogin,
        context: statusContext.context,
        description: statusContext.description,
        configuredReviewBots,
      })
    ) {
      currentHeadObservations.push({ observedAt: statusContext.createdAt, source: "status_context" });
    }
  }

  if (hasConfiguredCodexConnectorLogin(configuredReviewBots)) {
    for (const comment of facts.issueComments) {
      const authorLogin = normalizeLogin(comment.authorLogin);
      if (
        authorLogin &&
        isCodexConnectorLogin(authorLogin) &&
        isCodexConnectorPrSuccessCommentText(comment.body)
      ) {
        currentHeadObservations.push({ observedAt: comment.createdAt, source: "codex_pr_success_comment" });
      }
    }
  }

  const latestStrongCurrentHeadObservedAt = latestTimestamp(currentHeadObservations.map((observation) => observation.observedAt));
  if (!latestStrongCurrentHeadObservedAt) {
    return { observedAt: null, source: null };
  }
  const latestStrongCurrentHeadObservationSource =
    currentHeadObservations
      .filter((observation) => observation.observedAt === latestStrongCurrentHeadObservedAt)
      .at(-1)?.source ?? null;

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

  const latestObservedAt = latestTimestamp([
    latestStrongCurrentHeadObservedAt,
    ...weaklyAnchoredCodeRabbitCommentTimes,
    ...followUpIssueCommentTimes,
  ]);

  return {
    observedAt: latestObservedAt,
    source: latestObservedAt === latestStrongCurrentHeadObservedAt ? latestStrongCurrentHeadObservationSource : "review_thread_comment",
  };
}

function inferConfiguredBotCurrentHeadStatusState(
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

  let latestMatch: { createdAt: string; state: string } | null = null;
  for (const statusContext of facts.statusContexts ?? []) {
    if (
      statusContext.commitOid !== normalizedCurrentHeadOid ||
      !isCodeRabbitStatusContext(statusContext) ||
      !isConfiguredBotStatusContextActivity({
        creatorLogin: statusContext.creatorLogin,
        context: statusContext.context,
        description: statusContext.description,
        configuredReviewBots,
      })
    ) {
      continue;
    }

    const createdAtMs = parseTimestamp(statusContext.createdAt);
    const normalizedState = statusContext.state?.trim().toUpperCase() ?? null;
    if (createdAtMs === 0 || !normalizedState) {
      continue;
    }

    if (!latestMatch || createdAtMs >= parseTimestamp(latestMatch.createdAt)) {
      latestMatch = {
        createdAt: statusContext.createdAt ?? "",
        state: normalizedState,
      };
    }
  }

  return latestMatch?.state ?? null;
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

  const { activeRequestStartedAt, latestRemovedByBot } = summarizeConfiguredBotRequestWindow(
    facts.timeline,
    configuredReviewBots,
  );
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
        isDraftSkipReviewText(comment.body) &&
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
  currentHeadOid?: string | null,
  codexConnectorReviewRequestIdentity?: CodexConnectorReviewRequestIdentity | null,
): ConfiguredBotReviewSummary {
  const currentHeadObservation = inferConfiguredBotCurrentHeadObservation(facts, reviewBotLogins, currentHeadOid);
  const topLevelReview = inferConfiguredBotTopLevelReviewSummary(facts, reviewBotLogins);
  Object.defineProperty(topLevelReview, "configuredBotOnlyChangesRequestedReview", {
    enumerable: false,
    value: inferConfiguredBotOnlyChangesRequestedReview(facts, reviewBotLogins),
  });
  const summary = {
    lifecycle: inferCopilotReviewLifecycle(facts, reviewBotLogins),
    topLevelReview,
    ...(codexConnectorReviewRequestIdentity
      ? {
          codexConnectorReviewRequest: findCodexConnectorReviewRequest(facts.issueComments, codexConnectorReviewRequestIdentity),
        }
      : {}),
    currentHeadObservedAt: currentHeadObservation.observedAt,
    currentHeadObservationSource: currentHeadObservation.source,
    currentHeadStatusState: inferConfiguredBotCurrentHeadStatusState(facts, reviewBotLogins, currentHeadOid),
    currentHeadCiGreenAt: inferCurrentHeadCiGreenAt(facts, currentHeadOid),
    rateLimitWarningAt: inferConfiguredBotRateLimitWarningAt(facts, reviewBotLogins),
    draftSkipAt: inferConfiguredBotDraftSkipAt(facts, reviewBotLogins),
  } as ConfiguredBotReviewSummary;
  Object.defineProperty(summary, "latestReviewedCommitSha", {
    enumerable: false,
    value: inferLatestConfiguredBotReviewedCommitSha(facts, reviewBotLogins),
  });
  return summary;
}
