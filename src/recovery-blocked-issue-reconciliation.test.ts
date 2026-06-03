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

test("reconcileRecoverableBlockedIssueStates requeues open no-PR handoff-missing issues without dropping repeat tracking", async () => {
  const config = createConfig();
  const original = createRecord();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issues: GitHubIssue[] = [
    {
      number: 366,
      title: "P3: Add regression coverage",
      body: "",
      createdAt: "2026-03-10T23:25:21Z",
      updatedAt: "2026-03-10T23:25:21Z",
      url: "https://example.test/issues/366",
      state: "OPEN",
    },
  ];

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-11T06:33:08.821Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  await reconcileRecoverableBlockedIssueStates({
    getPullRequestIfExists: async () => {
      throw new Error("unexpected getPullRequestIfExists call");
    },
    getIssue: async () => {
      throw new Error("unexpected getIssue call");
    },
    getChecks: async () => {
      throw new Error("unexpected getChecks call");
    },
    getUnresolvedReviewThreads: async () => {
      throw new Error("unexpected getUnresolvedReviewThreads call");
    },
  }, stateStore, state, config, issues, {
    shouldAutoRetryHandoffMissing,
  });

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.last_failure_signature, "handoff-missing");
  assert.equal(
    updated.last_failure_context?.summary ?? null,
    "Codex completed without updating the issue journal for issue #366.",
  );
  assert.equal(updated.repeated_failure_signature_count, 1);
  assert.equal(saveCalls, 1);
});

test("reconcileRecoverableBlockedIssueStates leaves closed issues blocked", async () => {
  const config = createConfig();
  const original = createRecord();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": original,
    },
  };
  const issues: GitHubIssue[] = [
    {
      number: 366,
      title: "P3: Add regression coverage",
      body: "",
      createdAt: "2026-03-10T23:25:21Z",
      updatedAt: "2026-03-10T23:25:21Z",
      url: "https://example.test/issues/366",
      state: "CLOSED",
    },
  ];

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord): IssueRunRecord {
      return record;
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  await reconcileRecoverableBlockedIssueStates({
    getPullRequestIfExists: async () => {
      throw new Error("unexpected getPullRequestIfExists call");
    },
    getIssue: async () => {
      throw new Error("unexpected getIssue call");
    },
    getChecks: async () => {
      throw new Error("unexpected getChecks call");
    },
    getUnresolvedReviewThreads: async () => {
      throw new Error("unexpected getUnresolvedReviewThreads call");
    },
  }, stateStore, state, config, issues, {
    shouldAutoRetryHandoffMissing,
  });

  assert.deepEqual(state.issues["366"], original);
  assert.equal(saveCalls, 0);
});

test("reconcileRecoverableBlockedIssueStates requeues requirements-blocked issues once metadata is execution-ready even with a rehydrated journal", async (t) => {
  const config = createConfig();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "requirements-rehydrated-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const workspacePath = path.join(tempDir, "workspaces", "issue-366");
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", "366", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #366: P3: Add regression coverage

## Codex Working Notes
### Current Handoff
- Current blocker:
- Next exact step: Continue after requirements recovery.

### Scratchpad
- Journal rehydration note: this journal was rehydrated on this host because the prior local-only handoff journal was unavailable.
`,
    "utf8",
  );
  const original = createRecord({
    state: "blocked",
    blocked_reason: "requirements",
    workspace: workspacePath,
    journal_path: journalPath,
    last_error: "Missing required execution-ready metadata: scope, acceptance criteria, verification.",
    last_failure_kind: null,
    last_failure_context: {
      category: "blocked",
      summary: "Issue #366 is not execution-ready because it is missing: scope, acceptance criteria, verification.",
      signature: "requirements:scope|acceptance criteria|verification",
      command: null,
      details: [
        "missing_required=scope, acceptance criteria, verification",
        "missing_recommended=depends on, execution order",
      ],
      url: "https://example.test/issues/366",
      updated_at: "2026-03-11T01:50:41.997Z",
    },
    last_failure_signature: "requirements:scope|acceptance criteria|verification",
    repeated_failure_signature_count: 2,
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": original,
    },
  };
  const issues: GitHubIssue[] = [
    {
      number: 366,
      title: "P3: Add regression coverage",
      body: executionReadyBody("Add regression coverage."),
      createdAt: "2026-03-10T23:25:21Z",
      updatedAt: "2026-03-10T23:25:21Z",
      url: "https://example.test/issues/366",
      labels: [],
      state: "OPEN",
    },
  ];

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-11T06:33:08.821Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates({
    getPullRequestIfExists: async () => {
      throw new Error("unexpected getPullRequestIfExists call");
    },
    getIssue: async () => {
      throw new Error("unexpected getIssue call");
    },
    getChecks: async () => {
      throw new Error("unexpected getChecks call");
    },
    getUnresolvedReviewThreads: async () => {
      throw new Error("unexpected getUnresolvedReviewThreads call");
    },
  }, stateStore, state, config, issues, {
    shouldAutoRetryHandoffMissing,
  });

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.last_recovery_reason, "requirements_recovered: requeued issue #366 after execution-ready metadata was added");
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "requirements_recovered: requeued issue #366 after execution-ready metadata was added",
  ]);
});

test("reconcileRecoverableBlockedIssueStates clears the machine-managed requirements blocker comment once metadata is execution-ready", async () => {
  const config = createConfig();
  const original = createRecord({
    state: "blocked",
    blocked_reason: "requirements",
    last_error: "Missing required execution-ready metadata: scope, acceptance criteria, verification.",
    last_failure_kind: null,
    last_failure_context: {
      category: "blocked",
      summary: "Issue #366 is not execution-ready because it is missing: scope, acceptance criteria, verification.",
      signature: "requirements:scope|acceptance criteria|verification",
      command: null,
      details: [
        "missing_required=scope, acceptance criteria, verification",
        "missing_recommended=depends on, execution order",
      ],
      url: "https://example.test/issues/366",
      updated_at: "2026-03-11T01:50:41.997Z",
    },
    last_failure_signature: "requirements:scope|acceptance criteria|verification",
    repeated_failure_signature_count: 2,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issues: GitHubIssue[] = [
    createIssue({
      number: 366,
      title: "P3: Add regression coverage",
      body: executionReadyBody("Add regression coverage."),
      updatedAt: "2026-03-11T06:40:00Z",
      labels: [{ name: "codex" }],
    }),
  ];

  const updatedComments: Array<{ commentId: number; body: string }> = [];
  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-11T06:33:08.821Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  await reconcileRecoverableBlockedIssueStates({
    getPullRequestIfExists: async () => {
      throw new Error("unexpected getPullRequestIfExists call");
    },
    getIssue: async () => {
      throw new Error("unexpected getIssue call");
    },
    getChecks: async () => {
      throw new Error("unexpected getChecks call");
    },
    getUnresolvedReviewThreads: async () => {
      throw new Error("unexpected getUnresolvedReviewThreads call");
    },
    getIssueComments: async () => [{
      id: "comment-366",
      databaseId: 3661,
      body:
        "Issue execution is currently blocked on execution-ready metadata.\n\n" +
        "<!-- codex-supervisor:requirements-blocker-comment issue=366 -->",
      createdAt: "2026-03-11T02:00:00Z",
      url: "https://example.test/issues/366#issuecomment-3661",
      author: {
        login: "codex-supervisor",
        typeName: "Bot",
      },
      viewerDidAuthor: true,
    }],
    updateIssueComment: async (commentId: number, body: string) => {
      updatedComments.push({ commentId, body });
    },
  }, stateStore, state, config, issues, {
    shouldAutoRetryHandoffMissing,
  });

  assert.equal(saveCalls, 1);
  assert.equal(updatedComments.length, 1);
  assert.equal(updatedComments[0]?.commentId, 3661);
  assert.match(updatedComments[0]?.body ?? "", /no longer current/i);
  assert.match(updatedComments[0]?.body ?? "", /execution-ready/i);
});

test("reconcileRecoverableBlockedIssueStates resumes conflicted tracked PR handoff-missing issues into conflict repair", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "handoff_missing",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: "Codex started a turn but did not write a durable handoff.",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary: "Codex started a turn but did not write a durable handoff.",
          signature: "handoff-missing",
          command: null,
          details: ["Update the issue journal before the turn exits."],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "handoff-missing",
        repeated_failure_signature_count: 2,
        repair_attempt_count: 2,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "DIRTY",
    mergeable: "CONFLICTING",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "resolving_conflict");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.pr_number, 191);
  assert.equal(updated.last_head_sha, "head-191");
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to resolving_conflict using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to resolving_conflict using fresh tracked PR #191 facts at head head-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates resumes handoff-missing queued ready-promotion path hygiene repairs", async () => {
  const failureContext = {
    category: "blocked" as const,
    summary:
      "Ready-promotion path hygiene found actionable publishable tracked content; supervisor will retry a repair turn before marking the draft PR ready. Actionable files: backend/app/features/auth/bridge.py.",
    signature: "workstation-local-path-hygiene-failed",
    command: "npm run verify:paths",
    details: ["First fix: backend/app/features/auth/bridge.py (2 matches, Linux user home directory)."],
    url: null,
    updated_at: "2026-04-26T23:00:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 315,
        state: "blocked",
        blocked_reason: "handoff_missing",
        branch: "codex/issue-315",
        pr_number: 321,
        last_head_sha: "head-ready",
        last_error: "Codex completed without updating the issue journal for issue #315.",
        last_failure_context: {
          category: "blocked",
          summary: "Codex completed without updating the issue journal for issue #315.",
          signature: "handoff-missing",
          command: null,
          details: ["Update the Codex Working Notes section before ending the turn."],
          url: null,
          updated_at: "2026-04-26T23:01:00Z",
        },
        last_failure_signature: "handoff-missing",
        repeated_failure_signature_count: 4,
        last_observed_host_local_pr_blocker_signature: failureContext.signature,
        last_observed_host_local_pr_blocker_head_sha: "head-ready",
        timeline_artifacts: [
          {
            type: "path_hygiene_result",
            gate: "workstation_local_path_hygiene",
            command: "npm run verify:paths",
            head_sha: "head-ready",
            outcome: "repair_queued",
            remediation_target: "repair_already_queued",
            next_action: "wait_for_repair_turn",
            summary: failureContext.summary,
            recorded_at: "2026-04-26T23:00:00Z",
            repair_targets: ["backend/app/features/auth/bridge.py"],
          },
        ],
      }),
    ],
  });
  const issue = createIssue({
    number: 315,
    title: "Ready promotion repair",
    updatedAt: "2026-04-26T23:01:00Z",
  });
  const pr = createPullRequest({
    number: 321,
    state: "OPEN",
    isDraft: true,
    headRefName: "codex/issue-315",
    headRefOid: "head-ready",
    mergeStateStatus: "CLEAN",
  });
  let saveCalls = 0;

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-04-26T23:02:00Z",
        };
      },
      async save(): Promise<void> {
        saveCalls += 1;
      },
    },
    state,
    createConfig(),
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["315"];
  assert.equal(updated?.state, "repairing_ci");
  assert.equal(updated?.blocked_reason, null);
  assert.equal(updated?.last_failure_context?.summary, failureContext.summary);
  assert.equal(updated?.last_failure_context?.command, "npm run verify:paths");
  assert.deepEqual(updated?.last_failure_context?.details, [
    "Actionable file: backend/app/features/auth/bridge.py",
  ]);
  assert.equal(updated?.last_failure_signature, failureContext.signature);
  assert.equal(updated?.repeated_failure_signature_count, 1);
  assert.equal(updated?.last_error, failureContext.summary);
  assert.equal(saveCalls, 1);
  assert.match(recoveryEvents[0]?.reason ?? "", /tracked_pr_lifecycle_recovered/);
});

test("reconcileRecoverableBlockedIssueStates clears stale tracked-PR review state when a conflicted handoff-missing PR advances heads", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "handoff_missing",
        local_review_blocker_summary: "stale local review blocker",
        local_review_run_at: "2026-03-13T00:20:00Z",
        local_review_verified_max_severity: "low",
        local_review_verified_findings_count: 1,
        pre_merge_manual_review_count: 1,
        repeated_local_review_signature_count: 3,
        processed_review_thread_ids: ["thread-1", `thread-1@${TRACKED_PR_OLD_HEAD}`],
        processed_review_thread_fingerprints: [`thread-1@${TRACKED_PR_OLD_HEAD}#comment-1`],
        last_error: "Codex started a turn but did not write a durable handoff.",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary: "Codex started a turn but did not write a durable handoff.",
          signature: "handoff-missing",
          command: null,
          details: ["Update the issue journal before the turn exits."],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "handoff-missing",
        repeated_failure_signature_count: 2,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createTrackedPrRecoveryIssue({
    title: "Recovery issue",
  });
  const pr = createTrackedPrRecoveryPullRequest({
    title: "Recovery implementation",
    headRefOid: TRACKED_PR_NEW_HEAD,
    mergeStateStatus: "DIRTY",
    mergeable: "CONFLICTING",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "resolving_conflict");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.repair_attempt_count, 0);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.pr_number, 191);
  assert.equal(updated.last_head_sha, "head-new-191");
  assert.equal(updated.local_review_head_sha, null);
  assert.equal(updated.local_review_blocker_summary, null);
  assert.equal(updated.local_review_summary_path, null);
  assert.equal(updated.local_review_run_at, null);
  assert.equal(updated.local_review_max_severity, null);
  assert.equal(updated.local_review_findings_count, 0);
  assert.equal(updated.local_review_root_cause_count, 0);
  assert.equal(updated.local_review_verified_max_severity, null);
  assert.equal(updated.local_review_verified_findings_count, 0);
  assert.equal(updated.local_review_recommendation, null);
  assert.equal(updated.pre_merge_evaluation_outcome, null);
  assert.equal(updated.pre_merge_must_fix_count, 0);
  assert.equal(updated.pre_merge_manual_review_count, 0);
  assert.equal(updated.pre_merge_follow_up_count, 0);
  assert.equal(updated.last_local_review_signature, null);
  assert.equal(updated.repeated_local_review_signature_count, 0);
  assert.equal(updated.latest_local_ci_result, null);
  assert.equal(updated.external_review_head_sha, null);
  assert.equal(updated.external_review_misses_path, null);
  assert.equal(updated.external_review_matched_findings_count, 0);
  assert.equal(updated.external_review_near_match_findings_count, 0);
  assert.equal(updated.external_review_missed_findings_count, 0);
  assert.equal(updated.review_follow_up_head_sha, null);
  assert.equal(updated.review_follow_up_remaining, 0);
  assert.equal(updated.last_host_local_pr_blocker_comment_signature, null);
  assert.equal(updated.last_host_local_pr_blocker_comment_head_sha, null);
  assert.deepEqual(updated.processed_review_thread_ids, []);
  assert.deepEqual(updated.processed_review_thread_fingerprints, []);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_head_advanced: resumed issue #366 from blocked to resolving_conflict after tracked PR #191 advanced from head-old-191 to head-new-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_head_advanced: resumed issue #366 from blocked to resolving_conflict after tracked PR #191 advanced from head-old-191 to head-new-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates recovers tracked handoff-missing after head advance with green current-head checks", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "handoff_missing",
        last_error: "Codex started a turn but did not write a durable handoff.",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary: "Codex started a turn but did not write a durable handoff.",
          signature: "handoff-missing",
          command: null,
          details: ["Update the issue journal before the turn exits."],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "handoff-missing",
        repeated_failure_signature_count: 2,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createTrackedPrRecoveryIssue({
    title: "Recovery issue",
  });
  const pr = createTrackedPrRecoveryPullRequest({
    title: "Recovery implementation",
    headRefOid: TRACKED_PR_NEW_HEAD,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  let saveCalls = 0;

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    {
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
    },
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "ready_to_merge");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.last_head_sha, TRACKED_PR_NEW_HEAD);
  assert.equal(updated.local_review_head_sha, null);
  assert.deepEqual(updated.processed_review_thread_ids, []);
  assert.match(
    updated.last_recovery_reason ?? "",
    /^tracked_pr_handoff_missing_external_progress: resumed issue #366 from blocked to ready_to_merge after tracked PR #191 advanced from head-old-191 to head-new-191 with evidence=required_checks_green:build$/,
  );
  assert.equal(updated.last_tracked_pr_progress_summary, "handoff_missing_recovered=evidence=required_checks_green:build");
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [updated.last_recovery_reason]);
});

