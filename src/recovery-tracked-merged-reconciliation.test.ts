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

test("reconcileTrackedMergedButOpenIssues fetches missing issue snapshots for non-merging merged records", async () => {
  const record = createRecord({
    issue_number: 366,
    state: "ready_to_merge",
    pr_number: 191,
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": record,
    },
  };
  const mergedPr: GitHubPullRequest = {
    number: 191,
    title: "Merged implementation",
    url: "https://example.test/pr/191",
    state: "MERGED",
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:20:00Z",
    isDraft: false,
    headRefName: "codex/reopen-issue-366",
    headRefOid: "merged-head-191",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    mergedAt: "2026-03-13T00:20:00Z",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };
  const closedIssue: GitHubIssue = {
    number: 366,
    title: "Merged implementation issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:21:00Z",
    url: "https://example.test/issues/366",
    state: "CLOSED",
  };

  let getIssueCalls = 0;
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-13T00:25:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async () => mergedPr,
      getIssue: async () => {
        getIssueCalls += 1;
        return closedIssue;
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    createConfig(),
    [],
  );

  assert.equal(getIssueCalls, 1);
  assert.equal(saveCalls, 1);
  assert.equal(state.issues["366"]?.state, "done");
  assert.equal(state.issues["366"]?.pr_number, 191);
  assert.equal(state.issues["366"]?.last_head_sha, "merged-head-191");
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "merged_pr_convergence: tracked PR #191 merged; marked issue #366 done",
  ]);
});

test("reconcileTrackedMergedButOpenIssues refreshes open issue snapshots for merging records before applying the merge-time gate", async () => {
  const record = createRecord({
    issue_number: 366,
    state: "merging",
    pr_number: 191,
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": record,
    },
  };
  const mergedPr: GitHubPullRequest = {
    number: 191,
    title: "Merged implementation",
    url: "https://example.test/pr/191",
    state: "MERGED",
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:20:00Z",
    isDraft: false,
    headRefName: "codex/reopen-issue-366",
    headRefOid: "merged-head-191",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    mergedAt: "2026-03-13T00:20:00Z",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };
  const staleOpenIssue: GitHubIssue = {
    number: 366,
    title: "Merged implementation issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:25:00Z",
    url: "https://example.test/issues/366",
    state: "OPEN",
  };
  const refreshedOpenIssue: GitHubIssue = {
    ...staleOpenIssue,
    updatedAt: "2026-03-13T00:19:00Z",
  };

  let getIssueCalls = 0;
  let closeIssueCalls = 0;
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-13T00:25:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async () => mergedPr,
      getIssue: async () => {
        getIssueCalls += 1;
        return refreshedOpenIssue;
      },
      closeIssue: async () => {
        closeIssueCalls += 1;
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    createConfig(),
    [staleOpenIssue],
  );

  assert.equal(getIssueCalls, 1);
  assert.equal(closeIssueCalls, 1);
  assert.equal(saveCalls, 1);
  assert.equal(state.issues["366"]?.state, "done");
  assert.equal(state.issues["366"]?.pr_number, 191);
  assert.equal(state.issues["366"]?.last_head_sha, "merged-head-191");
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "merged_pr_convergence: tracked PR #191 merged; marked issue #366 done",
  ]);
});

