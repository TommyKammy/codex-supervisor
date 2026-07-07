import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";
import { reviewLoopRetryBudgetExhaustedForThread } from "../review-handling";
import {
  codexConnectorMustFixReviewThreads,
  latestCodexConnectorReviewCommentFingerprint,
} from "../codex-connector-review-policy";
import {
  configuredBotReviewFollowUpState,
  configuredBotReviewThreads,
  pendingBotReviewThreads,
} from "../review-thread-reporting";
import { configuredReviewProviderKinds } from "../core/review-providers";
import { currentHeadCodexRepairProofRejectionReasons } from "../current-head-codex-repair-proof";
import {
  buildCodexConnectorStillValidReviewRepairTargets,
  type CodexConnectorValidReviewRepairTarget,
} from "../codex-connector-valid-review-repair";
import { hasCurrentHeadSuccessSignal } from "./stale-review-current-head-evidence";
import type { RepositoryFileContents } from "./stale-review-repository-path-repair-evidence";
import {
  classifyStaleReviewBotAutoRepairSuppression,
  isVerifiedStaleResidueClassification,
  type StaleReviewBotAutoRepairSuppressedReason,
} from "./stale-review-bot-classification-policy";
import {
  buildStaleReviewBotRemediation,
  type StaleReviewBotRemediationDto,
} from "./stale-review-bot-remediation";

export interface StaleReviewBotThreadDiagnosticsDto {
  issueNumber: number;
  prNumber: number | null;
  currentHeadSuccess: "yes" | "no" | "unknown";
  unresolvedCurrentThreads: number;
  actionableMustFixThreads: number;
  verifiedStaleResidueThreads: number;
  missingVerificationEvidenceThreads: number;
  repeatStopExhausted: "yes" | "no";
  autoRepairSuppressedReason: StaleReviewBotAutoRepairSuppressedReason;
  currentHeadRepairProofRejectionReasons?: string[];
  validRepairTargets?: CodexConnectorValidReviewRepairTarget[];
}

export function formatStaleReviewBotTokenValue(value: string): string {
  return value.replace(/\r?\n/gu, "\\n");
}

function currentHeadSuccess(pr: GitHubPullRequest | null): StaleReviewBotThreadDiagnosticsDto["currentHeadSuccess"] {
  if (!pr) {
    return "unknown";
  }
  return hasCurrentHeadSuccessSignal(pr) ? "yes" : "no";
}

export function buildStaleReviewBotThreadDiagnostics(args: {
  config?: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads?: ReviewThread[];
  remediation?: StaleReviewBotRemediationDto | null;
  repositoryFileContents?: RepositoryFileContents;
}): StaleReviewBotThreadDiagnosticsDto | null {
  const remediation =
    args.remediation ??
    buildStaleReviewBotRemediation({
      config: args.config,
      record: args.record,
      pr: args.pr,
      checks: args.checks,
      reviewThreads: args.reviewThreads,
      repositoryFileContents: args.repositoryFileContents,
    });
  if (!remediation) {
    return null;
  }

  const config = args.config ?? null;
  const reviewThreads = args.reviewThreads ?? [];
  const configuredThreads = config ? configuredBotReviewThreads(config, reviewThreads) : [];
  const unresolvedConfiguredThreads = configuredThreads.filter((thread) => !thread.isResolved && !thread.isOutdated);
  const codexConfigured = config ? configuredReviewProviderKinds(config).includes("codex") : false;
  const actionableMustFixThreads = config && codexConfigured
    ? codexConnectorMustFixReviewThreads(reviewThreads)
    : config && args.pr
      ? pendingBotReviewThreads(config, args.record, args.pr, configuredThreads)
      : [];
  const currentHeadReviewRequestPending =
    remediation.classification === "metadata_only_missing_current_head_review" &&
    remediation.codexCurrentHeadReviewState === "missing";
  const isVerifiedResidue = isVerifiedStaleResidueClassification(remediation.classification);
  const reviewLoopRetryExhausted =
    config && args.pr && actionableMustFixThreads.length > 0
      ? actionableMustFixThreads.every((thread) =>
          reviewLoopRetryBudgetExhaustedForThread(
            args.record,
            args.pr!,
            thread,
            1,
            codexConfigured ? latestCodexConnectorReviewCommentFingerprint(thread) : undefined,
          ),
        )
      : false;
  const repeatStopExhausted =
    currentHeadReviewRequestPending || isVerifiedResidue
      ? false
      : reviewLoopRetryExhausted ||
        args.record.last_tracked_pr_repeat_failure_decision === "stop_no_progress" ||
        (config && args.pr
          ? configuredBotReviewFollowUpState(config, args.record, args.pr, configuredThreads) === "exhausted"
          : false);
  const verifiedStaleResidueThreads = isVerifiedResidue
    ? unresolvedConfiguredThreads.length
    : 0;
  const validRepairTargets =
    config && args.pr
      ? buildCodexConnectorStillValidReviewRepairTargets({
          record: args.record,
          pr: args.pr,
          reviewThreads: actionableMustFixThreads,
        })
      : [];
  const missingVerificationEvidenceThreads = remediation.missingProbeReason
    ? Math.max(actionableMustFixThreads.length - validRepairTargets.length, validRepairTargets.length > 0 ? 0 : 1)
    : 0;
  const currentHeadRepairProofRejectionReasons =
    config &&
    args.pr &&
    codexConfigured &&
    args.record.blocked_reason === "manual_review" &&
    args.record.last_tracked_pr_repeat_failure_decision === "stop_no_progress" &&
    !isVerifiedResidue &&
    actionableMustFixThreads.length > 0
      ? currentHeadCodexRepairProofRejectionReasons({
          config,
          record: args.record,
          pr: args.pr,
          checks: args.checks,
          reviewThreads,
        })
      : [];
  const reportableCurrentHeadRepairProofRejectionReasons = currentHeadRepairProofRejectionReasons.filter(
    (reason) => reason !== "current_head_repair_proof_structured_artifact_missing",
  );

  return {
    issueNumber: args.record.issue_number,
    prNumber: args.record.pr_number,
    currentHeadSuccess: currentHeadSuccess(args.pr),
    unresolvedCurrentThreads: unresolvedConfiguredThreads.length,
    actionableMustFixThreads: actionableMustFixThreads.length,
    verifiedStaleResidueThreads,
    missingVerificationEvidenceThreads,
    repeatStopExhausted: repeatStopExhausted ? "yes" : "no",
    autoRepairSuppressedReason: classifyStaleReviewBotAutoRepairSuppression({
      config,
      record: args.record,
      pr: args.pr,
      checks: args.checks,
      reviewThreads,
      classification: remediation.classification,
      missingProbeReason: remediation.missingProbeReason,
      actionableMustFixThreads,
      repeatStopExhausted,
    }),
    ...(reportableCurrentHeadRepairProofRejectionReasons.length > 0
      ? { currentHeadRepairProofRejectionReasons: reportableCurrentHeadRepairProofRejectionReasons }
      : {}),
    validRepairTargets,
  };
}