test("reconcileRecoverableBlockedIssueStates keeps tracked handoff-missing blocked without head-advance external evidence", async () => {
  const config = createConfig();
  const original = createTrackedPrStaleReviewRecord({
    state: "blocked",
    blocked_reason: "handoff_missing",
    last_error: "Codex started a turn but did not write a durable handoff.",
    last_failure_context: {
      category: "blocked",
      summary: "Codex started a turn but did not write a durable handoff.",
      signature: "handoff-missing",
      command: null,
      details: ["Update the issue journal before the turn exits."],
      url: null,
      updated_at: "2026-03-13T00:20:00Z",
    },
    last_failure_signature: "handoff-missing",
    repeated_failure_signature_count: 2,
    codex_session_id: "session-366",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issue = createTrackedPrRecoveryIssue();
  const pr = createTrackedPrRecoveryPullRequest({
    headRefOid: TRACKED_PR_NEW_HEAD,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  let saveCalls = 0;
  const addBodies: string[] = [];

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      addIssueComment: async (_issueNumber: number, body: string) => {
        addBodies.push(body);
      },
    },
    {
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
    },
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  assert.deepEqual(addBodies, []);
  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.deepEqual(state.issues["366"], original);
});

test("reconcileRecoverableBlockedIssueStates recovers same-head tracked handoff-missing when Codex current-head review request is due", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-19T09:14:00Z");
  try {
    const currentHead = "329b8e81ed535a61a2bc59ac3227ad52a58b0756";
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    });
    const original = createTrackedPrStaleReviewRecord({
      state: "blocked",
      blocked_reason: "handoff_missing",
      last_head_sha: currentHead,
      review_wait_started_at: "2026-05-19T09:03:41Z",
      review_wait_head_sha: currentHead,
      copilot_review_timed_out_at: null,
      copilot_review_timeout_action: null,
      copilot_review_timeout_reason: null,
      codex_connector_review_requested_observed_at: null,
      codex_connector_review_requested_head_sha: null,
      last_error: "Codex started a turn but did not write a durable handoff.",
      last_failure_context: {
        category: "blocked",
        summary: "Codex started a turn but did not write a durable handoff.",
        signature: "handoff-missing",
        command: null,
        details: ["Update the issue journal before the turn exits."],
        url: null,
        updated_at: "2026-05-19T09:10:00Z",
      },
      last_failure_signature: "handoff-missing",
      repeated_failure_signature_count: 1,
      codex_session_id: "session-366",
    });
    const state: SupervisorStateFile = createSupervisorState({
      issues: [original],
    });
    const issue = createTrackedPrRecoveryIssue({
      updatedAt: "2026-05-19T09:11:00Z",
    });
    const pr = createTrackedPrRecoveryPullRequest({
      headRefOid: currentHead,
      mergeStateStatus: "BLOCKED",
      mergeable: "MERGEABLE",
      currentHeadCiGreenAt: "2026-05-19T09:03:41Z",
      configuredBotCurrentHeadObservedAt: null,
      configuredBotLatestReviewedCommitSha: "98da2474c530b76dae67b5a6f43e0671b989f65a",
      codexConnectorReviewRequestedAt: null,
      codexConnectorReviewRequestedHeadSha: null,
    });
    let saveCalls = 0;

    const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
      {
        getPullRequestIfExists: async () => pr,
        getIssue: async () => {
          throw new Error("unexpected getIssue call");
        },
        getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        getUnresolvedReviewThreads: async () => [],
      },
      {
        touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
          return {
            ...current,
            ...patch,
            updated_at: "2026-05-19T09:14:00Z",
          };
        },
        async save(): Promise<void> {
          saveCalls += 1;
        },
      },
      state,
      config,
      [issue],
      {
        shouldAutoRetryHandoffMissing,
        inferStateFromPullRequest,
        inferFailureContext,
        blockedReasonForLifecycleState,
        isOpenPullRequest,
        syncReviewWaitWindow,
        syncCopilotReviewRequestObservation,
        syncCopilotReviewTimeoutState,
      },
    );

    const updated = state.issues["366"];
    assert.equal(updated.state, "waiting_ci");
    assert.equal(updated.blocked_reason, null);
    assert.equal(updated.last_error, null);
    assert.equal(updated.last_failure_context, null);
    assert.equal(updated.last_failure_signature, null);
    assert.equal(updated.repeated_failure_signature_count, 0);
    assert.equal(updated.codex_session_id, null);
    assert.equal(updated.pr_number, TRACKED_PR_NUMBER);
    assert.equal(updated.last_head_sha, currentHead);
    assert.equal(updated.copilot_review_timeout_action, "request_review_comment");
    assert.equal(updated.copilot_review_timeout_reason?.includes("current-head"), true);
    assert.equal(updated.last_tracked_pr_progress_summary, "handoff_missing_recovered=same_head_projected_state=waiting_ci");
    assert.equal(saveCalls, 1);
    assert.deepEqual(recoveryEvents.map((event) => event.reason), [
      `tracked_pr_handoff_missing_same_head_recovered: resumed issue #366 from blocked to waiting_ci using fresh tracked PR #${TRACKED_PR_NUMBER} facts at head ${currentHead}`,
    ]);
  } finally {
    Date.now = originalDateNow;
  }
});

test("reconcileRecoverableBlockedIssueStates recovers same-head handoff-missing with outdated Codex Connector residue", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-19T09:14:00Z");
  try {
    const currentHead = "329b8e81ed535a61a2bc59ac3227ad52a58b0756";
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    });
    const original = createTrackedPrStaleReviewRecord({
      state: "blocked",
      blocked_reason: "handoff_missing",
      last_head_sha: currentHead,
      review_wait_started_at: "2026-05-19T09:03:41Z",
      review_wait_head_sha: currentHead,
      copilot_review_timed_out_at: null,
      copilot_review_timeout_action: null,
      copilot_review_timeout_reason: null,
      codex_connector_review_requested_observed_at: null,
      codex_connector_review_requested_head_sha: null,
      last_failure_signature: "handoff-missing",
      repeated_failure_signature_count: 1,
      codex_session_id: "session-366",
    });
    const state: SupervisorStateFile = createSupervisorState({
      issues: [original],
    });
    const issue = createTrackedPrRecoveryIssue({
      updatedAt: "2026-05-19T09:11:00Z",
    });
    const pr = createTrackedPrRecoveryPullRequest({
      headRefOid: currentHead,
      mergeStateStatus: "BLOCKED",
      mergeable: "MERGEABLE",
      currentHeadCiGreenAt: "2026-05-19T09:03:41Z",
      configuredBotCurrentHeadObservedAt: null,
      configuredBotLatestReviewedCommitSha: "98da2474c530b76dae67b5a6f43e0671b989f65a",
      codexConnectorReviewRequestedAt: null,
      codexConnectorReviewRequestedHeadSha: null,
    });
    let saveCalls = 0;

    const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
      {
        getPullRequestIfExists: async () => pr,
        getIssue: async () => {
          throw new Error("unexpected getIssue call");
        },
        getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
        getUnresolvedReviewThreads: async () => [
          createReviewThread({
            id: "thread-outdated-codex-1",
            isOutdated: true,
            comments: {
              nodes: [
                {
                  id: "comment-outdated-codex-1",
                  body: "P2: This stale current-head finding was already addressed.",
                  createdAt: "2026-05-19T09:00:00Z",
                  url: "https://example.test/pr/191#discussion_r1",
                  author: {
                    login: "chatgpt-codex-connector",
                    typeName: "Bot",
                  },
                },
              ],
            },
          }),
        ],
      },
      {
        touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
          return {
            ...current,
            ...patch,
            updated_at: "2026-05-19T09:14:00Z",
          };
        },
        async save(): Promise<void> {
          saveCalls += 1;
        },
      },
      state,
      config,
      [issue],
      {
        shouldAutoRetryHandoffMissing,
        inferStateFromPullRequest,
        inferFailureContext,
        blockedReasonForLifecycleState,
        isOpenPullRequest,
        syncReviewWaitWindow,
        syncCopilotReviewRequestObservation,
        syncCopilotReviewTimeoutState,
      },
    );

    const updated = state.issues["366"];
    assert.equal(updated.state, "waiting_ci");
    assert.equal(updated.blocked_reason, null);
    assert.equal(updated.last_failure_signature, null);
    assert.equal(updated.codex_session_id, null);
    assert.equal(updated.copilot_review_timeout_action, "request_review_comment");
    assert.equal(saveCalls, 1);
    assert.deepEqual(recoveryEvents.map((event) => event.reason), [
      `tracked_pr_handoff_missing_same_head_recovered: resumed issue #366 from blocked to waiting_ci using fresh tracked PR #${TRACKED_PR_NUMBER} facts at head ${currentHead}`,
    ]);
  } finally {
    Date.now = originalDateNow;
  }
});

