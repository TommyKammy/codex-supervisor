import type { LocalReviewRepairContext } from "./codex";
import { STILL_VALID_REVIEW_THREAD_REPAIR_TARGET } from "./codex-connector-valid-review-repair";
import {
  codexConnectorMustFixReviewThreads,
  latestCodexConnectorReviewComment,
  latestCodexConnectorReviewCommentFingerprint,
  latestCodexConnectorReviewCommentNode,
} from "./codex-connector-review-policy";
import { VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET } from "./current-head-codex-repair-proof";
import { displayLocalCiCommand } from "./core/config";
import {
  latestReviewThreadCommentFingerprint,
  processedReviewThreadFingerprintKey,
  processedReviewThreadKey,
} from "./review-handling";
import { isIgnoredSupervisorArtifactPath } from "./core/git-workspace-helpers";
import {
  hasCurrentTurnVerifiedNoSourceChangeReviewThreadEvidence,
  nextProcessedReviewThreadPatch,
  nextReviewFollowUpPatch,
  selectVerifiedNoSourceChangeReviewThreads,
} from "./turn-execution-orchestration";
import {
  GitHubPullRequest,
  IssueRunRecord,
  LatestLocalCiResult,
  ReviewThread,
  SupervisorConfig,
  TimelineArtifact,
  WorkspaceStatus,
} from "./core/types";
import { upsertTimelineArtifact } from "./timeline-artifacts";
import {
  conciseCodexVerificationSummary,
  conciseFailedCodexVerificationSummary,
} from "./run-once-turn-verification-evidence";

function sameStringList(left: string[] | null | undefined, right: string[] | null | undefined): boolean {
  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((target, index) => target === normalizedRight[index])
  );
}

function sameRepairTargets(left: string[] | null | undefined, right: string[] | null | undefined): boolean {
  return sameStringList(left, right);
}

function processedReviewThreadIdsForHead(threads: ReviewThread[], headSha: string | null): string[] | undefined {
  if (!headSha || threads.length === 0) {
    return undefined;
  }
  return threads.map((thread) => processedReviewThreadKey(thread.id, headSha));
}

function processedReviewThreadFingerprintsForHead(threads: ReviewThread[], headSha: string | null): string[] | undefined {
  if (!headSha || threads.length === 0) {
    return undefined;
  }
  return threads.flatMap((thread) => {
    const fingerprint = latestReviewThreadCommentFingerprint(thread);
    return fingerprint
      ? [processedReviewThreadFingerprintKey(thread.id, headSha, fingerprint)]
      : [];
  });
}

function processedCodexConnectorReviewThreadFingerprintsForHead(
  threads: ReviewThread[],
  headSha: string | null,
): string[] | undefined {
  if (!headSha || threads.length === 0) {
    return undefined;
  }
  return threads.flatMap((thread) => {
    const fingerprints = [
      latestCodexConnectorReviewCommentFingerprint(thread),
      latestReviewThreadCommentFingerprint(thread),
    ].filter((fingerprint): fingerprint is string => Boolean(fingerprint));
    return [...new Set(fingerprints)].map((fingerprint) =>
      processedReviewThreadFingerprintKey(thread.id, headSha, fingerprint),
    );
  });
}

const VERIFIED_NO_SOURCE_CHANGE_REVIEW_THREAD_RESIDUE_TARGET =
  "verified_no_source_change_review_thread_residue";

const FAILED_STILL_VALID_PROBE_EVIDENCE_STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "before",
  "blocked",
  "codex",
  "connector",
  "error",
  "failed",
  "failure",
  "finding",
  "focused",
  "from",
  "into",
  "latest",
  "line",
  "only",
  "path",
  "probe",
  "repair",
  "review",
  "still",
  "test",
  "tests",
  "that",
  "this",
  "thread",
  "valid",
  "with",
]);

function normalizeEvidenceText(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, " ").trim();
}

