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

test("reconcileStaleActiveIssueReservation clears a stale reservation and emits a recovery loggable event", async () => {
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "implementing",
        codex_session_id: "session-366",
      }),
    },
  };

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

  const recoveryEvents = await reconcileStaleActiveIssueReservation({
    stateStore,
    state,
    issueLockPath: (issueNumber) => path.join(lockRoot, "locks", "issues", String(issueNumber)),
    sessionLockPath: (sessionId) => path.join(lockRoot, "locks", "sessions", String(sessionId)),
  });

  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=stale_state_cleanup: cleared stale active reservation after issue lock and session lock were missing/,
  );
});

test("reconcileStaleActiveIssueReservation does not block interrupted turns when the canonical journal mtime advanced after start", async () => {
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-interrupted-journal-"));
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", "366", "issue-journal.md");
  const trackedFilePath = path.join(workspacePath, "src", "service.ts");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.mkdir(path.dirname(trackedFilePath), { recursive: true });
  await fs.writeFile(journalPath, "# issue journal\n", "utf8");
  await fs.writeFile(trackedFilePath, "export const repair = 1;\n", "utf8");
  await fs.writeFile(
    path.join(workspacePath, ".codex-supervisor", "turn-in-progress.json"),
    `${JSON.stringify({
      issueNumber: 366,
      state: "addressing_review",
      startedAt: "2026-03-26T00:05:00.000Z",
      journalFingerprint: null,
    }, null, 2)}\n`,
    "utf8",
  );
  const afterStart = new Date("2026-03-26T00:06:00.000Z");
  await fs.utimes(journalPath, afterStart, afterStart);

  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "addressing_review",
        workspace: workspacePath,
        journal_path: journalPath,
        codex_session_id: "session-366",
        updated_at: "2026-03-26T00:00:00.000Z",
      }),
    },
  };

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-26T00:10:00.000Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileStaleActiveIssueReservation({
    stateStore,
    state,
    issueLockPath: (issueNumber) => path.join(lockRoot, "locks", "issues", String(issueNumber)),
    sessionLockPath: (sessionId) => path.join(lockRoot, "locks", "sessions", String(sessionId)),
  });

  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "addressing_review");
  assert.equal(state.issues["366"]?.blocked_reason, null);
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.match(
    state.issues["366"]?.last_recovery_reason ?? "",
    /durable_progress_evidence=journal_mtime_advanced/,
  );
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=stale_state_cleanup: cleared stale active reservation after issue lock and session lock were missing; durable_progress_evidence=journal_mtime_advanced/,
  );
  await assert.rejects(fs.access(path.join(workspacePath, ".codex-supervisor", "turn-in-progress.json")));
});

test("reconcileStaleActiveIssueReservation uses the canonical local journal when persisted journal_path points to another host", async () => {
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-interrupted-journal-host-migrate-"));
  const workspaceRoot = path.join(rootPath, "workspaces");
  const workspacePath = path.join(workspaceRoot, "issue-366");
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", "366", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(path.join(workspacePath, ".git"), "gitdir: /tmp/fake\n", "utf8");
  await fs.writeFile(journalPath, "# issue journal\n", "utf8");
  await fs.writeFile(
    path.join(workspacePath, ".codex-supervisor", "turn-in-progress.json"),
    `${JSON.stringify({
      issueNumber: 366,
      state: "addressing_review",
      startedAt: "2026-03-26T00:05:00.000Z",
      journalFingerprint: null,
    }, null, 2)}\n`,
    "utf8",
  );
  const afterStart = new Date("2026-03-26T00:06:00.000Z");
  await fs.utimes(journalPath, afterStart, afterStart);

  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "addressing_review",
        workspace: workspacePath,
        journal_path: "/tmp/other-host/issue-366/.codex-supervisor/issues/366/issue-journal.md",
        codex_session_id: "session-366",
        updated_at: "2026-03-26T00:00:00.000Z",
      }),
    },
  };

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-26T00:10:00.000Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileStaleActiveIssueReservation({
    config: createConfig({
      workspaceRoot,
      issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
    }),
    stateStore,
    state,
    issueLockPath: (issueNumber) => path.join(lockRoot, "locks", "issues", String(issueNumber)),
    sessionLockPath: (sessionId) => path.join(lockRoot, "locks", "sessions", String(sessionId)),
  });

  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "addressing_review");
  assert.equal(state.issues["366"]?.blocked_reason, null);
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.match(
    state.issues["366"]?.last_recovery_reason ?? "",
    /durable_progress_evidence=journal_mtime_advanced/,
  );
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=stale_state_cleanup: cleared stale active reservation after issue lock and session lock were missing; durable_progress_evidence=journal_mtime_advanced/,
  );
});

