import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { mock } from "node:test";
import { StateStore } from "../core/state-store";
import { GitHubIssue, SupervisorStateFile } from "../core/types";
import { renderSupervisorStatusDto } from "./supervisor-status-report";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createPullRequest,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";
import {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
  createTrackedPullRequestStatusScenario,
  createTrackedStatusIssue,
  staleResidueDiagnosticLines,
  writeSupervisorState,
} from "./supervisor-diagnostics-status-scenarios";
import {
  clearCurrentReconciliationPhase,
  writeCurrentReconciliationPhase,
} from "./supervisor-reconciliation-phase";

test("status distinguishes an idle queue after merged PR convergence", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 240;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "done",
        branch: branchName(fixture.config, issueNumber),
        pr_number: 340,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        last_recovery_reason: `merged_pr_convergence: tracked PR #340 merged; marked issue #${issueNumber} done`,
        last_recovery_at: "2026-04-25T00:20:00Z",
        updated_at: "2026-04-25T00:20:00Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(status, /^No active issue\.$/m);
  assert.match(status, /^runnable_issues=none$/m);
  assert.match(status, /^blocked_issues=none$/m);
  assert.match(
    status,
    /^operator_event type=merged_pr_convergence issue=#240 at=2026-04-25T00:20:00Z detail=tracked PR #340 merged; marked issue #240 done$/m,
  );
});

test("status surfaces repeated stale cleanup risk before the stale recovery loop exhausts retries", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 366;
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "queued",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        blocked_reason: null,
        last_error:
          "Issue #366 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
        last_failure_context: {
          category: "blocked",
          summary:
            "Issue #366 re-entered stale stabilizing recovery without a tracked PR; the supervisor will retry while the repeat count remains below 3.",
          signature: "stale-stabilizing-no-pr-recovery-loop",
          command: null,
          details: [
            "state=stabilizing",
            "tracked_pr=none",
            "branch_state=recoverable",
            "repeat_count=1/3",
          ],
          url: null,
          updated_at: "2026-03-23T03:10:00Z",
        },
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
        repeated_failure_signature_count: 0,
        stale_stabilizing_no_pr_recovery_count: 1,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();
  const report = await supervisor.statusReport();

  assert.deepEqual(report.activeIssue?.activityContext, {
    handoffSummary: null,
    localReviewRoutingSummary: null,
    changeClassesSummary: null,
    verificationPolicySummary: null,
    durableGuardrailSummary: null,
    externalReviewFollowUpSummary: null,
    preMergeEvaluation: null,
    localCiStatus: null,
    latestRecovery: null,
    retryContext: {
      timeoutRetryCount: 0,
      blockedVerificationRetryCount: 0,
      repeatedBlockerCount: 0,
      repeatedFailureSignatureCount: 0,
      lastFailureSignature: "stale-stabilizing-no-pr-recovery-loop",
    },
    repeatedRecovery: {
      kind: "stale_stabilizing_no_pr",
      repeatCount: 1,
      repeatLimit: 3,
      status: "retrying",
      action: "confirm_whether_the_change_already_landed_or_retarget_the_issue_manually",
      lastFailureSignature: "stale-stabilizing-no-pr-recovery-loop",
    },
    recentPhaseChanges: [],
    localReviewSummaryPath: null,
    externalReviewMissesPath: null,
    reviewWaits: [],
  });
  assert.match(
    status,
    /stale_recovery_warning issue=#366 status=retrying recoverability=stale_but_recoverable state=queued repeat_count=1\/3 tracked_pr=none action=confirm_whether_the_change_already_landed_or_retarget_the_issue_manually/,
  );
  assert.match(
    status,
    /^recovery_loop_summary kind=stale_stabilizing_no_pr status=retrying repeat_count=1\/3 action=confirm_whether_the_change_already_landed_or_retarget_the_issue_manually apparent_no_progress=yes$/m,
  );
});

test("status surfaces merge-critical recheck cadence and disabled fallback visibility", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const enabledSupervisor = new Supervisor({
    ...fixture.config,
    pollIntervalSeconds: 120,
    mergeCriticalRecheckSeconds: 30,
  });
  (enabledSupervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const enabledStatus = await enabledSupervisor.status();
  assert.match(
    enabledStatus,
    /merge_critical_recheck_seconds=30 merge_critical_effective_seconds=30 merge_critical_recheck_enabled=true/,
  );

  const disabledSupervisor = new Supervisor({
    ...fixture.config,
    pollIntervalSeconds: 120,
    mergeCriticalRecheckSeconds: 0,
  });
  (disabledSupervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const disabledStatus = await disabledSupervisor.status();
  assert.match(
    disabledStatus,
    /merge_critical_recheck_seconds=disabled merge_critical_effective_seconds=120 merge_critical_recheck_enabled=false/,
  );
});

test("status surfaces parent epic auto-closure as the latest recovery on read-only status surfaces", async () => {
  const fixture = await createSupervisorFixture();
  const parentIssueNumber = 199;
  const newerIssueNumber = 200;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(parentIssueNumber)]: createRecord({
        issue_number: parentIssueNumber,
        state: "done",
        branch: "",
        workspace: "",
        journal_path: null,
        pr_number: null,
        codex_session_id: null,
        blocked_reason: null,
        last_recovery_reason:
          "parent_epic_auto_closed: auto-closed parent epic #199 because child issues #201, #202 are closed",
        last_recovery_at: "2026-03-13T00:20:00Z",
      }),
      [String(newerIssueNumber)]: createRecord({
        issue_number: newerIssueNumber,
        state: "done",
        branch: branchName(fixture.config, newerIssueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${newerIssueNumber}`),
        journal_path: null,
        updated_at: "2026-03-13T00:25:00Z",
        last_recovery_reason: null,
        last_recovery_at: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.equal(report.selectionSummary, null);
  assert.equal(report.activeIssue, null);
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^latest_recovery issue=#199 at=2026-03-13T00:20:00Z reason=parent_epic_auto_closed detail=auto-closed parent epic #199 because child issues #201, #202 are closed$/m,
  );

  const status = await supervisor.status();
  assert.match(
    status,
    /^latest_recovery issue=#199 at=2026-03-13T00:20:00Z reason=parent_epic_auto_closed detail=auto-closed parent epic #199 because child issues #201, #202 are closed$/m,
  );
});

test("status surfaces failed no-PR transient auto-requeue recovery on read-only status surfaces", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 204;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "queued",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: null,
        blocked_reason: null,
        last_recovery_reason:
          "failed_no_pr_transient_retry: requeued issue #204 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity",
        last_recovery_at: "2026-03-13T00:20:00Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^latest_recovery issue=#204 at=2026-03-13T00:20:00Z reason=failed_no_pr_transient_retry detail=requeued issue #204 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity$/m,
  );

  const status = await supervisor.status();
  assert.match(
    status,
    /^latest_recovery issue=#204 at=2026-03-13T00:20:00Z reason=failed_no_pr_transient_retry detail=requeued issue #204 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity$/m,
  );
});