test("reconcileTrackedMergedButOpenIssues reports the inferred wait step when open tracked PR refresh resumes in waiting_ci", async () => {
  const config = createConfig({
    reviewBotLogins: ["coderabbitai[bot]"],
    configuredBotInitialGraceWaitSeconds: 90,
  });
  const record = createRecord({
    issue_number: 366,
    state: "pr_open",
    pr_number: 191,
    last_head_sha: "head-191",
    branch: "codex/reopen-issue-366",
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": record,
    },
  };
  const openPr = createTrackedPrRecoveryPullRequest({
    headRefOid: "head-191",
    currentHeadCiGreenAt: "2026-03-16T00:00:00Z",
  });

  let saveCalls = 0;
  const progressUpdates: Array<{
    targetIssueNumber?: number | null;
    targetPrNumber?: number | null;
    waitStep?: string | null;
  }> = [];
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-16T00:00:31Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-03-16T00:00:30Z");
  try {
    const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
      {
        getPullRequestIfExists: async () => openPr,
        getIssue: async () => {
          throw new Error("unexpected getIssue call");
        },
        closeIssue: async () => {
          throw new Error("unexpected closeIssue call");
        },
        closePullRequest: async () => {
          throw new Error("unexpected closePullRequest call");
        },
        getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        getMergedPullRequestsClosingIssue: async () => [],
        getUnresolvedReviewThreads: async () => [],
      },
      stateStore,
      state,
      config,
      [createTrackedPrRecoveryIssue()],
      async (patch) => {
        progressUpdates.push(patch);
      },
    );

    assert.equal(saveCalls, 1);
    assert.equal(state.issues["366"]?.state, "waiting_ci");
    assert.deepEqual(progressUpdates, [
      {
        targetIssueNumber: 366,
        targetPrNumber: 191,
        waitStep: null,
      },
      {
        waitStep: "configured_bot_initial_grace_wait",
      },
    ]);
    assert.deepEqual(recoveryEvents.map((event) => event.reason), [
      "tracked_pr_lifecycle_recovered: resumed issue #366 from pr_open to waiting_ci using fresh tracked PR #191 facts at head head-191",
    ]);
  } finally {
    Date.now = originalDateNow;
  }
});

test("reconcileTrackedMergedButOpenIssues records provider success from Codex success comments without status context", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotSettledWaitSeconds: 0,
    configuredBotRequireCurrentHeadSignal: true,
    configuredBotCurrentHeadSignalTimeoutMinutes: 1,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const headSha = "d5a9957506c697dc13f5431bb460cfe95257bcae";
  const record = createRecord({
    issue_number: 174,
    state: "waiting_ci",
    pr_number: 183,
    last_head_sha: headSha,
    branch: "codex/issue-174",
    review_wait_started_at: "2026-05-23T16:04:34.342Z",
    review_wait_head_sha: headSha,
    copilot_review_timed_out_at: "2026-05-23T16:07:04.342Z",
    copilot_review_timeout_action: "request_review_comment",
    copilot_review_timeout_reason: "current_head_signal_wait_timed_out",
    last_failure_context: {
      category: "review",
      summary: "7 unresolved automated review thread(s) remain.",
      signature: "PRRT_hrcore_183_1",
      command: null,
      details: ["src/mvp-a-onboarding-traceability.ts:? p_severity=P1 summary=stale Codex Connector residue"],
      url: "https://example.test/pr/183#discussion_r1",
      updated_at: "2026-05-25T03:43:48.716Z",
    },
    last_failure_signature: "PRRT_hrcore_183_1",
    repeated_failure_signature_count: 1,
    provider_success_head_sha: null,
    provider_success_observed_at: null,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [record],
  });
  const pr = createPullRequest({
    number: 183,
    title: "HRCore stale Codex Connector residue",
    url: "https://example.test/pr/183",
    headRefName: "codex/issue-174",
    headRefOid: headSha,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    reviewDecision: null,
    currentHeadCiGreenAt: "2026-05-23T16:02:36Z",
    configuredBotCurrentHeadObservedAt: "2026-05-23T14:33:41Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: "7327afdab32fb9c7ffb741d6158add4616bb3115",
    configuredBotTopLevelReviewStrength: null,
    requiredConversationResolution: {
      state: "enabled",
      source: "branch_protection",
      details: ["required_conversation_resolution=true"],
    },
  });
  const reviewThreads = Array.from({ length: 7 }, (_value, index) =>
    createReviewThread({
      id: `PRRT_hrcore_183_${index + 1}`,
      isOutdated: true,
      line: null,
      comments: {
        nodes: [
          {
            id: `comment-hrcore-${index + 1}`,
            body: "P1: Earlier Codex Connector finding that is obsolete after the current-head no-major signal.",
            createdAt: "2026-05-23T14:16:47Z",
            url: `https://example.test/pr/183#discussion_r${index + 1}`,
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
          {
            id: `comment-operator-hrcore-${index + 1}`,
            body: "Supervisor confirmed this stale Codex Connector finding is covered by the current-head success signal.",
            createdAt: "2026-05-25T04:16:47Z",
            url: `https://example.test/pr/183#discussion_r${index + 1}`,
            author: {
              login: "TommyKammy",
              typeName: "User",
            },
          },
        ],
      },
    }),
  );
  let saveCalls = 0;

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => reviewThreads,
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-05-25T03:55:00Z",
        };
      },
      async save(): Promise<void> {
        saveCalls += 1;
      },
    },
    state,
    config,
    [createIssue({ number: 174, title: "HRCore stale residue", updatedAt: "2026-05-25T03:54:00Z" })],
  );

  const updated = state.issues["174"];
  assert.equal(updated.state, "pr_open");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.provider_success_head_sha, headSha);
  assert.ok(updated.provider_success_observed_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    `tracked_pr_lifecycle_recovered: resumed issue #174 from waiting_ci to pr_open using fresh tracked PR #183 facts at head ${headSha}`,
  ]);
});