function evidenceTokens(value: string): Set<string> {
  return new Set(
    normalizeEvidenceText(value)
      .split(/[^a-z0-9_]+/u)
      .filter((token) => token.length >= 4 && !FAILED_STILL_VALID_PROBE_EVIDENCE_STOP_WORDS.has(token)),
  );
}

function textIncludesLiteralEvidence(evidenceText: string, value: string | null | undefined): boolean {
  const normalizedValue = normalizeEvidenceText(value ?? "");
  return normalizedValue.length > 0 && evidenceText.includes(normalizedValue);
}

function hasFailedStillValidProbeEvidenceForThread(args: {
  command: string | null | undefined;
  summary: string | null | undefined;
  thread: ReviewThread;
}): boolean {
  const evidenceText = normalizeEvidenceText(
    [args.command, args.summary].filter((value): value is string => Boolean(value?.trim())).join("\n"),
  );
  if (!evidenceText) {
    return false;
  }

  const latestCodexCommentNode = latestCodexConnectorReviewCommentNode(args.thread);
  const latestThreadComment = args.thread.comments.nodes[args.thread.comments.nodes.length - 1] ?? null;
  const literalThreadEvidence = [
    args.thread.id,
    args.thread.path ?? null,
    latestCodexCommentNode?.id ?? null,
    latestCodexCommentNode?.url ?? null,
    latestThreadComment?.id ?? null,
    latestThreadComment?.url ?? null,
  ];
  if (literalThreadEvidence.some((value) => textIncludesLiteralEvidence(evidenceText, value))) {
    return true;
  }

  const findingBody = latestCodexConnectorReviewComment(args.thread)?.body ?? "";
  const findingTokens = evidenceTokens(findingBody);
  if (findingTokens.size === 0) {
    return false;
  }

  const matchedTokenCount = [...evidenceTokens(evidenceText)]
    .filter((token) => findingTokens.has(token)).length;
  return matchedTokenCount >= (findingTokens.size === 1 ? 1 : 2);
}

function normalizeChangedFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^(?:\.\/)+/u, "");
}

function changedFilesContainPublishedRepairSource(args: {
  changedFilesAfterPublication: readonly string[];
  artifactOnlyChangedFilesAfterPublication: readonly string[];
  issueJournalRelativePath?: string;
  workspaceStatus: Pick<WorkspaceStatus, "hasUncommittedChanges">;
}): boolean {
  if (args.workspaceStatus.hasUncommittedChanges) {
    return false;
  }

  const artifactOnlyPaths = new Set(
    args.artifactOnlyChangedFilesAfterPublication.map(normalizeChangedFilePath),
  );
  const issueJournalRelativePath = args.issueJournalRelativePath
    ? normalizeChangedFilePath(args.issueJournalRelativePath)
    : undefined;
  return args.changedFilesAfterPublication
    .map(normalizeChangedFilePath)
    .some((filePath) =>
      !artifactOnlyPaths.has(filePath) &&
      filePath !== "WORKLOG.md" &&
      !isIgnoredSupervisorArtifactPath(filePath, issueJournalRelativePath)
    );
}

export interface PostPublicationReviewPersistence {
  processedReviewThreadPatch: Pick<
    IssueRunRecord,
    "processed_review_thread_ids" | "processed_review_thread_fingerprints" | "review_loop_retry_state"
  >;
  reviewFollowUpPatch: Pick<IssueRunRecord, "review_follow_up_head_sha" | "review_follow_up_remaining">;
  currentHeadLocalCiPatch: Partial<Pick<IssueRunRecord, "latest_local_ci_result">>;
  hasVerifiedNoSourceChangeReviewThreadEvidence: boolean;
  verifiedNoSourceChangeReviewThreads: ReviewThread[];
}

