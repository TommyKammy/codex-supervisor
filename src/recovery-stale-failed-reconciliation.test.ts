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

test("reconcileStaleFailedIssueStates requeues failed no-PR issues when the issue definition changes materially", async () => {
  const config = createConfig();
  const originalIssue = createIssue({
    number: 366,
    body: executionReadyBody("Refresh stale failed no-PR issues after issue-definition changes."),
    updatedAt: "2026-03-13T00:20:00Z",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        pr_number: null,
        codex_session_id: null,
        last_error: "Codex failed against a stale issue definition.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Codex failed against the stale issue definition.",
          signature: "codex-failed",
          command: "codex exec",
          details: ["state=failed", "tracked_pr=none"],
          url: "https://example.test/issues/366",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "codex-failed",
        repeated_failure_signature_count: 2,
        stale_stabilizing_no_pr_recovery_count: 1,
        issue_definition_fingerprint: buildIssueDefinitionFingerprint(originalIssue),
        issue_definition_updated_at: originalIssue.updatedAt,
        last_recovery_reason: "codex_failed: failed issue #366 after codex exited non-zero",
        last_recovery_at: "2026-03-13T00:20:00Z",
        updated_at: "2026-03-13T00:20:00Z",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    body: originalIssue.body.replace(
      "- supervisor treats this issue as runnable",
      "- supervisor requeues stale failed no-PR issues when the issue definition changes materially",
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

  await reconcileStaleFailedIssueStates(
    {
      getIssue: async () => issue,
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getMergedPullRequestsClosingIssue: async () => {
        throw new Error("unexpected getMergedPullRequestsClosingIssue call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
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
  assert.equal(updated.state, "queued");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "github_issue_definition_changed: requeued issue #366 after a material GitHub issue definition change invalidated the stale no-PR failed state",
  );
  assert.equal(updated.issue_definition_fingerprint, buildIssueDefinitionFingerprint(issue));
  assert.equal(updated.issue_definition_updated_at, issue.updatedAt);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates records a recovery reason when a tracked PR advances to a new head", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "failed",
        pr_number: 191,
        last_head_sha: "head-old-191",
        last_failure_signature: "tests:red",
        repeated_failure_signature_count: 3,
        blocked_reason: null,
        last_error: "Stopped after repeated test failures.",
        last_failure_kind: "codex_failed",
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
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:22:00Z",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-new-191",
    reviewDecision: "CHANGES_REQUESTED",
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "addressing_review",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "addressing_review");
  assert.equal(updated.pr_number, 191);
  assert.equal(updated.last_head_sha, "head-new-191");
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_head_advanced: resumed issue #366 from failed to addressing_review after tracked PR #191 advanced from head-old-191 to head-new-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates requeues failed no-PR issues when the workspace branch is safely ahead of origin/main", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "recoverable checkpoint\n");
  await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
  await runCommand("git", ["-C", workspacePath, "commit", "-m", "recoverable checkpoint"]);
  const headSha = (await runCommand("git", ["-C", workspacePath, "rev-parse", "HEAD"])).stdout.trim();

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        implementation_attempt_count: config.maxImplementationAttemptsPerIssue,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Recover failed no-PR branch",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_failure_kind, null);
  assert.match(updated.last_error ?? "", /recoverable failed no-PR recovery/i);
  assert.equal(updated.last_failure_signature, "stale-stabilizing-no-pr-recovery-loop");
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 1);
  assert.equal(
    updated.last_recovery_reason,
    `failed_no_pr_branch_recovery: requeued issue #366 from failed to queued after finding a recoverable no-PR branch ahead of origin/main at ${headSha}`,
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates requeues failed no-PR issues when journal_path points to another host but the canonical local workspace is recoverable", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", "366", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "recoverable checkpoint\n");
  await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
  await runCommand("git", ["-C", workspacePath, "commit", "-m", "recoverable checkpoint"]);
  const headSha = (await runCommand("git", ["-C", workspacePath, "rev-parse", "HEAD"])).stdout.trim();

  const config = createConfig({
    repoPath,
    workspaceRoot,
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: "/tmp/other-host/issue-366/.codex-supervisor/issues/366/issue-journal.md",
        pr_number: null,
        implementation_attempt_count: config.maxImplementationAttemptsPerIssue,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Recover failed no-PR branch after host migration",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_failure_kind, null);
  assert.match(updated.last_error ?? "", /recoverable failed no-PR recovery/i);
  assert.equal(updated.last_failure_signature, "stale-stabilizing-no-pr-recovery-loop");
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 1);
  assert.equal(
    updated.last_recovery_reason,
    `failed_no_pr_branch_recovery: requeued issue #366 from failed to queued after finding a recoverable no-PR branch ahead of origin/main at ${headSha}`,
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates fetches origin/main once per reconciliation pass for repeated failed no-PR recovery", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspace366 = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const workspace367 = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 367,
    branch: "codex/reopen-issue-367",
  });

  const issueDetails = [
    { issueNumber: 366, workspacePath: workspace366, branch: "codex/reopen-issue-366" },
    { issueNumber: 367, workspacePath: workspace367, branch: "codex/reopen-issue-367" },
  ] as const;

  const headShaByIssueNumber = new Map<number, string>();
  for (const { issueNumber, workspacePath } of issueDetails) {
    const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
    await fs.mkdir(path.dirname(journalPath), { recursive: true });
    await fs.writeFile(journalPath, "# local journal\n");
    await fs.writeFile(path.join(workspacePath, "feature.txt"), `recoverable checkpoint ${issueNumber}\n`);
    await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
    await runCommand("git", ["-C", workspacePath, "commit", "-m", `recoverable checkpoint ${issueNumber}`]);
    const headSha = (await runCommand("git", ["-C", workspacePath, "rev-parse", "HEAD"])).stdout.trim();
    headShaByIssueNumber.set(issueNumber, headSha);
  }

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: issueDetails.map(({ issueNumber, workspacePath, branch }) =>
      createRecord({
        issue_number: issueNumber,
        state: "failed",
        branch,
        workspace: workspacePath,
        journal_path: path.join(workspacePath, ".codex-supervisor", "issue-journal.md"),
        pr_number: null,
        implementation_attempt_count: config.maxImplementationAttemptsPerIssue,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: `session-${issueNumber}`,
      })),
  });
  const issues = issueDetails.map(({ issueNumber }) =>
    createIssue({
      number: issueNumber,
      title: `Recover failed no-PR branch ${issueNumber}`,
      updatedAt: "2026-03-13T00:21:00Z",
    }));

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

  let fetchCalls = 0;
  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    issues,
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
      fetchOriginDefaultBranch: async () => {
        fetchCalls += 1;
      },
    },
  );

  assert.equal(fetchCalls, 1);
  for (const { issueNumber } of issueDetails) {
    const updated = state.issues[String(issueNumber)];
    assert.equal(updated.state, "queued");
    assert.equal(updated.last_failure_signature, "stale-stabilizing-no-pr-recovery-loop");
    assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 1);
    assert.equal(
      updated.last_recovery_reason,
      `failed_no_pr_branch_recovery: requeued issue #${issueNumber} from failed to queued after finding a recoverable no-PR branch ahead of origin/main at ${headShaByIssueNumber.get(issueNumber)}`,
    );
  }
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates fails closed for all affected no-PR recovery records when the shared fetch fails", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspace366 = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const workspace367 = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 367,
    branch: "codex/reopen-issue-367",
  });

  const issueDetails = [
    { issueNumber: 366, workspacePath: workspace366, branch: "codex/reopen-issue-366" },
    { issueNumber: 367, workspacePath: workspace367, branch: "codex/reopen-issue-367" },
  ] as const;

  for (const { issueNumber, workspacePath } of issueDetails) {
    const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
    await fs.mkdir(path.dirname(journalPath), { recursive: true });
    await fs.writeFile(journalPath, "# local journal\n");
    await fs.writeFile(path.join(workspacePath, "feature.txt"), `recoverable checkpoint ${issueNumber}\n`);
    await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
    await runCommand("git", ["-C", workspacePath, "commit", "-m", `recoverable checkpoint ${issueNumber}`]);
  }

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: issueDetails.map(({ issueNumber, workspacePath, branch }) =>
      createRecord({
        issue_number: issueNumber,
        state: "failed",
        branch,
        workspace: workspacePath,
        journal_path: path.join(workspacePath, ".codex-supervisor", "issue-journal.md"),
        pr_number: null,
        implementation_attempt_count: config.maxImplementationAttemptsPerIssue,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: `session-${issueNumber}`,
      })),
  });
  const issues = issueDetails.map(({ issueNumber }) =>
    createIssue({
      number: issueNumber,
      title: `Recover failed no-PR branch ${issueNumber}`,
      updatedAt: "2026-03-13T00:21:00Z",
    }));

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

  let fetchCalls = 0;
  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    issues,
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
      fetchOriginDefaultBranch: async () => {
        fetchCalls += 1;
        throw new Error("simulated shared fetch failure");
      },
    },
  );

  assert.equal(fetchCalls, 1);
  for (const { issueNumber } of issueDetails) {
    const updated = state.issues[String(issueNumber)];
    assert.equal(updated.state, "blocked");
    assert.equal(updated.blocked_reason, "manual_review");
    assert.equal(updated.last_failure_context?.signature, "failed-no-pr-manual-review-required");
    assert.deepEqual(updated.last_failure_context?.details ?? [], [
      "state=failed",
      "tracked_pr=none",
      "branch_state=manual_review_required",
      "default_branch=origin/main",
      "head_sha=unknown",
      "operator_action=inspect the preserved workspace and resolve the unsafe or ambiguous branch state before requeueing manually",
    ]);
    assert.equal(
      updated.last_recovery_reason,
      `failed_no_pr_manual_review: blocked issue #${issueNumber} after failed no-PR recovery found an unsafe or ambiguous workspace state`,
    );
  }
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates blocks failed no-PR issues for manual review when the workspace branch is ahead but still has non-artifact edits", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "recoverable checkpoint\n");
  await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
  await runCommand("git", ["-C", workspacePath, "commit", "-m", "recoverable checkpoint"]);
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "recoverable checkpoint\nextra dirty edit\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const original = createRecord({
    issue_number: 366,
    state: "failed",
    branch: "codex/reopen-issue-366",
    workspace: workspacePath,
    journal_path: journalPath,
    pr_number: null,
    last_head_sha: baseHead,
    last_error: "Selected model is at capacity. Please try a different model.",
    last_failure_kind: "codex_exit",
    last_failure_context: {
      category: "codex",
      summary: "Selected model is at capacity. Please try a different model.",
      signature: "provider-capacity",
      command: null,
      details: ["provider=codex"],
      url: null,
      updated_at: "2026-03-13T00:20:00Z",
    },
    last_failure_signature: "provider-capacity",
    repeated_failure_signature_count: 1,
    last_runtime_error: "Selected model is at capacity. Please try a different model.",
    last_runtime_failure_kind: "codex_exit",
    last_runtime_failure_context: {
      category: "codex",
      summary: "Selected model is at capacity. Please try a different model.",
      signature: "provider-capacity",
      command: null,
      details: ["provider=codex"],
      url: null,
      updated_at: "2026-03-13T00:20:00Z",
    },
    codex_session_id: "session-366",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issue = createIssue({
    number: 366,
    title: "Keep dirty recoverable branch manual",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-manual-review-required");
  assert.equal(updated.last_runtime_failure_kind, "codex_exit");
  assert.equal(updated.last_runtime_error, "Selected model is at capacity. Please try a different model.");
  assert.equal(updated.last_runtime_failure_context?.category, "codex");
  assert.equal(updated.last_runtime_failure_context?.summary, "Selected model is at capacity. Please try a different model.");
  assert.equal(updated.last_runtime_failure_context?.signature, "provider-capacity");
  assert.match(updated.last_error ?? "", /not safe for automatic recovery/i);
  assert.deepEqual(updated.last_failure_context?.details ?? [], [
    "state=failed",
    "tracked_pr=none",
    "branch_state=manual_review_required",
    "default_branch=origin/main",
    `head_sha=${updated.last_head_sha ?? "unknown"}`,
    "preserved_partial_work=yes",
    "tracked_file_count=1",
    "tracked_files=feature.txt",
    "operator_action=inspect the preserved workspace and resolve the unsafe or ambiguous branch state before requeueing manually",
  ]);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_manual_review: blocked issue #366 after failed no-PR recovery found an unsafe or ambiguous workspace state",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates keeps retryable timeout failed no-PR issues failed when the workspace is structurally valid but dirty", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "recoverable checkpoint\n");
  await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
  await runCommand("git", ["-C", workspacePath, "commit", "-m", "recoverable checkpoint"]);
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "recoverable checkpoint\nextra dirty edit\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
    timeoutRetryLimit: 2,
  });
  const originalFailureContext = {
    category: "codex" as const,
    summary: "Command timed out after 1800000ms: codex exec resume thread-366",
    signature: "timeout-resume-thread-366",
    command: null,
    details: ["provider=codex", "phase=recovering"],
    url: null,
    updated_at: "2026-03-13T00:20:00Z",
  };
  const originalRuntimeFailureContext = {
    category: "codex" as const,
    summary: "Supervisor failed while recovering a Codex turn for issue #366.",
    signature: "recovering-timeout-thread-366",
    command: null,
    details: [
      "previous_state=reproducing",
      "workspace_dirty=yes",
      "workspace_head=deadbee",
      "pr_number=none",
      "pr_head=none",
      "codex_session_id=thread-366",
    ],
    url: null,
    updated_at: "2026-03-13T00:20:05Z",
  };
  const original = createRecord({
    issue_number: 366,
    state: "failed",
    branch: "codex/reopen-issue-366",
    workspace: workspacePath,
    journal_path: journalPath,
    pr_number: null,
    last_head_sha: baseHead,
    last_error: originalFailureContext.summary,
    last_failure_kind: "timeout",
    last_failure_context: originalFailureContext,
    last_failure_signature: originalFailureContext.signature,
    repeated_failure_signature_count: 1,
    timeout_retry_count: 1,
    last_runtime_error: originalRuntimeFailureContext.summary,
    last_runtime_failure_kind: "timeout",
    last_runtime_failure_context: originalRuntimeFailureContext,
    codex_session_id: "session-366",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issue = createIssue({
    number: 366,
    title: "Keep retryable timeout no-PR failure pending",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.deepEqual(updated, original);
  assert.equal(saveCalls, 0);
});

test("reconcileStaleFailedIssueStates snapshots the original runtime failure when no-PR manual review replaces failure context", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "recoverable checkpoint\n");
  await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
  await runCommand("git", ["-C", workspacePath, "commit", "-m", "recoverable checkpoint"]);
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "recoverable checkpoint\nextra dirty edit\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const originalFailureContext = {
    category: "codex" as const,
    summary: "Selected model is at capacity. Please try a different model.",
    signature: "provider-capacity",
    command: null,
    details: ["provider=codex"],
    url: null,
    updated_at: "2026-03-13T00:20:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: originalFailureContext.summary,
        last_failure_kind: "codex_exit",
        last_failure_context: originalFailureContext,
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        last_runtime_error: null,
        last_runtime_failure_kind: null,
        last_runtime_failure_context: null,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Preserve runtime failure snapshot for failed no-PR manual review",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-manual-review-required");
  assert.equal(updated.last_runtime_error, originalFailureContext.summary);
  assert.equal(updated.last_runtime_failure_kind, "codex_exit");
  assert.deepEqual(updated.last_runtime_failure_context, originalFailureContext);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates requeues failed no-PR issues once when only supervisor-local artifacts are dirty on an open issue", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", "366", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  const replayArtifactPath = path.join(workspacePath, ".codex-supervisor", "replay", "decision-cycle-snapshot.json");
  await fs.mkdir(path.dirname(replayArtifactPath), { recursive: true });
  await fs.writeFile(replayArtifactPath, "{\n  \"kind\": \"replay\"\n}\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  const original = createRecord({
    issue_number: 366,
    state: "failed",
    branch: "codex/reopen-issue-366",
    workspace: workspacePath,
    journal_path: journalPath,
    pr_number: null,
    last_head_sha: baseHead,
    last_error: "Selected model is at capacity. Please try a different model.",
    last_failure_kind: "codex_exit",
    last_failure_context: {
      category: "codex",
      summary: "Selected model is at capacity. Please try a different model.",
      signature: "provider-capacity",
      command: null,
      details: ["provider=codex"],
      url: null,
      updated_at: "2026-03-13T00:20:00Z",
    },
    last_failure_signature: "provider-capacity",
    repeated_failure_signature_count: 1,
    codex_session_id: "session-366",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [original],
  });
  const issue = createIssue({
    number: 366,
    title: "Keep dirty supervisor artifacts manual",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_runtime_error, "Selected model is at capacity. Please try a different model.");
  assert.equal(updated.last_runtime_failure_kind, "codex_exit");
  assert.equal(updated.last_runtime_failure_context?.signature, "provider-capacity");
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 1);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_transient_retry: requeued issue #366 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates requeues failed no-PR issues once when only supervisor-local artifact commits remain on an open issue", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", "366", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  const replayArtifactPath = path.join(workspacePath, ".codex-supervisor", "replay", "decision-cycle-snapshot.json");
  await fs.mkdir(path.dirname(replayArtifactPath), { recursive: true });
  await fs.writeFile(replayArtifactPath, "{\n  \"kind\": \"replay\"\n}\n");
  await runCommand("git", ["-C", workspacePath, "add", ".codex-supervisor"]);
  await runCommand("git", ["-C", workspacePath, "commit", "-m", "artifact-only checkpoint"]);
  const headSha = (await runCommand("git", ["-C", workspacePath, "rev-parse", "HEAD"])).stdout.trim();

  const config = createConfig({
    repoPath,
    workspaceRoot,
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Classify artifact-only failed no-PR branch as already satisfied",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_head_sha, headSha);
  assert.equal(updated.last_runtime_error, "Selected model is at capacity. Please try a different model.");
  assert.equal(updated.last_runtime_failure_kind, "codex_exit");
  assert.equal(updated.last_runtime_failure_context?.signature, "provider-capacity");
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 1);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_transient_retry: requeued issue #366 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates requeues failed no-PR issues once when an open no-PR issue has no meaningful branch diff", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Classify already-satisfied failed no-PR branch",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_runtime_error, "Selected model is at capacity. Please try a different model.");
  assert.equal(updated.last_runtime_failure_kind, "codex_exit");
  assert.equal(updated.last_runtime_failure_context?.signature, "provider-capacity");
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 1);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_transient_retry: requeued issue #366 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates requeues failed no-PR issues once when no meaningful branch diff matches allowlisted transient runtime evidence", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const originalRuntimeFailureContext = {
    category: "codex" as const,
    summary: "Selected model is at capacity. Please try a different model.",
    signature: "provider-capacity",
    command: null,
    details: ["provider=codex"],
    url: null,
    updated_at: "2026-03-13T00:20:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: originalRuntimeFailureContext.summary,
        last_failure_kind: "codex_exit",
        last_failure_context: originalRuntimeFailureContext,
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        last_runtime_error: originalRuntimeFailureContext.summary,
        last_runtime_failure_kind: "codex_exit",
        last_runtime_failure_context: originalRuntimeFailureContext,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Retry already-satisfied transient failed no-PR issue once",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.last_runtime_error, originalRuntimeFailureContext.summary);
  assert.equal(updated.last_runtime_failure_kind, "codex_exit");
  assert.deepEqual(updated.last_runtime_failure_context, originalRuntimeFailureContext);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 1);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_transient_retry: requeued issue #366 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates requeues failed no-PR issues once when no meaningful branch diff matches allowlisted timeout runtime evidence", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
    timeoutRetryLimit: 2,
  });
  const originalRuntimeFailureContext = {
    category: "codex" as const,
    summary: "Supervisor failed while recovering a Codex turn for issue #366.",
    signature: "recovering-timeout-thread-366",
    command: null,
    details: [
      "previous_state=reproducing",
      "workspace_dirty=no",
      "workspace_head=deadbee",
      "pr_number=none",
      "pr_head=none",
      "codex_session_id=thread-366",
    ],
    url: null,
    updated_at: "2026-03-13T00:20:05Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: "Command timed out after 1800000ms: codex exec resume thread-366",
        last_failure_kind: "timeout",
        last_failure_context: {
          category: "codex",
          summary: "Command timed out after 1800000ms: codex exec resume thread-366",
          signature: "timeout-resume-thread-366",
          command: null,
          details: ["provider=codex", "phase=recovering"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "timeout-resume-thread-366",
        repeated_failure_signature_count: 1,
        last_runtime_error: originalRuntimeFailureContext.summary,
        last_runtime_failure_kind: "timeout",
        last_runtime_failure_context: originalRuntimeFailureContext,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Retry already-satisfied timeout failed no-PR issue once",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.last_runtime_error, originalRuntimeFailureContext.summary);
  assert.equal(updated.last_runtime_failure_kind, "timeout");
  assert.deepEqual(updated.last_runtime_failure_context, originalRuntimeFailureContext);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 1);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_transient_retry: requeued issue #366 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence timeout",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates requeues failed no-PR issues once when allowlisted timeout evidence only exists in legacy failure fields", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
    timeoutRetryLimit: 2,
  });
  const legacyTimeoutFailureContext = {
    category: "codex" as const,
    summary: "Command timed out after 1800000ms: codex exec resume thread-366",
    signature: "timeout-resume-thread-366",
    command: null,
    details: ["provider=codex", "phase=recovering"],
    url: null,
    updated_at: "2026-03-13T00:20:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: legacyTimeoutFailureContext.summary,
        last_failure_kind: "timeout",
        last_failure_context: legacyTimeoutFailureContext,
        last_failure_signature: legacyTimeoutFailureContext.signature,
        repeated_failure_signature_count: 1,
        last_runtime_error: null,
        last_runtime_failure_kind: null,
        last_runtime_failure_context: null,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Retry already-satisfied timeout failed no-PR issue once from legacy failure fields",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(updated.last_runtime_error, legacyTimeoutFailureContext.summary);
  assert.equal(updated.last_runtime_failure_kind, "timeout");
  assert.deepEqual(updated.last_runtime_failure_context, legacyTimeoutFailureContext);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 1);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_transient_retry: requeued issue #366 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence timeout",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates does not requeue already-satisfied failed no-PR timeout records after the timeout retry budget is exhausted", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
    timeoutRetryLimit: 0,
  });
  const originalRuntimeFailureContext = {
    category: "codex" as const,
    summary: "Supervisor failed while recovering a Codex turn for issue #366.",
    signature: "recovering-timeout-thread-366",
    command: null,
    details: [
      "previous_state=reproducing",
      "workspace_dirty=no",
      "workspace_head=deadbee",
      "pr_number=none",
      "pr_head=none",
      "codex_session_id=thread-366",
    ],
    url: null,
    updated_at: "2026-03-13T00:20:05Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: "Command timed out after 1800000ms: codex exec resume thread-366",
        last_failure_kind: "timeout",
        last_failure_context: {
          category: "codex",
          summary: "Command timed out after 1800000ms: codex exec resume thread-366",
          signature: "timeout-resume-thread-366",
          command: null,
          details: ["provider=codex", "phase=recovering"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "timeout-resume-thread-366",
        repeated_failure_signature_count: 1,
        last_runtime_error: originalRuntimeFailureContext.summary,
        last_runtime_failure_kind: "timeout",
        last_runtime_failure_context: originalRuntimeFailureContext,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Do not auto-requeue already-satisfied timeout failed no-PR issue after exhausting the budget",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-already-satisfied-on-main");
  assert.match(updated.last_error ?? "", /no longer differs from origin\/main/i);
  assert.equal(updated.last_runtime_error, originalRuntimeFailureContext.summary);
  assert.equal(updated.last_runtime_failure_kind, "timeout");
  assert.deepEqual(updated.last_runtime_failure_context, originalRuntimeFailureContext);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_manual_review: blocked issue #366 after failed no-PR recovery found an open issue with no authoritative completion signal",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates blocks already-satisfied failed no-PR issues for manual review when runtime evidence is not allowlisted", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const originalRuntimeFailureContext = {
    category: "codex" as const,
    summary: "Codex exited with a non-transient repository check failure.",
    signature: "not-allowed",
    command: null,
    details: ["provider=codex", "classification=repository-check"],
    url: null,
    updated_at: "2026-03-13T00:20:05Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: originalRuntimeFailureContext.summary,
        last_failure_kind: "codex_exit",
        last_failure_context: originalRuntimeFailureContext,
        last_failure_signature: "not-allowed",
        repeated_failure_signature_count: 1,
        last_runtime_error: originalRuntimeFailureContext.summary,
        last_runtime_failure_kind: "codex_exit",
        last_runtime_failure_context: originalRuntimeFailureContext,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Fail closed when already-satisfied failed no-PR runtime evidence is not allowlisted",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-already-satisfied-on-main");
  assert.match(updated.last_error ?? "", /no longer differs from origin\/main/i);
  assert.equal(updated.last_runtime_error, originalRuntimeFailureContext.summary);
  assert.equal(updated.last_runtime_failure_kind, "codex_exit");
  assert.deepEqual(updated.last_runtime_failure_context, originalRuntimeFailureContext);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_manual_review: blocked issue #366 after failed no-PR recovery found an open issue with no authoritative completion signal",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates sends second already-satisfied transient failed no-PR recurrences to manual review", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const originalRuntimeFailureContext = {
    category: "codex" as const,
    summary: "Selected model is at capacity. Please try a different model.",
    signature: "provider-capacity",
    command: null,
    details: ["provider=codex"],
    url: null,
    updated_at: "2026-03-13T00:20:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: originalRuntimeFailureContext.summary,
        last_failure_kind: "codex_exit",
        last_failure_context: originalRuntimeFailureContext,
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        stale_stabilizing_no_pr_recovery_count: 1,
        last_runtime_error: originalRuntimeFailureContext.summary,
        last_runtime_failure_kind: "codex_exit",
        last_runtime_failure_context: originalRuntimeFailureContext,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Stop already-satisfied transient failed no-PR issue after one retry",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-already-satisfied-on-main");
  assert.equal(updated.last_runtime_error, originalRuntimeFailureContext.summary);
  assert.equal(updated.last_runtime_failure_kind, "codex_exit");
  assert.deepEqual(updated.last_runtime_failure_context, originalRuntimeFailureContext);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 1);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_manual_review: blocked issue #366 after failed no-PR recovery found an open issue with no authoritative completion signal",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates blocks failed no-PR issues for manual review when the workspace is not a registered worktree", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = path.join(workspaceRoot, "issue-366");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await runCommand("git", ["clone", repoPath, workspacePath]);
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Reject failed no-PR workspace that is not a worktree",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-manual-review-required");
  assert.match(updated.last_error ?? "", /not safe for automatic recovery/i);
  assert.deepEqual(updated.last_failure_context?.details ?? [], [
    "state=failed",
    "tracked_pr=none",
    "branch_state=manual_review_required",
    "default_branch=origin/main",
    "head_sha=unknown",
    "operator_action=inspect the preserved workspace and resolve the unsafe or ambiguous branch state before requeueing manually",
  ]);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_manual_review: blocked issue #366 after failed no-PR recovery found an unsafe or ambiguous workspace state",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates blocks failed no-PR issues for manual review when the worktree is on a different branch", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await runCommand("git", ["-C", workspacePath, "switch", "-c", "codex/other-issue-366"]);
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "meaningful change\n");
  await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
  await runCommand("git", ["-C", workspacePath, "commit", "-m", "meaningful checkpoint on wrong branch"]);

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Reject failed no-PR worktree on wrong branch",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_head_sha, baseHead);
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-manual-review-required");
  assert.match(updated.last_error ?? "", /not safe for automatic recovery/i);
  assert.deepEqual(updated.last_failure_context?.details ?? [], [
    "state=failed",
    "tracked_pr=none",
    "branch_state=manual_review_required",
    "default_branch=origin/main",
    "head_sha=unknown",
    "operator_action=inspect the preserved workspace and resolve the unsafe or ambiguous branch state before requeueing manually",
  ]);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_manual_review: blocked issue #366 after failed no-PR recovery found an unsafe or ambiguous workspace state",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates blocks failed no-PR issues for manual review when the worktree HEAD is detached", async () => {
  const { repoPath, workspaceRoot, baseHead } = await createRepositoryWithOrigin();
  const workspacePath = await createIssueWorktree({
    repoPath,
    workspaceRoot,
    issueNumber: 366,
    branch: "codex/reopen-issue-366",
  });
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# local journal\n");
  await fs.writeFile(path.join(workspacePath, "feature.txt"), "meaningful change\n");
  await runCommand("git", ["-C", workspacePath, "add", "feature.txt"]);
  await runCommand("git", ["-C", workspacePath, "commit", "-m", "meaningful checkpoint on issue branch"]);
  await runCommand("git", ["-C", workspacePath, "checkout", "--detach", "HEAD"]);

  const config = createConfig({
    repoPath,
    workspaceRoot,
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        branch: "codex/reopen-issue-366",
        workspace: workspacePath,
        journal_path: journalPath,
        pr_number: null,
        last_head_sha: baseHead,
        last_error: "Selected model is at capacity. Please try a different model.",
        last_failure_kind: "codex_exit",
        last_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "provider-capacity",
        repeated_failure_signature_count: 1,
        codex_session_id: "session-366",
      }),
    ],
  });
  const issue = createIssue({
    number: 366,
    title: "Reject failed no-PR detached worktree",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => {
        throw new Error("unexpected getPullRequestIfExists call");
      },
      getChecks: async () => {
        throw new Error("unexpected getChecks call");
      },
      getUnresolvedReviewThreads: async () => {
        throw new Error("unexpected getUnresolvedReviewThreads call");
      },
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.pr_number, null);
  assert.equal(updated.codex_session_id, null);
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_head_sha, baseHead);
  assert.equal(updated.last_failure_context?.signature, "failed-no-pr-manual-review-required");
  assert.match(updated.last_error ?? "", /not safe for automatic recovery/i);
  assert.deepEqual(updated.last_failure_context?.details ?? [], [
    "state=failed",
    "tracked_pr=none",
    "branch_state=manual_review_required",
    "default_branch=origin/main",
    "head_sha=unknown",
    "operator_action=inspect the preserved workspace and resolve the unsafe or ambiguous branch state before requeueing manually",
  ]);
  assert.equal(updated.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "failed_no_pr_manual_review: blocked issue #366 after failed no-PR recovery found an unsafe or ambiguous workspace state",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates rehydrates stale failed tracked PRs from direct issue facts when inventory refresh is degraded", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "366": createRecord({
        state: "failed",
        pr_number: 191,
        last_head_sha: "head-old-191",
        last_failure_signature: "dirty:head-old-191",
        repeated_failure_signature_count: 3,
        blocked_reason: null,
        last_error: "Stopped after repeated merge conflicts.",
        last_failure_kind: "codex_failed",
      }),
    },
  };
  const issue: GitHubIssue = {
    number: 366,
    title: "Recovery issue",
    body: "",
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:21:00Z",
    url: "https://example.test/issues/366",
    state: "OPEN",
  };
  const pr: GitHubPullRequest = {
    number: 191,
    title: "Recovery implementation",
    url: "https://example.test/pr/191",
    state: "OPEN",
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:22:00Z",
    isDraft: false,
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-new-191",
    mergeStateStatus: "CLEAN",
    reviewDecision: "CHANGES_REQUESTED",
    mergedAt: null,
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };

  let saveCalls = 0;
  let getIssueCalls = 0;
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async (issueNumber) => {
        getIssueCalls += 1;
        assert.equal(issueNumber, 366);
        return issue;
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [],
    {
      inferStateFromPullRequest: () => "addressing_review",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(getIssueCalls, 1);
  assert.equal(updated.state, "addressing_review");
  assert.equal(updated.pr_number, 191);
  assert.equal(updated.last_head_sha, "head-new-191");
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_head_advanced: resumed issue #366 from failed to addressing_review after tracked PR #191 advanced from head-old-191 to head-new-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("buildTrackedPrStaleFailureConvergencePatch isolates persisted tracked PR recovery state from recovery-event formatting", () => {
  const failureContext = {
    category: "review" as const,
    summary: "Verification still requires a human decision before the tracked PR can continue.",
    signature: "verification:human-decision",
    command: "npm test",
    details: ["suite=supervisor"],
    url: null,
    updated_at: "2026-03-13T00:25:00Z",
  };
  const record = createRecord({
    issue_number: 366,
    state: "failed",
    pr_number: 191,
    last_head_sha: "head-190",
    last_error: "Stopped after repeated test failures.",
    last_failure_kind: "codex_failed",
    last_failure_context: {
      category: "codex",
      summary: "Repair budget exhausted while waiting for PR recovery.",
      signature: "repair-budget-exhausted",
      command: null,
      details: ["attempts=3/3"],
      url: null,
      updated_at: "2026-03-13T00:20:00Z",
    },
    last_blocker_signature: "review:old",
    last_failure_signature: "verification:human-decision",
    repeated_failure_signature_count: 2,
    repeated_blocker_count: 3,
    timeout_retry_count: 2,
    blocked_verification_retry_count: 1,
  });

  const patch = buildTrackedPrStaleFailureConvergencePatch({
    record,
    pr: {
      number: 191,
      headRefOid: "head-191",
    },
    nextState: "blocked",
    failureContext,
    blockedReason: "verification",
    reviewWaitPatch: {
      review_wait_started_at: "2026-03-13T00:24:00Z",
      review_wait_head_sha: "head-191",
    },
    copilotReviewRequestObservationPatch: {
      copilot_review_requested_observed_at: "2026-03-13T00:24:30Z",
    },
    copilotReviewTimeoutPatch: {
      copilot_review_timed_out_at: null,
    },
  });

  assert.deepEqual(patch, {
    state: "blocked",
    last_error: failureContext.summary,
    last_failure_kind: null,
    last_failure_context: failureContext,
    last_blocker_signature: null,
    last_failure_signature: failureContext.signature,
    repeated_failure_signature_count: 1,
    blocked_reason: "verification",
    repeated_blocker_count: 0,
    repair_attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    pr_number: 191,
    last_head_sha: "head-191",
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
    pre_merge_evaluation_outcome: null,
    pre_merge_must_fix_count: 0,
    pre_merge_manual_review_count: 0,
    pre_merge_follow_up_count: 0,
    last_local_review_signature: null,
    repeated_local_review_signature_count: 0,
    latest_local_ci_result: null,
    provider_success_observed_at: null,
    provider_success_head_sha: null,
    external_review_head_sha: null,
    external_review_misses_path: null,
    external_review_matched_findings_count: 0,
    external_review_near_match_findings_count: 0,
    external_review_missed_findings_count: 0,
    review_follow_up_head_sha: null,
    review_follow_up_remaining: 0,
    codex_connector_review_requested_observed_at: null,
    codex_connector_review_requested_head_sha: null,
    codex_connector_review_request_retry_count: 0,
    codex_connector_review_request_retry_head_sha: null,
    codex_connector_review_request_last_retried_at: null,
    codex_connector_review_request_comment_identity_status: null,
    codex_connector_review_request_comment_database_id: null,
    codex_connector_review_request_comment_node_id: null,
    codex_connector_review_request_comment_url: null,
    last_observed_host_local_pr_blocker_signature: null,
    last_observed_host_local_pr_blocker_head_sha: null,
    last_host_local_pr_blocker_comment_signature: null,
    last_host_local_pr_blocker_comment_head_sha: null,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
    review_wait_started_at: "2026-03-13T00:24:00Z",
    review_wait_head_sha: "head-191",
    copilot_review_requested_observed_at: "2026-03-13T00:24:30Z",
    copilot_review_timed_out_at: null,
  });
});