test("reconcileStaleActiveIssueReservation blocks interrupted turns when the canonical journal mtime only matches start time", async () => {
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-interrupted-journal-"));
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", "366", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# issue journal\n", "utf8");
  await fs.writeFile(
    path.join(workspacePath, ".codex-supervisor", "turn-in-progress.json"),
    `${JSON.stringify({
      issueNumber: 366,
      state: "addressing_review",
      startedAt: "2026-03-26T00:05:00.000Z",
      journalFingerprint: null,
    }, null, 2)}\n`,
    "utf8",
  );
  const startTime = new Date("2026-03-26T00:05:00.000Z");
  await fs.utimes(journalPath, startTime, startTime);

  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "addressing_review",
        workspace: workspacePath,
        journal_path: journalPath,
        codex_session_id: "session-366",
        updated_at: "2026-03-26T00:05:00.000Z",
      }),
    },
  };

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-26T00:10:00.000Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileStaleActiveIssueReservation({
    stateStore,
    state,
    issueLockPath: (issueNumber) => path.join(lockRoot, "locks", "issues", String(issueNumber)),
    sessionLockPath: (sessionId) => path.join(lockRoot, "locks", "sessions", String(sessionId)),
  });

  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.blocked_reason, "handoff_missing");
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.match(
    state.issues["366"]?.last_failure_context?.details?.join("\n") ?? "",
    /durable_progress_evidence=journal_unchanged/,
  );
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=interrupted_turn_recovery: blocked issue #366 after an in-progress Codex turn ended without a durable handoff/,
  );
  await assert.rejects(fs.access(path.join(workspacePath, ".codex-supervisor", "turn-in-progress.json")));
});

test("reconcileStaleActiveIssueReservation reports interrupted-turn progress as unverifiable when timestamps cannot be compared", async () => {
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-interrupted-journal-"));
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", "366", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, "# issue journal\n", "utf8");
  await fs.writeFile(
    path.join(workspacePath, ".codex-supervisor", "turn-in-progress.json"),
    `${JSON.stringify({
      issueNumber: 366,
      state: "addressing_review",
      startedAt: "not-a-timestamp",
      journalFingerprint: null,
    }, null, 2)}\n`,
    "utf8",
  );

  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "addressing_review",
        workspace: workspacePath,
        journal_path: journalPath,
        codex_session_id: "session-366",
        updated_at: "2026-03-26T00:05:00.000Z",
      }),
    },
  };

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
      return {
        ...record,
        ...patch,
        updated_at: "2026-03-26T00:10:00.000Z",
      };
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileStaleActiveIssueReservation({
    stateStore,
    state,
    issueLockPath: (issueNumber) => path.join(lockRoot, "locks", "issues", String(issueNumber)),
    sessionLockPath: (sessionId) => path.join(lockRoot, "locks", "sessions", String(sessionId)),
  });

  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.blocked_reason, "handoff_missing");
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.match(
    state.issues["366"]?.last_failure_context?.details?.join("\n") ?? "",
    /durable_progress_evidence=progress_unverifiable/,
  );
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  await assert.rejects(fs.access(path.join(workspacePath, ".codex-supervisor", "turn-in-progress.json")));
});

test("reconcileStaleActiveIssueReservation requeues a stale stabilizing issue without a tracked PR", async () => {
  const config = createConfig();
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "stabilizing",
        pr_number: null,
        codex_session_id: "session-366",
        implementation_attempt_count: 0,
      }),
    },
  };

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

  const recoveryEvents = await reconcileStaleActiveIssueReservation({
    stateStore,
    state,
    issueLockPath: (issueNumber) => path.join(lockRoot, "locks", "issues", String(issueNumber)),
    sessionLockPath: (sessionId) => path.join(lockRoot, "locks", "sessions", String(sessionId)),
    sameFailureSignatureRepeatLimit: config.sameFailureSignatureRepeatLimit,
  });

  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "queued");
  assert.equal(state.issues["366"]?.pr_number, null);
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.equal(state.issues["366"]?.last_failure_signature, "stale-stabilizing-no-pr-recovery-loop");
  assert.equal(state.issues["366"]?.stale_stabilizing_no_pr_recovery_count, 1);
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=stale_state_cleanup: requeued stabilizing issue #366 after issue lock and session lock were missing/,
  );
});

