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

test("reconcileMergedIssueClosures clears a stale active issue pointer even when the record already matches the done patch", async () => {
  const original = createRecord({
    issue_number: 366,
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
    activeIssueNumber: 366,
    issues: {
      "366": original,
    },
  };
  const closedIssue: GitHubIssue = {
    number: 366,
    title: "Closed issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:20:00Z",
    url: "https://example.test/issues/366",
    state: "CLOSED",
  };

  let touchCalls = 0;
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      touchCalls += 1;
      return { ...current, ...patch };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileMergedIssueClosures(
    {
      getMergedPullRequestsClosingIssue: async () => [],
      getPullRequestIfExists: async () => null,
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    createConfig(),
    [closedIssue],
  );

  assert.equal(touchCalls, 0);
  assert.equal(saveCalls, 1);
  assert.equal(state.activeIssueNumber, null);
  assert.deepEqual(recoveryEvents, []);
  assert.deepEqual(state.issues["366"], original);
});

test("reconcileMergedIssueClosures skips historical terminal records but still revalidates changed or non-terminal closed issues", async () => {
  const historicalDoneRecords = Array.from({ length: 160 }, (_, index) =>
    createRecord({
      issue_number: 700 + index,
      state: "done",
      pr_number: 1700 + index,
      last_head_sha: `head-${700 + index}`,
      last_recovery_reason:
        `merged_pr_convergence: merged PR #${1700 + index} satisfied issue #${700 + index}; marked issue #${700 + index} done`,
      updated_at: "2026-03-13T00:25:00Z",
      last_recovery_at: "2026-03-13T00:25:00Z",
      last_failure_context: null,
      blocked_reason: null,
      last_error: null,
      last_failure_kind: null,
      last_failure_signature: null,
    }));
  const provenanceFreeDoneRecord = createRecord({
    issue_number: 959,
    state: "done",
    pr_number: null,
    last_head_sha: null,
    updated_at: "2026-03-13T00:25:00Z",
    last_recovery_at: "2026-03-13T00:25:00Z",
    last_failure_context: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_signature: null,
  });
  const recentlyChangedClosedRecord = createRecord({
    issue_number: 960,
    state: "done",
    pr_number: 1960,
    last_head_sha: "head-960",
    last_recovery_reason:
      "merged_pr_convergence: merged PR #1960 satisfied issue #960; marked issue #960 done",
    updated_at: "2026-03-13T00:25:00Z",
    last_recovery_at: "2026-03-13T00:25:00Z",
    last_failure_context: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_signature: null,
  });
  const nonTerminalClosedRecord = createRecord({
    issue_number: 961,
    state: "waiting_ci",
    pr_number: 1961,
    last_head_sha: "head-961",
    updated_at: "2026-03-13T00:25:00Z",
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_failure_signature: null,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      ...historicalDoneRecords,
      provenanceFreeDoneRecord,
      recentlyChangedClosedRecord,
      nonTerminalClosedRecord,
    ],
  });
  const issues = [
    ...historicalDoneRecords.map((record) => createIssue({
      number: record.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:20:00Z",
    })),
    createIssue({
      number: provenanceFreeDoneRecord.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:20:00Z",
    }),
    createIssue({
      number: recentlyChangedClosedRecord.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:30:00Z",
    }),
    createIssue({
      number: nonTerminalClosedRecord.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:20:00Z",
    }),
  ];
  const mergedClosureLookups: number[] = [];

  const recoveryEvents = await reconcileMergedIssueClosures(
    {
      getMergedPullRequestsClosingIssue: async (issueNumber) => {
        mergedClosureLookups.push(issueNumber);
        return [];
      },
      getPullRequestIfExists: async () => null,
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return { ...current, ...patch };
      },
      save: async () => {},
    },
    state,
    createConfig(),
    issues,
  );

  assert.deepEqual(mergedClosureLookups, [959, 960, 961]);
  assert.deepEqual(recoveryEvents, []);
});

