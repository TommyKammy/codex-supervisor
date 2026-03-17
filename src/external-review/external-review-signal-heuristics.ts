function normalizeReviewText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

const RATE_LIMIT_REVIEW_TEXT_PATTERN = /\brate limit exceeded\b/;
const CLOSED_PULL_REQUEST_REVIEW_TEXT_PATTERN =
  /\b(?:pull request|pr)\b[^.!?\n\r]*\balready closed\b|\balready closed\b[^.!?\n\r]*\b(?:pull request|pr)\b/;

const NITPICK_REVIEW_TEXT_PATTERN =
  /\b(nit|nitpick|nits|style|format|formatting|typo|wording|docs?|documentation|comment|comments|naming|rename|readability|consistency|prefer)\b/;
const STRONG_REVIEW_TEXT_PATTERN =
  /\b(bug|issue|error|warning|fix|fixed|missing|fails?|failure|broken|incorrect|unsafe|security|panic|crash|deadlock|regression|data loss|leak)\b/;

export function isInformationalReviewText(value: string | null | undefined): boolean {
  const normalized = normalizeReviewText(value);
  if (!normalized) {
    return false;
  }

  return (
    (normalized.includes("summary") && normalized.includes("no actionable")) ||
    normalized.includes("no actionable issues") ||
    normalized.includes("no actionable comments") ||
    normalized.includes("skipping review") ||
    normalized.includes("skip review") ||
    normalized.includes("still in draft") ||
    normalized.includes("pull request is in draft") ||
    normalized.includes("pull request is still in draft") ||
    CLOSED_PULL_REQUEST_REVIEW_TEXT_PATTERN.test(normalized)
  );
}

export function isDraftSkipReviewText(value: string | null | undefined): boolean {
  const normalized = normalizeReviewText(value);
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("skipping review") ||
    normalized.includes("skip review") ||
    normalized.includes("still in draft") ||
    normalized.includes("pull request is in draft") ||
    normalized.includes("pull request is still in draft")
  );
}

export function isRateLimitReviewText(value: string | null | undefined): boolean {
  const normalized = normalizeReviewText(value);
  if (!normalized) {
    return false;
  }

  return RATE_LIMIT_REVIEW_TEXT_PATTERN.test(normalized);
}

export function hasActionableReviewText(value: string | null | undefined): boolean {
  const normalized = normalizeReviewText(value);
  if (!normalized || isInformationalReviewText(normalized) || isRateLimitReviewText(normalized)) {
    return false;
  }

  return /\b(nit|nitpick|suggestion|consider|should|could|bug|issue|error|warning|fix|missing|fails?|incorrect|unsafe|please)\b/.test(
    normalized,
  );
}

export function classifyConfiguredBotTopLevelReviewStrength(args: {
  body?: string | null | undefined;
  state?: string | null | undefined;
}): "nitpick_only" | "blocking" | null {
  const state = normalizeReviewText(args.state);
  if (state !== "changes_requested") {
    return null;
  }

  const normalized = normalizeReviewText(args.body ?? args.state);
  if (!normalized || isInformationalReviewText(normalized)) {
    return "blocking";
  }

  if (NITPICK_REVIEW_TEXT_PATTERN.test(normalized) && !STRONG_REVIEW_TEXT_PATTERN.test(normalized)) {
    return "nitpick_only";
  }

  return "blocking";
}

export function isActionableTopLevelReview(args: {
  body?: string | null | undefined;
  state?: string | null | undefined;
}): boolean {
  const state = normalizeReviewText(args.state);
  if (state === "changes_requested") {
    return true;
  }

  if (!args.body && !args.state) {
    return true;
  }

  return hasActionableReviewText(args.body);
}