test("reconcileStaleActiveIssueReservation clears a stale reservation pointer for terminal records without mutating the record", async () => {
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "done",
        codex_session_id: null,
        last_error: null,
      }),
    },
  };

  let saveCalls = 0;
  const stateStore = {
    touch(record: IssueRunRecord): IssueRunRecord {
      return record;
    },
    async save(): Promise<void> {
      saveCalls += 1;
    },
  };

  const recoveryEvents = await reconcileStaleActiveIssueReservation({
    stateStore,
    state,
    issueLockPath: (issueNumber) => path.join(lockRoot, "locks", "issues", String(issueNumber)),
    sessionLockPath: (sessionId) => path.join(lockRoot, "locks", "sessions", String(sessionId)),
  });

  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "done");
  assert.equal(state.issues["366"]?.last_error, null);
  assert.equal(saveCalls, 1);
  assert.deepEqual(recoveryEvents, []);
});

test("reconcileStaleActiveIssueReservation does not clear reservations for ambiguous owner locks", async () => {
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "implementing",
        codex_session_id: "session-366",
      }),
    },
  };

  const issueLockPath = path.join(lockRoot, "locks", "issues", "366");
  const sessionLockPath = path.join(lockRoot, "locks", "sessions", "session-366");
  await fs.mkdir(path.dirname(issueLockPath), { recursive: true });
  await fs.mkdir(path.dirname(sessionLockPath), { recursive: true });
  await fs.writeFile(
    issueLockPath,
    `${JSON.stringify({
      pid: 999_999,
      label: "issue-366",
      acquired_at: "2026-03-20T00:00:00.000Z",
      host: "other-host",
      owner: "other-user",
    }, null, 2)}\n`,
    "utf8",
  );

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

  const recoveryEvents = await reconcileStaleActiveIssueReservation({
    stateStore,
    state,
    issueLockPath: () => issueLockPath,
    sessionLockPath: () => sessionLockPath,
  });

  assert.equal(state.activeIssueNumber, 366);
  assert.equal(state.issues["366"]?.codex_session_id, "session-366");
  assert.equal(saveCalls, 0);
  assert.deepEqual(recoveryEvents, []);
});

test("reconcileStaleActiveIssueReservation clears stale no-PR failure tracking after PR context is recovered", async () => {
  const config = createConfig();
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "stabilizing",
        pr_number: 191,
        codex_session_id: "session-366",
        implementation_attempt_count: 2,
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
            "repeat_count=1/3",
            "operator_action=confirm whether the implementation already landed elsewhere or retarget the tracked issue manually",
          ],
          url: null,
          updated_at: "2026-03-11T06:00:00.000Z",
        },
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
        repeated_failure_signature_count: 1,
        stale_stabilizing_no_pr_recovery_count: 1,
      }),
    },
  };
  const matchedPullRequest: GitHubPullRequest = {
    number: 191,
    title: "Recovered tracked PR",
    url: "https://example.test/pr/191",
    state: "OPEN",
    createdAt: "2026-03-11T05:50:00Z",
    updatedAt: "2026-03-11T06:10:00Z",
    isDraft: false,
    headRefName: "codex/reopen-issue-366",
    headRefOid: "head-191",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    mergedAt: null,
    copilotReviewState: null,
    copilotReviewRequestedAt: null,
    copilotReviewArrivedAt: null,
  };

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

  const recoveryEvents = await reconcileStaleActiveIssueReservation({
    stateStore,
    state,
    issueLockPath: (issueNumber) => path.join(lockRoot, "locks", "issues", String(issueNumber)),
    sessionLockPath: (sessionId) => path.join(lockRoot, "locks", "sessions", String(sessionId)),
    sameFailureSignatureRepeatLimit: config.sameFailureSignatureRepeatLimit,
    resolvePullRequestForBranch: async (branch, trackedPrNumber) => {
      assert.equal(branch, "codex/reopen-issue-366");
      assert.equal(trackedPrNumber, 191);
      return matchedPullRequest;
    },
  });

  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "stabilizing");
  assert.equal(state.issues["366"]?.pr_number, 191);
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.equal(state.issues["366"]?.last_error, null);
  assert.equal(state.issues["366"]?.last_failure_context, null);
  assert.equal(state.issues["366"]?.last_failure_signature, null);
  assert.equal(state.issues["366"]?.repeated_failure_signature_count, 0);
  assert.equal(state.issues["366"]?.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=stale_state_cleanup: cleared stale active reservation after issue lock and session lock were missing/,
  );
});

