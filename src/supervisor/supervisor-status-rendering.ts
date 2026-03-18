import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../core/command";
import {
  compareExternalReviewPatterns,
  EXTERNAL_REVIEW_GUARDRAILS_PATH,
  loadCommittedExternalReviewGuardrails,
  VERIFIER_GUARDRAILS_PATH,
} from "../committed-guardrails";
import { loadRelevantExternalReviewMissPatterns } from "../external-review/external-review-misses";
import {
  externalReviewMissFollowUpDigestPath,
  parseExternalReviewMissFollowUpDigest,
} from "../external-review/external-review-miss-digest";
import { reviewDir } from "../local-review/artifacts";
import {
  configuredBotReviewThreads,
  latestReviewComment,
  manualReviewThreads,
  pendingBotReviewThreads,
} from "../review-thread-reporting";
import { summarizeChangeRiskDecision } from "../issue-metadata";
import {
  buildDetailedStatusModel,
  buildDetailedStatusSummaryLines,
  sanitizeStatusValue,
} from "./supervisor-status-model";
import { displayRelativeArtifactPath } from "./supervisor-status-summary-helpers";
import { GitHubIssue, GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";
import { loadRelevantVerifierGuardrails } from "../verifier-guardrails";

export function summarizeChecks(
  checks: PullRequestCheck[],
): { allPassing: boolean; hasPending: boolean; hasFailing: boolean } {
  if (checks.length === 0) {
    return { allPassing: true, hasPending: false, hasFailing: false };
  }

  let allPassing = true;
  let hasPending = false;
  let hasFailing = false;

  for (const check of checks) {
    if (check.bucket === "pending" || check.bucket === "cancel") {
      hasPending = true;
      allPassing = false;
    } else if (check.bucket === "fail") {
      hasFailing = true;
      allPassing = false;
    } else if (check.bucket !== "pass" && check.bucket !== "skipping") {
      allPassing = false;
    }
  }

  return { allPassing, hasPending, hasFailing };
}

export function mergeConflictDetected(pr: GitHubPullRequest): boolean {
  return pr.mergeStateStatus === "DIRTY";
}

export async function loadStatusChangedFiles(
  config: SupervisorConfig,
  workspacePath: string,
): Promise<string[]> {
  let result;
  try {
    result = await runCommand(
      "git",
      ["diff", "--name-only", `origin/${config.defaultBranch}...HEAD`],
      {
        cwd: workspacePath,
        env: process.env,
      },
    );
  } catch {
    return [];
  }

  return [...new Set(
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  )].sort();
}

export function buildChangeClassesStatusLine(changedFiles: string[]): string | null {
  const changeClasses = summarizeChangeRiskDecision({ changedFiles }).deterministicChangeClasses;
  if (changeClasses.length === 0) {
    return null;
  }

  return `change_classes=${changeClasses.join(", ")}`;
}

export function buildVerificationPolicyStatusLine(args: {
  issue?: Pick<GitHubIssue, "title" | "body"> | null;
  changedFiles: string[];
}): string | null {
  const decision = summarizeChangeRiskDecision({
    issue: args.issue,
    changedFiles: args.changedFiles,
  });
  if (decision.verificationIntensity === "none") {
    return null;
  }

  const driverInputs =
    decision.higherRiskSource === "issue_metadata"
      ? decision.riskyChangeClasses
      : decision.higherRiskSource === "changed_files"
        ? decision.deterministicChangeClasses
        : [];
  const driverDetail = driverInputs.length > 0 ? driverInputs.join("|") : "none";

  return `verification_policy intensity=${decision.verificationIntensity} driver=${decision.higherRiskSource}:${driverDetail}`;
}

export async function buildDurableGuardrailStatusLine(args: {
  config: SupervisorConfig;
  activeRecord: Pick<IssueRunRecord, "branch" | "issue_number" | "last_head_sha" | "workspace">;
  pr: Pick<GitHubPullRequest, "headRefOid"> | null;
  changedFiles?: string[];
}): Promise<string | null> {
  const changedFiles =
    args.changedFiles ?? (await loadStatusChangedFiles(args.config, args.activeRecord.workspace));
  if (changedFiles.length === 0) {
    return null;
  }

  const changedFileSet = new Set(changedFiles);
  const verifierGuardrails = await loadRelevantVerifierGuardrails({
    workspacePath: args.activeRecord.workspace,
    changedFiles,
    limit: 3,
  });
  const committedExternalReviewPatterns = (await loadCommittedExternalReviewGuardrails(args.activeRecord.workspace))
    .filter((pattern) => changedFileSet.has(pattern.file))
    .sort(compareExternalReviewPatterns);
  const runtimeExternalReviewPatterns = await loadRelevantExternalReviewMissPatterns({
    artifactDir: reviewDir(args.config, args.activeRecord.issue_number),
    branch: args.activeRecord.branch,
    currentHeadSha: args.pr?.headRefOid ?? args.activeRecord.last_head_sha ?? "",
    changedFiles,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const activeExternalReviewPatterns = new Map<string, {
    sourceType: "committed" | "runtime";
    pattern: (typeof committedExternalReviewPatterns)[number];
  }>();
  for (const pattern of committedExternalReviewPatterns) {
    activeExternalReviewPatterns.set(pattern.fingerprint, {
      sourceType: "committed",
      pattern,
    });
  }
  for (const pattern of runtimeExternalReviewPatterns) {
    const existing = activeExternalReviewPatterns.get(pattern.fingerprint);
    if (!existing || compareExternalReviewPatterns(pattern, existing.pattern) < 0) {
      activeExternalReviewPatterns.set(pattern.fingerprint, {
        sourceType: "runtime",
        pattern,
      });
    }
  }
  const activeExternalReviewWinners = [...activeExternalReviewPatterns.values()]
    .sort((left, right) => compareExternalReviewPatterns(left.pattern, right.pattern))
    .slice(0, 3);

  if (verifierGuardrails.length === 0 && activeExternalReviewWinners.length === 0) {
    return null;
  }

  const verifierSummary =
    verifierGuardrails.length > 0
      ? `committed:${VERIFIER_GUARDRAILS_PATH}#${verifierGuardrails.length}`
      : "none";
  const externalReviewSources: string[] = [];
  let committedCount = 0;
  const runtimeCounts = new Map<string, number>();
  for (const winner of activeExternalReviewWinners) {
    if (winner.sourceType === "committed") {
      committedCount += 1;
      continue;
    }

    const sourcePath = displayRelativeArtifactPath(args.config, winner.pattern.sourceArtifactPath);
    runtimeCounts.set(sourcePath, (runtimeCounts.get(sourcePath) ?? 0) + 1);
  }
  if (committedCount > 0) {
    externalReviewSources.push(`committed:${EXTERNAL_REVIEW_GUARDRAILS_PATH}#${committedCount}`);
  }
  for (const sourcePath of [...runtimeCounts.keys()].sort()) {
    externalReviewSources.push(`runtime:${sourcePath}#${runtimeCounts.get(sourcePath)}`);
  }

  return `durable_guardrails verifier=${verifierSummary} external_review=${externalReviewSources.length > 0 ? externalReviewSources.join("|") : "none"}`;
}

export async function buildExternalReviewFollowUpStatusLine(args: {
  activeRecord: Pick<IssueRunRecord, "external_review_misses_path" | "external_review_head_sha" | "last_head_sha">;
  currentHeadSha: string | null;
}): Promise<string | null> {
  const missesPath = args.activeRecord.external_review_misses_path;
  if (!missesPath) {
    return null;
  }

  const currentHeadSha = args.currentHeadSha ?? args.activeRecord.last_head_sha;
  if (!currentHeadSha || args.activeRecord.external_review_head_sha !== currentHeadSha) {
    return null;
  }

  let digest: string;
  try {
    digest = await fs.readFile(externalReviewMissFollowUpDigestPath(missesPath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const summary = parseExternalReviewMissFollowUpDigest(digest);
  if (
    !summary ||
    summary.headStatus !== "current-head" ||
    summary.missAnalysisHeadSha !== currentHeadSha ||
    summary.activePrHeadSha !== currentHeadSha ||
    summary.missedFindings <= 0
  ) {
    return null;
  }

  const actions = [
    ["durable_guardrail", "durable_guardrail"],
    ["regression_test", "regression_test"],
    ["review_prompt", "review_prompt"],
    ["issue_template", "issue_template"],
  ].flatMap(([target, label]) => {
    const count = summary.actionCounts[target as keyof typeof summary.actionCounts];
    return count && count > 0 ? [`${label}:${count}`] : [];
  });

  return `external_review_follow_up unresolved=${summary.missedFindings} actions=${actions.length > 0 ? actions.join("|") : "none"}`;
}

export function formatDetailedStatus(args: {
  config: SupervisorConfig;
  activeRecord: IssueRunRecord | null;
  latestRecord: IssueRunRecord | null;
  latestRecoveryRecord?: IssueRunRecord | null;
  trackedIssueCount: number;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  handoffSummary?: string | null;
  changeClassesSummary?: string | null;
  verificationPolicySummary?: string | null;
  durableGuardrailSummary?: string | null;
  externalReviewFollowUpSummary?: string | null;
}): string {
  const lines = buildDetailedStatusModel({
    config: args.config,
    activeRecord: args.activeRecord,
    latestRecord: args.latestRecord,
    latestRecoveryRecord: args.latestRecoveryRecord,
    trackedIssueCount: args.trackedIssueCount,
    pr: args.pr,
    checks: args.checks,
    reviewThreads: args.reviewThreads,
    manualReviewThreads,
    configuredBotReviewThreads,
    pendingBotReviewThreads,
    summarizeChecks,
    mergeConflictDetected,
  });
  const summaryLines = buildDetailedStatusSummaryLines({
    config: args.config,
    activeRecord: args.activeRecord,
    latestRecoveryRecord: args.latestRecoveryRecord,
    handoffSummary: args.handoffSummary,
    changeClassesSummary: args.changeClassesSummary,
    verificationPolicySummary: args.verificationPolicySummary,
    durableGuardrailSummary: args.durableGuardrailSummary,
    externalReviewFollowUpSummary: args.externalReviewFollowUpSummary,
  });
  return [...lines, ...summaryLines].join("\n");
}

export { sanitizeStatusValue, latestReviewComment };
