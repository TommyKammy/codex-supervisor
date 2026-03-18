import fs from "node:fs/promises";
import { parseJson } from "../core/utils";
import { inferStateWithoutPullRequest } from "../no-pull-request-state";
import {
  IssueRunRecord,
  SupervisorConfig,
} from "../core/types";
import { blockedReasonForLifecycleState, derivePullRequestLifecycleSnapshot, shouldRunCodex } from "./supervisor-lifecycle";
import { inferFailureContext } from "./supervisor-failure-context";
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
      const replayedDecision = {
        nextState: lifecycle.nextState,
        shouldRunCodex: shouldRunCodex(
          lifecycle.recordForState,
          snapshot.github.pullRequest,
          snapshot.github.checks,
          snapshot.github.reviewThreads,
          config,
        ),
        blockedReason: blockedReasonForLifecycleState(
          config,
          lifecycle.recordForState,
          snapshot.github.pullRequest,
          snapshot.github.checks,
          snapshot.github.reviewThreads,
        ),
        failureContext: lifecycle.failureContext,
      };

      return {
        replayedDecision,
        effectiveRecord: {
          state: lifecycle.recordForState.state,
          review_wait_started_at: lifecycle.recordForState.review_wait_started_at,
          review_wait_head_sha: lifecycle.recordForState.review_wait_head_sha,
          copilot_review_requested_observed_at: lifecycle.recordForState.copilot_review_requested_observed_at,
          copilot_review_requested_head_sha: lifecycle.recordForState.copilot_review_requested_head_sha,
          copilot_review_timed_out_at: lifecycle.recordForState.copilot_review_timed_out_at,
          copilot_review_timeout_action: lifecycle.recordForState.copilot_review_timeout_action,
          copilot_review_timeout_reason: lifecycle.recordForState.copilot_review_timeout_reason,
        },
        matchesCapturedDecision:
          JSON.stringify(normalizeDecision(replayedDecision)) === JSON.stringify(normalizeDecision(snapshot.decision)),
      };
    }

    const replayedDecision = {
      nextState: inferStateWithoutPullRequest(
        snapshot.local.record as IssueRunRecord,
        snapshot.local.workspaceStatus,
      ),
      shouldRunCodex: shouldRunCodex(
        snapshot.local.record as IssueRunRecord,
        null,
        snapshot.github.checks,
        snapshot.github.reviewThreads,
        config,
      ),
      blockedReason: null,
      failureContext: inferFailureContext(
        config,
        snapshot.local.record as IssueRunRecord,
        null,
        snapshot.github.checks,
        snapshot.github.reviewThreads,
      ),
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