test("reconcileTrackedMergedButOpenIssues can restrict convergence to the active merging issue", async () => {
  const activeRecord = createRecord({
    issue_number: 366,
    state: "merging",
    pr_number: 191,
    blocked_reason: null,
  });
  const unrelatedRecord = createRecord({
    issue_number: 367,
    state: "waiting_ci",
    branch: "codex/reopen-issue-367",
    pr_number: 192,
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "367": unrelatedRecord,
      "366": activeRecord,
    },
  };
  const mergedPr = createPullRequest({
    number: 191,
    title: "Merged implementation",
    url: "https://example.test/pr/191",
    state: "MERGED",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "merged-head-191",
    mergedAt: "2026-03-13T00:20:00Z",
  });
  const closedIssue: GitHubIssue = {
    number: 366,
    title: "Merged implementation issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:21:00Z",
    url: "https://example.test/issues/366",
    state: "CLOSED",
  };

  const prLookups: number[] = [];
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-13T00:25:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async (prNumber) => {
        prLookups.push(prNumber);
        if (prNumber === 191) {
          return mergedPr;
        }
        throw new Error(`unexpected unrelated PR lookup #${prNumber}`);
      },
      getIssue: async () => closedIssue,
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    createConfig(),
    [closedIssue],
    null,
    { onlyIssueNumber: 366 },
  );

  assert.equal(saveCalls, 1);
  assert.deepEqual(prLookups, [191]);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "done");
  assert.equal(state.issues["367"]?.state, "waiting_ci");
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "merged_pr_convergence: tracked PR #191 merged; marked issue #366 done",
  ]);
});

test("reconcileTrackedMergedButOpenIssues stops after the per-cycle budget and defers remaining records", async () => {
  const firstRecord = createRecord({
    issue_number: 366,
    state: "merging",
    pr_number: 191,
    blocked_reason: null,
  });
  const secondRecord = createRecord({
    issue_number: 367,
    state: "waiting_ci",
    branch: "codex/reopen-issue-367",
    pr_number: 192,
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": firstRecord,
      "367": secondRecord,
    },
  };
  const firstMergedPr = createPullRequest({
    number: 191,
    title: "Merged implementation 191",
    url: "https://example.test/pr/191",
    state: "MERGED",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "merged-head-191",
    mergedAt: "2026-03-13T00:20:00Z",
  });
  const secondMergedPr = createPullRequest({
    number: 192,
    title: "Merged implementation 192",
    url: "https://example.test/pr/192",
    state: "MERGED",
    headRefName: "codex/reopen-issue-367",
    headRefOid: "merged-head-192",
    mergedAt: "2026-03-13T00:22:00Z",
  });
  const closedIssues = new Map<number, GitHubIssue>([
    [366, {
      number: 366,
      title: "Merged implementation issue 366",
      body: "",
      createdAt: "2026-03-13T00:00:00Z",
      updatedAt: "2026-03-13T00:21:00Z",
      url: "https://example.test/issues/366",
      state: "CLOSED",
    }],
    [367, {
      number: 367,
      title: "Merged implementation issue 367",
      body: "",
      createdAt: "2026-03-13T00:01:00Z",
      updatedAt: "2026-03-13T00:23:00Z",
      url: "https://example.test/issues/367",
      state: "CLOSED",
    }],
  ]);

  const prLookups: number[] = [];
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-13T00:25:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async (prNumber) => {
        prLookups.push(prNumber);
        if (prNumber === 191) {
          return firstMergedPr;
        }
        if (prNumber === 192) {
          return secondMergedPr;
        }
        throw new Error(`unexpected PR lookup #${prNumber}`);
      },
      getIssue: async (issueNumber) => {
        const issue = closedIssues.get(issueNumber);
        assert.ok(issue, `expected closed issue snapshot for #${issueNumber}`);
        return issue;
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    createConfig(),
    Array.from(closedIssues.values()),
    null,
    { maxRecords: 1 },
  );

  assert.equal(saveCalls, 1);
  assert.deepEqual(prLookups, [191]);
  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "done");
  assert.equal(state.issues["367"]?.state, "waiting_ci");
  assert.equal(state.issues["367"]?.pr_number, 192);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "merged_pr_convergence: tracked PR #191 merged; marked issue #366 done",
    "tracked_pr_reconciliation_bounded: deferred 1 tracked PR backlog record(s) after issue #366; resume after this cursor next cycle",
  ]);
});