test("reconcileRecoverableBlockedIssueStates records provider success for same-head handoff-missing with operator-replied Codex residue", async () => {
  const currentHead = "d5a9957506c697dc13f5431bb460cfe95257bcae";
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotSettledWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 1,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const original = createTrackedPrStaleReviewRecord({
    state: "blocked",
    blocked_reason: "handoff_missing",
    last_head_sha: currentHead,
    review_wait_started_at: "2026-05-23T16:04:34.342Z",
    review_wait_head_sha: currentHead,
    copilot_review_timed_out_at: "2026-05-23T16:07:04.342Z",
    copilot_review_timeout_action: "request_review_comment",
    copilot_review_timeout_reason: "current_head_signal_wait_timed_out",
    provider_success_head_sha: null,
    provider_success_observed_at: null,
    last_failure_signature: "handoff-missing",
    repeated_failure_signature_count: 1,
    codex_session_id: "session-366",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issue = createTrackedPrRecoveryIssue({
    updatedAt: "2026-05-25T06:05:00Z",
  });
  const pr = createTrackedPrRecoveryPullRequest({
    headRefOid: currentHead,
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
  const threadIds = ["PRRT_hrcore_183_operator", "PRRT_hrcore_183_bot_1", "PRRT_hrcore_183_bot_2"];
  let saveCalls = 0;

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () =>
        threadIds.map((threadId, index) =>
          createReviewThread({
            id: threadId,
            isOutdated: true,
            line: null,
            comments: {
              nodes: [
                {
                  id: `comment-codex-${threadId}`,
                  body: "P1: Earlier Codex Connector finding that is obsolete after the current-head no-major signal.",
                  createdAt: "2026-05-23T14:16:47Z",
                  url: `https://example.test/pr/183#discussion_r${index + 1}`,
                  author: {
                    login: "chatgpt-codex-connector",
                    typeName: "Bot",
                  },
                },
                ...(index === 0
                  ? [
                      {
                        id: `comment-operator-${threadId}`,
                        body: [
                          `The supervisor reprocessed this configured-bot finding on the current head \`${currentHead}\` and classified it as stale.`,
                          `Audit: issue=#366 pr=#${TRACKED_PR_NUMBER} head=${currentHead} thread=${threadId} reason=verified_no_source_change_auto_resolve.`,
                          "Evidence: location=src/mvp-a-onboarding-traceability.ts:? processed_on_current_head=yes. Source: https://example.test/pr/183#discussion_r1",
                          "Under the configured verified no-source-change auto-resolve opt-in, the supervisor is auto-resolving this thread now.",
                        ].join("\n\n"),
                        createdAt: "2026-05-25T04:16:47Z",
                        url: `https://example.test/pr/183#discussion_r${index + 1}`,
                        author: {
                          login: "TommyKammy",
                          typeName: "User",
                        },
                      },
                    ]
                  : []),
              ],
            },
          }),
        ),
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-05-25T06:06:00Z",
        };
      },
      async save(): Promise<void> {
        saveCalls += 1;
      },
    },
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "pr_open");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.provider_success_head_sha, currentHead);
  assert.ok(updated.provider_success_observed_at);
  assert.equal(updated.last_tracked_pr_progress_summary, "handoff_missing_recovered=same_head_projected_state=pr_open");
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    `tracked_pr_handoff_missing_same_head_recovered: resumed issue #366 from blocked to pr_open using fresh tracked PR #${TRACKED_PR_NUMBER} facts at head ${currentHead}`,
  ]);
});

test("reconcileRecoverableBlockedIssueStates keeps same-head handoff-missing blocked for unacknowledged human Codex residue replies", async () => {
  const currentHead = "d5a9957506c697dc13f5431bb460cfe95257bcae";
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotInitialGraceWaitSeconds: 0,
    configuredBotSettledWaitSeconds: 0,
    configuredBotCurrentHeadSignalTimeoutMinutes: 1,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const original = createTrackedPrStaleReviewRecord({
    state: "blocked",
    blocked_reason: "handoff_missing",
    last_head_sha: currentHead,
    review_wait_started_at: "2026-05-23T16:04:34.342Z",
    review_wait_head_sha: currentHead,
    provider_success_head_sha: null,
    provider_success_observed_at: null,
    last_failure_signature: "handoff-missing",
    repeated_failure_signature_count: 1,
    codex_session_id: "session-366",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issue = createTrackedPrRecoveryIssue({
    updatedAt: "2026-05-25T06:05:00Z",
  });
  const pr = createTrackedPrRecoveryPullRequest({
    headRefOid: currentHead,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    reviewDecision: null,
    currentHeadCiGreenAt: "2026-05-23T16:02:36Z",
    configuredBotCurrentHeadObservedAt: "2026-05-23T14:33:41Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: null,
    configuredBotLatestReviewedCommitSha: "7327afdab32fb9c7ffb741d6158add4616bb3115",
    configuredBotTopLevelReviewStrength: null,
  });
  let saveCalls = 0;

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [
        createReviewThread({
          id: "PRRT_hrcore_183_human_followup",
          isOutdated: true,
          line: null,
          comments: {
            nodes: [
              {
                id: "comment-codex-human-followup",
                body: "P1: Earlier Codex Connector finding.",
                createdAt: "2026-05-23T14:16:47Z",
                url: "https://example.test/pr/183#discussion_r1",
                author: {
                  login: "chatgpt-codex-connector",
                  typeName: "Bot",
                },
              },
              {
                id: "comment-human-followup",
                body: "This still looks actionable; please inspect the audit correlation path before merging.",
                createdAt: "2026-05-25T04:16:47Z",
                url: "https://example.test/pr/183#discussion_r1",
                author: {
                  login: "reviewer-user",
                  typeName: "User",
                },
              },
            ],
          },
        }),
      ],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-05-25T06:06:00Z",
        };
      },
      async save(): Promise<void> {
        saveCalls += 1;
      },
    },
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.deepEqual(state.issues["366"], original);
});

test("reconcileRecoverableBlockedIssueStates does not force same-head outdated residue recovery from unrelated projected states", async () => {
  const currentHead = "329b8e81ed535a61a2bc59ac3227ad52a58b0756";
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const original = createTrackedPrStaleReviewRecord({
    state: "blocked",
    blocked_reason: "handoff_missing",
    last_head_sha: currentHead,
    review_wait_started_at: "2026-05-19T09:03:41Z",
    review_wait_head_sha: currentHead,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    last_failure_signature: "handoff-missing",
    repeated_failure_signature_count: 1,
    codex_session_id: "session-366",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issue = createTrackedPrRecoveryIssue({
    updatedAt: "2026-05-19T09:11:00Z",
  });
  const pr = createTrackedPrRecoveryPullRequest({
    headRefOid: currentHead,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  });
  let saveCalls = 0;

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [
        createReviewThread({
          id: "thread-outdated-codex-1",
          isOutdated: true,
          comments: {
            nodes: [
              {
                id: "comment-outdated-codex-1",
                body: "P2: Stale residue that should not override an unrelated block.",
                createdAt: "2026-05-19T09:00:00Z",
                url: "https://example.test/pr/191#discussion_r5",
                author: {
                  login: "chatgpt-codex-connector",
                  typeName: "Bot",
                },
              },
            ],
          },
        }),
      ],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-05-19T09:14:00Z",
        };
      },
      async save(): Promise<void> {
        saveCalls += 1;
      },
    },
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "blocked",
      inferFailureContext,
      blockedReasonForLifecycleState: () => "verification",
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState: () => ({
        copilot_review_timed_out_at: "2026-05-19T09:13:41.000Z",
        copilot_review_timeout_action: "request_review_comment",
        copilot_review_timeout_reason:
          `Requested chatgpt-codex-connector review never arrived within 10 minute(s) for head ${currentHead}.`,
      }),
    },
  );

  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.deepEqual(state.issues["366"], original);
});

test("reconcileRecoverableBlockedIssueStates keeps same-head handoff-missing blocked for actionable or non-configured residue", async () => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-19T09:14:00Z");
  try {
    const currentHead = "329b8e81ed535a61a2bc59ac3227ad52a58b0756";
    const config = createConfig({
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredBotInitialGraceWaitSeconds: 0,
      configuredBotCurrentHeadSignalTimeoutMinutes: 10,
      configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
    });
    const pr = createTrackedPrRecoveryPullRequest({
      headRefOid: currentHead,
      mergeStateStatus: "BLOCKED",
      mergeable: "MERGEABLE",
      currentHeadCiGreenAt: "2026-05-19T09:03:41Z",
      configuredBotCurrentHeadObservedAt: null,
      configuredBotLatestReviewedCommitSha: "98da2474c530b76dae67b5a6f43e0671b989f65a",
      codexConnectorReviewRequestedAt: null,
      codexConnectorReviewRequestedHeadSha: null,
    });
    const scenarios: Array<{ name: string; thread: ReturnType<typeof createReviewThread> }> = [
      {
        name: "human-authored outdated thread",
        thread: createReviewThread({
          id: "thread-human-outdated",
          isOutdated: true,
          comments: {
            nodes: [
              {
                id: "comment-human-outdated",
                body: "Please keep this blocked for a human reviewer.",
                createdAt: "2026-05-19T09:00:00Z",
                url: "https://example.test/pr/191#discussion_r2",
                author: {
                  login: "reviewer",
                  typeName: "User",
                },
              },
            ],
          },
        }),
      },
      {
        name: "current Codex Connector must-fix thread",
        thread: createReviewThread({
          id: "thread-current-codex",
          isOutdated: false,
          comments: {
            nodes: [
              {
                id: "comment-current-codex",
                body: "P2: Keep this current-head finding blocked.",
                createdAt: "2026-05-19T09:00:00Z",
                url: "https://example.test/pr/191#discussion_r3",
                author: {
                  login: "chatgpt-codex-connector",
                  typeName: "Bot",
                },
              },
            ],
          },
        }),
      },
      {
        name: "non-configured bot outdated thread",
        thread: createReviewThread({
          id: "thread-other-bot-outdated",
          isOutdated: true,
          comments: {
            nodes: [
              {
                id: "comment-other-bot-outdated",
                body: "Please keep this blocked for another reviewer.",
                createdAt: "2026-05-19T09:00:00Z",
                url: "https://example.test/pr/191#discussion_r4",
                author: {
                  login: "other-review-bot",
                  typeName: "Bot",
                },
              },
            ],
          },
        }),
      },
    ];

    for (const scenario of scenarios) {
      const original = createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "handoff_missing",
        last_head_sha: currentHead,
        review_wait_started_at: "2026-05-19T09:03:41Z",
        review_wait_head_sha: currentHead,
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
        codex_connector_review_requested_observed_at: null,
        codex_connector_review_requested_head_sha: null,
        last_failure_signature: "handoff-missing",
        repeated_failure_signature_count: 1,
        codex_session_id: "session-366",
      });
      const state: SupervisorStateFile = createSupervisorState({
        issues: [original],
      });
      let saveCalls = 0;

      const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
        {
          getPullRequestIfExists: async () => pr,
          getIssue: async () => {
            throw new Error("unexpected getIssue call");
          },
          getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
          getUnresolvedReviewThreads: async () => [scenario.thread],
        },
        {
          touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
            return {
              ...current,
              ...patch,
              updated_at: "2026-05-19T09:14:00Z",
            };
          },
          async save(): Promise<void> {
            saveCalls += 1;
          },
        },
        state,
        config,
        [createTrackedPrRecoveryIssue({ updatedAt: "2026-05-19T09:11:00Z" })],
        {
          shouldAutoRetryHandoffMissing,
          inferStateFromPullRequest,
          inferFailureContext,
          blockedReasonForLifecycleState,
          isOpenPullRequest,
          syncReviewWaitWindow,
          syncCopilotReviewRequestObservation,
          syncCopilotReviewTimeoutState,
        },
      );

      assert.equal(saveCalls, 0, scenario.name);
      assert.deepEqual(recoveryEvents, [], scenario.name);
      assert.deepEqual(state.issues["366"], original, scenario.name);
    }
  } finally {
    Date.now = originalDateNow;
  }
});

test("reconcileRecoverableBlockedIssueStates does not recover same-head handoff-missing for generic review timeouts", async () => {
  const currentHead = "329b8e81ed535a61a2bc59ac3227ad52a58b0756";
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const original = createTrackedPrStaleReviewRecord({
    state: "blocked",
    blocked_reason: "handoff_missing",
    last_head_sha: currentHead,
    review_wait_started_at: "2026-05-19T09:03:41Z",
    review_wait_head_sha: currentHead,
    copilot_review_timed_out_at: null,
    copilot_review_timeout_action: null,
    copilot_review_timeout_reason: null,
    last_failure_signature: "handoff-missing",
    repeated_failure_signature_count: 1,
    codex_session_id: "session-366",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issue = createTrackedPrRecoveryIssue({
    updatedAt: "2026-05-19T09:11:00Z",
  });
  const pr = createTrackedPrRecoveryPullRequest({
    headRefOid: currentHead,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  });
  let saveCalls = 0;

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-05-19T09:14:00Z",
        };
      },
      async save(): Promise<void> {
        saveCalls += 1;
      },
    },
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "waiting_ci",
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState: () => ({
        copilot_review_timed_out_at: "2026-05-19T09:13:41.000Z",
        copilot_review_timeout_action: "request_review_comment",
        copilot_review_timeout_reason:
          `Requested chatgpt-codex-connector review never arrived within 10 minute(s) for head ${currentHead}.`,
      }),
    },
  );

  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.deepEqual(state.issues["366"], original);
});

