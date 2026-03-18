import fs from "node:fs/promises";
import { parseJson } from "../core/utils";
import { inferStateWithoutPullRequest } from "../no-pull-request-state";
import {
  IssueRunRecord,
  SupervisorConfig,
} from "../core/types";
import { blockedReasonForLifecycleState, derivePullRequestLifecycleSnapshot, shouldRunCodex } from "./supervisor-lifecycle";
import { applyFailureSignature, shouldAutoRetryTimeout } from "./supervisor-failure-helpers";
import { localReviewFailureContext, localReviewHighSeverityNeedsRetry } from "../review-handling";
import { isEligibleForSelection } from "./supervisor-execution-policy";
import type { SupervisorCycleDecisionSnapshot } from "./supervisor-cycle-snapshot";

export interface SupervisorCycleReplayResult {
  replayedDecision: SupervisorCycleDecisionSnapshot["decision"];
  effectiveRecord: Pick<
    IssueRunRecord,
    | "state"
    | "review_wait_started_at"
    | "review_wait_head_sha"
    | "copilot_review_requested_observed_at"
    | "copilot_review_requested_head_sha"
    | "copilot_review_timed_out_at"
    | "copilot_review_timeout_action"
    | "copilot_review_timeout_reason"
  >;
  matchesCapturedDecision: boolean;
}

function normalizeDecision(decision: SupervisorCycleDecisionSnapshot["decision"]): object {
  return {
    ...decision,
    failureContext: decision.failureContext
      ? {
          ...decision.failureContext,
          updated_at: null,
        }
      : null,
  };
}

function withReplayClock<T>(capturedAt: string, run: () => T): T {
  const replayedNowMs = Date.parse(capturedAt);
  if (Number.isNaN(replayedNowMs)) {
    throw new Error(`Invalid supervisor cycle snapshot capturedAt: ${capturedAt}`);
  }

  const originalDateNow = Date.now;
  Date.now = () => replayedNowMs;
  try {
    return run();
  } finally {
    Date.now = originalDateNow;
  }
}

export async function loadSupervisorCycleDecisionSnapshot(snapshotPath: string): Promise<SupervisorCycleDecisionSnapshot> {
  const raw = await fs.readFile(snapshotPath, "utf8");
  const snapshot = parseJson<SupervisorCycleDecisionSnapshot>(raw, snapshotPath);
  if (snapshot.schemaVersion !== 1) {
    throw new Error(`Unsupported supervisor cycle snapshot schema version: ${String(snapshot.schemaVersion)}`);
  }

  return snapshot;
}