test("reconcileTrackedMergedButOpenIssues resumes from persisted progress in the next cycle", async () => {
  const firstRecord = createRecord({
    issue_number: 366,
    state: "waiting_ci",
    pr_number: 191,
    blocked_reason: null,
  });
  const secondRecord = createRecord({
    issue_number: 367,
    state: "merging",
    branch: "codex/reopen-issue-367",
    pr_number: 192,
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": firstRecord,
      "367": secondRecord,
    },
  };
  const openPr = createPullRequest({
    number: 191,
    title: "Open implementation 191",
    url: "https://example.test/pr/191",
    state: "OPEN",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "open-head-191",
    mergedAt: null,
  });
  const mergedPr = createPullRequest({
    number: 192,
    title: "Merged implementation 192",
    url: "https://example.test/pr/192",
    state: "MERGED",
    headRefName: "codex/reopen-issue-367",
    headRefOid: "merged-head-192",
    mergedAt: "2026-03-13T00:22:00Z",
  });
  const closedIssue: GitHubIssue = {
    number: 367,
    title: "Merged implementation issue 367",
    body: "",
    createdAt: "2026-03-13T00:01:00Z",
    updatedAt: "2026-03-13T00:23:00Z",
    url: "https://example.test/issues/367",
    state: "CLOSED",
  };

  const prLookups: number[] = [];
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-13T00:25:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const firstCycleEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async (prNumber) => {
        prLookups.push(prNumber);
        if (prNumber === 191) {
          return openPr;
        }
        if (prNumber === 192) {
          return mergedPr;
        }
        throw new Error(`unexpected PR lookup #${prNumber}`);
      },
      getIssue: async (issueNumber) => {
        assert.equal(issueNumber, 367);
        return closedIssue;
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    createConfig(),
    [closedIssue],
    null,
    { maxRecords: 1 },
  );

  assert.deepEqual(firstCycleEvents.map((event) => event.reason), [
    "tracked_pr_head_advanced: resumed issue #366 from waiting_ci to ready_to_merge after tracked PR #191 advanced from abcdef1 to open-head-191",
    "tracked_pr_reconciliation_bounded: deferred 1 tracked PR backlog record(s) after issue #366; resume after this cursor next cycle",
  ]);
  assert.deepEqual(prLookups, [191]);
  assert.equal(saveCalls, 1);
  assert.equal(state.issues["366"]?.state, "ready_to_merge");
  assert.equal(state.issues["366"]?.last_head_sha, "open-head-191");
  assert.equal(state.issues["367"]?.state, "merging");

  const secondCycleEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async (prNumber) => {
        prLookups.push(prNumber);
        if (prNumber === 191) {
          return openPr;
        }
        if (prNumber === 192) {
          return mergedPr;
        }
        throw new Error(`unexpected PR lookup #${prNumber}`);
      },
      getIssue: async (issueNumber) => {
        assert.equal(issueNumber, 367);
        return closedIssue;
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    createConfig(),
    [closedIssue],
    null,
    { maxRecords: 1 },
  );

  assert.deepEqual(prLookups, [191, 192]);
  assert.equal(saveCalls, 2);
  assert.equal(state.issues["367"]?.state, "done");
  assert.equal(state.issues["367"]?.last_head_sha, "merged-head-192");
  assert.deepEqual(secondCycleEvents.map((event) => event.reason), [
    "merged_pr_convergence: tracked PR #192 merged; marked issue #367 done",
    "tracked_pr_reconciliation_bounded: deferred 1 tracked PR backlog record(s) after issue #367; resume after this cursor next cycle",
  ]);
});