test("reconcileMergedIssueClosures revalidates suspicious closed done records with stale merged provenance even when issue updatedAt is older", async () => {
  const staleProvenanceRecord = createRecord({
    issue_number: 962,
    state: "done",
    pr_number: 191,
    last_head_sha: "wrong-head-191",
    last_recovery_reason: null,
    updated_at: "2026-03-13T00:25:00Z",
    last_recovery_at: "2026-03-13T00:25:00Z",
    last_failure_context: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_signature: null,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [staleProvenanceRecord],
  });
  const issues = [
    createIssue({
      number: staleProvenanceRecord.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:20:00Z",
    }),
  ];
  const mergedClosureLookups: number[] = [];
  let saveCalls = 0;

  const recoveryEvents = await reconcileMergedIssueClosures(
    {
      getMergedPullRequestsClosingIssue: async (issueNumber) => {
        mergedClosureLookups.push(issueNumber);
        return [
          createPullRequest({
            number: 191,
            state: "MERGED",
            headRefOid: "head-new-191",
            mergedAt: "2026-03-13T00:19:00Z",
          }),
        ];
      },
      getPullRequestIfExists: async () => null,
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-03-13T00:35:00Z",
        };
      },
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    createConfig(),
    issues,
  );

  assert.deepEqual(mergedClosureLookups, [962]);
  assert.equal(state.issues["962"]?.pr_number, 191);
  assert.equal(state.issues["962"]?.last_head_sha, "head-new-191");
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "merged_pr_convergence: merged PR #191 satisfied issue #962; marked issue #962 done",
  ]);
});

test("reconcileMergedIssueClosures backfills merged convergence provenance even when stored PR metadata already matches", async () => {
  const convergedButUntrustedRecord = createRecord({
    issue_number: 963,
    state: "done",
    pr_number: 191,
    last_head_sha: "head-current-191",
    last_recovery_reason: "manual_requeue: operator requeued issue #963 previously",
    updated_at: "2026-03-13T00:25:00Z",
    last_recovery_at: "2026-03-13T00:25:00Z",
    last_failure_context: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_signature: null,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [convergedButUntrustedRecord],
  });
  const issues = [
    createIssue({
      number: convergedButUntrustedRecord.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:20:00Z",
    }),
  ];
  const mergedClosureLookups: number[] = [];
  let saveCalls = 0;

  const recoveryEvents = await reconcileMergedIssueClosures(
    {
      getMergedPullRequestsClosingIssue: async (issueNumber) => {
        mergedClosureLookups.push(issueNumber);
        return [
          createPullRequest({
            number: 191,
            state: "MERGED",
            headRefOid: "head-current-191",
            mergedAt: "2026-03-13T00:19:00Z",
          }),
        ];
      },
      getPullRequestIfExists: async () => null,
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-03-13T00:35:00Z",
        };
      },
      save: async () => {
        saveCalls += 1;
      },
    },
    state,
    createConfig(),
    issues,
  );

  assert.deepEqual(mergedClosureLookups, [963]);
  assert.equal(state.issues["963"]?.pr_number, 191);
  assert.equal(state.issues["963"]?.last_head_sha, "head-current-191");
  assert.equal(
    state.issues["963"]?.last_recovery_reason,
    "merged_pr_convergence: merged PR #191 satisfied issue #963; marked issue #963 done",
  );
  assert.equal(state.issues["963"]?.updated_at, "2026-03-13T00:35:00Z");
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "merged_pr_convergence: merged PR #191 satisfied issue #963; marked issue #963 done",
  ]);
});