test("reconcileRecoverableBlockedIssueStates reopens configured-bot follow-up when last_head_sha is current but local review state is stale", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    trackedPrCurrentHeadLocalReviewRequired: true,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    humanReviewBlocksMerge: false,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "verification",
        last_head_sha: TRACKED_PR_NEW_HEAD,
        local_review_head_sha: TRACKED_PR_OLD_HEAD,
        local_review_blocker_summary: "stale local review blocker",
        local_review_run_at: "2026-03-13T00:20:00Z",
        local_review_verified_max_severity: "low",
        local_review_verified_findings_count: 1,
        local_review_recommendation: "changes_requested",
        pre_merge_evaluation_outcome: "follow_up_eligible",
        repeated_local_review_signature_count: 3,
        latest_local_ci_result: null,
        external_review_head_sha: null,
        external_review_misses_path: null,
        external_review_matched_findings_count: 0,
        external_review_near_match_findings_count: 0,
        external_review_missed_findings_count: 0,
        review_follow_up_head_sha: TRACKED_PR_OLD_HEAD,
        review_follow_up_remaining: 1,
        processed_review_thread_ids: [`thread-1@${TRACKED_PR_NEW_HEAD}`],
        processed_review_thread_fingerprints: [`thread-1@${TRACKED_PR_NEW_HEAD}#comment-1`],
        last_error: "Configured bot thread was already processed on the current head.",
        last_failure_kind: null,
        last_failure_context: {
          category: "manual",
          summary: "Configured bot thread was already processed on the current head.",
          signature: "stalled-bot:thread-1",
          command: null,
          details: ["processed_on_current_head=yes"],
          url: "https://example.test/pr/191#discussion_r1",
          updated_at: "2026-03-13T00:22:00Z",
        },
        last_failure_signature: "stalled-bot:thread-1",
        repeated_failure_signature_count: 2,
      }),
    ],
  });
  const issue = createTrackedPrRecoveryIssue({
    title: "Tracked PR partial reconciliation",
    updatedAt: "2026-03-13T00:23:00Z",
  });
  const pr = createTrackedPrRecoveryPullRequest({
    title: "Repair push",
    headRefOid: TRACKED_PR_NEW_HEAD,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [createReviewThread()],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      isOpenPullRequest,
      syncCopilotReviewTimeoutState: () => noCopilotReviewTimeoutPatch(),
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "addressing_review");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.last_head_sha, "head-new-191");
  assert.equal(updated.local_review_head_sha, null);
  assert.equal(updated.local_review_summary_path, null);
  assert.equal(updated.pre_merge_evaluation_outcome, null);
  assert.equal(updated.review_follow_up_head_sha, null);
  assert.equal(updated.review_follow_up_remaining, 0);
  assert.deepEqual(updated.processed_review_thread_ids, []);
  assert.deepEqual(updated.processed_review_thread_fingerprints, []);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to addressing_review using fresh tracked PR #191 facts at head head-new-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to addressing_review using fresh tracked PR #191 facts at head head-new-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates requeues stale no-PR manual-review stops after fresh GitHub issue updates", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [createStaleNoPrManualReviewRecord(config)],
  });
  const issue = createIssue({
    number: 366,
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const stateStore = createCountingStateStore("2026-03-13T00:25:00Z");

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    createUnexpectedRecoveryGithub(),
    stateStore.stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "github_issue_reconsidered: requeued issue #366 after GitHub issue updates arrived following a stale no-PR manual stop",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(stateStore.saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "github_issue_reconsidered: requeued issue #366 after GitHub issue updates arrived following a stale no-PR manual stop",
  ]);
});

test("reconcileRecoverableBlockedIssueStates keeps stale no-PR manual-review stops blocked when GitHub issue context is unchanged", async () => {
  const config = createConfig();
  const original = createStaleNoPrManualReviewRecord(config);
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issue = createIssue({
    number: 366,
    updatedAt: "2026-03-13T00:20:00Z",
  });
  const stateStore = createCountingStateStore("2026-03-13T00:25:00Z");

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    createUnexpectedRecoveryGithub(),
    stateStore.stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
    },
  );

  assert.equal(stateStore.saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.deepEqual(state.issues["366"], original);
});

test("reconcileRecoverableBlockedIssueStates requeues additional no-PR blocked verification stops when the issue definition changes materially", async () => {
  const config = createConfig();
  const originalIssue = createIssue({
    number: 366,
    body: executionReadyBody("Add recovery coverage for changed issue definitions."),
    updatedAt: "2026-03-13T00:20:00Z",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "blocked",
        blocked_reason: "verification",
        pr_number: null,
        codex_session_id: null,
        last_error: "Verification failed against a stale issue definition.",
        last_failure_kind: "command_error",
        last_failure_context: {
          category: "review",
          summary: "Verification failed against the stale issue definition.",
          signature: "verify-failed",
          command: "npm test",
          details: ["suite=supervisor", "assertion=stale-acceptance-criteria"],
          url: "https://example.test/issues/366",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "verify-failed",
        repeated_failure_signature_count: 2,
        issue_definition_fingerprint: buildIssueDefinitionFingerprint(originalIssue),
        issue_definition_updated_at: originalIssue.updatedAt,
        last_recovery_reason: "verification_stop: blocked issue #366 after local verification failed",
        last_recovery_at: "2026-03-13T00:20:00Z",
        updated_at: "2026-03-13T00:20:00Z",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    body: originalIssue.body
      .replace(
        "- supervisor treats this issue as runnable",
        "- supervisor requeues stale no-PR blocked verification stops when the issue definition changes materially",
      ),
    updatedAt: "2026-03-13T00:21:00Z",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "github_issue_definition_changed: requeued issue #366 after a material GitHub issue definition change invalidated the stale no-PR blocked state",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "github_issue_definition_changed: requeued issue #366 after a material GitHub issue definition change invalidated the stale no-PR blocked state",
  ]);
});

test("reconcileRecoverableBlockedIssueStates ignores cosmetic-only issue edits for additional no-PR blocked verification stops", async () => {
  const config = createConfig();
  const originalIssue = createIssue({
    number: 366,
    body: executionReadyBody("Add recovery coverage for changed issue definitions."),
    updatedAt: "2026-03-13T00:20:00Z",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "blocked",
        blocked_reason: "verification",
        pr_number: null,
        codex_session_id: null,
        last_error: "Verification failed against a stale issue definition.",
        last_failure_kind: "command_error",
        last_failure_context: {
          category: "review",
          summary: "Verification failed against the stale issue definition.",
          signature: "verify-failed",
          command: "npm test",
          details: ["suite=supervisor", "assertion=stale-acceptance-criteria"],
          url: "https://example.test/issues/366",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "verify-failed",
        repeated_failure_signature_count: 2,
        issue_definition_fingerprint: buildIssueDefinitionFingerprint(originalIssue),
        issue_definition_updated_at: originalIssue.updatedAt,
        updated_at: "2026-03-13T00:20:00Z",
      }),
    ],
  });
  const cosmeticallyEditedIssue = createIssue({
    ...originalIssue,
    body: originalIssue.body
      .replace("## Scope\n- keep the test fixture execution-ready", "## Scope\n\n- keep the test fixture execution-ready   ")
      .replace("## Verification\n- npm test -- src/supervisor.test.ts", "## Verification\n\n-   npm test -- src/supervisor.test.ts"),
    updatedAt: "2026-03-13T00:21:00Z",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
    },
    stateStore,
    state,
    config,
    [cosmeticallyEditedIssue],
    {
      shouldAutoRetryHandoffMissing,
    },
  );

  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.equal(state.issues["366"]?.state, "blocked");
});

test("reconcileRecoverableBlockedIssueStates clears stale same-head review-thread blockers after GitHub reports them resolved", async () => {
  const config = createConfig({
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "blocked",
        blocked_reason: "manual_review",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error:
          "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_kind: null,
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:thread-1",
          command: null,
          details: ["reviewer=copilot-pull-request-reviewer file=src/file.ts line=12 processed_on_current_head=yes"],
          url: "https://example.test/pr/191#discussion_r1",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "stalled-bot:thread-1",
        repeated_failure_signature_count: 2,
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    copilotReviewState: "arrived",
    copilotReviewArrivedAt: "2026-03-13T00:10:00Z",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async (prNumber: number) => {
        assert.equal(prNumber, 191);
        return pr;
      },
      getIssue: async (issueNumber: number) => {
        assert.equal(issueNumber, 366);
        return issue;
      },
      getChecks: async (prNumber: number) => {
        assert.equal(prNumber, 191);
        return [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }];
      },
      getUnresolvedReviewThreads: async (prNumber: number) => {
        assert.equal(prNumber, 191);
        return [];
      },
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "ready_to_merge");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates rehydrates tracked PR manual-review blocks to ready_to_merge on same-head GitHub facts", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "manual_review",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: "Manual review is required before the PR can proceed.",
        last_failure_kind: null,
        last_failure_context: {
          category: "review",
          summary: "Manual review is required before the PR can proceed.",
          signature: "manual-review:thread-1",
          command: null,
          details: ["thread=thread-1"],
          url: "https://example.test/pr/191#discussion_r1",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "manual-review:thread-1",
        repeated_failure_signature_count: 2,
        repeated_blocker_count: 2,
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async (issueNumber) => {
        assert.equal(issueNumber, 366);
        return issue;
      },
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "ready_to_merge");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.repeated_blocker_count, 0);
  assert.equal(updated.pr_number, 191);
  assert.equal(updated.last_head_sha, "head-191");
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates rehydrates unknown tracked PR blocks once GitHub facts are merge-ready", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotRequireCurrentHeadSignal: true,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "unknown",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: "GitHub CLI authentication is unavailable.",
        last_failure_kind: "command_error",
        last_failure_context: {
          category: "manual",
          summary: "GitHub CLI authentication is unavailable.",
          signature: "gh-auth-unavailable",
          command: "gh auth status --hostname github.com",
          details: ["gh auth unavailable"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "gh-auth-unavailable",
        repeated_failure_signature_count: 4,
        last_tracked_pr_repeat_failure_decision: "stop_no_progress",
        last_tracked_pr_progress_snapshot: JSON.stringify({
          headRefOid: "head-191",
          unresolvedReviewThreadIds: ["thread-1", "thread-2"],
          unresolvedReviewThreadFingerprints: ["thread-1#comment-1", "thread-2#comment-2"],
        }),
        last_tracked_pr_progress_summary: "recovery_blocked=stale_review_bot_no_auto_retry",
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    currentHeadCiGreenAt: "2026-03-13T00:22:00Z",
    configuredBotCurrentHeadObservedAt: "2026-03-13T00:23:00Z",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "ready_to_merge");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.pr_number, 191);
  assert.equal(updated.last_head_sha, "head-191");
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  );
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates keeps agent-reported unknown blockers out of automatic PR recovery", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotRequireCurrentHeadSignal: true,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "unknown",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: "Codex reported blocked without a structured reason.",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary: "Codex reported blocked for issue #366.",
          signature: "codex-reported-unknown-blocker",
          command: null,
          details: ["The agent did not provide a structured blockedReason."],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "codex-reported-unknown-blocker",
        repeated_failure_signature_count: 2,
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getIssue: async () => issue,
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "unknown");
  assert.equal(updated.last_failure_signature, "codex-reported-unknown-blocker");
  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
});

