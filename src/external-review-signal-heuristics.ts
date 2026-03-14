function normalizeReviewText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

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
    normalized.includes("pull request is still in draft")
  );
}

export function hasActionableReviewText(value: string | null | undefined): boolean {
  const normalized = normalizeReviewText(value);
  if (!normalized || isInformationalReviewText(normalized)) {
    return false;
  }

  return /\b(nit|nitpick|suggestion|consider|should|could|bug|issue|error|warning|fix|missing|fails?|incorrect|unsafe|please)\b/.test(
    normalized,
  );
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
