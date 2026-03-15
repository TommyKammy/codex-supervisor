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
import {
  hasProcessedReviewThread,
  localReviewBlocksMerge,
  localReviewBlocksReady,
  localReviewRetryLoopStalled,
} from "./run-once-turn-execution";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "./types";
import { truncate } from "./utils";
import { loadRelevantVerifierGuardrails } from "./verifier-guardrails";

const COPILOT_REVIEWER_LOGIN = "copilot-pull-request-reviewer";

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
  return bots.length === 1 && bots[0].toLowerCase() === COPILOT_REVIEWER_LOGIN;
}

function configuredReviewStatusLabel(config: SupervisorConfig): string {
  return !repoExpectsConfiguredBotReview(config) || repoUsesCopilotOnlyReviewBot(config)
    ? "copilot_review"
    : "configured_bot_review";
}

type ReviewBotProfileId = "none" | "copilot" | "codex" | "coderabbit" | "custom";

interface ReviewBotProfileSummary {
  profile: ReviewBotProfileId;
  provider: string;
  reviewers: string[];
  signalSource: string;
}

interface ReviewBotDiagnostics {
  status: string;
  observedReview: string;
  nextCheck: string;
}

function inferReviewBotProfile(config: SupervisorConfig): ReviewBotProfileSummary {
  const reviewers = configuredReviewBots(config);
  const normalized = reviewers.map((reviewer) => reviewer.toLowerCase());
  const normalizedSet = new Set(normalized);

  if (normalized.length === 0) {
    return {
      profile: "none",
      provider: "none",
      reviewers,
      signalSource: "none",
    };
  }

  if (normalized.length === 1 && normalized[0] === COPILOT_REVIEWER_LOGIN) {
    return {
      profile: "copilot",
      provider: COPILOT_REVIEWER_LOGIN,
      reviewers,
      signalSource: "copilot_lifecycle",
    };
  }

  if (normalized.length === 1 && normalized[0] === "chatgpt-codex-connector") {
    return {
      profile: "codex",
      provider: "chatgpt-codex-connector",
      reviewers,
      signalSource: "review_threads",
    };
  }

  if (
    normalized.length === 2 &&
    normalizedSet.has("coderabbitai") &&
    normalizedSet.has("coderabbitai[bot]")
  ) {
    return {
      profile: "coderabbit",
      provider: "coderabbitai",
      reviewers,
      signalSource: "review_threads",
    };
  }

  return {
    profile: "custom",
    provider: reviewers.join(",") || "custom",
    reviewers,
    signalSource: normalized.includes(COPILOT_REVIEWER_LOGIN) ? "copilot_lifecycle+review_threads" : "review_threads",
  };
}

function summarizeObservedReviewSignal(
  config: SupervisorConfig,
  activeRecord: IssueRunRecord,
  pr: GitHubPullRequest,
  reviewThreads: ReviewThread[],
): { observedReview: string; hasSignal: boolean } {
  const configuredThreads = configuredBotReviewThreads(config, reviewThreads);
  if (configuredThreads.length > 0) {
    return { observedReview: "review_thread", hasSignal: true };
  }

  if (activeRecord.external_review_head_sha === pr.headRefOid) {
    return { observedReview: "external_review_record", hasSignal: true };
  }

  const lifecycleState = pr.copilotReviewState ?? "not_requested";
  if (lifecycleState === "arrived") {
    return { observedReview: "copilot_arrived", hasSignal: true };
  }
  if (lifecycleState === "requested") {
    return { observedReview: "copilot_requested", hasSignal: false };
  }
  if (pr.copilotReviewState === null) {
    return { observedReview: "unknown", hasSignal: false };
  }

  return { observedReview: "none", hasSignal: false };
}