test("reconcileRecoverableBlockedIssueStates clears stale manual-review repeat stops when only outdated configured-bot residue remains", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotRequireCurrentHeadSignal: true,
    verifiedNoSourceChangeReviewThreadAutoResolve: true,
  });
  const previousProgressSnapshot = JSON.stringify({
    headRefOid: "head-191",
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "BLOCKED",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadStatusState: null,
    currentHeadCiGreenAt: "2026-05-12T00:18:00Z",
    configuredBotRateLimitedAt: null,
    configuredBotDraftSkipAt: null,
    configuredBotTopLevelReviewStrength: null,
    configuredBotTopLevelReviewSubmittedAt: null,
    checks: ["build:pass:SUCCESS:CI"],
    unresolvedReviewThreadIds: ["PRRT_stale_1", "PRRT_stale_2"],
    unresolvedReviewThreadFingerprints: ["PRRT_stale_1#comment-1", "PRRT_stale_2#comment-2"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "manual_review",
        pr_number: 191,
        last_head_sha: "head-191",
        review_wait_started_at: "2026-05-12T00:19:00Z",
        review_wait_head_sha: "head-191",
        last_error:
          "2 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_kind: null,
        last_failure_context: {
          category: "manual",
          summary:
            "2 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:chatgpt-codex-connector-p2",
          command: null,
          details: [
            "reviewer=chatgpt-codex-connector severity=P2 processed_on_current_head=yes thread=PRRT_stale_1",
            "reviewer=chatgpt-codex-connector severity=P2 processed_on_current_head=yes thread=PRRT_stale_2",
          ],
          url: "https://example.test/pr/191",
          updated_at: "2026-05-12T00:20:00Z",
        },
        last_failure_signature: "stalled-bot:chatgpt-codex-connector-p2",
        repeated_failure_signature_count: 3,
        provider_success_observed_at: null,
        provider_success_head_sha: null,
        processed_review_thread_ids: ["PRRT_stale_1@head-191"],
        processed_review_thread_fingerprints: [
          "PRRT_stale_1@head-191#comment-1",
        ],
        last_tracked_pr_progress_snapshot: previousProgressSnapshot,
        last_tracked_pr_progress_summary: "no_meaningful_tracked_pr_progress",
        last_tracked_pr_repeat_failure_decision: "stop_no_progress",
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-05-12T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    reviewDecision: null,
    currentHeadCiGreenAt: "2026-05-12T00:18:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadObservedAt: "2026-05-12T00:22:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotLatestReviewedCommitSha: "head-191",
    configuredBotTopLevelReviewStrength: null,
    requiredConversationResolution: {
      state: "enabled",
      source: "branch_protection",
      details: ["required_conversation_resolution=true"],
    },
  });

  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-05-12T00:25:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [
        createReviewThread({
          id: "PRRT_stale_1",
          isOutdated: true,
          comments: {
            nodes: [
              {
                id: "comment-1",
                body: "P2 stale finding 1",
                createdAt: "2026-05-12T00:10:00Z",
                url: "https://example.test/pr/191#discussion_r1",
                author: { login: "chatgpt-codex-connector", typeName: "Bot" },
              },
            ],
          },
        }),
        createReviewThread({
          id: "PRRT_stale_2",
          isOutdated: true,
          comments: {
            nodes: [
              {
                id: "comment-2",
                body: "P2 stale finding 2",
                createdAt: "2026-05-12T00:11:00Z",
                url: "https://example.test/pr/191#discussion_r2",
                author: { login: "chatgpt-codex-connector", typeName: "Bot" },
              },
            ],
          },
        }),
      ],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "pr_open");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.provider_success_head_sha, "head-191");
  assert.ok(updated.provider_success_observed_at);
  assert.equal(updated.last_tracked_pr_progress_summary, null);
  assert.equal(updated.last_tracked_pr_progress_snapshot, null);
  assert.equal(updated.last_tracked_pr_repeat_failure_decision, null);
  assert.deepEqual(updated.processed_review_thread_ids, []);
  assert.deepEqual(updated.processed_review_thread_fingerprints, []);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_stale_local_blocker_recovered: resumed issue #366 from blocked to pr_open after stale manual-review metadata was superseded by tracked PR #191 facts at head head-191",
  );
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_stale_local_blocker_recovered: resumed issue #366 from blocked to pr_open after stale manual-review metadata was superseded by tracked PR #191 facts at head head-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates suppresses same-head tracked PR recovery after a repeated no-progress review-thread stop on the same blocker", async () => {
  const config = createConfig();
  const previousProgressSnapshot = JSON.stringify({
    headRefOid: "head-191",
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "BLOCKED",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadStatusState: null,
    currentHeadCiGreenAt: "2026-03-13T00:18:00Z",
    configuredBotRateLimitedAt: null,
    configuredBotDraftSkipAt: null,
    configuredBotTopLevelReviewStrength: null,
    configuredBotTopLevelReviewSubmittedAt: null,
    checks: ["build:pass:SUCCESS:CI"],
    unresolvedReviewThreadIds: ["PRRT_thread_1"],
    unresolvedReviewThreadFingerprints: ["PRRT_thread_1#comment-1"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "manual_review",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error:
          "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_kind: null,
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "PRRT_thread_1",
          command: null,
          details: ["reviewer=coderabbit path=src/file.ts line=12 processed_on_current_head=yes"],
          url: "https://example.test/pr/191#discussion_r1",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "PRRT_thread_1",
        repeated_failure_signature_count: 3,
        last_tracked_pr_progress_snapshot: previousProgressSnapshot,
        last_tracked_pr_progress_summary: "no_meaningful_tracked_pr_progress",
        last_tracked_pr_repeat_failure_decision: "stop_no_progress",
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [
        createReviewThread({
          id: "PRRT_thread_1",
          comments: {
            nodes: [
              {
                id: "comment-1",
                body: "Please address this thread.",
                createdAt: "2026-03-13T00:19:00Z",
                url: "https://example.test/pr/191#discussion_r1",
                author: { login: "coderabbit", typeName: "Bot" },
              },
            ],
          },
        }),
      ],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "local_review",
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(
    updated.last_tracked_pr_progress_summary,
    "suppressed_same_head_same_review_thread_blocker",
  );
  assert.equal(updated.last_tracked_pr_repeat_failure_decision, "stop_no_progress");
  assert.equal(updated.last_recovery_reason, null);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents, []);
});

test("reconcileRecoverableBlockedIssueStates preserves Codex Connector manual-review churn blocks after PR head advance", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const previousProgressSnapshot = JSON.stringify({
    headRefOid: "head-previous-366",
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "BLOCKED",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
    configuredBotCurrentHeadObservedAt: "2026-06-01T06:09:54Z",
    configuredBotCurrentHeadStatusState: null,
    currentHeadCiGreenAt: "2026-06-01T06:08:00Z",
    configuredBotRateLimitedAt: null,
    configuredBotDraftSkipAt: null,
    configuredBotTopLevelReviewStrength: "blocking",
    configuredBotTopLevelReviewSubmittedAt: "2026-06-01T06:09:54Z",
    checks: ["build:pass:SUCCESS:CI"],
    unresolvedReviewThreadIds: ["thread-authority", "thread-truth", "thread-scope", "thread-snapshot"],
    unresolvedReviewThreadFingerprints: [
      "thread-authority#comment-authority",
      "thread-truth#comment-truth",
      "thread-scope#comment-scope",
      "thread-snapshot#comment-snapshot",
    ],
    unresolvedReviewThreadSourceAnchors: [
      "thread-authority:src/release-readiness.ts:120",
      "thread-truth:src/release-readiness.ts:121",
      "thread-scope:src/release-readiness.ts:122",
      "thread-snapshot:src/release-readiness.ts:123",
    ],
    processedReviewThreadIds: [],
    processedReviewThreadFingerprints: [],
    verificationProbeOutcomes: [],
    codexConnectorReviewChurnProgress: {
      currentHeadSha: "head-previous-366",
      currentEffectiveMustFixCount: 4,
      dominantFile: "src/release-readiness.ts",
      dominantFilePercent: 100,
      clusterCategorySignature: "truth_source",
      representativeThreadIds: ["thread-authority", "thread-truth", "thread-scope", "thread-snapshot"],
    },
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "manual_review",
        pr_number: 191,
        last_head_sha: "head-previous-366",
        last_error:
          "Clustered Codex Connector churn made no progress; inspect dominant file src/release-readiness.ts with current effective must-fix count 4 before restarting the loop.",
        last_failure_kind: null,
        last_failure_context: {
          category: "manual",
          summary:
            "Clustered Codex Connector churn made no progress; inspect dominant file src/release-readiness.ts with current effective must-fix count 4 before restarting the loop.",
          signature: "codex-review-churn:P2:src/release-readiness.ts",
          command: null,
          details: [
            "dominant_file=src/release-readiness.ts",
            "current_effective_must_fix=4",
            "representative_threads=thread-authority,thread-truth,thread-scope,thread-snapshot",
          ],
          url: "https://example.test/pr/191",
          updated_at: "2026-06-01T06:10:00Z",
        },
        last_failure_signature: "codex-review-churn:P2:src/release-readiness.ts",
        repeated_failure_signature_count: 3,
        local_review_head_sha: "head-previous-366",
        local_review_blocker_summary: "old head local review blocker",
        local_review_summary_path: "reviews/issue-366/head-previous-366.md",
        review_follow_up_head_sha: "head-previous-366",
        review_follow_up_remaining: 1,
        processed_review_thread_ids: ["thread-authority"],
        processed_review_thread_fingerprints: ["thread-authority#comment-authority"],
        last_tracked_pr_progress_snapshot: previousProgressSnapshot,
        last_tracked_pr_progress_summary: "no_progress_clustered_codex_churn current_effective_must_fix=4",
        last_tracked_pr_repeat_failure_decision: "stop_no_progress",
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-06-01T06:11:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-current-366",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    reviewDecision: "CHANGES_REQUESTED",
    configuredBotTopLevelReviewStrength: "blocking",
    configuredBotTopLevelReviewSubmittedAt: "2026-06-01T06:12:00Z",
  });

  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-06-01T06:13:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [
        createReviewThread({
          id: "thread-authority",
          comments: {
            nodes: [{
              id: "comment-authority",
              body: "P2 authority finding",
              createdAt: "2026-06-01T06:12:00Z",
              url: "https://example.test/pr/191#discussion_authority",
              author: { login: "chatgpt-codex-connector", typeName: "Bot" },
            }],
          },
        }),
        createReviewThread({
          id: "thread-truth",
          comments: {
            nodes: [{
              id: "comment-truth",
              body: "P2 truth-source finding",
              createdAt: "2026-06-01T06:12:01Z",
              url: "https://example.test/pr/191#discussion_truth",
              author: { login: "chatgpt-codex-connector", typeName: "Bot" },
            }],
          },
        }),
        createReviewThread({
          id: "thread-scope",
          comments: {
            nodes: [{
              id: "comment-scope",
              body: "P2 scope finding",
              createdAt: "2026-06-01T06:12:02Z",
              url: "https://example.test/pr/191#discussion_scope",
              author: { login: "chatgpt-codex-connector", typeName: "Bot" },
            }],
          },
        }),
        createReviewThread({
          id: "thread-snapshot",
          comments: {
            nodes: [{
              id: "comment-snapshot",
              body: "P2 snapshot finding",
              createdAt: "2026-06-01T06:12:03Z",
              url: "https://example.test/pr/191#discussion_snapshot",
              author: { login: "chatgpt-codex-connector", typeName: "Bot" },
            }],
          },
        }),
      ],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "addressing_review",
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_head_sha, "head-current-366");
  assert.equal(updated.last_failure_signature, "codex-review-churn:P2:src/release-readiness.ts");
  assert.equal(updated.last_tracked_pr_repeat_failure_decision, "stop_no_progress");
  assert.equal(updated.local_review_head_sha, null);
  assert.equal(updated.local_review_blocker_summary, null);
  assert.equal(updated.local_review_summary_path, null);
  assert.equal(updated.review_follow_up_head_sha, null);
  assert.equal(updated.review_follow_up_remaining, 0);
  assert.deepEqual(updated.processed_review_thread_ids, []);
  assert.deepEqual(updated.processed_review_thread_fingerprints, []);
  assert.equal(
    updated.last_tracked_pr_progress_summary,
    "manual_review_preserved=codex_connector_churn_unresolved_configured_bot_threads",
  );
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_manual_review_preserved: preserved issue #366 manual-review block after tracked PR #191 advanced from head-previous-366 to head-current-366 because unresolved configured-bot review evidence still exists",
  );
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_manual_review_preserved: preserved issue #366 manual-review block after tracked PR #191 advanced from head-previous-366 to head-current-366 because unresolved configured-bot review evidence still exists",
  ]);
});

