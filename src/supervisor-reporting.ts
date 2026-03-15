import path from "node:path";
import { runCommand } from "./command";
import {
  compareExternalReviewPatterns,
  EXTERNAL_REVIEW_GUARDRAILS_PATH,
  loadCommittedExternalReviewGuardrails,
  VERIFIER_GUARDRAILS_PATH,
} from "./committed-guardrails";
import { loadRelevantExternalReviewMissPatterns } from "./external-review-misses";
import { reviewDir } from "./local-review-artifacts";
import { hasProcessedReviewThread } from "./review-handling";
import {
  buildDetailedStatusModel,
  buildDetailedStatusSummaryLines,
  sanitizeStatusValue,
} from "./supervisor-status-model";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "./types";
import { loadRelevantVerifierGuardrails } from "./verifier-guardrails";

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

export function latestReviewComment(thread: ReviewThread) {
  return thread.comments.nodes[thread.comments.nodes.length - 1] ?? null;
}

function isAllowedReviewBotThread(config: SupervisorConfig, thread: ReviewThread): boolean {
  const configuredLogins = new Set(configuredReviewBots(config).map((login) => login.toLowerCase()));
  return thread.comments.nodes.some((comment) => {
    const login = comment.author?.login?.toLowerCase();
    return Boolean(login && configuredLogins.has(login));
  });
}

export function manualReviewThreads(config: SupervisorConfig, reviewThreads: ReviewThread[]): ReviewThread[] {
  return reviewThreads.filter((thread) => !isAllowedReviewBotThread(config, thread));
}

export function configuredBotReviewThreads(
  config: SupervisorConfig,
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  return reviewThreads.filter((thread) => isAllowedReviewBotThread(config, thread));
}

export function pendingBotReviewThreads(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    "processed_review_thread_ids" | "processed_review_thread_fingerprints" | "last_head_sha"
  >,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  reviewThreads: ReviewThread[],
): ReviewThread[] {
  return configuredBotReviewThreads(config, reviewThreads).filter(
    (thread) => !hasProcessedReviewThread(record, pr, thread),
  );
}

export function mergeConflictDetected(pr: GitHubPullRequest): boolean {
  return pr.mergeStateStatus === "DIRTY";
}

function configuredReviewBots(config: SupervisorConfig): string[] {
  return config.reviewBotLogins.map((login) => login.trim()).filter((login) => login.length > 0);
}

function repoExpectsConfiguredBotReview(config: SupervisorConfig): boolean {
  return configuredReviewBots(config).length > 0;
}

function repoUsesCopilotOnlyReviewBot(config: SupervisorConfig): boolean {
  const bots = configuredReviewBots(config);
  return bots.length === 1 && bots[0].toLowerCase() === "copilot-pull-request-reviewer";
}

function displayStatusArtifactPath(config: SupervisorConfig, filePath: string): string {
  const relativePath = path.relative(config.localReviewArtifactDir, filePath);
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
    ? relativePath
    : path.basename(filePath);
}

async function loadStatusChangedFiles(config: SupervisorConfig, workspacePath: string): Promise<string[]> {
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

export async function buildDurableGuardrailStatusLine(args: {
  config: SupervisorConfig;
  activeRecord: Pick<IssueRunRecord, "branch" | "issue_number" | "last_head_sha" | "workspace">;
  pr: Pick<GitHubPullRequest, "headRefOid"> | null;
}): Promise<string | null> {
  const changedFiles = await loadStatusChangedFiles(args.config, args.activeRecord.workspace);
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

    const sourcePath = displayStatusArtifactPath(args.config, winner.pattern.sourceArtifactPath);
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
  durableGuardrailSummary?: string | null;
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
    durableGuardrailSummary: args.durableGuardrailSummary,
  });
  return [...lines, ...summaryLines].join("\n");
}

export { sanitizeStatusValue };
