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

test("reconcileParentEpicClosures clears a stale active issue pointer even when the parent record already matches the done patch", async () => {
  const original = createRecord({
    issue_number: 123,
    state: "done",
    pr_number: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    local_review_blocker_summary: null,
    local_review_recommendation: null,
    local_review_degraded: false,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 123,
    issues: {
      "123": original,
    },
  };
  const issues = createParentEpicClosureIssues();

  let closeIssueCalls = 0;
  const stateStore = createCountingStateStore("2026-03-13T00:01:00Z");

  await reconcileParentEpicClosures(
    {
      ...createParentEpicClosureGithub(),
      closeIssue: async () => {
        closeIssueCalls += 1;
      },
    },
    stateStore.stateStore,
    state,
    issues,
  );

  assert.equal(closeIssueCalls, 1);
  assert.equal(stateStore.touchCalls, 1);
  assert.equal(stateStore.saveCalls, 1);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(
    state.issues["123"]?.last_recovery_reason,
    PARENT_EPIC_AUTO_CLOSED_REASON,
  );
  assert.ok(state.issues["123"]?.last_recovery_at);
  assert.equal(state.issues["123"]?.state, "done");
  assert.deepEqual(state.issues["123"], stateStore.touchedRecord);
});

test("reconcileParentEpicClosures returns an explicit recovery event and persists it on the parent record", async () => {
  const original = createParentEpicRecord();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "123": original,
    },
  };
  const issues = createParentEpicClosureIssues();
  const stateStore = createCountingStateStore("2026-03-13T00:01:00Z");

  const recoveryEvents = await reconcileParentEpicClosures(
    createParentEpicClosureGithub(),
    stateStore.stateStore,
    state,
    issues,
  );

  assert.equal(recoveryEvents.length, 1);
  assert.equal(recoveryEvents[0]?.issueNumber, 123);
  assert.equal(recoveryEvents[0]?.reason, PARENT_EPIC_AUTO_CLOSED_REASON);
  assert.equal(state.issues["123"]?.state, "done");
  assert.equal(state.issues["123"]?.last_recovery_reason, PARENT_EPIC_AUTO_CLOSED_REASON);
  assert.ok(state.issues["123"]?.last_recovery_at);
  if (stateStore.savedState === null) {
    throw new Error("expected state to be saved");
  }
  const persistedState: SupervisorStateFile = stateStore.savedState;
  assert.deepEqual(persistedState.issues["123"], state.issues["123"]);
});

test("reconcileParentEpicClosures persists recovery metadata for an untracked parent epic without making it active work", async () => {
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  const issues = createParentEpicClosureIssues();
  const stateStore = createCountingStateStore("2026-03-13T00:01:00Z");

  const recoveryEvents = await reconcileParentEpicClosures(
    createParentEpicClosureGithub(),
    stateStore.stateStore,
    state,
    issues,
  );

  assert.equal(stateStore.touchCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.equal(recoveryEvents[0]?.issueNumber, 123);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["123"]?.issue_number, 123);
  assert.equal(state.issues["123"]?.state, "done");
  assert.equal(state.issues["123"]?.pr_number, null);
  assert.equal(state.issues["123"]?.blocked_reason, null);
  assert.equal(state.issues["123"]?.codex_session_id, null);
  assert.equal(state.issues["123"]?.last_recovery_reason, PARENT_EPIC_AUTO_CLOSED_REASON);
  assert.ok(state.issues["123"]?.last_recovery_at);
  if (stateStore.savedState === null) {
    throw new Error("expected state to be saved");
  }
  const persistedState: SupervisorStateFile = stateStore.savedState;
  assert.deepEqual(persistedState.issues["123"], state.issues["123"]);
});