function currentHeadLocalCiPatchFromCodexVerification(args: {
  config: Pick<SupervisorConfig, "localCiCommand">;
  currentPr: GitHubPullRequest | null;
  codexVerificationCommand: string | null;
  workspaceStatus: Pick<WorkspaceStatus, "hasUncommittedChanges" | "headSha">;
  structuredSummary: string | null | undefined;
}): Partial<Pick<IssueRunRecord, "latest_local_ci_result">> {
  const configuredLocalCiCommand = displayLocalCiCommand(args.config.localCiCommand ?? undefined);
  if (
    !configuredLocalCiCommand ||
    !args.currentPr ||
    !args.codexVerificationCommand ||
    args.codexVerificationCommand.trim() !== configuredLocalCiCommand ||
    args.workspaceStatus.hasUncommittedChanges ||
    args.workspaceStatus.headSha !== args.currentPr.headRefOid
  ) {
    return {};
  }

  const latestLocalCiResult: LatestLocalCiResult = {
    outcome: "passed",
    summary: conciseCodexVerificationSummary(args.structuredSummary) || "configured_local_ci_passed_in_codex_turn",
    ran_at: new Date().toISOString(),
    head_sha: args.currentPr.headRefOid,
    execution_mode: null,
    command: configuredLocalCiCommand,
    failure_class: null,
    remediation_target: null,
  };
  return { latest_local_ci_result: latestLocalCiResult };
}

export function buildPostPublicationReviewPersistence(args: {
  config: SupervisorConfig;
  preRunState: IssueRunRecord["state"];
  record: IssueRunRecord;
  currentPr: GitHubPullRequest | null;
  evaluatedReviewHeadSha: string;
  reviewThreadsToProcess: ReviewThread[];
  localReviewRepairContext: LocalReviewRepairContext | null;
  preRunReviewThreads: ReviewThread[];
  postRunReviewThreads: ReviewThread[];
  codexVerificationCommand: string | null;
  structuredSummary?: string | null;
  workspaceStatus: Pick<WorkspaceStatus, "hasUncommittedChanges" | "headSha">;
  changedFilesAfterPublication: readonly string[];
}): PostPublicationReviewPersistence {
  const verifiedNoSourceChangeReviewThreads =
    args.preRunState === "local_review_fix"
      ? selectVerifiedNoSourceChangeReviewThreads({
          config: args.config,
          localReviewRepairContext: args.localReviewRepairContext,
          reviewThreads: args.reviewThreadsToProcess,
        })
      : [];
  const canPersistVerifiedNoSourceChangeCurrentHead =
    Boolean(args.codexVerificationCommand) &&
    !args.workspaceStatus.hasUncommittedChanges &&
    args.changedFilesAfterPublication.length === 0;
  const processedReviewThreadPatch = nextProcessedReviewThreadPatch({
    config: args.config,
    preRunState: args.preRunState,
    record: args.record,
    currentPr: args.currentPr,
    evaluatedReviewHeadSha: args.evaluatedReviewHeadSha,
    reviewThreadsToProcess: args.reviewThreadsToProcess,
    verifiedNoSourceChangeReviewThreads:
      args.preRunState === "local_review_fix"
        ? verifiedNoSourceChangeReviewThreads
        : undefined,
    persistVerifiedNoSourceChangeCurrentHead: canPersistVerifiedNoSourceChangeCurrentHead,
  });
  const reviewFollowUpPatch = nextReviewFollowUpPatch({
    config: args.config,
    preRunState: args.preRunState,
    record: args.record,
    currentPr: args.currentPr,
    evaluatedReviewHeadSha: args.evaluatedReviewHeadSha,
    preRunReviewThreads: args.preRunReviewThreads,
    postRunReviewThreads: args.postRunReviewThreads,
  });
  const currentPrHeadSha = args.currentPr?.headRefOid ?? null;
  const hasVerifiedNoSourceChangeReviewThreadEvidence =
    hasCurrentTurnVerifiedNoSourceChangeReviewThreadEvidence({
      preRunState: args.preRunState,
      currentPrHeadSha,
      canPersistVerifiedNoSourceChangeCurrentHead,
      verifiedNoSourceChangeReviewThreads,
      processedReviewThreadIds: processedReviewThreadPatch.processed_review_thread_ids,
    });
  return {
    processedReviewThreadPatch,
    reviewFollowUpPatch,
    currentHeadLocalCiPatch: currentHeadLocalCiPatchFromCodexVerification({
      config: args.config,
      currentPr: args.currentPr,
      codexVerificationCommand: args.codexVerificationCommand,
      workspaceStatus: args.workspaceStatus,
      structuredSummary: args.structuredSummary,
    }),
    hasVerifiedNoSourceChangeReviewThreadEvidence,
    verifiedNoSourceChangeReviewThreads,
  };
}

