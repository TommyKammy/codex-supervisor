import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleReplayCommand } from "../cli/replay-command";

async function writeConfig(tempDir: string): Promise<string> {
  const configPath = path.join(tempDir, "supervisor.config.json");
  await fs.writeFile(configPath, JSON.stringify({
    repoPath: tempDir,
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: path.join(tempDir, "workspaces"),
    stateBackend: "json",
    stateFile: path.join(tempDir, "state.json"),
    codexBinary: "/usr/bin/codex",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    branchPrefix: "codex/issue-",
  }));
  return configPath;
}

test("handleReplayCommand surfaces execution metrics summaries alongside replay output", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "execution-metrics-replay-"));
  const workspacePath = path.join(tempDir, "workspaces", "issue-408");
  const configPath = await writeConfig(tempDir);
  const snapshotPath = path.join(tempDir, "decision-cycle-snapshot.json");

  await fs.mkdir(path.join(workspacePath, ".codex-supervisor", "execution-metrics"), { recursive: true });
  await fs.writeFile(
    path.join(workspacePath, ".codex-supervisor", "execution-metrics", "run-summary.json"),
    JSON.stringify({
      schemaVersion: 4,
      issueNumber: 408,
      terminalState: "blocked",
      terminalOutcome: {
        category: "blocked",
        reason: "manual_review",
      },
      issueCreatedAt: "2026-03-16T09:00:00Z",
      startedAt: "2026-03-16T09:10:00Z",
      prCreatedAt: "2026-03-16T09:15:00Z",
      prMergedAt: null,
      finishedAt: "2026-03-16T10:10:00Z",
      runDurationMs: 3600000,
      issueLeadTimeMs: 4200000,
      issueToPrCreatedMs: 900000,
      prOpenDurationMs: null,
      reviewMetrics: {
        classification: "configured_bot_threads",
        iterationCount: 2,
        totalCount: 5,
        totalCountKind: "actionable_thread_instances",
      },
      failureMetrics: {
        classification: "latest_failure",
        category: "review",
        failureKind: null,
        blockedReason: "manual_review",
        occurrenceCount: 2,
        lastOccurredAt: "2026-03-16T10:08:00Z",
      },
      recoveryMetrics: {
        classification: "latest_recovery",
        reason: "tracked_pr_head_advanced",
        occurrenceCount: 1,
        lastRecoveredAt: "2026-03-16T10:09:00Z",
        timeToLatestRecoveryMs: 60000,
      },
    }),
  );
  await fs.writeFile(snapshotPath, JSON.stringify({
    schemaVersion: 1,
    capturedAt: "2026-03-16T10:07:00Z",
    issue: {
      number: 408,
      title: "Replay debugging snapshot",
      url: "https://example.test/issues/408",
      state: "OPEN",
      updatedAt: "2026-03-16T10:05:00Z",
    },
    local: {
      record: {
        issue_number: 408,
        state: "reproducing",
        branch: "codex/issue-408",
        pr_number: null,
        workspace: workspacePath,
        journal_path: null,
        attempt_count: 0,
        implementation_attempt_count: 0,
        repair_attempt_count: 0,
        timeout_retry_count: 0,
        blocked_verification_retry_count: 0,
        repeated_blocker_count: 0,
        repeated_failure_signature_count: 0,
        stale_stabilizing_no_pr_recovery_count: 0,
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        last_head_sha: null,
        review_wait_started_at: null,
        review_wait_head_sha: null,
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        merge_readiness_last_evaluated_at: null,
        copilot_review_requested_observed_at: null,
        copilot_review_requested_head_sha: null,
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
        local_review_head_sha: null,
        local_review_blocker_summary: null,
        local_review_summary_path: null,
        local_review_run_at: null,
        local_review_max_severity: null,
        local_review_findings_count: 0,
        local_review_root_cause_count: 0,
        local_review_verified_max_severity: null,
        local_review_verified_findings_count: 0,
        local_review_recommendation: null,
        local_review_degraded: false,
        last_local_review_signature: null,
        repeated_local_review_signature_count: 0,
        latest_local_ci_result: null,
        processed_review_thread_ids: [],
        processed_review_thread_fingerprints: [],
        updated_at: "2026-03-16T10:05:00Z",
      },
      workspaceStatus: {
        branch: "codex/issue-408",
        headSha: "head-408",
        hasUncommittedChanges: false,
        baseAhead: 0,
        baseBehind: 0,
        remoteBranchExists: false,
        remoteAhead: 0,
        remoteBehind: 0,
      },
    },
    github: {
      pullRequest: null,
      checks: [],
      reviewThreads: [],
    },
    decision: {
      nextState: "reproducing",
      shouldRunCodex: true,
      blockedReason: null,
      failureContext: null,
    },
    operatorSummary: null,
  }));

  const output = await handleReplayCommand({
    configPath,
    snapshotPath,
  });

  assert.match(output, /replayed_next_state=reproducing/);
  assert.match(output, /execution_metrics terminal_state=blocked outcome=blocked reason=manual_review run_duration_ms=3600000/);
  assert.match(output, /execution_metrics_review classification=configured_bot_threads iterations=2 actionable_threads=5/);
  assert.match(output, /execution_metrics_failure category=review failure_kind=none blocked_reason=manual_review occurrences=2/);
  assert.match(output, /execution_metrics_recovery reason=tracked_pr_head_advanced occurrences=1/);
  assert.match(output, /decision_match=yes/);
});