function reviewBotDiagnostics(
  config: SupervisorConfig,
  activeRecord: IssueRunRecord,
  pr: GitHubPullRequest,
  reviewThreads: ReviewThread[],
): ReviewBotDiagnostics {
  if (!repoExpectsConfiguredBotReview(config)) {
    return {
      status: "disabled",
      observedReview: "none",
      nextCheck: "none",
    };
  }

  const observed = summarizeObservedReviewSignal(config, activeRecord, pr, reviewThreads);
  if (observed.hasSignal) {
    return {
      status: "review_signal_observed",
      observedReview: observed.observedReview,
      nextCheck: "none",
    };
  }

  if (observed.observedReview === "copilot_requested") {
    return {
      status: "waiting_for_provider_review",
      observedReview: observed.observedReview,
      nextCheck: "provider_delivery",
    };
  }

  return {
    status: "missing_provider_signal",
    observedReview: observed.observedReview,
    nextCheck: "provider_setup_or_delivery",
  };
}

export function sanitizeStatusValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/\r?\n/g, "\\n");
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

function summarizeCheckBuckets(checks: PullRequestCheck[]): string {
  if (checks.length === 0) {
    return "none";
  }

  const counts = {
    pass: 0,
    fail: 0,
    pending: 0,
    skipping: 0,
    cancel: 0,
    other: 0,
  };

  for (const check of checks) {
    if (check.bucket === "pass") {
      counts.pass += 1;
    } else if (check.bucket === "fail") {
      counts.fail += 1;
    } else if (check.bucket === "pending") {
      counts.pending += 1;
    } else if (check.bucket === "skipping") {
      counts.skipping += 1;
    } else if (check.bucket === "cancel") {
      counts.cancel += 1;
    } else {
      counts.other += 1;
    }
  }

  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([bucket, count]) => `${bucket}=${count}`)
    .join(" ");
}

function listChecksByBucket(checks: PullRequestCheck[], bucket: "fail" | "pending"): string | null {
  const matches = checks.filter((check) => check.bucket === bucket).map((check) => check.name);
  return matches.length > 0 ? matches.join(", ") : null;
}

function formatRecentRecord(record: IssueRunRecord | null): string {
  if (!record) {
    return "none";
  }

  return `#${record.issue_number} state=${record.state} updated_at=${record.updated_at}`;
}

function localReviewHeadStatus(
  record: Pick<IssueRunRecord, "local_review_head_sha">,
  pr: Pick<GitHubPullRequest, "headRefOid"> | null,
): "none" | "current" | "stale" | "unknown" {
  if (!record.local_review_head_sha) {
    return "none";
  }

  if (!pr) {
    return "unknown";
  }

  return record.local_review_head_sha === pr.headRefOid ? "current" : "stale";
}

function localReviewHeadDetails(
  record: Pick<IssueRunRecord, "local_review_head_sha">,
  pr: Pick<GitHubPullRequest, "headRefOid"> | null,
): {
  status: "none" | "current" | "stale" | "unknown";
  reviewedHeadSha: string;
  prHeadSha: string;
  driftSuffix: string;
} {
  const status = localReviewHeadStatus(record, pr);
  const reviewedHeadSha = record.local_review_head_sha ?? "none";
  const prHeadSha = pr?.headRefOid ?? "unknown";

  return {
    status,
    reviewedHeadSha,
    prHeadSha,
    driftSuffix: status === "stale" ? ` needs_review_run=yes drift=${reviewedHeadSha}->${prHeadSha}` : "",
  };
}

function localReviewIsGating(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    "local_review_head_sha" | "local_review_findings_count" | "local_review_recommendation"
  >,
  pr: GitHubPullRequest | null,
): boolean {
  if (!pr) {
    return false;
  }

  return localReviewBlocksReady(config, record, pr) || localReviewBlocksMerge(config, record, pr);
}