export function replaySupervisorCycleDecisionSnapshot(
  snapshot: SupervisorCycleDecisionSnapshot,
  config: SupervisorConfig,
): SupervisorCycleReplayResult {
  return withReplayClock(snapshot.capturedAt, () => {
    if (snapshot.github.pullRequest) {
      const lifecycle = derivePullRequestLifecycleSnapshot(
        config,
        snapshot.local.record as IssueRunRecord,
        snapshot.github.pullRequest,
        snapshot.github.checks,
        snapshot.github.reviewThreads,
      );
      const effectiveFailureContext =
        lifecycle.failureContext ??
        (lifecycle.nextState === "local_review_fix" &&
        localReviewHighSeverityNeedsRetry(config, lifecycle.recordForState, snapshot.github.pullRequest)
          ? localReviewFailureContext(lifecycle.recordForState)
          : null);
      const preEscalationBlockedReason = blockedReasonForLifecycleState(
        config,
        lifecycle.recordForState,
        snapshot.github.pullRequest,
        snapshot.github.checks,
        snapshot.github.reviewThreads,
      );
      let effectiveRecord = {
        ...(snapshot.local.record as IssueRunRecord),
        pr_number: snapshot.github.pullRequest.number,
        state: lifecycle.nextState,
        ...lifecycle.reviewWaitPatch,
        ...lifecycle.copilotRequestObservationPatch,
        ...lifecycle.copilotTimeoutPatch,
        last_error:
          lifecycle.nextState === "blocked" && effectiveFailureContext
            ? effectiveFailureContext.summary
            : snapshot.local.record.last_error,
        last_failure_context: effectiveFailureContext,
        ...applyFailureSignature(snapshot.local.record as IssueRunRecord, effectiveFailureContext),
        blocked_reason: preEscalationBlockedReason,
      } satisfies IssueRunRecord;
      if (
        effectiveFailureContext &&
        effectiveRecord.last_failure_signature !== null &&
        effectiveRecord.repeated_failure_signature_count >= config.sameFailureSignatureRepeatLimit
      ) {
        effectiveRecord = {
          ...effectiveRecord,
          state: "failed",
          last_error:
            `Repeated identical failure signature ${effectiveRecord.repeated_failure_signature_count} times: ` +
            `${effectiveRecord.last_failure_signature}`,
          last_failure_kind: "command_error",
          blocked_reason: null,
        };
      }
      const replayedDecision = {
        nextState: effectiveRecord.state,
        shouldRunCodex: shouldRunCodex(
          effectiveRecord,
          snapshot.github.pullRequest,
          snapshot.github.checks,
          snapshot.github.reviewThreads,
          config,
        ),
        blockedReason: effectiveRecord.state === "failed" ? null : preEscalationBlockedReason,
        failureContext: effectiveRecord.last_failure_context,
      };

      return {
        replayedDecision,
        effectiveRecord: {
          state: effectiveRecord.state,
          review_wait_started_at: effectiveRecord.review_wait_started_at,
          review_wait_head_sha: effectiveRecord.review_wait_head_sha,
          copilot_review_requested_observed_at: effectiveRecord.copilot_review_requested_observed_at,
          copilot_review_requested_head_sha: effectiveRecord.copilot_review_requested_head_sha,
          copilot_review_timed_out_at: effectiveRecord.copilot_review_timed_out_at,
          copilot_review_timeout_action: effectiveRecord.copilot_review_timeout_action,
          copilot_review_timeout_reason: effectiveRecord.copilot_review_timeout_reason,
        },
        matchesCapturedDecision:
          JSON.stringify(normalizeDecision(replayedDecision)) === JSON.stringify(normalizeDecision(snapshot.decision)),
      };
    }

    const baseRecord = snapshot.local.record as IssueRunRecord;
    if (!isEligibleForSelection(baseRecord, config)) {
      const replayedDecision = {
        nextState: baseRecord.state,
        shouldRunCodex: false,
        blockedReason: baseRecord.blocked_reason,
        failureContext: baseRecord.last_failure_context,
      };

      return {
        replayedDecision,
        effectiveRecord: {
          state: baseRecord.state,
          review_wait_started_at: baseRecord.review_wait_started_at,
          review_wait_head_sha: baseRecord.review_wait_head_sha,
          copilot_review_requested_observed_at: baseRecord.copilot_review_requested_observed_at,
          copilot_review_requested_head_sha: baseRecord.copilot_review_requested_head_sha,
          copilot_review_timed_out_at: baseRecord.copilot_review_timed_out_at,
          copilot_review_timeout_action: baseRecord.copilot_review_timeout_action,
          copilot_review_timeout_reason: baseRecord.copilot_review_timeout_reason,
        },
        matchesCapturedDecision:
          JSON.stringify(normalizeDecision(replayedDecision)) === JSON.stringify(normalizeDecision(snapshot.decision)),
      };
    }

    const replayedDecision = {
      nextState: inferStateWithoutPullRequest(
        baseRecord,
        snapshot.local.workspaceStatus,
      ),
      shouldRunCodex: shouldRunCodex(
        {
          ...baseRecord,
          blocked_reason: shouldAutoRetryTimeout(baseRecord, config) ? null : baseRecord.blocked_reason,
          last_failure_context: shouldAutoRetryTimeout(baseRecord, config) ? null : baseRecord.last_failure_context,
          last_failure_signature: shouldAutoRetryTimeout(baseRecord, config) ? null : baseRecord.last_failure_signature,
          repeated_failure_signature_count: shouldAutoRetryTimeout(baseRecord, config)
            ? 0
            : baseRecord.repeated_failure_signature_count,
        } as IssueRunRecord,
        null,
        snapshot.github.checks,
        snapshot.github.reviewThreads,
        config,
      ),
      blockedReason: null,
      failureContext: null,
    };

    return {
      replayedDecision,
      effectiveRecord: {
        state: replayedDecision.nextState,
        review_wait_started_at: snapshot.local.record.review_wait_started_at,
        review_wait_head_sha: snapshot.local.record.review_wait_head_sha,
        copilot_review_requested_observed_at: snapshot.local.record.copilot_review_requested_observed_at,
        copilot_review_requested_head_sha: snapshot.local.record.copilot_review_requested_head_sha,
        copilot_review_timed_out_at: snapshot.local.record.copilot_review_timed_out_at,
        copilot_review_timeout_action: snapshot.local.record.copilot_review_timeout_action,
        copilot_review_timeout_reason: snapshot.local.record.copilot_review_timeout_reason,
      },
      matchesCapturedDecision:
        JSON.stringify(normalizeDecision(replayedDecision)) === JSON.stringify(normalizeDecision(snapshot.decision)),
    };
  });
}

export function formatSupervisorCycleReplay(args: {
  snapshotPath: string;
  replayResult: SupervisorCycleReplayResult;
  snapshot: SupervisorCycleDecisionSnapshot;
}): string {
  const { snapshotPath, replayResult, snapshot } = args;
  return [
    `snapshot_path=${snapshotPath}`,
    `captured_at=${snapshot.capturedAt}`,
    `issue_number=${snapshot.issue.number}`,
    `pr_number=${snapshot.github.pullRequest?.number ?? "none"}`,
    `captured_next_state=${snapshot.decision.nextState}`,
    `replayed_next_state=${replayResult.replayedDecision.nextState}`,
    `captured_should_run_codex=${snapshot.decision.shouldRunCodex}`,
    `replayed_should_run_codex=${replayResult.replayedDecision.shouldRunCodex}`,
    `captured_blocked_reason=${snapshot.decision.blockedReason ?? "none"}`,
    `replayed_blocked_reason=${replayResult.replayedDecision.blockedReason ?? "none"}`,
    `captured_failure_signature=${snapshot.decision.failureContext?.signature ?? "none"}`,
    `replayed_failure_signature=${replayResult.replayedDecision.failureContext?.signature ?? "none"}`,
    `decision_match=${replayResult.matchesCapturedDecision ? "yes" : "no"}`,
  ].join("\n");
}
