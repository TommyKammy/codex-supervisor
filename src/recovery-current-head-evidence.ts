import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck } from "./core/types";
import { codexConnectorMustFixTopLevelReviewFindings } from "./codex-connector-top-level-review";
import { summarizeChecks } from "./supervisor/supervisor-status-rendering";

export function firstPassingCheckEvidence(checks: PullRequestCheck[]): string | null {
  if (checks.length === 0) {
    return null;
  }

  const checkSummary = summarizeChecks(checks);
  if (!checkSummary.allPassing || checkSummary.hasPending || checkSummary.hasFailing) {
    return null;
  }

  const firstCheckName = checks
    .map((check) => check.name.trim())
    .filter((name) => name.length > 0)
    .sort()[0];

  return `required_checks_green:${firstCheckName ?? "all"}`;
}

export function currentHeadConfiguredBotEvidence(
  pr: Pick<
    GitHubPullRequest,
    | "configuredBotCurrentHeadObservedAt"
    | "configuredBotCurrentHeadStatusState"
    | "configuredBotTopLevelReviewStrength"
    | "configuredBotTopLevelReviewFindings"
  >,
): string | null {
  if (!pr.configuredBotCurrentHeadObservedAt) {
    return null;
  }

  const statusState = pr.configuredBotCurrentHeadStatusState?.toLowerCase() ?? null;
  const statusPassed =
    statusState === "success" ||
    statusState === "pass" ||
    statusState === "passed";
  const topLevelPassed =
    codexConnectorMustFixTopLevelReviewFindings(pr.configuredBotTopLevelReviewFindings ?? []).length === 0 &&
    (pr.configuredBotTopLevelReviewStrength === null ||
      pr.configuredBotTopLevelReviewStrength === undefined ||
      pr.configuredBotTopLevelReviewStrength === "nitpick_only");

  if (!statusPassed && !topLevelPassed) {
    return null;
  }

  return "configured_bot_current_head_passed";
}

export function trackedHandoffExternalProgressEvidence(args: {
  record: Pick<IssueRunRecord, "last_head_sha">;
  pr: Pick<
    GitHubPullRequest,
    | "configuredBotCurrentHeadObservedAt"
    | "configuredBotCurrentHeadStatusState"
    | "configuredBotTopLevelReviewStrength"
    | "configuredBotTopLevelReviewFindings"
    | "headRefOid"
  >;
  checks: PullRequestCheck[];
}): string | null {
  if (!args.record.last_head_sha || args.record.last_head_sha === args.pr.headRefOid) {
    return null;
  }

  return firstPassingCheckEvidence(args.checks) ?? currentHeadConfiguredBotEvidence(args.pr);
}

export function isCurrentHeadReviewSignalRequestTimeout(
  patch: Pick<
    IssueRunRecord,
    "copilot_review_timed_out_at" | "copilot_review_timeout_action" | "copilot_review_timeout_reason"
  >,
): boolean {
  return (
    patch.copilot_review_timed_out_at !== null &&
    patch.copilot_review_timeout_action === "request_review_comment" &&
    patch.copilot_review_timeout_reason?.includes("current-head review signal") === true
  );
}