test("reconcileStaleActiveIssueReservation blocks repeated stale stabilizing no-PR records at the retry limit", async () => {
  const config = createConfig();
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "stabilizing",
        pr_number: null,
        codex_session_id: "session-366",
        implementation_attempt_count: 2,
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
        repeated_failure_signature_count: config.sameFailureSignatureRepeatLimit - 1,
        stale_stabilizing_no_pr_recovery_count: config.sameFailureSignatureRepeatLimit - 1,
      }),
    },
  };

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

  const recoveryEvents = await reconcileStaleActiveIssueReservation({
    stateStore,
    state,
    issueLockPath: (issueNumber) => path.join(lockRoot, "locks", "issues", String(issueNumber)),
    sessionLockPath: (sessionId) => path.join(lockRoot, "locks", "sessions", String(sessionId)),
    sameFailureSignatureRepeatLimit: config.sameFailureSignatureRepeatLimit,
  });

  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.pr_number, null);
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.equal(state.issues["366"]?.blocked_reason, "manual_review");
  assert.equal(
    state.issues["366"]?.last_failure_signature,
    "stale-stabilizing-no-pr-recovery-loop",
  );
  assert.equal(state.issues["366"]?.repeated_failure_signature_count, 0);
  assert.equal(
    state.issues["366"]?.stale_stabilizing_no_pr_recovery_count,
    config.sameFailureSignatureRepeatLimit,
  );
  assert.match(
    state.issues["366"]?.last_error ?? "",
    /re-entered stale stabilizing recovery without a tracked PR 3 times; manual intervention is required/,
  );
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=stale_state_manual_stop: blocked issue #366 after repeated stale stabilizing recovery without a tracked PR/,
  );
});

test("reconcileStaleActiveIssueReservation blocks already-satisfied-on-main stale stabilizing records for manual review", async () => {
  const config = createConfig();
  const lockRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-supervisor-locks-"));
  const state: SupervisorStateFile = {
    activeIssueNumber: 366,
    issues: {
      "366": createRecord({
        issue_number: 366,
        state: "stabilizing",
        pr_number: null,
        codex_session_id: "session-366",
        implementation_attempt_count: 2,
        last_failure_signature: "stale-stabilizing-no-pr-recovery-loop",
        repeated_failure_signature_count: 1,
        stale_stabilizing_no_pr_recovery_count: 1,
      }),
    },
  };

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

  const recoveryEvents = await reconcileStaleActiveIssueReservation({
    stateStore,
    state,
    issueLockPath: (issueNumber) => path.join(lockRoot, "locks", "issues", String(issueNumber)),
    sessionLockPath: (sessionId) => path.join(lockRoot, "locks", "sessions", String(sessionId)),
    sameFailureSignatureRepeatLimit: config.sameFailureSignatureRepeatLimit,
    classifyStaleStabilizingNoPrBranchState: async (record) => {
      assert.equal(record.issue_number, 366);
      return "already_satisfied_on_main";
    },
  });

  assert.equal(state.activeIssueNumber, null);
  assert.equal(state.issues["366"]?.state, "blocked");
  assert.equal(state.issues["366"]?.pr_number, null);
  assert.equal(state.issues["366"]?.codex_session_id, null);
  assert.equal(state.issues["366"]?.blocked_reason, "manual_review");
  assert.match(
    state.issues["366"]?.last_error ?? "",
    /preserved branch no longer differs from origin\/main/,
  );
  assert.equal(state.issues["366"]?.last_failure_kind, null);
  assert.equal(state.issues["366"]?.last_failure_context?.signature, "failed-no-pr-already-satisfied-on-main");
  assert.deepEqual(state.issues["366"]?.last_failure_context?.details ?? [], [
    "state=stabilizing",
    "tracked_pr=none",
    "github_issue_state=OPEN",
    "branch_state=already_satisfied_on_main",
    "default_branch=origin/main",
    "completion_evidence=missing",
    "operator_action=confirm whether the issue should be requeued or whether completion landed outside the tracked PR flow",
  ]);
  assert.equal(state.issues["366"]?.last_failure_signature, null);
  assert.equal(state.issues["366"]?.repeated_failure_signature_count, 0);
  assert.equal(state.issues["366"]?.stale_stabilizing_no_pr_recovery_count, 0);
  assert.equal(saveCalls, 1);
  assert.equal(recoveryEvents.length, 1);
  assert.match(
    formatRecoveryLog(recoveryEvents) ?? "",
    /recovery issue=#366 reason=stale_stabilizing_no_pr_manual_review: blocked issue #366 after stale stabilizing recovery found the preserved branch already satisfied on origin\/main with no authoritative completion signal/,
  );
});