test("reconcileTrackedMergedButOpenIssues resumes from the next higher issue when the persisted cursor record disappeared", async () => {
  const earlierRecord = createRecord({
    issue_number: 365,
    state: "waiting_ci",
    pr_number: 191,
    blocked_reason: null,
  });
  const laterRecord = createRecord({
    issue_number: 367,
    state: "merging",
    branch: "codex/reopen-issue-367",
    pr_number: 192,
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "365": earlierRecord,
      "367": laterRecord,
    },
    reconciliation_state: {
      tracked_merged_but_open_last_processed_issue_number: 366,
    },
  };
  const openPr = createPullRequest({
    number: 191,
    title: "Open implementation 191",
    url: "https://example.test/pr/191",
    state: "OPEN",
    headRefName: "codex/reopen-issue-365",
    headRefOid: "open-head-191",
    mergedAt: null,
  });
  const mergedPr = createPullRequest({
    number: 192,
    title: "Merged implementation 192",
    url: "https://example.test/pr/192",
    state: "MERGED",
    headRefName: "codex/reopen-issue-367",
    headRefOid: "merged-head-192",
    mergedAt: "2026-03-13T00:22:00Z",
  });
  const closedIssue: GitHubIssue = {
    number: 367,
    title: "Merged implementation issue 367",
    body: "",
    createdAt: "2026-03-13T00:01:00Z",
    updatedAt: "2026-03-13T00:23:00Z",
    url: "https://example.test/issues/367",
    state: "CLOSED",
  };

  const prLookups: number[] = [];
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-13T00:25:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async (prNumber) => {
        prLookups.push(prNumber);
        if (prNumber === 191) {
          return openPr;
        }
        if (prNumber === 192) {
          return mergedPr;
        }
        throw new Error(`unexpected PR lookup #${prNumber}`);
      },
      getIssue: async (issueNumber) => {
        assert.equal(issueNumber, 367);
        return closedIssue;
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    createConfig(),
    [closedIssue],
    null,
    { maxRecords: 1 },
  );

  assert.deepEqual(prLookups, [192]);
  assert.equal(saveCalls, 1);
  assert.equal(state.issues["365"]?.state, "waiting_ci");
  assert.equal(state.issues["367"]?.state, "done");
  assert.equal(state.reconciliation_state?.tracked_merged_but_open_last_processed_issue_number, 367);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "merged_pr_convergence: tracked PR #192 merged; marked issue #367 done",
    "tracked_pr_reconciliation_bounded: deferred 1 tracked PR backlog record(s) after issue #367; resume after this cursor next cycle",
  ]);
});

test("reconcileTrackedMergedButOpenIssues prioritizes recoverable tracked PR records ahead of historical done records", async () => {
  const recoverableRecord = createRecord({
    issue_number: 450,
    state: "merging",
    branch: "codex/reopen-issue-450",
    pr_number: 901,
    blocked_reason: null,
  });
  const historicalDoneRecords = Array.from({ length: 30 }, (_, index) =>
    createRecord({
      issue_number: 300 + index,
      state: "done",
      branch: `codex/historical-done-${300 + index}`,
      pr_number: 800 + index,
      blocked_reason: null,
    }));
  const state: SupervisorStateFile = createSupervisorState({
    issues: [...historicalDoneRecords, recoverableRecord],
  });
  const closedIssue = createIssue({
    number: 450,
    title: "Recoverable merging issue",
    updatedAt: "2026-03-13T00:23:00Z",
    state: "CLOSED",
  });
  const mergedPr = createPullRequest({
    number: 901,
    title: "Recoverable tracked PR",
    url: "https://example.test/pr/901",
    state: "MERGED",
    headRefName: "codex/reopen-issue-450",
    headRefOid: "merged-head-901",
    mergedAt: "2026-03-13T00:22:00Z",
  });

  const prLookups: number[] = [];
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-13T00:25:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async (prNumber) => {
        prLookups.push(prNumber);
        if (prNumber === 901) {
          return mergedPr;
        }
        return null;
      },
      getIssue: async (issueNumber) => {
        assert.equal(issueNumber, 450);
        return closedIssue;
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    createConfig(),
    [closedIssue],
    null,
  );

  assert.equal(prLookups[0], 901);
  assert.equal(prLookups.includes(901), true);
  assert.equal(saveCalls, 1);
  assert.equal(state.issues["450"]?.state, "done");
  assert.equal(state.issues["450"]?.last_head_sha, "merged-head-901");
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "merged_pr_convergence: tracked PR #901 merged; marked issue #450 done",
  ]);
});

