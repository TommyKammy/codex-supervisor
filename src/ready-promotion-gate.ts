import {
  FailureContext,
  GitHubPullRequest,
  IssueRunRecord,
} from "./core/types";
import { truncate } from "./core/utils";
import { type WorkstationLocalPathGateResult } from "./workstation-local-path-gate";
import * as trackedPrStatusComments from "./tracked-pr-status-comment";
import {
  appendTimelineArtifact,
  buildPathHygieneTimelineArtifact,
} from "./timeline-artifacts";
import { READY_PROMOTION_PATH_HYGIENE_REPAIR_SUMMARY } from "./ready-promotion-path-hygiene-repair";

export type ReadyPromotionPathHygieneDecision =
  | {
      kind: "passed";
      rewrittenTrackedPaths: string[];
    }
  | {
      kind: "repair";
      failureContext: FailureContext;
      recordPatch: Partial<IssueRunRecord>;
      comment: {
        gateType: "workstation_local_path_hygiene";
        blockerSignature: string | null;
        failureClass: string | null;
        remediationTarget: "repair_already_queued";
        summary: string;
        details: string[] | null | undefined;
      };
    }
  | {
      kind: "manual_review";
      failureContext: FailureContext | null;
      recordPatch: Partial<IssueRunRecord>;
      comment: {
        gateType: "workstation_local_path_hygiene";
        blockerSignature: string | null;
        failureClass: string | null;
        remediationTarget: "manual_review";
        summary: string | null;
        details: string[] | null | undefined;
      };
    };

export function deriveReadyPromotionPathHygieneDecision(args: {
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  gate: WorkstationLocalPathGateResult;
  fallbackSummary: string;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
}): ReadyPromotionPathHygieneDecision {
  if (args.gate.ok) {
    return {
      kind: "passed",
      rewrittenTrackedPaths: [
        ...(args.gate.rewrittenJournalPaths ?? []),
        ...(args.gate.rewrittenTrustedGeneratedArtifactPaths ?? []),
      ],
    };
  }

  const failureContext = args.gate.failureContext;
  const actionablePublishableFilePaths = args.gate.actionablePublishableFilePaths ?? [];
  if (failureContext !== null && actionablePublishableFilePaths.length > 0) {
    const repairFailureContext: FailureContext = {
      ...failureContext,
      summary: `${READY_PROMOTION_PATH_HYGIENE_REPAIR_SUMMARY} Actionable files: ${actionablePublishableFilePaths.join(", ")}. ${failureContext.summary}`,
    };
    return {
      kind: "repair",
      failureContext: repairFailureContext,
      recordPatch: {
        state: "repairing_ci",
        timeline_artifacts: appendTimelineArtifact(args.record, buildPathHygieneTimelineArtifact({
          failureContext: repairFailureContext,
          headSha: args.pr.headRefOid ?? null,
          outcome: "repair_queued",
          remediationTarget: "repair_already_queued",
          repairTargets: actionablePublishableFilePaths,
        })),
        last_error: truncate(repairFailureContext.summary, 1000),
        last_failure_kind: null,
        last_failure_context: repairFailureContext,
        ...args.applyFailureSignature(args.record, repairFailureContext),
        blocked_reason: null,
        ...trackedPrStatusComments.observedTrackedPrHostLocalBlockerPatch({
          pr: args.pr,
          blockerSignature: repairFailureContext.signature,
        }),
      },
      comment: {
        gateType: "workstation_local_path_hygiene",
        blockerSignature: repairFailureContext.signature,
        failureClass: repairFailureContext.signature,
        remediationTarget: "repair_already_queued",
        summary: repairFailureContext.summary,
        details: repairFailureContext.details,
      },
    };
  }

  return {
    kind: "manual_review",
    failureContext,
    recordPatch: {
      state: "blocked",
      timeline_artifacts: failureContext
        ? appendTimelineArtifact(args.record, buildPathHygieneTimelineArtifact({
          failureContext,
          headSha: args.pr.headRefOid ?? null,
          outcome: "failed",
          remediationTarget: "manual_review",
        }))
        : args.record.timeline_artifacts,
      last_error: truncate(failureContext?.summary ?? args.fallbackSummary, 1000),
      last_failure_kind: null,
      last_failure_context: failureContext,
      ...args.applyFailureSignature(args.record, failureContext),
      blocked_reason: "verification",
      ...trackedPrStatusComments.observedTrackedPrHostLocalBlockerPatch({
        pr: args.pr,
        blockerSignature: failureContext?.signature ?? null,
      }),
    },
    comment: {
      gateType: "workstation_local_path_hygiene",
      blockerSignature: failureContext?.signature ?? null,
      failureClass: failureContext?.signature ?? null,
      remediationTarget: "manual_review",
      summary: failureContext?.summary ?? null,
      details: failureContext?.details,
    },
  };
}