export function buildPostPublicationCodexVerificationTimelineArtifacts(args: {
  record: IssueRunRecord;
  currentPr: GitHubPullRequest | null;
  codexVerificationCommand: string | null;
  failedCodexVerificationCommand?: string | null;
  workspaceStatus: Pick<WorkspaceStatus, "hasUncommittedChanges" | "headSha">;
  preRunState: IssueRunRecord["state"];
  structuredSummary: string | null | undefined;
  postRunState: IssueRunRecord["state"];
  hasVerifiedNoSourceChangeReviewThreadEvidence: boolean;
  verifiedNoSourceChangeReviewThreads: ReviewThread[];
  reviewThreadsToProcess: ReviewThread[];
  changedFilesAfterPublication: readonly string[];
  artifactOnlyChangedFilesAfterPublication: readonly string[];
  issueJournalRelativePath?: string;
}): TimelineArtifact[] | null {
  const currentPrHeadSha = args.currentPr?.headRefOid ?? null;
  const codexTurnVerificationReviewThreads = args.hasVerifiedNoSourceChangeReviewThreadEvidence
    ? args.verifiedNoSourceChangeReviewThreads
    : args.reviewThreadsToProcess;
  const codexTurnVerificationReviewThreadIds =
    processedReviewThreadIdsForHead(codexTurnVerificationReviewThreads, currentPrHeadSha);
  const codexTurnVerificationReviewThreadFingerprints =
    processedReviewThreadFingerprintsForHead(codexTurnVerificationReviewThreads, currentPrHeadSha);
  const hasCodexTurnVerificationReviewThreadEvidence =
    (codexTurnVerificationReviewThreadIds?.length ?? 0) > 0 ||
    (codexTurnVerificationReviewThreadFingerprints?.length ?? 0) > 0;
  const hasPublishedRepairChanges = changedFilesContainPublishedRepairSource({
    changedFilesAfterPublication: args.changedFilesAfterPublication,
    artifactOnlyChangedFilesAfterPublication: args.artifactOnlyChangedFilesAfterPublication,
    issueJournalRelativePath: args.issueJournalRelativePath,
    workspaceStatus: args.workspaceStatus,
  });
  const canEmitSourceChangingReviewRepairTarget =
    args.preRunState === "addressing_review" && hasPublishedRepairChanges;
  const codexTurnVerificationRepairTargets = args.hasVerifiedNoSourceChangeReviewThreadEvidence
    ? [
        VERIFIED_NO_SOURCE_CHANGE_REVIEW_THREAD_RESIDUE_TARGET,
        VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET,
      ]
    : canEmitSourceChangingReviewRepairTarget && hasCodexTurnVerificationReviewThreadEvidence
      ? [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET]
      : undefined;
  const codexTurnVerificationHeadSha =
    args.currentPr &&
    args.codexVerificationCommand &&
    args.workspaceStatus.headSha === args.currentPr.headRefOid &&
    args.postRunState !== "failed" &&
    (args.postRunState !== "blocked" ||
      args.hasVerifiedNoSourceChangeReviewThreadEvidence ||
      hasCodexTurnVerificationReviewThreadEvidence)
      ? args.currentPr.headRefOid
      : null;
  const codexTurnVerificationTimelineArtifacts =
    args.currentPr &&
    args.codexVerificationCommand &&
    codexTurnVerificationHeadSha
      ? upsertTimelineArtifact(
          args.record,
          {
            type: "verification_result",
            gate: "codex_turn",
            command: args.codexVerificationCommand,
            head_sha: codexTurnVerificationHeadSha,
            outcome: "passed",
            remediation_target: null,
            next_action: "continue",
            summary: conciseCodexVerificationSummary(args.structuredSummary),
            recorded_at: new Date().toISOString(),
            ...(codexTurnVerificationRepairTargets
              ? { repair_targets: codexTurnVerificationRepairTargets }
              : {}),
            ...(hasCodexTurnVerificationReviewThreadEvidence
              ? {
                  processed_review_thread_ids: codexTurnVerificationReviewThreadIds ?? [],
                  processed_review_thread_fingerprints: codexTurnVerificationReviewThreadFingerprints ?? [],
                }
              : {}),
          },
          (candidate) =>
            candidate.type === "verification_result" &&
            candidate.gate === "codex_turn" &&
            candidate.outcome === "passed" &&
            candidate.head_sha === codexTurnVerificationHeadSha &&
            candidate.command === args.codexVerificationCommand &&
            sameRepairTargets(candidate.repair_targets, codexTurnVerificationRepairTargets) &&
            sameStringList(candidate.processed_review_thread_ids, codexTurnVerificationReviewThreadIds) &&
            sameStringList(
              candidate.processed_review_thread_fingerprints,
              codexTurnVerificationReviewThreadFingerprints,
            ),
        )
      : null;
  const stillValidRepairProbeThreads = codexConnectorMustFixReviewThreads(args.reviewThreadsToProcess)
    .filter((thread) =>
      hasFailedStillValidProbeEvidenceForThread({
        command: args.failedCodexVerificationCommand,
        summary: args.structuredSummary,
        thread,
      }),
    );
  const stillValidRepairProbeThreadIds =
    processedReviewThreadIdsForHead(stillValidRepairProbeThreads, currentPrHeadSha);
  const stillValidRepairProbeThreadFingerprints =
    processedCodexConnectorReviewThreadFingerprintsForHead(stillValidRepairProbeThreads, currentPrHeadSha);
  const hasStillValidRepairProbeThreadEvidence =
    (stillValidRepairProbeThreadIds?.length ?? 0) > 0 ||
    (stillValidRepairProbeThreadFingerprints?.length ?? 0) > 0;
  const canEmitStillValidRepairProbeFailure =
    args.currentPr &&
    args.failedCodexVerificationCommand &&
    args.preRunState === "addressing_review" &&
    args.postRunState === "blocked" &&
    !args.workspaceStatus.hasUncommittedChanges &&
    args.workspaceStatus.headSha === args.currentPr.headRefOid &&
    hasStillValidRepairProbeThreadEvidence;
  const stillValidRepairProbeTimelineArtifacts = canEmitStillValidRepairProbeFailure
    ? upsertTimelineArtifact(
        args.record,
        {
          type: "verification_result",
          gate: "codex_turn",
          command: args.failedCodexVerificationCommand!,
          head_sha: args.currentPr!.headRefOid,
          outcome: "failed",
          remediation_target: null,
          next_action: "repair_still_valid_review_thread",
          summary: conciseFailedCodexVerificationSummary(args.structuredSummary),
          recorded_at: new Date().toISOString(),
          repair_targets: [STILL_VALID_REVIEW_THREAD_REPAIR_TARGET],
          processed_review_thread_ids: stillValidRepairProbeThreadIds ?? [],
          processed_review_thread_fingerprints: stillValidRepairProbeThreadFingerprints ?? [],
        },
        (candidate) =>
          candidate.type === "verification_result" &&
          candidate.gate === "codex_turn" &&
          candidate.outcome === "failed" &&
          candidate.head_sha === args.currentPr!.headRefOid &&
          candidate.command === args.failedCodexVerificationCommand &&
          candidate.repair_targets?.includes(STILL_VALID_REVIEW_THREAD_REPAIR_TARGET) === true &&
          sameStringList(candidate.processed_review_thread_ids, stillValidRepairProbeThreadIds) &&
          sameStringList(
            candidate.processed_review_thread_fingerprints,
            stillValidRepairProbeThreadFingerprints,
          ),
      )
    : null;
  return stillValidRepairProbeTimelineArtifacts ?? codexTurnVerificationTimelineArtifacts;
}