test("reconcileRecoverableBlockedIssueStates leaves already-preserved same-head Codex Connector churn blocks quiescent", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const progressSnapshot = JSON.stringify({
    headRefOid: "head-current-366",
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "BLOCKED",
    configuredBotCurrentHeadObservedAt: "2026-06-01T06:12:00Z",
    configuredBotCurrentHeadStatusState: null,
    currentHeadCiGreenAt: "2026-06-01T06:08:00Z",
    configuredBotTopLevelReviewStrength: "blocking",
    configuredBotTopLevelReviewSubmittedAt: "2026-06-01T06:12:00Z",
    checks: ["build:pass:SUCCESS:CI"],
    unresolvedReviewThreadIds: ["thread-authority"],
    unresolvedReviewThreadFingerprints: ["thread-authority#comment-authority"],
    codexConnectorReviewChurnProgress: {
      currentHeadSha: "head-current-366",
      currentEffectiveMustFixCount: 1,
      dominantFile: "src/release-readiness.ts",
      dominantFilePercent: 100,
      clusterCategorySignature: "truth_source",
      representativeThreadIds: ["thread-authority"],
    },
  });
  const original = createRecord({
    state: "blocked",
    blocked_reason: "manual_review",
    pr_number: 191,
    last_head_sha: "head-current-366",
    last_error:
      "Clustered Codex Connector churn made no progress; inspect dominant file src/release-readiness.ts with current effective must-fix count 1 before restarting the loop.",
    last_failure_kind: null,
    last_failure_context: {
      category: "manual",
      summary:
        "Clustered Codex Connector churn made no progress; inspect dominant file src/release-readiness.ts with current effective must-fix count 1 before restarting the loop.",
      signature: "codex-review-churn:P2:src/release-readiness.ts",
      command: null,
      details: ["dominant_file=src/release-readiness.ts", "current_effective_must_fix=1"],
      url: "https://example.test/pr/191",
      updated_at: "2026-06-01T06:12:00Z",
    },
    last_failure_signature: "codex-review-churn:P2:src/release-readiness.ts",
    repeated_failure_signature_count: 3,
    last_recovery_reason:
      "tracked_pr_manual_review_preserved: preserved issue #366 manual-review block after tracked PR #191 advanced from head-previous-366 to head-current-366 because unresolved configured-bot review evidence still exists",
    last_recovery_at: "2026-06-01T06:13:00Z",
    last_tracked_pr_progress_snapshot: progressSnapshot,
    last_tracked_pr_progress_summary:
      "manual_review_preserved=codex_connector_churn_unresolved_configured_bot_threads",
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-06-01T06:14:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-current-366",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    reviewDecision: "CHANGES_REQUESTED",
    configuredBotTopLevelReviewStrength: "blocking",
    configuredBotTopLevelReviewSubmittedAt: "2026-06-01T06:12:00Z",
  });

  let saveCalls = 0;
  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [
        createReviewThread({
          id: "thread-authority",
          comments: {
            nodes: [{
              id: "comment-authority",
              body: "P2 authority finding",
              createdAt: "2026-06-01T06:12:00Z",
              url: "https://example.test/pr/191#discussion_authority",
              author: { login: "chatgpt-codex-connector", typeName: "Bot" },
            }],
          },
        }),
      ],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-06-01T06:15:00Z",
        };
      },
      async save(): Promise<void> {
        saveCalls += 1;
      },
    },
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "addressing_review",
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
  assert.deepEqual(state.issues["366"], original);
});

test("reconcileRecoverableBlockedIssueStates ignores outdated Codex Connector residue when preserving churn manual-review blocks", async () => {
  const config = createConfig({
    reviewBotLogins: ["chatgpt-codex-connector"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const previousProgressSnapshot = JSON.stringify({
    headRefOid: "head-previous-366",
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "BLOCKED",
    configuredBotCurrentHeadObservedAt: "2026-06-01T06:09:54Z",
    configuredBotCurrentHeadStatusState: null,
    currentHeadCiGreenAt: "2026-06-01T06:08:00Z",
    configuredBotTopLevelReviewStrength: "blocking",
    configuredBotTopLevelReviewSubmittedAt: "2026-06-01T06:09:54Z",
    checks: ["build:pass:SUCCESS:CI"],
    unresolvedReviewThreadIds: ["thread-stale-codex", "thread-human"],
    unresolvedReviewThreadFingerprints: [
      "thread-stale-codex#comment-stale-codex",
      "thread-human#comment-human",
    ],
    codexConnectorReviewChurnProgress: {
      currentHeadSha: "head-previous-366",
      currentEffectiveMustFixCount: 1,
      dominantFile: "src/release-readiness.ts",
      dominantFilePercent: 100,
      clusterCategorySignature: "truth_source",
      representativeThreadIds: ["thread-stale-codex"],
    },
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "manual_review",
        pr_number: 191,
        last_head_sha: "head-previous-366",
        last_error:
          "Clustered Codex Connector churn made no progress; inspect dominant file src/release-readiness.ts with current effective must-fix count 1 before restarting the loop.",
        last_failure_kind: null,
        last_failure_context: {
          category: "manual",
          summary:
            "Clustered Codex Connector churn made no progress; inspect dominant file src/release-readiness.ts with current effective must-fix count 1 before restarting the loop.",
          signature: "codex-review-churn:P2:src/release-readiness.ts",
          command: null,
          details: ["dominant_file=src/release-readiness.ts", "current_effective_must_fix=1"],
          url: "https://example.test/pr/191",
          updated_at: "2026-06-01T06:10:00Z",
        },
        last_failure_signature: "codex-review-churn:P2:src/release-readiness.ts",
        repeated_failure_signature_count: 3,
        last_tracked_pr_progress_snapshot: previousProgressSnapshot,
        last_tracked_pr_progress_summary: "no_progress_clustered_codex_churn current_effective_must_fix=1",
        last_tracked_pr_repeat_failure_decision: "stop_no_progress",
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-06-01T06:11:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-current-366",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    reviewDecision: null,
  });

  let saveCalls = 0;
  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [
        createReviewThread({
          id: "thread-stale-codex",
          isOutdated: true,
          comments: {
            nodes: [{
              id: "comment-stale-codex",
              body: "P2 stale finding",
              createdAt: "2026-06-01T06:09:00Z",
              url: "https://example.test/pr/191#discussion_stale",
              author: { login: "chatgpt-codex-connector", typeName: "Bot" },
            }],
          },
        }),
        createReviewThread({
          id: "thread-human",
          comments: {
            nodes: [{
              id: "comment-human",
              body: "Leaving this note for context.",
              createdAt: "2026-06-01T06:12:00Z",
              url: "https://example.test/pr/191#discussion_human",
              author: { login: "reviewer", typeName: "User" },
            }],
          },
        }),
      ],
    },
    {
      touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
        return {
          ...current,
          ...patch,
          updated_at: "2026-06-01T06:13:00Z",
        };
      },
      async save(): Promise<void> {
        saveCalls += 1;
      },
    },
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "addressing_review",
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "addressing_review");
  assert.equal(updated.blocked_reason, null);
  assert.notEqual(
    updated.last_tracked_pr_progress_summary,
    "manual_review_preserved=codex_connector_churn_unresolved_configured_bot_threads",
  );
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_head_advanced: resumed issue #366 from blocked to addressing_review after tracked PR #191 advanced from head-previous-366 to head-current-366",
  );
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [updated.last_recovery_reason]);
});

test("reconcileRecoverableBlockedIssueStates keeps stopped stale_review_bot records blocked when no-auto retry saw no same-head progress", async () => {
  const config = createConfig({
    reviewBotLogins: ["codex-connector"],
    staleConfiguredBotReviewPolicy: "reply_only",
  });
  const previousProgressSnapshot = JSON.stringify({
    headRefOid: "head-191",
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadStatusState: null,
    currentHeadCiGreenAt: "2026-05-12T00:18:00Z",
    configuredBotRateLimitedAt: null,
    configuredBotDraftSkipAt: null,
    configuredBotTopLevelReviewStrength: "blocking",
    configuredBotTopLevelReviewSubmittedAt: "2026-05-12T00:10:00Z",
    checks: ["build:pass:SUCCESS:CI"],
    unresolvedReviewThreadIds: ["PRRT_thread_1", "PRRT_thread_2", "PRRT_thread_3", "PRRT_thread_4"],
    unresolvedReviewThreadFingerprints: [
      "PRRT_thread_1#comment-1",
      "PRRT_thread_2#comment-2",
      "PRRT_thread_3#comment-3",
      "PRRT_thread_4#comment-4",
    ],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "stale_review_bot",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error:
          "4 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_kind: null,
        last_failure_context: {
          category: "manual",
          summary:
            "4 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:codex-connector-p2",
          command: null,
          details: [
            "reviewer=codex-connector severity=P2 processed_on_current_head=yes thread=PRRT_thread_1",
            "reviewer=codex-connector severity=P2 processed_on_current_head=yes thread=PRRT_thread_2",
            "reviewer=codex-connector severity=P2 processed_on_current_head=yes thread=PRRT_thread_3",
            "reviewer=codex-connector severity=P2 processed_on_current_head=yes thread=PRRT_thread_4",
          ],
          url: "https://example.test/pr/191",
          updated_at: "2026-05-12T00:20:00Z",
        },
        last_failure_signature: "stalled-bot:codex-connector-p2",
        repeated_failure_signature_count: 3,
        last_stale_review_bot_reply_head_sha: "head-191",
        last_stale_review_bot_reply_signature: "stalled-bot:codex-connector-p2",
        stale_review_bot_reply_progress_keys: [
          "PRRT_thread_1@head-191",
          "PRRT_thread_2@head-191",
          "PRRT_thread_3@head-191",
          "PRRT_thread_4@head-191",
        ],
        processed_review_thread_ids: [
          "PRRT_thread_1@head-191",
          "PRRT_thread_2@head-191",
          "PRRT_thread_3@head-191",
          "PRRT_thread_4@head-191",
        ],
        processed_review_thread_fingerprints: [
          "PRRT_thread_1@head-191#comment-1",
          "PRRT_thread_2@head-191#comment-2",
          "PRRT_thread_3@head-191#comment-3",
          "PRRT_thread_4@head-191#comment-4",
        ],
        last_tracked_pr_progress_snapshot: previousProgressSnapshot,
        last_tracked_pr_progress_summary: "no_meaningful_tracked_pr_progress",
        last_tracked_pr_repeat_failure_decision: "stop_no_progress",
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-05-12T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    reviewDecision: "CHANGES_REQUESTED",
    configuredBotTopLevelReviewStrength: "blocking",
    configuredBotTopLevelReviewSubmittedAt: "2026-05-12T00:10:00Z",
  });

  let saveCalls = 0;
  const stateStore = {
    touch(current: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...current,
        ...patch,
        updated_at: "2026-05-12T00:25:00Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [
        createReviewThread({
          id: "PRRT_thread_1",
          comments: { nodes: [{ id: "comment-1", body: "P2 finding 1", createdAt: "2026-05-12T00:11:00Z", url: "https://example.test/pr/191#discussion_r1", author: { login: "codex-connector", typeName: "Bot" } }] },
        }),
        createReviewThread({
          id: "PRRT_thread_2",
          comments: { nodes: [{ id: "comment-2", body: "P2 finding 2", createdAt: "2026-05-12T00:12:00Z", url: "https://example.test/pr/191#discussion_r2", author: { login: "codex-connector", typeName: "Bot" } }] },
        }),
        createReviewThread({
          id: "PRRT_thread_3",
          comments: { nodes: [{ id: "comment-3", body: "P2 finding 3", createdAt: "2026-05-12T00:13:00Z", url: "https://example.test/pr/191#discussion_r3", author: { login: "codex-connector", typeName: "Bot" } }] },
        }),
        createReviewThread({
          id: "PRRT_thread_4",
          comments: { nodes: [{ id: "comment-4", body: "P2 finding 4", createdAt: "2026-05-12T00:14:00Z", url: "https://example.test/pr/191#discussion_r4", author: { login: "codex-connector", typeName: "Bot" } }] },
        }),
      ],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "addressing_review",
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "stale_review_bot");
  assert.equal(updated.last_tracked_pr_progress_summary, "recovery_blocked=stale_review_bot_no_auto_retry");
  assert.equal(updated.last_tracked_pr_repeat_failure_decision, "stop_no_progress");
  assert.equal(updated.last_recovery_reason, null);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents, []);
});