test("reconcileStaleFailedIssueStates reclassifies stale failed tracked PRs to blocked manual_review state", async () => {
  const config = createConfig();
  const failureContext = {
    category: "review" as const,
    summary: "Manual review is required before the PR can proceed.",
    signature: "manual-review:thread-1",
    command: null,
    details: ["thread=thread-1"],
    url: "https://example.test/pr/191#discussion_r1",
    updated_at: "2026-03-13T00:25:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "failed",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: "Stopped after repeated test failures.",
        last_failure_kind: "codex_failed",
        last_failure_context: {
          category: "codex",
          summary: "The build failed repeatedly.",
          signature: "tests:red",
          command: "npm test",
          details: ["suite=supervisor"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "tests:red",
        repeated_failure_signature_count: 3,
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "blocked",
      inferFailureContext: () => failureContext,
      blockedReasonForLifecycleState: () => "manual_review",
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "manual_review");
  assert.equal(updated.last_error, failureContext.summary);
  assert.deepEqual(updated.last_failure_context, failureContext);
  assert.equal(updated.last_failure_signature, failureContext.signature);
  assert.equal(updated.repeated_failure_signature_count, 1);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from failed to blocked using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates clears stale failed tracked PR state when GitHub resumes the issue in draft_pr on the same head", async () => {
  const config = createConfig();
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: "Stopped after repeated repair attempts.",
        last_failure_kind: "codex_failed",
        last_failure_context: {
          category: "codex",
          summary: "Repair budget exhausted while waiting for PR recovery.",
          signature: "repair-budget-exhausted",
          command: null,
          details: ["attempts=3/3"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "repair-budget-exhausted",
        repeated_failure_signature_count: 3,
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
    isDraft: true,
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "draft_pr",
      inferFailureContext: () => null,
      blockedReasonForLifecycleState: () => null,
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "draft_pr");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from failed to draft_pr using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates resets repair attempts when GitHub resumes the issue in addressing_review on the same head", async () => {
  const config = createConfig({
    maxRepairAttemptsPerIssue: 2,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        issue_number: 366,
        state: "failed",
        pr_number: 191,
        last_head_sha: "head-191",
        attempt_count: 3,
        implementation_attempt_count: 1,
        repair_attempt_count: 2,
        last_error: "Stopped after repeated repair attempts.",
        last_failure_kind: "codex_failed",
        last_failure_context: {
          category: "codex",
          summary: "Repair budget exhausted while waiting for PR recovery.",
          signature: "repair-budget-exhausted",
          command: null,
          details: ["attempts=2/2"],
          url: null,
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_failure_signature: "repair-budget-exhausted",
        repeated_failure_signature_count: 3,
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
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
  });
  const reviewThreads = [createReviewThread()];

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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => reviewThreads,
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest,
      inferFailureContext,
      blockedReasonForLifecycleState,
      isOpenPullRequest,
      syncReviewWaitWindow,
      syncCopilotReviewRequestObservation,
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "addressing_review");
  assert.equal(updated.repair_attempt_count, 0);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
  assert.equal(updated.repeated_failure_signature_count, 0);
  assert.equal(
    updated.last_recovery_reason,
    "tracked_pr_lifecycle_recovered: resumed issue #366 from failed to addressing_review using fresh tracked PR #191 facts at head head-191",
  );
  assert.ok(updated.last_recovery_at);
  assert.equal(saveCalls, 1);
});

test("reconcileStaleFailedIssueStates reclassifies stale failed tracked PRs to blocked verification state", async () => {
  const config = createConfig();
  const failureContext = {
    category: "review" as const,
    summary: "Local review found high-severity issues. Manual attention is required before the PR can proceed.",
    signature: "local-review:high-severity",
    command: null,
    details: ["severity=high"],
    url: null,
    updated_at: "2026-03-13T00:25:00Z",
  };
  const state: SupervisorStateFile = createSupervisorState({
    issues: [
      createRecord({
        state: "failed",
        pr_number: 191,
        last_head_sha: "head-191",
        last_error: "Stopped after repeated test failures.",
        last_failure_kind: "codex_failed",
        timeout_retry_count: 2,
        blocked_verification_retry_count: 2,
        last_failure_signature: "tests:red",
        repeated_failure_signature_count: 3,
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

  await reconcileStaleFailedIssueStates(
    {
      getPullRequestIfExists: async () => pr,
      getChecks: async () => [],
      getUnresolvedReviewThreads: async () => [],
      closeIssue: async () => {
        throw new Error("unexpected closeIssue call");
      },
      closePullRequest: async () => {
        throw new Error("unexpected closePullRequest call");
      },
      getIssue: async () => {
        throw new Error("unexpected getIssue call");
      },
      getMergedPullRequestsClosingIssue: async () => [],
    },
    stateStore,
    state,
    config,
    [issue],
    {
      inferStateFromPullRequest: () => "blocked",
      inferFailureContext: () => failureContext,
      blockedReasonForLifecycleState: () => "verification",
      isOpenPullRequest: () => true,
      syncReviewWaitWindow: () => ({}),
      syncCopilotReviewRequestObservation: () => ({}),
      syncCopilotReviewTimeoutState: noCopilotReviewTimeoutPatch,
    },
  );

  const updated = state.issues["366"];
  assert.equal(updated.state, "blocked");
  assert.equal(updated.blocked_reason, "verification");
  assert.equal(updated.last_error, failureContext.summary);
  assert.deepEqual(updated.last_failure_context, failureContext);
  assert.equal(updated.last_failure_signature, failureContext.signature);
  assert.equal(updated.repeated_failure_signature_count, 1);
  assert.equal(updated.timeout_retry_count, 0);
  assert.equal(updated.blocked_verification_retry_count, 0);
  assert.equal(updated.last_failure_kind, null);
  assert.equal(saveCalls, 1);
});