test("reconcileMergedIssueClosures bounds historical backlog processing and resumes from the persisted cursor on the next cycle", async () => {
  const firstCycleHistoricalRecord = createRecord({
    issue_number: 959,
    state: "done",
    pr_number: 1959,
    last_head_sha: "stale-head-959",
    last_recovery_reason:
      "merged_pr_convergence: merged PR #1959 satisfied issue #959; marked issue #959 done",
    updated_at: "2026-03-13T00:25:00Z",
    last_recovery_at: "2026-03-13T00:25:00Z",
    last_failure_context: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_signature: null,
  });
  const firstCycleRecentlyChangedRecord = createRecord({
    issue_number: 960,
    state: "done",
    pr_number: 1960,
    last_head_sha: "stale-head-960",
    last_recovery_reason:
      "merged_pr_convergence: merged PR #1960 satisfied issue #960; marked issue #960 done",
    updated_at: "2026-03-13T00:25:00Z",
    last_recovery_at: "2026-03-13T00:25:00Z",
    last_failure_context: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_signature: null,
  });
  const secondCycleNonTerminalRecord = createRecord({
    issue_number: 961,
    state: "waiting_ci",
    pr_number: 1961,
    last_head_sha: "head-961",
    updated_at: "2026-03-13T00:25:00Z",
    last_recovery_at: "2026-03-13T00:25:00Z",
    last_failure_context: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_signature: null,
  });
  const secondCycleSuspiciousDoneRecord = createRecord({
    issue_number: 962,
    state: "done",
    pr_number: 1962,
    last_head_sha: "wrong-head-962",
    last_recovery_reason: null,
    updated_at: "2026-03-13T00:25:00Z",
    last_recovery_at: "2026-03-13T00:25:00Z",
    last_failure_context: null,
    blocked_reason: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_signature: null,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      firstCycleHistoricalRecord,
      firstCycleRecentlyChangedRecord,
      secondCycleNonTerminalRecord,
      secondCycleSuspiciousDoneRecord,
    ],
  });
  const issues = [
    createIssue({
      number: firstCycleHistoricalRecord.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:30:00Z",
    }),
    createIssue({
      number: firstCycleRecentlyChangedRecord.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:30:00Z",
    }),
    createIssue({
      number: secondCycleNonTerminalRecord.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:20:00Z",
    }),
    createIssue({
      number: secondCycleSuspiciousDoneRecord.issue_number,
      state: "CLOSED",
      updatedAt: "2026-03-13T00:20:00Z",
    }),
  ];
  const mergedClosureLookups: number[] = [];
  let saveCalls = 0;

  const github = {
    getMergedPullRequestsClosingIssue: async (issueNumber: number) => {
      mergedClosureLookups.push(issueNumber);
      if (issueNumber === 959) {
        return [
          createPullRequest({
            number: 1959,
            state: "MERGED",
            headRefOid: "head-959",
            mergedAt: "2026-03-13T00:29:00Z",
          }),
        ];
      }
      if (issueNumber === 960) {
        return [
          createPullRequest({
            number: 1960,
            state: "MERGED",
            headRefOid: "head-960",
            mergedAt: "2026-03-13T00:29:00Z",
          }),
        ];
      }
      if (issueNumber === 961) {
        return [
          createPullRequest({
            number: 1961,
            state: "MERGED",
            headRefOid: "head-961",
            mergedAt: "2026-03-13T00:19:00Z",
          }),
        ];
      }
      if (issueNumber === 962) {
        return [
          createPullRequest({
            number: 1962,
            state: "MERGED",
            headRefOid: "head-962",
            mergedAt: "2026-03-13T00:19:00Z",
          }),
        ];
      }
      return [];
    },
    getPullRequestIfExists: async () => null,
    closePullRequest: async () => {
      throw new Error("unexpected closePullRequest call");
    },
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    getIssue: async () => {
      throw new Error("unexpected getIssue call");
    },
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-13T00:35:00Z",
      };
    },
    save: async () => {
      saveCalls += 1;
    },
  };

  const firstCycleEvents = await reconcileMergedIssueClosures(
    github,
    stateStore,
    state,
    createConfig(),
    issues,
    null,
    { maxRecords: 2 },
  );

  assert.deepEqual(mergedClosureLookups, [959, 960]);
  assert.equal(state.reconciliation_state?.merged_issue_closures_last_processed_issue_number, 960);
  assert.equal(state.issues["959"]?.last_head_sha, "head-959");
  assert.equal(state.issues["960"]?.last_head_sha, "head-960");
  assert.equal(state.issues["961"]?.state, "waiting_ci");
  assert.equal(state.issues["962"]?.last_head_sha, "wrong-head-962");
  assert.deepEqual(firstCycleEvents.map((event) => event.reason), [
    "merged_pr_convergence: merged PR #1959 satisfied issue #959; marked issue #959 done",
    "merged_pr_convergence: merged PR #1960 satisfied issue #960; marked issue #960 done",
  ]);

  const secondCycleEvents = await reconcileMergedIssueClosures(
    github,
    stateStore,
    state,
    createConfig(),
    issues,
    null,
    { maxRecords: 2 },
  );

  assert.deepEqual(mergedClosureLookups, [959, 960, 961, 962]);
  assert.equal(state.reconciliation_state?.merged_issue_closures_last_processed_issue_number, null);
  assert.equal(state.issues["961"]?.state, "done");
  assert.equal(state.issues["961"]?.pr_number, 1961);
  assert.equal(state.issues["961"]?.last_head_sha, "head-961");
  assert.equal(state.issues["962"]?.last_head_sha, "head-962");
  assert.equal(saveCalls, 2);
  assert.deepEqual(secondCycleEvents.map((event) => event.reason), [
    "merged_pr_convergence: merged PR #1961 satisfied issue #961; marked issue #961 done",
    "merged_pr_convergence: merged PR #1962 satisfied issue #962; marked issue #962 done",
  ]);
});