test("reconcileRecoverableBlockedIssueStates preserves same-head suppression when older progress snapshots lack review-thread fingerprints", async () => {
  const config = createConfig();
  const previousProgressSnapshot = JSON.stringify({
    headRefOid: "head-191",
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "BLOCKED",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadStatusState: null,
    currentHeadCiGreenAt: "2026-03-13T00:18:00Z",
    configuredBotRateLimitedAt: null,
    configuredBotDraftSkipAt: null,
    configuredBotTopLevelReviewStrength: null,
    configuredBotTopLevelReviewSubmittedAt: null,
    checks: ["build:pass:SUCCESS:CI"],
    unresolvedReviewThreadIds: ["PRRT_thread_1"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "manual_review",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error:
          "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_kind: null,
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "PRRT_thread_1",
          command: null,
          details: ["reviewer=coderabbit path=src/file.ts line=12 processed_on_current_head=yes"],
          url: "https://example.test/pr/191#discussion_r1",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "PRRT_thread_1",
        repeated_failure_signature_count: 3,
        last_tracked_pr_progress_snapshot: previousProgressSnapshot,
        last_tracked_pr_progress_summary: "no_meaningful_tracked_pr_progress",
        last_tracked_pr_repeat_failure_decision: "stop_no_progress",
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [
        createReviewThread({
          id: "PRRT_thread_1",
          comments: {
            nodes: [
              {
                id: "comment-1",
                body: "Please address this thread.",
                createdAt: "2026-03-13T00:19:00Z",
                url: "https://example.test/pr/191#discussion_r1",
                author: { login: "coderabbit", typeName: "Bot" },
              },
            ],
          },
        }),
      ],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "local_review",
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(
    updated.last_tracked_pr_progress_summary,
    "suppressed_same_head_same_review_thread_blocker",
  );
  assert.equal(updated.last_tracked_pr_repeat_failure_decision, "stop_no_progress");
  assert.equal(updated.last_recovery_reason, null);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents, []);
});

test("reconcileRecoverableBlockedIssueStates allows same-head tracked PR recovery when the unresolved blocker guidance changes within the same thread", async () => {
  const config = createConfig();
  const previousProgressSnapshot = JSON.stringify({
    headRefOid: "head-191",
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "BLOCKED",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadStatusState: null,
    currentHeadCiGreenAt: "2026-03-13T00:18:00Z",
    configuredBotRateLimitedAt: null,
    configuredBotDraftSkipAt: null,
    configuredBotTopLevelReviewStrength: null,
    configuredBotTopLevelReviewSubmittedAt: null,
    checks: ["build:pass:SUCCESS:CI"],
    unresolvedReviewThreadIds: ["PRRT_thread_1"],
    unresolvedReviewThreadFingerprints: ["PRRT_thread_1#comment-1"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "manual_review",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error:
          "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_kind: null,
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "PRRT_thread_1",
          command: null,
          details: ["reviewer=coderabbit path=src/file.ts line=12 processed_on_current_head=yes"],
          url: "https://example.test/pr/191#discussion_r1",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "PRRT_thread_1",
        repeated_failure_signature_count: 3,
        last_tracked_pr_progress_snapshot: previousProgressSnapshot,
        last_tracked_pr_progress_summary: "no_meaningful_tracked_pr_progress",
        last_tracked_pr_repeat_failure_decision: "stop_no_progress",
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [
        createReviewThread({
          id: "PRRT_thread_1",
          comments: {
            nodes: [
              {
                id: "comment-1",
                body: "Please address this thread.",
                createdAt: "2026-03-13T00:19:00Z",
                url: "https://example.test/pr/191#discussion_r1",
                author: { login: "coderabbit", typeName: "Bot" },
              },
              {
                id: "comment-2",
                body: "Additional guidance arrived on the same unresolved thread.",
                createdAt: "2026-03-13T00:24:00Z",
                url: "https://example.test/pr/191#discussion_r2",
                author: { login: "coderabbit", typeName: "Bot" },
              },
            ],
          },
        }),
      ],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "local_review",
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "local_review");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_tracked_pr_progress_summary, "same_review_thread_guidance_changed");
  assert.equal(updated.last_tracked_pr_repeat_failure_decision, "stop_no_progress");
  assert.match(
    updated.last_recovery_reason ?? "",
    /tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to local_review using fresh tracked PR #191 facts at head head-191/,
  );
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to local_review using fresh tracked PR #191 facts at head head-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates keeps same-head draft tracked PRs blocked when the verification gate still fails", async () => {
  const config = createConfig({
    localCiCommand: "npm run verify:paths",
  });
  const failureContext = {
    category: "blocked" as const,
    summary: "Configured local CI command failed before marking PR #191 ready.",
    signature: "local-ci-gate-non_zero_exit",
    command: "npm run verify:paths",
    details: ["failure_class=non_zero_exit"],
    url: null,
    updated_at: "2026-03-13T00:20:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "verification",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: failureContext.summary,
        last_failure_kind: null,
        last_failure_context: failureContext,
        last_failure_signature: failureContext.signature,
        repeated_failure_signature_count: 3,
        repeated_blocker_count: 4,
        repair_attempt_count: 2,
        timeout_retry_count: 1,
        blocked_verification_retry_count: 2,
        latest_local_ci_result: {
          outcome: "failed",
          summary: failureContext.summary,
          ran_at: "2026-03-13T00:19:00Z",
          head_sha: "head-191",
          execution_mode: "legacy_shell_string",
          failure_class: "non_zero_exit",
          remediation_target: "tracked_publishable_content",
        },
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    isDraft: true,
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "verification");
  assert.equal(updated.last_head_sha, "head-191");
  assert.equal(updated.last_error, failureContext.summary);
  assert.deepEqual(updated.last_failure_context, failureContext);
  assert.equal(updated.last_failure_signature, failureContext.signature);
  assert.equal(updated.repeated_failure_signature_count, 3);
  assert.equal(updated.repeated_blocker_count, 4);
  assert.equal(updated.repair_attempt_count, 2);
  assert.equal(updated.timeout_retry_count, 1);
  assert.equal(updated.blocked_verification_retry_count, 2);
  assert.equal(updated.last_recovery_reason, null);
  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
});

test("reconcileRecoverableBlockedIssueStates keeps same-head draft tracked PR host-local blockers blocked when the current head observation exists without a persisted comment", async () => {
  const config = createConfig({
    localCiCommand: "npm run verify:paths",
  });
  const failureContext = {
    category: "blocked" as const,
    summary: "Tracked durable artifacts failed workstation-local path hygiene before marking PR #191 ready.",
    signature: "workstation-local-path-hygiene-failed",
    command: "npm run verify:paths",
    details: ["First fix: .codex-supervisor/issue-journal.md (1 match)."],
    url: null,
    updated_at: "2026-03-13T00:20:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "verification",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: failureContext.summary,
        last_failure_kind: null,
        last_failure_context: failureContext,
        last_failure_signature: failureContext.signature,
        repeated_failure_signature_count: 1,
        last_observed_host_local_pr_blocker_head_sha: "head-191",
        last_observed_host_local_pr_blocker_signature: failureContext.signature,
        latest_local_ci_result: null,
        last_host_local_pr_blocker_comment_signature: null,
        last_host_local_pr_blocker_comment_head_sha: null,
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    isDraft: true,
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "verification");
  assert.equal(updated.last_error, failureContext.summary);
  assert.equal(updated.last_failure_signature, failureContext.signature);
  assert.equal(updated.last_observed_host_local_pr_blocker_head_sha, "head-191");
  assert.equal(updated.last_observed_host_local_pr_blocker_signature, failureContext.signature);
  assert.equal(updated.last_recovery_reason, null);
  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
});

test("reconcileRecoverableBlockedIssueStates only falls back to getIssue for blocked tracked PR records", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "waiting_ci",
        blocked_reason: null,
        pr_number: 191,
      }),
      createRecord({
        issue_number: 367,
        state: "blocked",
        blocked_reason: "manual_review",
        pr_number: 192,
        branch: "codex/reopen-issue-367",
        workspace: "/tmp/workspaces/issue-367",
        journal_path: "/tmp/workspaces/issue-367/.codex-supervisor/issue-journal.md",
        last_head_sha: "head-192",
        last_error: "Manual review is required before the PR can proceed.",
        last_failure_kind: null,
        last_failure_context: {
          category: "review",
          summary: "Manual review is required before the PR can proceed.",
          signature: "manual-review:thread-2",
          command: null,
          details: ["thread=thread-2"],
          url: "https://example.test/pr/192#discussion_r2",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "manual-review:thread-2",
        repeated_failure_signature_count: 1,
      }),
    ],
  });
  const issueCalls: number[] = [];
  const issue = createIssue({
    number: 367,
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 192,
    title: "Recovery implementation",
    url: "https://example.test/pr/192",
    headRefName: "codex/reopen-issue-367",
    headRefOid: "head-192",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async (prNumber) => {
        assert.equal(prNumber, 192);
        return pr;
      },
      getIssue: async (issueNumber) => {
        issueCalls.push(issueNumber);
        assert.equal(issueNumber, 367);
        return issue;
      },
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  assert.deepEqual(issueCalls, [367]);
  assert.equal(state.issues["366"]?.state, "waiting_ci");
  assert.equal(state.issues["367"]?.state, "ready_to_merge");
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #367 from blocked to ready_to_merge using fresh tracked PR #192 facts at head head-192",
  ]);
});

test("reconcileRecoverableBlockedIssueStates persists refreshed tracked PR lifecycle fields when the PR remains blocked", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "manual_review",
        pr_number: 191,
        last_head_sha: "stale-head",
        review_wait_started_at: null,
        review_wait_head_sha: null,
        copilot_review_requested_observed_at: null,
        copilot_review_requested_head_sha: null,
        copilot_review_timed_out_at: null,
        copilot_review_timeout_action: null,
        copilot_review_timeout_reason: null,
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "BLOCKED",
    mergeable: "CONFLICTING",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [createReviewThread()],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "blocked",
      inferFailureContext,
      blockedReasonForLifecycleState: () => "manual_review",
      isOpenPullRequest,
      syncReviewWaitWindow: () => ({
        review_wait_started_at: "2026-03-13T00:22:00Z",
        review_wait_head_sha: "head-191",
      }),
      syncCopilotReviewRequestObservation: () => ({
        copilot_review_requested_observed_at: "2026-03-13T00:23:00Z",
        copilot_review_requested_head_sha: "head-191",
      }),
      syncCopilotReviewTimeoutState: () => ({
        copilot_review_timed_out_at: "2026-03-13T00:24:00Z",
        copilot_review_timeout_action: "continue",
        copilot_review_timeout_reason: "review pending",
      }),
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.pr_number, 191);
  assert.equal(updated.last_head_sha, "head-191");
  assert.equal(updated.review_wait_started_at, "2026-03-13T00:22:00Z");
  assert.equal(updated.review_wait_head_sha, "head-191");
  assert.equal(updated.copilot_review_requested_observed_at, "2026-03-13T00:23:00Z");
  assert.equal(updated.copilot_review_requested_head_sha, "head-191");
  assert.equal(updated.copilot_review_timed_out_at, "2026-03-13T00:24:00Z");
  assert.equal(updated.copilot_review_timeout_action, "continue");
  assert.equal(updated.copilot_review_timeout_reason, "review pending");
  assert.equal(updated.last_recovery_reason, null);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents, []);
});

test("reconcileRecoverableBlockedIssueStates clears stale same-head tracked PR ready-promotion blockers without fresh evidence", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "blocked",
        blocked_reason: "verification",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: "Ready-for-review promotion is blocked by local verification.",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary: "Ready-for-review promotion is blocked by local verification.",
          signature: "local-verification-blocked",
          command: null,
          details: ["tracked_pr=head-191"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "local-verification-blocked",
        repeated_failure_signature_count: 3,
        last_tracked_pr_progress_snapshot: JSON.stringify({
          headRefOid: "head-old-191",
          reviewDecision: null,
          mergeStateStatus: "CLEAN",
          copilotReviewState: null,
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
          configuredBotCurrentHeadObservedAt: null,
          configuredBotCurrentHeadStatusState: null,
          currentHeadCiGreenAt: "2026-03-13T00:18:00Z",
          configuredBotRateLimitedAt: null,
          configuredBotDraftSkipAt: null,
          configuredBotTopLevelReviewStrength: null,
          configuredBotTopLevelReviewSubmittedAt: null,
          checks: ["build:pass:SUCCESS:CI"],
          unresolvedReviewThreadIds: [],
        }),
        last_recovery_reason:
          "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to draft_pr using fresh tracked PR #191 facts at head head-old-191",
        last_recovery_at: "2026-03-13T00:18:00Z",
        latest_local_ci_result: null,
        last_host_local_pr_blocker_comment_signature: null,
        last_host_local_pr_blocker_comment_head_sha: null,
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    isDraft: true,
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated?.state, "draft_pr");
  assert.equal(updated?.blocked_reason, null);
  assert.equal(updated?.last_error, null);
  assert.equal(updated?.last_failure_context, null);
  assert.equal(updated?.last_failure_signature, null);
  assert.equal(updated?.repeated_failure_signature_count, 0);
  assert.equal(updated?.repeated_blocker_count, 0);
  assert.equal(updated?.repair_attempt_count, 0);
  assert.equal(updated?.timeout_retry_count, 0);
  assert.equal(updated?.blocked_verification_retry_count, 0);
  assert.equal(updated?.last_head_sha, "head-191");
  assert.equal(
    updated?.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to draft_pr using fresh tracked PR #191 facts at head head-191",
  );
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to draft_pr using fresh tracked PR #191 facts at head head-191",
  ]);
  assert.equal(saveCalls, 1);
});

