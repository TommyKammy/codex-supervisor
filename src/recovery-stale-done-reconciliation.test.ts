import {
  PARENT_EPIC_AUTO_CLOSED_REASON,
  STALE_NO_PR_MANUAL_STOP_REASON,
  STALE_NO_PR_MANUAL_STOP_RECOVERY_REASON,
  TRACKED_PR_HEAD_BRANCH,
  TRACKED_PR_NEW_HEAD,
  TRACKED_PR_NUMBER,
  TRACKED_PR_OLD_HEAD,
  TRACKED_PR_URL,
  assert,
  blockedReasonForLifecycleState,
  buildIssueDefinitionFingerprint,
  buildTrackedPrStaleFailureConvergencePatch,
  createCodexConnectorRecoveryConfig,
  createConfig,
  createCountingStateStore,
  createIssue,
  createIssueWorktree,
  createParentEpicClosureGithub,
  createParentEpicClosureIssues,
  createParentEpicRecord,
  createPullRequest,
  createRecord,
  createRepositoryWithOrigin,
  createReviewBotTimeoutTrackedPrRecord,
  createReviewThread,
  createStaleDoneNoPrRecord,
  createStaleNoPrManualReviewRecord,
  createSupervisorState,
  createTrackedPrRecoveryIssue,
  createTrackedPrRecoveryPullRequest,
  createTrackedPrStaleReviewRecord,
  createUnexpectedRecoveryGithub,
  executionReadyBody,
  formatRecoveryLog,
  fs,
  inferFailureContext,
  inferStateFromPullRequest,
  isOpenPullRequest,
  noCopilotReviewTimeoutPatch,
  os,
  path,
  reconcileMergedIssueClosures,
  reconcileParentEpicClosures,
  reconcileRecoverableBlockedIssueStates,
  reconcileStaleActiveIssueReservation,
  reconcileStaleDoneIssueStates,
  reconcileStaleFailedIssueStates,
  reconcileTrackedMergedButOpenIssues,
  requeueIssueForOperator,
  runCommand,
  runReviewBotTimeoutRecoveryScenario,
  shouldAutoRetryHandoffMissing,
  syncCopilotReviewRequestObservation,
  syncCopilotReviewTimeoutState,
  syncReviewWaitWindow,
  test,
  type GitHubIssue,
  type GitHubPullRequest,
  type IssueRunRecord,
  type PullRequestCheck,
  type SupervisorStateFile,
} from "./recovery-reconciliation-test-helpers";

test("reconcileStaleDoneIssueStates downgrades stale open no-PR done records to manual review", async () => {
  const record = createStaleDoneNoPrRecord();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [record],
  });
  const issues = [
    createIssue({
      number: 366,
      updatedAt: "2026-03-13T00:21:00Z",
      state: "OPEN",
    }),
  ];
  const stateStore = createCountingStateStore("2026-03-13T00:22:00Z");

  const recoveryEvents = await reconcileStaleDoneIssueStates(
    {
      getIssue: async (issueNumber: number) => {
        assert.equal(issueNumber, 366);
        return issues[0]!;
      },
    },
    stateStore.stateStore,
    state,
    issues,
  );

  assert.equal(stateStore.saveCalls, 1);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.blocked_reason, "manual_review");
  assert.match(state.issues["366"]?.last_error ?? "", /locally marked done without authoritative completion evidence/);
  assert.deepEqual(state.issues["366"]?.last_failure_context?.details ?? [], [
    "state=done",
    "tracked_pr=none",
    "github_issue_state=OPEN",
    "completion_evidence=missing",
    "operator_action=confirm whether the issue should be requeued or whether completion landed outside the tracked PR flow",
  ]);
  assert.equal(recoveryEvents.length, 1);
  assert.equal(
    recoveryEvents[0]?.reason,
    "stale_done_manual_review: blocked issue #366 after reconsidering an open no-PR done record with no authoritative completion signal",
  );
});

test("reconcileStaleDoneIssueStates downgrades suspicious no-PR done records when GitHub revalidation fails", async () => {
  const record = createStaleDoneNoPrRecord();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [record],
  });
  const stateStore = createCountingStateStore("2026-03-13T00:22:00Z");

  const recoveryEvents = await reconcileStaleDoneIssueStates(
    {
      getIssue: async (issueNumber: number) => {
        assert.equal(issueNumber, 366);
        throw new Error("GitHub unavailable");
      },
    },
    stateStore.stateStore,
    state,
    [],
  );

  assert.equal(stateStore.saveCalls, 1);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.blocked_reason, "manual_review");
  assert.match(state.issues["366"]?.last_error ?? "", /GitHub revalidation could not confirm the current issue state/);
  assert.deepEqual(state.issues["366"]?.last_failure_context?.details ?? [], [
    "state=done",
    "tracked_pr=none",
    "github_issue_state=UNKNOWN",
    "completion_evidence=missing",
    "operator_action=confirm whether the issue should be requeued or whether completion landed outside the tracked PR flow",
  ]);
  assert.equal(recoveryEvents.length, 1);
  assert.equal(
    recoveryEvents[0]?.reason,
    "stale_done_revalidation_failed_manual_review: blocked issue #366 after GitHub revalidation failed for a no-PR done record with no authoritative completion signal",
  );
});