function displayRelativeArtifactPath(config: SupervisorConfig, filePath: string): string {
  const relativePath = path.relative(config.localReviewArtifactDir, filePath);
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
    ? relativePath
    : path.basename(filePath);
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
  const {
    config,
    activeRecord,
    latestRecord,
    latestRecoveryRecord = null,
    trackedIssueCount,
    pr,
    checks,
    reviewThreads,
    handoffSummary = null,
    durableGuardrailSummary = null,
  } = args;

  if (!activeRecord) {
    const lines = [
      "No active issue.",
      `tracked_issues=${trackedIssueCount}`,
      `latest_record=${formatRecentRecord(latestRecord)}`,
    ];

    if (latestRecoveryRecord?.last_recovery_reason && latestRecoveryRecord.last_recovery_at) {
      lines.push(
        `latest_recovery issue=#${latestRecoveryRecord.issue_number} at=${latestRecoveryRecord.last_recovery_at} reason=${sanitizeStatusValue(latestRecoveryRecord.last_recovery_reason)}`,
      );
    }

    return lines.join("\n");
  }

  const localReviewHead = localReviewHeadDetails(activeRecord, pr);
  const localReviewGating = localReviewIsGating(config, activeRecord, pr) ? "yes" : "no";
  const localReviewStalled =
    pr &&
    localReviewRetryLoopStalled(
      config,
      activeRecord,
      pr,
      checks,
      reviewThreads,
      manualReviewThreads,
      configuredBotReviewThreads,
      summarizeChecks,
      mergeConflictDetected,
    )
      ? "yes"
      : "no";
  const externalReviewHeadStatus =
    !activeRecord.external_review_head_sha
      ? "none"
      : pr
        ? activeRecord.external_review_head_sha === pr.headRefOid
          ? "current"
          : "stale"
        : "unknown";
  const lines = [
    `issue=#${activeRecord.issue_number}`,
    `state=${activeRecord.state}`,
    `branch=${activeRecord.branch}`,
    `pr=${activeRecord.pr_number ?? "none"}`,
    `attempts=${activeRecord.attempt_count}`,
    `implementation_attempts=${activeRecord.implementation_attempt_count}`,
    `repair_attempts=${activeRecord.repair_attempt_count}`,
    `updated_at=${activeRecord.updated_at}`,
    `workspace=${activeRecord.workspace}`,
    `blocked_reason=${activeRecord.blocked_reason ?? "none"}`,
    `last_failure_kind=${activeRecord.last_failure_kind ?? "none"}`,
    `last_failure_signature=${activeRecord.last_failure_signature ?? "none"}`,
    `retries timeout=${activeRecord.timeout_retry_count} verification=${activeRecord.blocked_verification_retry_count} same_blocker=${activeRecord.repeated_blocker_count} same_failure_signature=${activeRecord.repeated_failure_signature_count}`,
    `local_review gating=${localReviewGating} policy=${config.localReviewPolicy} findings=${activeRecord.local_review_findings_count} root_causes=${activeRecord.local_review_root_cause_count} max_severity=${activeRecord.local_review_max_severity ?? "none"} verified_findings=${activeRecord.local_review_verified_findings_count} verified_max_severity=${activeRecord.local_review_verified_max_severity ?? "none"} head=${localReviewHead.status} reviewed_head_sha=${localReviewHead.reviewedHeadSha} pr_head_sha=${localReviewHead.prHeadSha} ran_at=${activeRecord.local_review_run_at ?? "none"}${localReviewGating === "yes" && activeRecord.local_review_blocker_summary ? ` blocker_summary=${truncate(sanitizeStatusValue(activeRecord.local_review_blocker_summary), 160)}` : ""}${localReviewHead.driftSuffix} signature=${activeRecord.last_local_review_signature ?? "none"} repeated=${activeRecord.repeated_local_review_signature_count} stalled=${localReviewStalled}`,
    `external_review head=${externalReviewHeadStatus} reviewed_head_sha=${activeRecord.external_review_head_sha ?? "none"} matched=${activeRecord.external_review_matched_findings_count} near_match=${activeRecord.external_review_near_match_findings_count} missed=${activeRecord.external_review_missed_findings_count}`,
  ];

  if (activeRecord.last_error) {
    const sanitizedLastError = sanitizeStatusValue(activeRecord.last_error);
    lines.push(`last_error=${truncate(sanitizedLastError, 300)}`);
  }

  if (pr) {
    const reviewBotProfile = inferReviewBotProfile(config);
    const reviewBotStatus = reviewBotDiagnostics(config, activeRecord, pr, reviewThreads);
    const copilotReviewState = pr.copilotReviewState === null ? "unknown" : (pr.copilotReviewState ?? "not_requested");
    const reviewStatusLabel = configuredReviewStatusLabel(config);
    const reviewers = configuredReviewBots(config);
    const reviewersSuffix =
      reviewStatusLabel === "configured_bot_review" && reviewers.length > 0 ? ` reviewers=${reviewers.join(",")}` : "";
    lines.push(
      `review_bot_profile profile=${reviewBotProfile.profile} provider=${reviewBotProfile.provider} reviewers=${reviewBotProfile.reviewers.length > 0 ? reviewBotProfile.reviewers.join(",") : "none"} signal_source=${reviewBotProfile.signalSource}`,
    );
    lines.push(
      `review_bot_diagnostics status=${reviewBotStatus.status} observed_review=${reviewBotStatus.observedReview} expected_reviewers=${reviewBotProfile.reviewers.length > 0 ? reviewBotProfile.reviewers.join(",") : "none"} next_check=${reviewBotStatus.nextCheck}`,
    );
    lines.push(
      `${reviewStatusLabel} state=${copilotReviewState}${reviewersSuffix} requested_at=${pr.copilotReviewRequestedAt ?? "none"} arrived_at=${pr.copilotReviewArrivedAt ?? "none"} timed_out_at=${activeRecord.copilot_review_timed_out_at ?? "none"} timeout_action=${activeRecord.copilot_review_timeout_action ?? "none"}`,
    );
    if (activeRecord.copilot_review_timeout_reason) {
      lines.push(`timeout_reason=${sanitizeStatusValue(activeRecord.copilot_review_timeout_reason)}`);
    }
    lines.push(
      `pr_state=${pr.state} draft=${pr.isDraft ? "yes" : "no"} merge_state=${pr.mergeStateStatus ?? "unknown"} review_decision=${pr.reviewDecision ?? "none"} head_sha=${pr.headRefOid}`,
    );
    lines.push(`checks=${summarizeCheckBuckets(checks)}`);
    const failingChecks = listChecksByBucket(checks, "fail");
    if (failingChecks) {
      lines.push(`failing_checks=${failingChecks}`);
    }
    const pendingChecks = listChecksByBucket(checks, "pending");
    if (pendingChecks) {
      lines.push(`pending_checks=${pendingChecks}`);
    }
    lines.push(
      `review_threads bot_pending=${pendingBotReviewThreads(config, activeRecord, pr, reviewThreads).length} bot_unresolved=${configuredBotReviewThreads(config, reviewThreads).length} manual=${manualReviewThreads(config, reviewThreads).length}`,
    );
  }

  if (activeRecord.last_failure_context) {
    lines.push(
      `failure_context category=${activeRecord.last_failure_context.category ?? "none"} summary=${truncate(activeRecord.last_failure_context.summary, 200) ?? "none"}`,
    );
    if (activeRecord.last_failure_context.details.length > 0) {
      lines.push(
        `failure_details=${truncate(sanitizeStatusValue(activeRecord.last_failure_context.details.join(" | ")), 300) ?? "none"}`,
      );
    }
  }

  if (handoffSummary) {
    lines.push(`handoff_summary=${truncate(sanitizeStatusValue(handoffSummary), 200)}`);
  }

  if (durableGuardrailSummary) {
    lines.push(truncate(sanitizeStatusValue(durableGuardrailSummary), 300) ?? "");
  }

  if (latestRecoveryRecord?.last_recovery_reason && latestRecoveryRecord.last_recovery_at) {
    lines.push(
      `latest_recovery issue=#${latestRecoveryRecord.issue_number} at=${latestRecoveryRecord.last_recovery_at} reason=${sanitizeStatusValue(latestRecoveryRecord.last_recovery_reason)}`,
    );
  }

  if (activeRecord.local_review_summary_path) {
    const displayedSummaryPath = displayRelativeArtifactPath(config, activeRecord.local_review_summary_path);
    const sanitizedSummaryPath = sanitizeStatusValue(displayedSummaryPath);
    lines.push(`local_review_summary_path=${truncate(sanitizedSummaryPath, 200)}`);
  }

  if (activeRecord.external_review_misses_path) {
    const displayedMissesPath = displayRelativeArtifactPath(config, activeRecord.external_review_misses_path);
    lines.push(`external_review_misses_path=${truncate(sanitizeStatusValue(displayedMissesPath), 200)}`);
  }

  return lines.join("\n");
}