test("reconcileTrackedMergedButOpenIssues keeps merged convergence done when audit persistence fails", async () => {
  const artifactRootFile = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "reconcile-audit-failure-")),
    "artifacts-file",
  );
  await fs.writeFile(artifactRootFile, "not-a-directory\n", "utf8");

  const record = createRecord({
    issue_number: 366,
    state: "merging",
    pr_number: 191,
    blocked_reason: null,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": record,
    },
  };
  const mergedPr: GitHubPullRequest = {
    number: 191,
    title: "Merged implementation",
    url: "https://example.test/pr/191",
    state: "MERGED",
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:20:00Z",
    isDraft: false,
    headRefName: "codex/reopen-issue-366",
    headRefOid: "merged-head-191",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    mergedAt: "2026-03-13T00:20:00Z",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };
  const closedIssue: GitHubIssue = {
    number: 366,
    title: "Merged implementation issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:21:00Z",
    url: "https://example.test/issues/366",
    state: "CLOSED",
  };

  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-13T00:25:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
      {
        getPullRequestIfExists: async () => mergedPr,
        getIssue: async () => closedIssue,
        closeIssue: async () => {
          throw new Error("unexpected closeIssue call");
        },
        closePullRequest: async () => {
          throw new Error("unexpected closePullRequest call");
        },
        getChecks: async () => [],
        getMergedPullRequestsClosingIssue: async () => [],
        getUnresolvedReviewThreads: async () => [],
      },
      stateStore,
      state,
      createConfig({
        localReviewArtifactDir: artifactRootFile,
      }),
      [closedIssue],
    );

    assert.equal(saveCalls, 1);
    assert.equal(state.activeIssueNumber, null);
    assert.equal(state.issues["366"]?.state, "done");
    assert.equal(state.issues["366"]?.pr_number, 191);
    assert.equal(state.issues["366"]?.last_head_sha, "merged-head-191");
    assert.deepEqual(recoveryEvents.map((event) => event.reason), [
      "merged_pr_convergence: tracked PR #191 merged; marked issue #366 done",
    ]);
    assert.equal(warnings.length, 1);
    assert.match(
      String(warnings[0]?.[0] ?? ""),
      /Failed to write post-merge audit artifact for issue #366\./,
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("reconcileTrackedMergedButOpenIssues does not rewrite recovery metadata when the done state is already current", async () => {
  const original = createRecord({
    issue_number: 366,
    state: "done",
    pr_number: 191,
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
    last_head_sha: "merged-head-191",
    local_review_blocker_summary: null,
    local_review_recommendation: null,
    local_review_degraded: false,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    last_recovery_reason: "existing recovery reason",
    last_recovery_at: "2026-03-13T00:30:00Z",
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": original,
    },
  };
  const mergedPr: GitHubPullRequest = {
    number: 191,
    title: "Merged implementation",
    url: "https://example.test/pr/191",
    state: "MERGED",
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:20:00Z",
    isDraft: false,
    headRefName: "codex/reopen-issue-366",
    headRefOid: "merged-head-191",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    mergedAt: "2026-03-13T00:20:00Z",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };
  const closedIssue: GitHubIssue = {
    number: 366,
    title: "Merged implementation issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:21:00Z",
    url: "https://example.test/issues/366",
    state: "CLOSED",
  };

  let touchCalls = 0;
  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      touchCalls += 1;
      return {
        ...current,
        ...patch,
        updated_at: "2026-03-13T00:35:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileTrackedMergedButOpenIssues(
    {
      getPullRequestIfExists: async () => mergedPr,
      getIssue: async () => closedIssue,
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getChecks: async () => [],
      getMergedPullRequestsClosingIssue: async () => [],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    createConfig(),
    [closedIssue],
  );

  assert.equal(touchCalls, 0);
  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.deepEqual(state.issues["366"], original);
});
