import { displayLocalCiCommand } from "./core/config";
import {
  configuredReviewBotLogins,
  configuredReviewProviderKinds,
  normalizeReviewProviderLogin,
} from "./core/review-providers";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, SupervisorConfig, TimelineArtifact } from "./core/types";

export type LocalCiConfiguredState = Pick<SupervisorConfig, "localCiCommand"> & {
  localCiCommand?: SupervisorConfig["localCiCommand"] | null;
};

export function hasConfiguredLocalCiCommand(config: LocalCiConfiguredState): boolean {
  return displayLocalCiCommand(config.localCiCommand ?? undefined) !== null;
}

export function hasCurrentHeadLocalCiSuccess(record: IssueRunRecord, pr: GitHubPullRequest): boolean {
  const latestLocalCi = record.latest_local_ci_result ?? null;
  return latestLocalCi?.outcome === "passed" && latestLocalCi.head_sha === pr.headRefOid;
}

export function currentHeadLocalCiMissing(record: IssueRunRecord, pr: GitHubPullRequest): boolean {
  return !hasCurrentHeadLocalCiSuccess(record, pr);
}

function allChecksPassing(checks: Pick<PullRequestCheck, "bucket">[]): boolean {
  return checks.length > 0 && checks.every((check) => check.bucket === "pass" || check.bucket === "skipping");
}

function isConfiguredReviewBotCheck(
  config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">,
  check: Pick<PullRequestCheck, "name" | "workflow">,
): boolean {
  const configuredBotLogins = configuredReviewBotLogins(config);
  const configuredProviderKinds = configuredReviewProviderKinds(config);
  const labels = [check.name, check.workflow].flatMap((label) => {
    const normalized = label?.trim().toLowerCase();
    return normalized ? [normalized] : [];
  });

  return labels.some((label) => {
    const login = normalizeReviewProviderLogin(label);
    if (login && configuredBotLogins.includes(login)) {
      return true;
    }
    if (configuredBotLogins.some((configuredLogin) => label.includes(configuredLogin))) {
      return true;
    }
    if (configuredProviderKinds.includes("codex") && label.includes("codex") && (label.includes("connector") || label.includes("review"))) {
      return true;
    }
    if (configuredProviderKinds.includes("coderabbit") && label.includes("coderabbit")) {
      return true;
    }
    return configuredProviderKinds.includes("copilot") && label.includes("copilot") && label.includes("review");
  });
}

export function currentHeadPassingNonReviewChecks(
  config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">,
  checks: Pick<PullRequestCheck, "bucket" | "name" | "workflow">[],
): Pick<PullRequestCheck, "bucket" | "name" | "workflow">[] {
  if (!allChecksPassing(checks)) {
    return [];
  }
  return checks.filter((check) => check.bucket === "pass" && !isConfiguredReviewBotCheck(config, check));
}

export type CurrentHeadLocalVerificationEvidenceSource =
  | "latest_local_ci_result"
  | "scoped_repair_timeline_artifact_with_non_review_checks";

export interface CurrentHeadLocalVerificationEvidence {
  source: CurrentHeadLocalVerificationEvidenceSource;
  summary: string;
}

export function currentHeadLocalVerificationEvidence(args: {
  config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">;
  record: Pick<IssueRunRecord, "latest_local_ci_result">;
  pr: Pick<GitHubPullRequest, "headRefOid">;
  checks: Pick<PullRequestCheck, "bucket" | "name" | "workflow">[];
  scopedTimelineArtifact?: Pick<TimelineArtifact, "summary" | "command"> | null;
}): CurrentHeadLocalVerificationEvidence | null {
  const latestLocalCi = args.record.latest_local_ci_result;
  if (latestLocalCi?.outcome === "passed" && latestLocalCi.head_sha === args.pr.headRefOid) {
    return {
      source: "latest_local_ci_result",
      summary: latestLocalCi.summary || latestLocalCi.command || "current_head_local_ci_passed",
    };
  }

  if (!args.scopedTimelineArtifact) {
    return null;
  }

  const nonReviewChecks = currentHeadPassingNonReviewChecks(args.config, args.checks);
  if (nonReviewChecks.length === 0) {
    return null;
  }

  const checkNames = nonReviewChecks
    .map((check) => check.name?.trim())
    .filter((name): name is string => Boolean(name))
    .slice(0, 3)
    .join(",");
  const checkSummary = checkNames ? `current_head_checks_passed:${checkNames}` : "current_head_checks_passed";
  const artifactSummary =
    args.scopedTimelineArtifact.summary ||
    args.scopedTimelineArtifact.command ||
    "current_head_scoped_repair_verification_passed";
  return {
    source: "scoped_repair_timeline_artifact_with_non_review_checks",
    summary: `${artifactSummary};${checkSummary}`,
  };
}