test("reconcileRecoverableBlockedIssueStates clears stale tracked PR ready-promotion blockers after head advance", async () => {
  const config = createConfig();
  const failureContext = {
    category: "blocked" as const,
    summary: "Ready-for-review promotion is blocked by local verification on the previous head.",
    signature: "local-verification-blocked",
    command: null,
    details: [`tracked_pr=${TRACKED_PR_OLD_HEAD}`],
    url: null,
    updated_at: "2026-03-13T00:20:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "verification",
        pr_number: TRACKED_PR_NUMBER,
        last_head_sha: TRACKED_PR_OLD_HEAD,
        last_error: failureContext.summary,
        last_failure_kind: null,
        last_failure_context: failureContext,
        last_failure_signature: failureContext.signature,
        repeated_failure_signature_count: 3,
        repeated_blocker_count: 4,
        repair_attempt_count: 2,
        timeout_retry_count: 1,
        blocked_verification_retry_count: 2,
        latest_local_ci_result: {
          outcome: "failed",
          summary: "Configured local CI command failed on the previous head.",
          ran_at: "2026-03-13T00:22:00Z",
          head_sha: TRACKED_PR_OLD_HEAD,
          execution_mode: "shell",
          failure_class: "non_zero_exit",
          remediation_target: "tracked_publishable_content",
        },
      }),
    ],
  });
  const issue = createTrackedPrRecoveryIssue();
  const pr = createTrackedPrRecoveryPullRequest({
    headRefOid: TRACKED_PR_NEW_HEAD,
    isDraft: true,
    currentHeadCiGreenAt: "2026-03-13T00:24:00Z",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "draft_pr");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_head_sha, TRACKED_PR_NEW_HEAD);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.repeated_blocker_count, 0);
  assert.equal(updated.repair_attempt_count, 0);
  assert.equal(updated.timeout_retry_count, 0);
  assert.equal(updated.blocked_verification_retry_count, 0);
  assert.equal(updated.local_review_head_sha, null);
  assert.equal(updated.latest_local_ci_result, null);
  assert.equal(updated.last_host_local_pr_blocker_comment_head_sha, null);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_head_advanced: resumed issue #366 from blocked to draft_pr after tracked PR #191 advanced from head-old-191 to head-new-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates resumes tracked PR stale configured-bot blockers after reply_and_resolve is enabled", async () => {
  const config = createConfig({
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "stale_review_bot",
        pr_number: 191,
        last_head_sha: "head-191",
        local_review_head_sha: "head-191",
        local_review_summary_path: "/tmp/reviews/issue-366/head-191.md",
        last_error: "Configured bot review stayed stale on the current head.",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary: "Configured bot review stayed stale on the current head.",
          signature: "stale-configured-bot-review",
          command: null,
          details: ["tracked_pr=head-191"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "stale-configured-bot-review",
        latest_local_ci_result: {
          outcome: "passed",
          summary: "Local CI passed on the current head.",
          ran_at: "2026-03-13T00:22:00Z",
          head_sha: "head-191",
          execution_mode: "shell",
          failure_class: null,
          remediation_target: null,
        },
        external_review_head_sha: "head-191",
        external_review_misses_path: "/tmp/reviews/issue-366/head-191-misses.json",
        review_follow_up_head_sha: "head-191",
        last_host_local_pr_blocker_comment_head_sha: "head-191",
        processed_review_thread_ids: ["thread-1", "thread-1@head-191"],
        processed_review_thread_fingerprints: ["thread-1@head-191#comment-1"],
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    isDraft: false,
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [createReviewThread()],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "blocked",
      inferFailureContext: () => ({
        category: "blocked",
        summary: "Configured bot review stayed stale on the current head.",
        signature: "stale-configured-bot-review",
        command: null,
        details: ["tracked_pr=head-191"],
        url: null,
        updated_at: "2026-03-13T00:20:00Z",
      }),
      blockedReasonForLifecycleState: () => "stale_review_bot",
      isOpenPullRequest,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  assert.equal(recoveryEvents.length, 0);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.blocked_reason, "stale_review_bot");
  assert.equal(state.issues["366"]?.pr_number, 191);
  assert.equal(state.issues["366"]?.last_head_sha, "head-191");
  assert.equal(state.issues["366"]?.last_failure_signature, "stale-configured-bot-review");
  assert.equal(saveCalls, 1);
});

test("reconcileRecoverableBlockedIssueStates rehydrates same-head stale configured-bot blockers to ready_to_merge after the current head was already auto-handled", async () => {
  const config = createConfig({
    staleConfiguredBotReviewPolicy: "reply_and_resolve",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "stale_review_bot",
        pr_number: 191,
        last_head_sha: "head-191",
        local_review_head_sha: "head-191",
        local_review_summary_path: "/tmp/reviews/issue-366/head-191.md",
        last_error: "Configured bot review stayed stale on the current head.",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary: "Configured bot review stayed stale on the current head.",
          signature: "stale-configured-bot-review",
          command: null,
          details: ["tracked_pr=head-191"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "stale-configured-bot-review",
        latest_local_ci_result: {
          outcome: "passed",
          summary: "Local CI passed on the current head.",
          ran_at: "2026-03-13T00:22:00Z",
          head_sha: "head-191",
          execution_mode: "shell",
          failure_class: null,
          remediation_target: null,
        },
        external_review_head_sha: "head-191",
        external_review_misses_path: "/tmp/reviews/issue-366/head-191-misses.json",
        review_follow_up_head_sha: "head-191",
        last_host_local_pr_blocker_comment_head_sha: "head-191",
        processed_review_thread_ids: ["thread-1", "thread-1@head-191"],
        processed_review_thread_fingerprints: ["thread-1@head-191#comment-1"],
        last_stale_review_bot_reply_head_sha: "head-191",
        last_stale_review_bot_reply_signature: "stale-configured-bot-review",
        stale_review_bot_reply_progress_keys: ["reply:thread-1@head-191"],
        stale_review_bot_resolve_progress_keys: ["resolve:thread-1@head-191"],
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    isDraft: false,
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "ready_to_merge",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "ready_to_merge");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.last_stale_review_bot_reply_head_sha, "head-191");
  assert.equal(updated.last_stale_review_bot_reply_signature, "stale-configured-bot-review");
  assert.deepEqual(updated.stale_review_bot_reply_progress_keys, ["reply:thread-1@head-191"]);
  assert.deepEqual(updated.stale_review_bot_resolve_progress_keys, ["resolve:thread-1@head-191"]);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates clears stale same-head configured-bot blockers under diagnose_only when GitHub is already clear", async () => {
  const config = createConfig({
    staleConfiguredBotReviewPolicy: "diagnose_only",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "stale_review_bot",
        pr_number: 191,
        last_head_sha: "head-191",
        local_review_head_sha: "head-191",
        local_review_summary_path: "/tmp/reviews/issue-366/head-191.md",
        last_error: "Configured bot review stayed stale on the current head.",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary: "Configured bot review stayed stale on the current head.",
          signature: "stale-configured-bot-review",
          command: null,
          details: ["tracked_pr=head-191"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "stale-configured-bot-review",
        last_stale_review_bot_reply_head_sha: "head-191",
        last_stale_review_bot_reply_signature: "stale-configured-bot-review",
        stale_review_bot_reply_progress_keys: ["reply:thread-1@head-191"],
        stale_review_bot_resolve_progress_keys: ["resolve:thread-1@head-191"],
      }),
    ],
  });
  const issue = createIssue({
    title: "Recovery issue",
    updatedAt: "2026-03-13T00:21:00Z",
  });
  const pr = createPullRequest({
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    isDraft: false,
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "ready_to_merge",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "ready_to_merge");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.last_stale_review_bot_reply_head_sha, "head-191");
  assert.equal(updated.last_stale_review_bot_reply_signature, "stale-configured-bot-review");
  assert.deepEqual(updated.stale_review_bot_reply_progress_keys, ["reply:thread-1@head-191"]);
  assert.deepEqual(updated.stale_review_bot_resolve_progress_keys, ["resolve:thread-1@head-191"]);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_lifecycle_recovered: resumed issue #366 from blocked to ready_to_merge using fresh tracked PR #191 facts at head head-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates clears stale head-scoped review state after a tracked PR repair push", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    trackedPrCurrentHeadLocalReviewRequired: true,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "verification",
        processed_review_thread_ids: ["thread-1"],
        processed_review_thread_fingerprints: [],
        last_error: "Local review requested changes (2 actionable findings across 1 root cause).",
        last_failure_kind: null,
        last_failure_context: {
          category: "blocked",
          summary: "Local review requested changes (2 actionable findings across 1 root cause).",
          signature: "local-review:medium:none:1:0:clean",
          command: null,
          details: ["findings=2", "root_causes=1"],
          url: null,
          updated_at: "2026-03-13T00:19:00Z",
        },
        last_failure_signature: "local-review:medium:none:1:0:clean",
        repeated_failure_signature_count: 137,
      }),
    ],
  });
  const issue = createTrackedPrRecoveryIssue();
  const pr = createTrackedPrRecoveryPullRequest({
    title: "Repair push",
    headRefOid: TRACKED_PR_NEW_HEAD,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [createReviewThread()],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "addressing_review");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_head_sha, "head-new-191");
  assert.equal(updated.local_review_head_sha, null);
  assert.equal(updated.local_review_summary_path, null);
  assert.equal(updated.pre_merge_evaluation_outcome, null);
  assert.equal(updated.external_review_head_sha, null);
  assert.equal(updated.review_follow_up_head_sha, null);
  assert.equal(updated.review_follow_up_remaining, 0);
  assert.deepEqual(updated.processed_review_thread_ids, []);
  assert.deepEqual(updated.processed_review_thread_fingerprints, []);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.repeated_local_review_signature_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_head_advanced: resumed issue #366 from blocked to addressing_review after tracked PR #191 advanced from head-old-191 to head-new-191",
  );
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents.map((event) => event.reason), [
    "tracked_pr_head_advanced: resumed issue #366 from blocked to addressing_review after tracked PR #191 advanced from head-old-191 to head-new-191",
  ]);
});

test("reconcileRecoverableBlockedIssueStates clears stale head-scoped review state when a tracked PR stays blocked on a new head", async () => {
  const config = createConfig({
    localReviewEnabled: true,
    localReviewPolicy: "block_merge",
    trackedPrCurrentHeadLocalReviewRequired: true,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const failureContext = {
    category: "review" as const,
    summary: "Manual review is still required on the refreshed PR head.",
    signature: "manual-review:thread-1",
    command: null,
    details: ["thread=thread-1"],
    url: "https://example.test/pr/191#discussion_r1",
    updated_at: "2026-03-13T00:25:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createTrackedPrStaleReviewRecord({
        state: "blocked",
        blocked_reason: "manual_review",
        pre_merge_evaluation_outcome: "manual_review_blocked",
        pre_merge_manual_review_count: 2,
        last_error: failureContext.summary,
        last_failure_kind: null,
        last_failure_context: failureContext,
        last_failure_signature: failureContext.signature,
        repeated_failure_signature_count: 137,
        repeated_blocker_count: 4,
        repair_attempt_count: 2,
        timeout_retry_count: 1,
        blocked_verification_retry_count: 1,
      }),
    ],
  });
  const issue = createTrackedPrRecoveryIssue();
  const pr = createTrackedPrRecoveryPullRequest({
    title: "Repair push",
    headRefOid: TRACKED_PR_NEW_HEAD,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

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

  const recoveryEvents = await reconcileRecoverableBlockedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getIssue: async () => issue,
      getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
      getUnresolvedReviewThreads: async () => [createReviewThread()],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      shouldAutoRetryHandoffMissing,
      inferStateFromPullRequest: () => "blocked",
      inferFailureContext: () => failureContext,
      blockedReasonForLifecycleState: () => "manual_review",
      isOpenPullRequest,
      syncReviewWaitWindow: () => ({
        review_wait_started_at: "2026-03-13T00:24:00Z",
        review_wait_head_sha: "head-new-191",
      }),
      syncCopilotReviewRequestObservation: () => ({
        copilot_review_requested_observed_at: "2026-03-13T00:24:30Z",
        copilot_review_requested_head_sha: "head-new-191",
      }),
      syncCopilotReviewTimeoutState: () => noCopilotReviewTimeoutPatch(),
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.pr_number, 191);
  assert.equal(updated.last_head_sha, "head-new-191");
  assert.equal(updated.local_review_head_sha, null);
  assert.equal(updated.local_review_summary_path, null);
  assert.equal(updated.pre_merge_evaluation_outcome, null);
  assert.equal(updated.external_review_head_sha, null);
  assert.equal(updated.review_follow_up_head_sha, null);
  assert.equal(updated.review_follow_up_remaining, 0);
  assert.deepEqual(updated.processed_review_thread_ids, []);
  assert.deepEqual(updated.processed_review_thread_fingerprints, []);
  assert.equal(updated.last_error, failureContext.summary);
  assert.deepEqual(updated.last_failure_context, failureContext);
  assert.equal(updated.last_failure_signature, failureContext.signature);
  assert.equal(updated.repeated_failure_signature_count, 1);
  assert.equal(updated.repeated_local_review_signature_count, 0);
  assert.equal(updated.repeated_blocker_count, 0);
  assert.equal(updated.repair_attempt_count, 0);
  assert.equal(updated.timeout_retry_count, 0);
  assert.equal(updated.blocked_verification_retry_count, 0);
  assert.equal(updated.review_wait_started_at, "2026-03-13T00:24:00Z");
  assert.equal(updated.review_wait_head_sha, "head-new-191");
  assert.equal(updated.copilot_review_requested_observed_at, "2026-03-13T00:24:30Z");
  assert.equal(updated.copilot_review_requested_head_sha, "head-new-191");
  assert.equal(updated.last_recovery_reason, null);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents, []);
});
