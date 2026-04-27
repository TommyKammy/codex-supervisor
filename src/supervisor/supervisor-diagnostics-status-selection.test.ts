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
  clearCurrentReconciliationPhase,
  writeCurrentReconciliationPhase,
} from "./supervisor-reconciliation-phase";

test("doctor uses the diagnostic-only state loader instead of StateStore.load", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  await fs.writeFile(fixture.stateFile, "{not-json}\n", "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
  };

  const stateStore = (supervisor as unknown as { stateStore: StateStore }).stateStore;
  stateStore.load = async () => {
    throw new Error("StateStore.load should not be used by doctor");
  };

  const diagnostics = await supervisor.doctorReport();
  assert.equal(diagnostics.overallStatus, "fail");
  assert.equal(diagnostics.checks.find((check) => check.name === "state_file")?.status, "fail");

  const report = await supervisor.doctor();

  assert.match(report, /doctor_check name=github_auth status=pass/);
  assert.match(report, /doctor_check name=state_file status=fail/);
  assert.match(report, /doctor_check name=worktrees status=pass/);
});

test("status surfaces corrupted JSON state as an explicit hard diagnostic", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  await fs.writeFile(fixture.stateFile, "{not-json}\n", "utf8");

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
    /state_diagnostic severity=hard backend=json summary=corrupted_json_state_forced_empty_fallback_not_missing_bootstrap findings=1 location=.*state\.json/,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /state_load_finding backend=json scope=state_file issue_number=none location=.*state\.json message=/,
  );
  assert.equal(report.warning, null);

  const status = await supervisor.status();
  assert.match(
    status,
    /state_diagnostic severity=hard backend=json summary=corrupted_json_state_forced_empty_fallback_not_missing_bootstrap findings=1 location=.*state\.json/,
  );
  assert.match(status, /state_load_finding backend=json scope=state_file issue_number=none location=.*state\.json message=/);
  assert.match(status, /^No active issue\.$/m);
});

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

test("status surfaces the default trust posture and execution-safety warning", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();

  assert.deepEqual(report.trustDiagnostics, {
    trustMode: "trusted_repo_and_authors",
    executionSafetyMode: "unsandboxed_autonomous",
    warning:
      "Unsandboxed autonomous execution assumes trusted GitHub-authored inputs; confirm this explicit setup trust posture before starting autonomous execution.",
    configWarning:
      "Active config still uses legacy shared issue journal path .codex-supervisor/issue-journal.md; prefer .codex-supervisor/issues/{issueNumber}/issue-journal.md.",
  });

  const status = await supervisor.status();
  assert.match(status, /trust_mode=trusted_repo_and_authors/);
  assert.match(status, /execution_safety_mode=unsandboxed_autonomous/);
  assert.match(
    status,
    /execution_safety_warning=Unsandboxed autonomous execution assumes trusted GitHub-authored inputs; confirm this explicit setup trust posture before starting autonomous execution\./,
  );
  assert.match(
    status,
    /config_warning=Active config still uses legacy shared issue journal path \.codex-supervisor\/issue-journal\.md; prefer \.codex-supervisor\/issues\/\{issueNumber\}\/issue-journal\.md\./,
  );
});

test("status reports effective Codex routing for inherited defaults and explicit overrides", async (t) => {
  const fixture = await createSupervisorFixture();
  const codexHome = path.join(path.dirname(fixture.repoPath), "codex-home");
  const previousCodexHome = process.env.CODEX_HOME;
  t.after(async () => {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(codexHome, "config.toml"), 'model = "gpt-5.4"\n', "utf8");
  process.env.CODEX_HOME = codexHome;

  const issueNumber = 144;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch,
        pr_number: 244,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor({
    ...fixture.config,
    codexModelStrategy: "inherit",
    boundedRepairModelStrategy: "alias",
    boundedRepairModel: "gpt-5.4-mini",
    localReviewModelStrategy: "alias",
    localReviewModel: "local-review-fast",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    resolvePullRequestForBranch: async () => createPullRequest({ number: 244, headRefName: branch }),
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getIssue: async () => ({
      number: issueNumber,
      title: "Surface effective Codex policy",
      body: executionReadyBody("Surface effective Codex policy"),
      createdAt: "2026-03-11T00:00:00Z",
      updatedAt: "2026-03-11T00:00:00Z",
      url: `https://example.test/issues/${issueNumber}`,
      state: "OPEN",
    } satisfies GitHubIssue),
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /codex_execution_policy active=supervisor:alias:gpt-5\.4-mini@bounded_repair_override reasoning=high/,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /codex_route_overrides repair=alias:gpt-5\.4-mini@bounded_repair_override local_review=alias:local-review-fast@local_review_override/,
  );

  const status = renderSupervisorStatusDto(report);
  assert.match(status, /codex_execution_policy active=supervisor:alias:gpt-5\.4-mini@bounded_repair_override reasoning=high/);
});

test("status reports bootstrap repos as not ready for expected CI and review signals", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 144;
  const prNumber = 244;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "draft_pr",
        branch,
        pr_number: prNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor({
    ...fixture.config,
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  const pr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    isDraft: true,
    reviewDecision: "REVIEW_REQUIRED",
    copilotReviewState: "not_requested",
    currentHeadCiGreenAt: null,
    configuredBotCurrentHeadObservedAt: null,
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => pr,
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();
  assert.match(
    status,
    /^external_signal_readiness status=repo_not_ready_for_expected_signals ci=repo_not_configured review=repo_not_configured workflows=absent$/m,
  );
});

test("status surfaces host-migration path repair and journal rehydration from the canonical local journal", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 145;
  const branch = branchName(fixture.config, issueNumber);
  const workspacePath = path.join(fixture.workspaceRoot, `issue-${issueNumber}`);
  const journalPath = path.join(workspacePath, ".codex-supervisor", "issues", String(issueNumber), "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(path.join(workspacePath, ".git"), "gitdir: /tmp/fake\n", "utf8");
  await fs.writeFile(
    journalPath,
    `# Issue #145: Host migration

## Supervisor Snapshot
- Updated at: 2026-04-17T00:10:00Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Current blocker: No blocker.
- Next exact step: Resume focused verification from the local worktree.

### Scratchpad
- Journal rehydration note: this journal was rehydrated on this host because the prior local-only handoff journal was unavailable.
`,
    "utf8",
  );

  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "reproducing",
        branch,
        workspace: `/tmp/other-host/issue-${issueNumber}`,
        journal_path: `/tmp/other-host/issue-${issueNumber}/.codex-supervisor/issues/${issueNumber}/issue-journal.md`,
        blocked_reason: null,
        last_error: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor({
    ...fixture.config,
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => ({
      number: issueNumber,
      title: "Host migration diagnostics",
      body: executionReadyBody("Surface host migration diagnostics in status."),
      createdAt: "2026-04-17T00:00:00Z",
      updatedAt: "2026-04-17T00:00:00Z",
      url: `https://example.test/issues/${issueNumber}`,
      labels: [],
      state: "OPEN",
    } satisfies GitHubIssue),
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    resolvePullRequestForBranch: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getPullRequestIfExists: async () => null,
  };

  const status = await supervisor.status();

  assert.match(
    status,
    /^handoff_summary=next: Resume focused verification from the local worktree\.$/m,
  );
  assert.match(
    status,
    /^issue_host_paths issue=#145 workspace=auto_repaired journal_path=auto_repaired guidance=no_manual_action_required$/m,
  );
  assert.match(
    status,
    /^issue_journal_state issue=#145 status=rehydrated guidance=no_manual_action_required detail=prior_local_only_handoff_unavailable$/m,
  );
  assert.match(
    status,
    /^status_warning=Tracked work is active for issue #145, but the supervisor loop is off\. Restart the supported loop host; expect loop_runtime state=running before issue #145 advances\.$/m,
  );
});

test("status does not warn for issue-scoped or custom issue journal paths", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const githubStub = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const issueScopedSupervisor = new Supervisor({
    ...fixture.config,
    issueJournalRelativePath: ".codex-supervisor/issues/{issueNumber}/issue-journal.md",
  });
  (issueScopedSupervisor as unknown as { github: Record<string, unknown> }).github = githubStub;
  const issueScopedStatus = await issueScopedSupervisor.status();
  assert.doesNotMatch(issueScopedStatus, /config_warning=/);

  const customPathSupervisor = new Supervisor({
    ...fixture.config,
    issueJournalRelativePath: ".codex-supervisor/custom/issue-{issueNumber}.md",
  });
  (customPathSupervisor as unknown as { github: Record<string, unknown> }).github = githubStub;
  const customPathStatus = await customPathSupervisor.status();
  assert.doesNotMatch(customPathStatus, /config_warning=/);
});

test("renderSupervisorStatusDto appends canonical github rate-limit lines from dto.githubRateLimit", () => {
  const status = renderSupervisorStatusDto({
    gsdSummary: null,
    githubRateLimit: {
      rest: {
        resource: "core",
        limit: 5000,
        remaining: 75,
        resetAt: "2026-03-27T00:30:00.000Z",
        state: "low",
      },
      graphql: {
        resource: "graphql",
        limit: 5000,
        remaining: 0,
        resetAt: "2026-03-27T00:15:00.000Z",
        state: "exhausted",
      },
    },
    candidateDiscovery: null,
    loopRuntime: {
      state: "off",
      hostMode: "unknown",
      markerPath: "/tmp/locks/supervisor/loop-runtime.lock",
      configPath: "/tmp/supervisor.config.json",
      stateFile: "/tmp/state.json",
      pid: null,
      startedAt: null,
      ownershipConfidence: "none",
      detail: null,
    },
    activeIssue: null,
    selectionSummary: null,
    trackedIssues: [],
    runnableIssues: [],
    blockedIssues: [],
    detailedStatusLines: [],
    reconciliationPhase: null,
    reconciliationWarning: null,
    readinessLines: [],
    whyLines: [],
    warning: null,
  });

  assert.match(status, /^github_rate_limit resource=rest status=low remaining=75 limit=5000 reset_at=2026-03-27T00:30:00.000Z$/m);
  assert.match(status, /^github_rate_limit resource=graphql status=exhausted remaining=0 limit=5000 reset_at=2026-03-27T00:15:00.000Z$/m);
});

test("renderSupervisorStatusDto maps provider outage diagnostics to an operator action token", () => {
  const status = renderSupervisorStatusDto({
    gsdSummary: null,
    candidateDiscovery: null,
    loopRuntime: {
      state: "running",
      hostMode: "tmux",
      runMode: "macos_tmux_loop",
      markerPath: "/tmp/locks/supervisor/loop-runtime.lock",
      configPath: "/tmp/supervisor.config.json",
      stateFile: "/tmp/state.json",
      pid: 4242,
      startedAt: "2026-03-27T00:15:00.000Z",
      ownershipConfidence: "live_lock",
      detail: "supervisor-loop-runtime",
    },
    activeIssue: null,
    selectionSummary: null,
    trackedIssues: [],
    runnableIssues: [],
    blockedIssues: [],
    detailedStatusLines: [
      "review_bot_diagnostics status=provider_outage_suspected observed_review=none expected_reviewers=coderabbitai next_check=wait_or_provider_setup_or_manual_review recent_observation=required_checks_green:2026-03-16T00:10:00.000Z recoverability=provider_outage_suspected",
    ],
    reconciliationPhase: null,
    reconciliationWarning: null,
    readinessLines: [],
    whyLines: [],
    warning: null,
  });

  assert.match(
    status,
    /^operator_action action=provider_outage_suspected source=review_bot_diagnostics priority=70 summary=The configured review provider has not reported on the current head after checks turned green; wait, verify provider delivery, or escalate to manual review\.$/m,
  );
});

test("renderSupervisorStatusDto maps stale configured-bot remediation to the root operator action", () => {
  const status = renderSupervisorStatusDto({
    gsdSummary: null,
    candidateDiscovery: null,
    loopRuntime: {
      state: "running",
      hostMode: "tmux",
      runMode: "macos_tmux_loop",
      markerPath: "/tmp/locks/supervisor/loop-runtime.lock",
      configPath: "/tmp/supervisor.config.json",
      stateFile: "/tmp/state.json",
      pid: 4242,
      startedAt: "2026-03-27T00:15:00.000Z",
      ownershipConfidence: "live_lock",
      detail: "supervisor-loop-runtime",
    },
    activeIssue: null,
    selectionSummary: null,
    trackedIssues: [],
    runnableIssues: [],
    blockedIssues: [],
    detailedStatusLines: [
      "stale_review_bot_remediation issue=#366 pr=#44 reason=stale_review_bot code_ci=green current_head_sha=deadbeef processed_on_current_head=yes classification=unresolved_work review_thread_url=https://example.test/pr/44#discussion_r44 manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note summary=code_or_ci_green_but_review_thread_metadata_unresolved",
    ],
    reconciliationPhase: null,
    reconciliationWarning: null,
    readinessLines: [],
    whyLines: [],
    warning: null,
  });

  assert.match(
    status,
    /^operator_action action=resolve_stale_review_bot source=stale_review_bot_remediation priority=72 summary=Code or CI is green but configured-bot review thread metadata is still unresolved; inspect the exact thread and resolve it or leave a manual note without changing merge policy\.$/m,
  );
});

test("status --why classifies current-head processed configured-bot success as stale metadata remediation while idle", async (t) => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = ["coderabbitai", "coderabbitai[bot]"];
  const issueNumber = 365;
  const prNumber = 372;
  const headSha = "5de0d3844468d4a77cab512f8dcbe46171166c3a";
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: "codex/issue-365",
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "stale_review_bot",
        last_head_sha: headSha,
        processed_review_thread_ids: [`thread-365@${headSha}`],
        processed_review_thread_fingerprints: [`thread-365@${headSha}#comment-365`],
        last_failure_signature: "stalled-bot:thread-365",
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:thread-365",
          command: null,
          details: ["reviewer=coderabbitai[bot] file=src/query.ts line=12 processed_on_current_head=yes"],
          url: "https://example.test/pr/372#discussion_r365",
          updated_at: "2026-04-25T00:20:00Z",
        },
        updated_at: "2026-04-25T07:20:00Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "SafeQuery shaped stale configured bot metadata",
    body: executionReadyBody("Classify stale configured-bot metadata precisely while idle."),
    createdAt: "2026-04-25T00:00:00Z",
    updatedAt: "2026-04-25T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: prNumber,
    headRefName: "codex/issue-365",
    headRefOid: headSha,
    currentHeadCiGreenAt: "2026-04-25T00:10:00Z",
    configuredBotCurrentHeadObservedAt: "2026-04-25T00:11:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const staleMetadataThread = {
    id: "thread-365",
    isResolved: false,
    isOutdated: false,
    path: "src/query.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-365",
          body: "Please address this stale finding.",
          createdAt: "2026-04-25T00:05:00Z",
          url: "https://example.test/pr/372#discussion_r365",
          author: {
            login: "coderabbitai[bot]",
            typeName: "Bot",
          },
        },
      ],
    },
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [staleMetadataThread],
  };

  const status = await supervisor.status({ why: true });

  assert.match(status, /^No active issue\.$/m);
  assert.match(
    status,
    /^no_active_tracked_record issue=#365 classification=stale_review_bot_remediation state=blocked reason=metadata_only$/m,
  );
  assert.match(
    status,
    /^stale_review_bot_remediation issue=#365 pr=#372 reason=stale_review_bot code_ci=green current_head_sha=5de0d3844468d4a77cab512f8dcbe46171166c3a processed_on_current_head=yes classification=metadata_only review_thread_url=https:\/\/example\.test\/pr\/372#discussion_r365 manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note summary=stale_configured_bot_thread_metadata_only$/m,
  );
  assert.match(status, /^operator_action action=resolve_stale_review_bot /m);
  assert.doesNotMatch(status, /provider_outage_suspected/);
  assert.doesNotMatch(status, /stale_review_bot_provider_signal_missing/);
});

test("renderSupervisorStatusDto sanitizes loop runtime host and timestamp tokens", () => {
  const status = renderSupervisorStatusDto({
    gsdSummary: null,
    candidateDiscovery: null,
    loopRuntime: {
      state: "running",
      hostMode: "direct\nlegacy" as unknown as "direct",
      markerPath: "/tmp/locks/supervisor/loop-runtime.lock\nlegacy",
      configPath: "/tmp/supervisor.config.json\nlegacy",
      stateFile: "/tmp/state.json\nlegacy",
      pid: 4242,
      startedAt: "2026-03-27T00:15:00.000Z\nlegacy",
      ownershipConfidence: "duplicate_suspected",
      detail: "supervisor-loop-runtime",
      recoveryGuidance:
        "Safe recovery: for config /tmp/supervisor.config.json, stop the tmux-managed loop with ./scripts/stop-loop-tmux.sh, inspect the listed direct loop PIDs before stopping any process, then restart with ./scripts/start-loop-tmux.sh using the same config.",
      duplicateLoopDiagnostic: {
        kind: "duplicate_loop_processes",
        status: "duplicate",
        matchingProcessCount: 2,
        matchingPids: [4242, 4243],
        configPath: "/tmp/supervisor.config.json",
        stateFile: "/tmp/state.json",
        recoveryGuidance:
          "Safe recovery: for config /tmp/supervisor.config.json, stop the tmux-managed loop with ./scripts/stop-loop-tmux.sh, inspect the listed direct loop PIDs before stopping any process, then restart with ./scripts/start-loop-tmux.sh using the same config.",
      },
    },
    activeIssue: null,
    selectionSummary: null,
    trackedIssues: [],
    runnableIssues: [],
    blockedIssues: [],
    detailedStatusLines: [],
    reconciliationPhase: null,
    reconciliationWarning: null,
    readinessLines: [],
    whyLines: [],
    warning: null,
  });

  assert.match(
    status,
    /^loop_runtime state=running host_mode=direct\\nlegacy run_mode=unknown marker_path=\/tmp\/locks\/supervisor\/loop-runtime\.lock\\nlegacy config_path=\/tmp\/supervisor\.config\.json\\nlegacy state_file=\/tmp\/state\.json\\nlegacy pid=4242 started_at=2026-03-27T00:15:00.000Z\\nlegacy ownership_confidence=duplicate_suspected detail=supervisor-loop-runtime$/m,
  );
  assert.match(
    status,
    /^loop_runtime_diagnostic kind=duplicate_loop_processes status=duplicate matching_processes=2 pids=4242,4243 config_path=\/tmp\/supervisor.config.json state_file=\/tmp\/state.json recovery=Safe recovery: for config \/tmp\/supervisor.config.json, stop the tmux-managed loop with \.\/scripts\/stop-loop-tmux\.sh, inspect the listed direct loop PIDs before stopping any process, then restart with \.\/scripts\/start-loop-tmux\.sh using the same config\.$/m,
  );
  assert.match(
    status,
    /^loop_runtime_recovery guidance=Safe recovery: for config \/tmp\/supervisor.config.json, stop the tmux-managed loop with \.\/scripts\/stop-loop-tmux\.sh, inspect the listed direct loop PIDs before stopping any process, then restart with \.\/scripts\/start-loop-tmux\.sh using the same config\.$/m,
  );
});

test("status omits execution-safety warnings when the trust posture does not require one", async (t) => {
  const fixture = await createSupervisorFixture();
  fixture.config.trustMode = "untrusted_or_mixed";
  fixture.config.executionSafetyMode = "operator_gated";
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();

  assert.deepEqual(report.trustDiagnostics, {
    trustMode: "untrusted_or_mixed",
    executionSafetyMode: "operator_gated",
    warning: null,
    configWarning:
      "Active config still uses legacy shared issue journal path .codex-supervisor/issue-journal.md; prefer .codex-supervisor/issues/{issueNumber}/issue-journal.md.",
  });

  const status = await supervisor.status();
  assert.match(status, /trust_mode=untrusted_or_mixed/);
  assert.match(status, /execution_safety_mode=operator_gated/);
  assert.doesNotMatch(status, /execution_safety_warning=/);
});

test("status reports degraded full inventory refresh and suppresses readiness selection work", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
    inventory_refresh_failure: {
      source: "gh issue list",
      message: "Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1",
      recorded_at: "2026-03-26T00:00:00Z",
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => {
      throw new Error("unexpected listCandidateIssues call");
    },
    listAllIssues: async () => {
      throw new Error("unexpected listAllIssues call");
    },
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport({ why: true });

  assert.match(report.detailedStatusLines.join("\n"), /^inventory_refresh=degraded source=gh issue list recorded_at=2026-03-26T00:00:00Z message=Failed to parse JSON from gh issue list: Unexpected token \] in JSON at position 1$/m);
  assert.equal(report.selectionSummary, null);
  assert.equal(report.warning?.kind, "readiness");
  assert.match(report.warning?.message ?? "", /Full inventory refresh is degraded/);

  const status = await supervisor.status({ why: true });
  assert.match(status, /^inventory_refresh=degraded source=gh issue list recorded_at=2026-03-26T00:00:00Z message=Failed to parse JSON from gh issue list: Unexpected token \] in JSON at position 1$/m);
  assert.match(status, /^readiness_warning=Full inventory refresh is degraded\./m);
});

test("status reports last-known-good inventory snapshot diagnostics during degraded mode without re-enabling selection", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
        branch: branchName(fixture.config, 91),
        workspace: path.join(fixture.workspaceRoot, "issue-91"),
        journal_path: null,
      }),
    },
    inventory_refresh_failure: {
      source: "gh issue list",
      message: "Failed to parse JSON from gh issue list: Unexpected token ] in JSON at position 1",
      recorded_at: "2026-03-26T00:10:00Z",
    },
    last_successful_inventory_snapshot: {
      source: "gh issue list",
      recorded_at: "2026-03-26T00:05:00Z",
      issue_count: 2,
      issues: [
        {
          number: 91,
          title: "Already completed prerequisite",
          body: "## Summary\nCompleted prerequisite.",
          createdAt: "2026-03-26T00:00:00Z",
          updatedAt: "2026-03-26T00:00:00Z",
          url: "https://example.test/issues/91",
          labels: [],
          state: "CLOSED",
        },
        {
          number: 92,
          title: "Snapshot-only runnable candidate",
          body: `## Summary
Use the last-known-good snapshot for degraded diagnostics.

## Scope
- report snapshot-backed readiness details without re-enabling selection

## Acceptance criteria
- status stays non-authoritative while showing snapshot-derived readiness

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts

Depends on: #91`,
          createdAt: "2026-03-26T00:01:00Z",
          updatedAt: "2026-03-26T00:01:00Z",
          url: "https://example.test/issues/92",
          labels: [],
          state: "OPEN",
        },
      ],
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => {
      throw new Error("unexpected listCandidateIssues call");
    },
    listAllIssues: async () => {
      throw new Error("unexpected listAllIssues call");
    },
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport({ why: true });

  assert.match(
    report.detailedStatusLines.join("\n"),
    /^inventory_snapshot=last_known_good source=gh issue list recorded_at=2026-03-26T00:05:00Z issue_count=2 authority=non_authoritative$/m,
  );
  assert.deepEqual(report.runnableIssues, [{
    issueNumber: 92,
    title: "Snapshot-only runnable candidate",
    readiness: "execution_ready+depends_on_satisfied:91",
  }]);
  assert.equal(report.selectionSummary, null);
  assert.match(report.warning?.message ?? "", /last-known-good snapshot/i);

  const status = await supervisor.status({ why: true });
  assert.match(
    status,
    /^inventory_snapshot=last_known_good source=gh issue list recorded_at=2026-03-26T00:05:00Z issue_count=2 authority=non_authoritative$/m,
  );
  assert.match(status, /^runnable_issues=#92 ready=execution_ready\+depends_on_satisfied:91$/m);
  assert.match(status, /^selection_reason=inventory_refresh_degraded$/m);
});

test("statusReport exposes bounded snapshot-backed selection posture when degraded selection can continue", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
    inventory_refresh_failure: {
      source: "gh issue list",
      message:
        'Transient GitHub CLI failure after 3 attempts: gh issue list --repo owner/repo\nCommand failed: gh issue list --repo owner/repo\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
      recorded_at: "2026-03-26T00:10:00Z",
      selection_permitted: "snapshot_backed",
    },
    last_successful_inventory_snapshot: {
      source: "gh issue list",
      recorded_at: "2026-03-26T00:05:00Z",
      issue_count: 1,
      issues: [
        {
          number: 92,
          title: "Snapshot-backed runnable candidate",
          body: `## Summary
Use the last-known-good snapshot for bounded degraded selection.

## Scope
- keep operator-facing posture aligned with snapshot-backed continuation

## Acceptance criteria
- status distinguishes bounded degraded selection from hard-blocked degraded mode

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts`,
          createdAt: "2026-03-26T00:01:00Z",
          updatedAt: "2026-03-26T00:01:00Z",
          url: "https://example.test/issues/92",
          labels: [],
          state: "OPEN",
        },
      ],
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => {
      throw new Error("unexpected listCandidateIssues call");
    },
    listAllIssues: async () => {
      throw new Error("unexpected listAllIssues call");
    },
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport({ why: true });

  assert.deepEqual(report.inventoryStatus, {
    mode: "degraded",
    posture: "bounded_snapshot_selection",
    recoveryState: "partially_degraded",
    selectionBlocked: false,
    summary: "Full inventory refresh is degraded; bounded queue selection can continue from a fresh last-known-good snapshot.",
    recoveryGuidance:
      "Restore a successful full inventory refresh soon; bounded snapshot-backed selection can continue temporarily while fresh inventory is unavailable.",
    recoveryActions: [
      "restore_full_inventory_refresh",
      "continue_bounded_snapshot_selection",
    ],
    lastSuccessfulFullRefreshAt: "2026-03-26T00:05:00Z",
    failure: {
      source: "gh issue list",
      message:
        'Transient GitHub CLI failure after 3 attempts: gh issue list --repo owner/repo\nCommand failed: gh issue list --repo owner/repo\nexitCode=1\nPost "https://api.github.com/graphql": read tcp 127.0.0.1:12345->140.82.112.6:443: read: connection reset by peer',
      recordedAt: "2026-03-26T00:10:00Z",
      classification: "unknown",
    },
  });
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^inventory_posture=bounded_snapshot_selection recovery_state=partially_degraded selection_blocked=no last_successful_full_refresh_at=2026-03-26T00:05:00Z$/m,
  );

  const status = await supervisor.status({ why: true });
  assert.match(
    status,
    /^inventory_posture=bounded_snapshot_selection recovery_state=partially_degraded selection_blocked=no last_successful_full_refresh_at=2026-03-26T00:05:00Z$/m,
  );
  assert.match(
    status,
    /^readiness_warning=Full inventory refresh is degraded\. Bounded snapshot-backed selection can continue temporarily\./m,
  );
});

test("statusReport exposes typed targeted degraded reconciliation posture for operators", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: 58,
    issues: {
      "58": createRecord({
        issue_number: 58,
        state: "reproducing",
        pr_number: 108,
        branch: branchName(fixture.config, 58),
        workspace: path.join(fixture.workspaceRoot, "issue-58"),
        journal_path: null,
      }),
    },
    inventory_refresh_failure: {
      source: "gh issue list",
      message: "secondary rate limit exceeded for the REST API",
      recorded_at: "2026-03-26T00:10:00Z",
      classification: "rate_limited",
    },
    last_successful_inventory_snapshot: {
      source: "gh issue list",
      recorded_at: "2026-03-26T00:05:00Z",
      issue_count: 1,
      issues: [{
        number: 58,
        title: "Tracked issue remains active",
        body: executionReadyBody("Keep the tracked issue active while inventory refresh is degraded."),
        createdAt: "2026-03-26T00:00:00Z",
        updatedAt: "2026-03-26T00:00:00Z",
        url: "https://example.test/issues/58",
        labels: [],
        state: "OPEN",
      }],
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    listCandidateIssues: async () => {
      throw new Error("unexpected listCandidateIssues call");
    },
    listAllIssues: async () => {
      throw new Error("unexpected listAllIssues call");
    },
  };

  const report = await supervisor.statusReport();

  assert.deepEqual(report.inventoryStatus, {
    mode: "degraded",
    posture: "targeted_degraded_reconciliation",
    recoveryState: "partially_degraded",
    selectionBlocked: true,
    summary: "Full inventory refresh is degraded; targeted reconciliation can continue for tracked pull requests.",
    recoveryGuidance:
      "Restore a successful full inventory refresh to resume authoritative queue selection; tracked PR reconciliation can continue meanwhile.",
    recoveryActions: [
      "restore_full_inventory_refresh",
      "continue_targeted_pr_reconciliation",
    ],
    lastSuccessfulFullRefreshAt: "2026-03-26T00:05:00Z",
    failure: {
      source: "gh issue list",
      message: "secondary rate limit exceeded for the REST API",
      recordedAt: "2026-03-26T00:10:00Z",
      classification: "rate_limited",
    },
  });
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^inventory_posture=targeted_degraded_reconciliation recovery_state=partially_degraded selection_blocked=yes last_successful_full_refresh_at=2026-03-26T00:05:00Z$/m,
  );
});

test("statusReport exposes the typed local CI contract summary from config", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  fixture.config.localCiCommand = "npm run ci:local";

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();

  assert.deepEqual(report.localCiContract, {
    configured: true,
    command: "npm run ci:local",
    recommendedCommand: null,
    source: "config",
    summary: "Repo-owned local CI contract is configured.",
    warning:
      "localCiCommand is configured but workspacePreparationCommand is unset. Configure a repo-owned workspacePreparationCommand so preserved issue worktrees can prepare toolchains before host-local CI runs. GitHub checks can stay green while host-local CI still blocks tracked PR progress.",
    adoptionFlow: {
      state: "configured",
      candidateDetected: false,
      commandPreview: "npm run ci:local",
      validationStatus: "configured",
      workspacePreparationCommand: null,
      workspacePreparationRecommendedCommand: null,
      workspacePreparationGuidance:
        "workspacePreparationCommand is unset; confirm preserved issue worktrees can prepare required toolchains before adopting local CI.",
      decisions: [],
    },
  });

  const status = await supervisor.status();
  assert.match(status, /local_ci configured=true source=config command=npm run ci:local summary=Repo-owned local CI contract is configured\./);
});

test("statusReport exposes GitHub REST and GraphQL rate-limit telemetry in typed and rendered status surfaces", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getRateLimitTelemetry: async () => ({
      rest: {
        resource: "core",
        limit: 5000,
        remaining: 75,
        resetAt: "2026-03-27T00:30:00.000Z",
        state: "low",
      },
      graphql: {
        resource: "graphql",
        limit: 5000,
        remaining: 0,
        resetAt: "2026-03-27T00:15:00.000Z",
        state: "exhausted",
      },
    }),
  };

  const report = await supervisor.statusReport();

  assert.deepEqual(report.githubRateLimit, {
    rest: {
      resource: "core",
      limit: 5000,
      remaining: 75,
      resetAt: "2026-03-27T00:30:00.000Z",
      state: "low",
    },
    graphql: {
      resource: "graphql",
      limit: 5000,
      remaining: 0,
      resetAt: "2026-03-27T00:15:00.000Z",
      state: "exhausted",
    },
  });
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^github_rate_limit resource=rest status=low remaining=75 limit=5000 reset_at=2026-03-27T00:30:00.000Z$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^github_rate_limit resource=graphql status=exhausted remaining=0 limit=5000 reset_at=2026-03-27T00:15:00.000Z$/m,
  );

  const status = await supervisor.status();
  assert.match(status, /^github_rate_limit resource=rest status=low remaining=75 limit=5000 reset_at=2026-03-27T00:30:00.000Z$/m);
  assert.match(status, /^github_rate_limit resource=graphql status=exhausted remaining=0 limit=5000 reset_at=2026-03-27T00:15:00.000Z$/m);
});

test("statusReport fetches GitHub rate-limit telemetry after inactive selection reads", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const calls: string[] = [];
  const issue: GitHubIssue = {
    number: 41,
    title: "Keep inactive status rate-limit snapshots current",
    body: executionReadyBody("Fetch rate-limit telemetry after inactive selection reads."),
    createdAt: "2026-03-27T00:00:00Z",
    updatedAt: "2026-03-27T00:00:00Z",
    url: "https://example.test/issues/41",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => {
      calls.push("listCandidateIssues");
      return [issue];
    },
    listAllIssues: async () => {
      calls.push("listAllIssues");
      return [issue];
    },
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
    getRateLimitTelemetry: async () => {
      calls.push("getRateLimitTelemetry");
      return {
        rest: {
          resource: "core",
          limit: 5000,
          remaining: 74,
          resetAt: "2026-03-27T00:30:00.000Z",
          state: "low",
        },
        graphql: {
          resource: "graphql",
          limit: 5000,
          remaining: 12,
          resetAt: "2026-03-27T00:15:00.000Z",
          state: "low",
        },
      };
    },
  };

  await supervisor.statusReport({ why: true });

  assert.deepEqual(calls, [
    "listCandidateIssues",
    "listAllIssues",
    "listCandidateIssues",
    "listAllIssues",
    "listCandidateIssues",
    "listAllIssues",
    "getRateLimitTelemetry",
  ]);
});

test("statusReport fetches GitHub rate-limit telemetry after active issue reads", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 58;
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch: branchName(fixture.config, issueNumber),
        pr_number: issueNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const calls: string[] = [];
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => {
      calls.push("getIssue");
      return {
        number: issueNumber,
        title: "Keep active status rate-limit snapshots current",
        body: executionReadyBody("Fetch rate-limit telemetry after active status reads."),
        createdAt: "2026-03-27T00:00:00Z",
        updatedAt: "2026-03-27T00:00:00Z",
        url: `https://example.test/issues/${issueNumber}`,
        labels: [],
        state: "OPEN",
      };
    },
    resolvePullRequestForBranch: async () => {
      calls.push("resolvePullRequestForBranch");
      return {
        number: issueNumber,
        title: "Keep active status rate-limit snapshots current",
        url: `https://example.test/pull/${issueNumber}`,
        state: "OPEN",
        createdAt: "2026-03-27T00:00:00Z",
        updatedAt: "2026-03-27T00:00:00Z",
        isDraft: false,
        reviewDecision: null,
        mergeStateStatus: "CLEAN",
        headRefName: branchName(fixture.config, issueNumber),
        headRefOid: "head-58",
      };
    },
    getChecks: async () => {
      calls.push("getChecks");
      return [];
    },
    getUnresolvedReviewThreads: async () => {
      calls.push("getUnresolvedReviewThreads");
      return [];
    },
    getRateLimitTelemetry: async () => {
      calls.push("getRateLimitTelemetry");
      return {
        rest: {
          resource: "core",
          limit: 5000,
          remaining: 73,
          resetAt: "2026-03-27T00:30:00.000Z",
          state: "low",
        },
        graphql: {
          resource: "graphql",
          limit: 5000,
          remaining: 11,
          resetAt: "2026-03-27T00:15:00.000Z",
          state: "low",
        },
      };
    },
  };

  await supervisor.statusReport();

  assert.deepEqual(calls, [
    "getIssue",
    "resolvePullRequestForBranch",
    "getChecks",
    "getUnresolvedReviewThreads",
    "getRateLimitTelemetry",
  ]);
});

test("statusReport exposes typed loop runtime state from the host runtime marker", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  const previousLauncher = process.env.CODEX_SUPERVISOR_LAUNCHER;
  delete process.env.CODEX_SUPERVISOR_LAUNCHER;
  t.after(() => {
    if (previousLauncher === undefined) {
      delete process.env.CODEX_SUPERVISOR_LAUNCHER;
      return;
    }
    process.env.CODEX_SUPERVISOR_LAUNCHER = previousLauncher;
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const runtimeLock = await supervisor.acquireLoopRuntimeLock();
  assert.equal(runtimeLock.acquired, true);
  t.after(async () => {
    await runtimeLock.release();
  });

  const report = await supervisor.statusReport();

  assert.deepEqual(report.loopRuntime, {
    state: "running",
    hostMode: "unknown",
    runMode: "unknown",
    markerPath: report.loopRuntime?.markerPath ?? "",
    configPath: null,
    stateFile: fixture.config.stateFile,
    pid: process.pid,
    startedAt: report.loopRuntime?.startedAt ?? null,
    ownershipConfidence: "live_lock",
    detail: "supervisor-loop-runtime",
  });
  assert.match(report.loopRuntime?.startedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);

  const status = await supervisor.status();
  assert.match(status, /^loop_runtime state=running host_mode=unknown run_mode=unknown marker_path=.*loop-runtime\.lock config_path=none state_file=.*state\.json pid=\d+ started_at=\d{4}-\d{2}-\d{2}T.* ownership_confidence=live_lock detail=supervisor-loop-runtime$/m);
});

test("status surfaces loop-off as a blocker when tracked work is still active", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 188;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch,
        pr_number: 288,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Loop-off blocker should be explicit",
    body: executionReadyBody("Surface loop-off as a tracked-work blocker in status."),
    createdAt: "2026-03-25T00:00:00Z",
    updatedAt: "2026-03-25T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#188 first_state=addressing_review first_pr=#288 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=if_blocker_remains_run_status_why_and_doctor_then_inspect_runtime_marker_and_config$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^restart_recommendation category=restart_required_for_convergence source=loop_runtime_blocker summary=Restarting the supported supervisor loop is required before active tracked work can converge\.$/m,
  );
  assert.equal(
    report.warning?.message,
    "Tracked work is active for issue #188, but the supervisor loop is off. Restart the supported loop host; expect loop_runtime state=running before issue #188 advances.",
  );

  const status = await supervisor.status();
  assert.match(
    status,
    /^loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#188 first_state=addressing_review first_pr=#288 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=if_blocker_remains_run_status_why_and_doctor_then_inspect_runtime_marker_and_config$/m,
  );
  assert.match(
    status,
    /^operator_action action=restart_loop source=loop_runtime_blocker priority=90 summary=Tracked work is active but the supervisor loop is off; restart the supported loop host so the runtime reports running and tracked work can advance\.$/m,
  );
  assert.match(
    status,
    /^restart_recommendation category=restart_required_for_convergence source=loop_runtime_blocker summary=Restarting the supported supervisor loop is required before active tracked work can converge\.$/m,
  );
  assert.match(
    status,
    /^status_warning=Tracked work is active for issue #188, but the supervisor loop is off\. Restart the supported loop host; expect loop_runtime state=running before issue #188 advances\.$/m,
  );
});

test("status does not emit the loop-off restart blocker for blocked-only tracked work", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 188;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        blocked_reason: "manual_review",
        branch: branchName(fixture.config, issueNumber),
        pr_number: 288,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Blocked tracked issue should not advertise loop restart",
    body: executionReadyBody("Blocked-only tracked work should not be treated as loop-advanceable."),
    createdAt: "2026-03-25T00:00:00Z",
    updatedAt: "2026-03-25T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.equal(report.warning?.message ?? null, null);
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /^loop_runtime_blocker /m);

  const status = await supervisor.status();
  assert.doesNotMatch(status, /^loop_runtime_blocker /m);
  assert.doesNotMatch(status, /^status_warning=Tracked work is active for issue #188, but the supervisor loop is off\./m);
  assert.match(
    status,
    /^operator_action action=continue source=status priority=0 summary=No blocking operator action was detected; continue normal supervisor operation\.$/m,
  );
});

test("acquireSupervisorLock fails closed on ambiguous-owner run locks", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const lockPath = path.resolve(path.dirname(fixture.stateFile), "locks", "supervisor", "run.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({
      pid: 999_999,
      label: "supervisor-loop",
      acquired_at: "2026-03-20T00:00:00.000Z",
      host: "other-host",
      owner: "other-user",
    }, null, 2)}\n`,
    "utf8",
  );

  const supervisor = new Supervisor(fixture.config);
  const lock = await supervisor.acquireSupervisorLock("run-once");

  assert.equal(lock.acquired, false);
  assert.match(lock.reason ?? "", /ambiguous owner/i);
  assert.deepEqual(JSON.parse(await fs.readFile(lockPath, "utf8")), {
    pid: 999_999,
    label: "supervisor-loop",
    acquired_at: "2026-03-20T00:00:00.000Z",
    host: "other-host",
    owner: "other-user",
  });
});

test("acquireLoopRuntimeLock fails closed on ambiguous-owner loop runtime locks and keeps diagnostics visible", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const lockPath = path.resolve(path.dirname(fixture.stateFile), "locks", "supervisor", "loop-runtime.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({
      pid: 999_999,
      label: "supervisor-loop-runtime",
      acquired_at: "2026-03-20T00:00:00.000Z",
      host: "other-host",
      owner: "other-user",
    }, null, 2)}\n`,
    "utf8",
  );

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const lock = await supervisor.acquireLoopRuntimeLock();

  assert.equal(lock.acquired, false);
  assert.match(lock.reason ?? "", /ambiguous owner/i);
  assert.deepEqual(JSON.parse(await fs.readFile(lockPath, "utf8")), {
    pid: 999_999,
    label: "supervisor-loop-runtime",
    acquired_at: "2026-03-20T00:00:00.000Z",
    host: "other-host",
    owner: "other-user",
  });

  const report = await supervisor.statusReport();
  assert.deepEqual(report.loopRuntime, {
    state: "unknown",
    hostMode: "unknown",
    runMode: "unknown",
    markerPath: lockPath,
    configPath: null,
    stateFile: fixture.config.stateFile,
    pid: 999_999,
    startedAt: "2026-03-20T00:00:00.000Z",
    ownershipConfidence: "ambiguous_owner",
    detail: "supervisor-loop-runtime",
    recoveryGuidance:
      "Safe recovery: verify marker PID 999999 owns the active supervisor config before restarting automation; if ownership is still unclear, inspect the process and marker instead of deleting the marker or killing processes automatically.",
  });
});

test("statusReport exposes typed active-issue and selection summary fields alongside legacy lines", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: 58,
    issues: {
      "58": createRecord({
        issue_number: 58,
        state: "queued",
        branch: branchName(fixture.config, 58),
        pr_number: 58,
        workspace: path.join(fixture.workspaceRoot, "issue-58"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
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

  const report = await supervisor.statusReport({ why: true });

  assert.deepEqual(report.activeIssue, {
    issueNumber: 58,
    state: "queued",
    branch: branchName(fixture.config, 58),
    prNumber: 58,
    blockedReason: null,
    activityContext: {
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
        repeatedFailureSignatureCount: 1,
        lastFailureSignature: "handoff-missing",
      },
      repeatedRecovery: null,
      recentPhaseChanges: [],
      localReviewSummaryPath: null,
      externalReviewMissesPath: null,
      reviewWaits: [],
    },
  });
  assert.deepEqual(report.selectionSummary, {
    selectedIssueNumber: null,
    selectionReason: null,
  });
  assert.match(report.detailedStatusLines.join("\n"), /^issue=#58$/m);
  assert.match(report.detailedStatusLines.join("\n"), /^state=queued$/m);
});

test("statusReport exposes typed operator activity context for the active issue", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 58;
  const journalPath = path.join(fixture.workspaceRoot, "issue-58", ".codex-supervisor", "issue-journal.md");
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await fs.writeFile(
    journalPath,
    `# Issue #58: Typed operator activity context

## Supervisor Snapshot
- Updated at: 2026-03-22T00:20:00Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The status DTO should carry typed operator-facing issue context.
- What changed: Added a focused active-issue contract test.
- Current blocker: Waiting on the status DTO to expose the handoff summary directly.
- Next exact step: Add typed activity context fields on the active issue payload.
- Verification gap: Focused status DTO coverage was missing.
- Files touched: src/supervisor/supervisor.ts
- Rollback concern:
- Last focused command: npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts

### Scratchpad
- Keep this section short.
`,
    "utf8",
  );

  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch: branchName(fixture.config, issueNumber),
        pr_number: issueNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: journalPath,
        blocked_reason: null,
        last_error: null,
        last_recovery_reason:
          "tracked_pr_head_advanced: resumed issue #58 from blocked to addressing_review after tracked PR #58 advanced from head-old-58 to head-new-58",
        last_recovery_at: "2026-03-22T00:15:00Z",
        timeout_retry_count: 2,
        blocked_verification_retry_count: 1,
        repeated_failure_signature_count: 4,
        last_failure_signature: "tracked-pr-refresh-loop",
        latest_local_ci_result: {
          outcome: "failed",
          summary: "Configured local CI command failed before marking PR #58 ready.",
          ran_at: "2026-03-22T00:10:00Z",
          head_sha: "head-new-58",
          execution_mode: "legacy_shell_string",
          failure_class: "non_zero_exit",
          remediation_target: "tracked_publishable_content",
        },
        review_wait_started_at: "2099-01-01T00:00:30.000Z",
        review_wait_head_sha: "head-new-58",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor({
    ...fixture.config,
    reviewBotLogins: ["coderabbitai"],
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => ({
      number: issueNumber,
      title: "Typed operator activity context",
      body: `## Summary
Expose typed operator-facing issue detail fields.

## Scope
- extend the status DTO

## Acceptance criteria
- status includes typed operator activity context

## Verification
- npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`,
      createdAt: "2026-03-22T00:00:00Z",
      updatedAt: "2026-03-22T00:00:00Z",
      url: `https://example.test/issues/${issueNumber}`,
      labels: [],
      state: "OPEN",
    }),
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    resolvePullRequestForBranch: async () => ({
      number: issueNumber,
      title: "Typed operator activity context",
      url: `https://example.test/pull/${issueNumber}`,
      state: "OPEN",
      createdAt: "2026-03-22T00:00:00Z",
      updatedAt: "2026-03-22T00:00:00Z",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: "CLEAN",
      headRefName: branchName(fixture.config, issueNumber),
      headRefOid: "head-new-58",
      configuredBotDraftSkipAt: "2099-01-01T00:00:00.000Z",
      currentHeadCiGreenAt: "2099-01-01T00:00:30.000Z",
    }),
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  const status = await supervisor.status();

  assert.deepEqual(report.activeIssue?.activityContext, {
    handoffSummary:
      "blocker: Waiting on the status DTO to expose the handoff summary directly. | next: Add typed activity context fields on the active issue payload.",
    localReviewRoutingSummary: null,
    changeClassesSummary: null,
    verificationPolicySummary: null,
    durableGuardrailSummary: null,
    externalReviewFollowUpSummary: null,
    preMergeEvaluation: null,
    localCiStatus: {
      outcome: "failed",
      summary: "Configured local CI command failed before marking PR #58 ready.",
      ranAt: "2026-03-22T00:10:00Z",
      headSha: "head-new-58",
      headStatus: "current",
      context: "warning",
      command: null,
      stderrSummary: null,
      failureClass: "non_zero_exit",
      remediationTarget: "tracked_publishable_content",
      verifierDriftHint: null,
    },
    latestRecovery: {
      issueNumber,
      at: "2026-03-22T00:15:00Z",
      reason: "tracked_pr_head_advanced",
      detail: "resumed issue #58 from blocked to addressing_review after tracked PR #58 advanced from head-old-58 to head-new-58",
    },
    retryContext: {
      timeoutRetryCount: 2,
      blockedVerificationRetryCount: 1,
      repeatedBlockerCount: 0,
      repeatedFailureSignatureCount: 4,
      lastFailureSignature: "tracked-pr-refresh-loop",
    },
    repeatedRecovery: null,
    recentPhaseChanges: [
      {
        at: "2026-03-22T00:15:00Z",
        from: "blocked",
        to: "addressing_review",
        reason: "tracked_pr_head_advanced",
        source: "recovery",
      },
    ],
    localReviewSummaryPath: null,
    externalReviewMissesPath: null,
    reviewWaits: [
      {
        kind: "configured_bot_initial_grace_wait",
        status: "active",
        provider: "coderabbit",
        pauseReason: "awaiting_fresh_provider_review_after_draft_skip",
        recentObservation: "ready_for_review_reopened_wait",
        observedAt: "2099-01-01T00:00:30.000Z",
        configuredWaitSeconds: 90,
        waitUntil: "2099-01-01T00:02:00.000Z",
      },
    ],
  });
  assert.match(
    status,
    /^retry_summary timeout=2 verification=1 same_failure_signature=4 last_failure_signature=tracked-pr-refresh-loop apparent_no_progress=yes$/m,
  );
  assert.match(
    status,
    /^recovery_loop_summary latest_reason=tracked_pr_head_advanced phase_change=blocked->addressing_review apparent_no_progress=yes$/m,
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

test("runOnce fail-closes before execution when corrupted JSON state is quarantined", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  await fs.writeFile(fixture.stateFile, "{not-json}\n", "utf8");

  let authStatusCalls = 0;
  let listAllIssuesCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => {
      authStatusCalls += 1;
      return { ok: true, message: null };
    },
    listAllIssues: async () => {
      listAllIssuesCalls += 1;
      return [];
    },
  };

  const message = await supervisor.runOnce({ dryRun: false });

  assert.match(
    message,
    /Blocked execution-changing command: corrupted JSON supervisor state detected at .*state\.json\./,
  );
  assert.match(message, /status/);
  assert.match(message, /doctor/);
  assert.match(message, /reset-corrupt-json-state/);
  assert.equal(authStatusCalls, 0);
  assert.equal(listAllIssuesCalls, 0);

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.json_state_quarantine?.marker_file, fixture.stateFile);
  assert.match(persisted.json_state_quarantine?.quarantined_file ?? "", /state\.json\.corrupt\./);
});

test("status shows readiness reasons for runnable, requirements-blocked, and clarification-blocked issues", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
        branch: branchName(fixture.config, 91),
        workspace: path.join(fixture.workspaceRoot, "issue-91"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const runnableIssue: GitHubIssue = {
    number: 92,
    title: "Step 2",
    body: `## Summary
Ship the second step.

## Scope
- build on the completed dependency

## Acceptance criteria
- supervisor can explain why this issue is runnable

## Verification
- npm test -- src/supervisor.test.ts

Depends on: #91`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/92",
    labels: [],
    state: "OPEN",
  };
  const missingMetadataIssue: GitHubIssue = {
    number: 93,
    title: "Underspecified issue",
    body: `## Summary
Missing execution-ready metadata.`,
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:10:00Z",
    url: "https://example.test/issues/93",
    labels: [],
    state: "OPEN",
  };
  const clarificationBlockedIssue: GitHubIssue = {
    number: 94,
    title: "Decide which auth path to keep",
    body: `## Summary
Decide whether to keep the current production auth token flow or replace it before rollout.

## Scope
- choose the production authentication path for service-to-service traffic

## Acceptance criteria
- the operator confirms which auth flow should ship

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:15:00Z",
    updatedAt: "2026-03-13T00:15:00Z",
    url: "https://example.test/issues/94",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [runnableIssue, missingMetadataIssue, clarificationBlockedIssue],
    listAllIssues: async () => [runnableIssue, missingMetadataIssue, clarificationBlockedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.equal(report.reconciliationPhase, null);
  assert.equal(report.warning?.kind ?? null, null);
  assert.match(report.detailedStatusLines.join("\n"), /^No active issue\.$/m);
  assert.deepEqual(report.trackedIssues, [
    {
      issueNumber: 91,
      state: "done",
      branch: branchName(fixture.config, 91),
      prNumber: null,
      blockedReason: null,
    },
  ]);
  assert.deepEqual(report.runnableIssues, [
    {
      issueNumber: 92,
      title: "Step 2",
      readiness: "execution_ready+depends_on_satisfied:91",
    },
  ]);
  assert.deepEqual(report.blockedIssues, [
    {
      issueNumber: 93,
      title: "Underspecified issue",
      blockedBy: "requirements:scope, acceptance criteria, verification",
    },
    {
      issueNumber: 94,
      title: "Decide which auth path to keep",
      blockedBy: "clarification:unresolved_choice:auth",
    },
  ]);
  assert.deepEqual(report.candidateDiscovery, {
    fetchWindow: 100,
    strategy: "paginated",
    truncated: false,
    observedMatchingOpenIssues: null,
    warning: null,
  });
  assert.match(
    report.readinessLines.join("\n"),
    /runnable_issues=#92 ready=execution_ready\+depends_on_satisfied:91/,
  );
  assert.match(
    report.readinessLines.join("\n"),
    /blocked_issues=#93 blocked_by=requirements:scope, acceptance criteria, verification; #94 blocked_by=clarification:unresolved_choice:auth/,
  );

  const status = await supervisor.status();

  assert.match(status, /runnable_issues=#92 ready=execution_ready\+depends_on_satisfied:91/);
  assert.match(
    status,
    /blocked_issues=#93 blocked_by=requirements:scope, acceptance criteria, verification; #94 blocked_by=clarification:unresolved_choice:auth/,
  );
});

test("status distinguishes blocked preserved partial work from an empty backlog", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 145;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        blocked_reason: "manual_review",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        updated_at: "2026-04-12T00:10:00Z",
        last_failure_context: {
          category: "manual",
          summary: "Issue #145 needs manual review because the workspace preserves partial work.",
          signature: "manual-review-preserved-partial-work",
          command: null,
          details: [
            "preserved_partial_work=yes",
            "tracked_files=feature.txt|src/workflow.ts",
          ],
          url: "https://example.test/issues/145",
          updated_at: "2026-04-12T00:10:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Manual review for preserved partial work",
    body: executionReadyBody(
      "Keep the preserved worktree available until the operator manually reviews the partial work.",
    ),
    createdAt: "2026-04-12T00:00:00Z",
    updatedAt: "2026-04-12T00:00:00Z",
    url: "https://example.test/issues/145",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [blockedIssue],
    listAllIssues: async () => [blockedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport({ why: true });
  assert.match(report.readinessLines.join("\n"), /^runnable_issues=none$/m);
  assert.match(report.readinessLines.join("\n"), /^blocked_issues=#145 blocked_by=local_state:blocked$/m);
  assert.match(
    report.readinessLines.join("\n"),
    /^blocked_partial_work issue=#145 blocked_reason=manual_review partial_work=preserved tracked_files=feature\.txt\|src\/workflow\.ts$/m,
  );
  assert.deepEqual(report.whyLines, [
    "selected_issue=none",
    "selection_reason=blocked_partial_work_manual_review issue=#145",
    "blocked_partial_work issue=#145 blocked_reason=manual_review partial_work=preserved tracked_files=feature.txt|src/workflow.ts",
  ]);

  const status = await supervisor.status({ why: true });
  assert.match(status, /^No active issue\.$/m);
  assert.match(status, /^selection_reason=blocked_partial_work_manual_review issue=#145$/m);
  assert.match(
    status,
    /^blocked_partial_work issue=#145 blocked_reason=manual_review partial_work=preserved tracked_files=feature\.txt\|src\/workflow\.ts$/m,
  );
});

test("status makes safer-mode trust gating explicit while allowing trusted-input issues", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 95,
    title: "Blocked by trust gate",
    body: `## Summary
Do not run this issue autonomously without an explicit trust signal.

## Scope
- keep the issue execution-ready

## Acceptance criteria
- status explains why safer-mode execution is blocked

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts`,
    createdAt: "2026-03-13T00:20:00Z",
    updatedAt: "2026-03-13T00:20:00Z",
    url: "https://example.test/issues/95",
    labels: [],
    state: "OPEN",
  };
  const allowedIssue: GitHubIssue = {
    ...blockedIssue,
    number: 96,
    title: "Allowed by trusted-input label",
    url: "https://example.test/issues/96",
    labels: [{ name: "trusted-input" }],
  };

  const supervisor = new Supervisor({
    ...fixture.config,
    trustMode: "untrusted_or_mixed",
    executionSafetyMode: "operator_gated",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [blockedIssue, allowedIssue],
    listAllIssues: async () => [blockedIssue, allowedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(report.readinessLines.join("\n"), /runnable_issues=#96 ready=execution_ready/);
  assert.match(report.readinessLines.join("\n"), /blocked_issues=#95 blocked_by=trust_gate:trusted-input-required/);

  const status = await supervisor.status();
  assert.match(status, /trust_mode=untrusted_or_mixed/);
  assert.match(status, /execution_safety_mode=operator_gated/);
  assert.match(status, /runnable_issues=#96 ready=execution_ready/);
  assert.match(status, /blocked_issues=#95 blocked_by=trust_gate:trusted-input-required/);
});

test("status reports missing labels as a blocked metadata problem instead of treating them as unlabeled", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: 97,
    title: "Missing labels payload",
    body: `## Summary
Do not treat missing labels like an empty label set.

## Scope
- preserve fail-closed label-gated readiness

## Acceptance criteria
- status reports missing labels as blocking metadata

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts`,
    createdAt: "2026-03-13T00:20:00Z",
    updatedAt: "2026-03-13T00:20:00Z",
    url: "https://example.test/issues/97",
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [issue],
    listAllIssues: async () => [issue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(report.readinessLines.join("\n"), /blocked_issues=#97 blocked_by=metadata:labels_unavailable/);

  const status = await supervisor.status();
  assert.match(status, /blocked_issues=#97 blocked_by=metadata:labels_unavailable/);
});

test("status uses the full issue set when a candidate is blocked by a non-candidate dependency", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const dependencyIssue: GitHubIssue = {
    number: 91,
    title: "Foundational dependency",
    body: `## Summary
Ship the dependency first.

## Scope
- land the prerequisite work

## Acceptance criteria
- downstream issues stay blocked until this closes

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/91",
    labels: [],
    state: "OPEN",
  };
  const candidateIssue: GitHubIssue = {
    number: 92,
    title: "Blocked by non-candidate dependency",
    body: `## Summary
This issue should stay blocked until its dependency is done.

## Scope
- verify readiness uses the full issue set

## Acceptance criteria
- status does not report this issue as runnable while #91 is open

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts

Depends on: #91`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/92",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [candidateIssue],
    listAllIssues: async () => [dependencyIssue, candidateIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();

  assert.deepEqual(report.runnableIssues, []);
  assert.deepEqual(report.blockedIssues, [
    {
      issueNumber: 92,
      title: "Blocked by non-candidate dependency",
      blockedBy: "depends on #91",
    },
  ]);
  assert.match(report.readinessLines.join("\n"), /runnable_issues=none/);
  assert.match(report.readinessLines.join("\n"), /blocked_issues=#92 blocked_by=depends on #91/);
});

test("status marks skipped readiness checks explicitly and uses non-conflicting inner separators", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
        branch: branchName(fixture.config, 91),
        workspace: path.join(fixture.workspaceRoot, "issue-91"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
      "92": createRecord({
        issue_number: 92,
        state: "done",
        branch: branchName(fixture.config, 92),
        workspace: path.join(fixture.workspaceRoot, "issue-92"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
      "93": createRecord({
        issue_number: 93,
        state: "queued",
        branch: branchName(fixture.config, 93),
        workspace: path.join(fixture.workspaceRoot, "issue-93"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
        attempt_count: 1,
        implementation_attempt_count: 1,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const predecessorOne: GitHubIssue = {
    number: 91,
    title: "Step 1",
    body: `## Summary
Finish step 1.

## Scope
- start the execution order chain

## Acceptance criteria
- step 1 completes first

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 1 of 3`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/91",
    labels: [],
    state: "CLOSED",
  };
  const predecessorTwo: GitHubIssue = {
    number: 92,
    title: "Step 2",
    body: `## Summary
Finish step 2.

## Scope
- land after step 1

## Acceptance criteria
- step 2 completes after step 1

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 2 of 3`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/92",
    labels: [],
    state: "CLOSED",
  };
  const skippedRequirementsIssue: GitHubIssue = {
    number: 93,
    title: "Step 3",
    body: `## Summary
Existing in-flight issue with missing readiness metadata.

Depends on: #91, #92
Part of: #150
Execution order: 3 of 3`,
    createdAt: "2026-03-13T00:10:00Z",
    updatedAt: "2026-03-13T00:10:00Z",
    url: "https://example.test/issues/93",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [predecessorOne, predecessorTwo, skippedRequirementsIssue],
    listAllIssues: async () => [predecessorOne, predecessorTwo, skippedRequirementsIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();

  assert.match(
    status,
    /runnable_issues=#93 ready=requirements_skipped\+depends_on_satisfied:91\|92\+execution_order_satisfied:91\|92/,
  );
});

test("status reports paginated candidate discovery without a truncation warning", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const selectedIssue: GitHubIssue = {
    number: 101,
    title: "Ready issue in first page",
    body: `## Summary
Keep selection behavior unchanged while surfacing the current discovery limit.

## Scope
- preserve current first-page candidate fetching

## Acceptance criteria
- status warns when more matching open issues exist than the fetch window can cover

## Verification
- npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/101",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor({
    ...fixture.config,
    candidateDiscoveryFetchWindow: 250,
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [selectedIssue],
    listAllIssues: async () => [selectedIssue],
    getCandidateDiscoveryDiagnostics: async () => ({
      fetchWindow: 250,
      observedMatchingOpenIssues: 251,
      truncated: false,
    }),
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.equal(report.candidateDiscoverySummary, "candidate_discovery fetch_window=250 strategy=paginated");
  assert.deepEqual(report.candidateDiscovery, {
    fetchWindow: 250,
    strategy: "paginated",
    truncated: false,
    observedMatchingOpenIssues: 251,
    warning: null,
  });
  assert.doesNotMatch(report.readinessLines.join("\n"), /candidate_discovery_warning=/);

  const status = await supervisor.status();
  assert.match(status, /candidate_discovery fetch_window=250 strategy=paginated/);
  assert.doesNotMatch(status, /candidate_discovery_warning=/);
});

test("status surfaces the current reconciliation phase only while reconciliation is in progress", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
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

  await writeCurrentReconciliationPhase(fixture.config, "tracked_merged_but_open_issues");
  const duringReconciliation = await supervisor.status();
  assert.match(duringReconciliation, /reconciliation_phase=tracked_merged_but_open_issues/);

  await clearCurrentReconciliationPhase(fixture.config);
  const afterReconciliation = await supervisor.status();
  assert.doesNotMatch(afterReconciliation, /reconciliation_phase=/);
});

test("statusReport exposes typed reconciliation target and wait-step context while reconciliation is in progress", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fixture.config.configuredReviewProviders = [
    {
      kind: "coderabbit",
      reviewerLogins: ["coderabbitai"],
      signalSource: "review_threads",
    },
  ];

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  await writeCurrentReconciliationPhase(fixture.config, {
    phase: "stale_failed_issue_states",
    targetIssueNumber: 58,
    targetPrNumber: 91,
    waitStep: "configured_bot_initial_grace_wait",
  });

  const report = await supervisor.statusReport();
  assert.deepEqual(report.reconciliationProgress, {
    phase: "stale_failed_issue_states",
    startedAt: report.reconciliationProgress?.startedAt ?? null,
    targetIssueNumber: 58,
    targetPrNumber: 91,
    waitStep: "configured_bot_initial_grace_wait",
  });
  assert.equal(report.reconciliationPhase, "stale_failed_issue_states");

  const status = await supervisor.status();
  assert.match(status, /reconciliation_phase=stale_failed_issue_states/);
  assert.match(
    status,
    /reconciliation_progress phase=stale_failed_issue_states target_issue=#58 target_pr=#91 wait_step=configured_bot_initial_grace_wait/,
  );
});

test("status and doctor surface tracked merged-but-open backlog cursor diagnostics when historical backlog remains", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "320": createRecord({
        issue_number: 320,
        state: "done",
        pr_number: 920,
        blocked_reason: null,
      }),
      "321": createRecord({
        issue_number: 321,
        state: "done",
        pr_number: 921,
        blocked_reason: null,
      }),
      "400": createRecord({
        issue_number: 400,
        state: "waiting_ci",
        pr_number: 990,
        blocked_reason: null,
      }),
    },
    reconciliation_state: {
      tracked_merged_but_open_last_processed_issue_number: 321,
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getCandidateDiscoveryDiagnostics: async () => ({
      fetchWindow: 100,
      observedMatchingOpenIssues: 0,
      truncated: false,
    }),
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /reconciliation_backlog phase=tracked_merged_but_open_issues resume_after_issue=#321 historical_done_records=2 recoverable_records=1 tracked_records=3/,
  );

  const status = await supervisor.status();
  assert.match(
    status,
    /reconciliation_backlog phase=tracked_merged_but_open_issues resume_after_issue=#321 historical_done_records=2 recoverable_records=1 tracked_records=3/,
  );

  const doctor = await supervisor.doctor();
  assert.match(
    doctor,
    /doctor_reconciliation_backlog phase=tracked_merged_but_open_issues resume_after_issue=#321 historical_done_records=2 recoverable_records=1 tracked_records=3/,
  );
});

test("status emits a warning only after reconciliation exceeds the long-running threshold", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  const liveIssue = {
    number: 1772,
    title: "Classify stale reconciliation markers",
    body: executionReadyBody("Classify stale reconciliation markers separately from live work."),
    createdAt: "2026-03-20T00:00:00Z",
    updatedAt: "2026-03-20T00:00:00Z",
    url: "https://example.test/issues/1772",
    labels: [],
    state: "OPEN",
  } satisfies GitHubIssue;
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [liveIssue],
    listAllIssues: async () => [liveIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const originalDateNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-03-20T00:10:00.000Z");

    await writeCurrentReconciliationPhase(fixture.config, "tracked_merged_but_open_issues");
    let status = await supervisor.status();
    assert.doesNotMatch(status, /reconciliation_warning=/);

    Date.now = () => Date.parse("2026-03-20T00:15:00.000Z");
    status = await supervisor.status();
    assert.doesNotMatch(status, /reconciliation_warning=/);

    Date.now = () => Date.parse("2026-03-20T00:15:01.000Z");
    status = await supervisor.status();
    assert.match(
      status,
      /reconciliation_warning=long_running phase=tracked_merged_but_open_issues elapsed_seconds=301 threshold_seconds=\d+ started_at=2026-03-20T00:10:00\.000Z/,
    );
  } finally {
    Date.now = originalDateNow;
    await clearCurrentReconciliationPhase(fixture.config);
  }
});

test("status classifies an old reconciliation marker as stale artifact when no live work exists", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
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

  const originalDateNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-03-20T00:10:00.000Z");
    await writeCurrentReconciliationPhase(fixture.config, "tracked_merged_but_open_issues");

    Date.now = () => Date.parse("2026-03-20T00:16:00.000Z");
    const status = await supervisor.status({ why: true });
    assert.doesNotMatch(status, /reconciliation_warning=long_running/);
    assert.match(
      status,
      /reconciliation_marker=stale_artifact phase=tracked_merged_but_open_issues classification=safe_to_ignore maintenance=yes/,
    );
    assert.match(status, /^selected_issue=none$/m);
    assert.match(status, /^selection_reason=no_runnable_issue$/m);
  } finally {
    Date.now = originalDateNow;
    await clearCurrentReconciliationPhase(fixture.config);
  }
});

test("acquireSupervisorLock reports reconciliation work when the run lock is already held", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const supervisor = new Supervisor(fixture.config);
  await writeCurrentReconciliationPhase(fixture.config, "tracked_merged_but_open_issues");

  const heldLock = await supervisor.acquireSupervisorLock("run-once");
  assert.equal(heldLock.acquired, true);

  try {
    const blockedLock = await supervisor.acquireSupervisorLock("run-once");
    assert.equal(blockedLock.acquired, false);
    assert.match(
      blockedLock.reason ?? "",
      /lock held by pid \d+ for supervisor-run-once for reconciliation work \(tracked_merged_but_open_issues\)/,
    );
  } finally {
    await heldLock.release();
    await clearCurrentReconciliationPhase(fixture.config);
  }
});

test("acquireSupervisorLock preserves the original denial when reconciliation phase reads fail", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const supervisor = new Supervisor(fixture.config);
  const originalReadFile = fs.readFile.bind(fs);
  const readFileMock = mock.method(
    fs,
    "readFile",
    async (...args: Parameters<typeof fs.readFile>) => {
      const [target] = args;
      if (String(target).endsWith("current-reconciliation-phase.json")) {
        const error = new Error("permission denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return originalReadFile(...args);
    },
  );

  const heldLock = await supervisor.acquireSupervisorLock("run-once");
  assert.equal(heldLock.acquired, true);

  try {
    const blockedLock = await supervisor.acquireSupervisorLock("run-once");
    assert.equal(blockedLock.acquired, false);
    assert.match(blockedLock.reason ?? "", /lock held by pid \d+ for supervisor-run-once/);
    assert.doesNotMatch(blockedLock.reason ?? "", /for reconciliation work/);
  } finally {
    readFileMock.mock.restore();
    await heldLock.release();
  }
});

test("runRecoveryAction refuses to mutate while the supervisor run lock is held", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 91;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: "verification",
        pr_number: null,
        codex_session_id: "session-91",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  const heldLock = await supervisor.acquireSupervisorLock("run-once");
  assert.equal(heldLock.acquired, true);

  try {
    await assert.rejects(
      supervisor.runRecoveryAction("requeue", issueNumber),
      /Cannot run recovery action while supervisor is active: lock held by pid \d+ for supervisor-run-once/,
    );
  } finally {
    await heldLock.release();
  }

  const persisted = JSON.parse(await fs.readFile(fixture.stateFile, "utf8")) as SupervisorStateFile;
  assert.equal(persisted.issues[String(issueNumber)]?.state, "blocked");
  assert.equal(persisted.issues[String(issueNumber)]?.codex_session_id, "session-91");
});

test("runRecoveryAction fails closed on ambiguous-owner supervisor run locks", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 91;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: "verification",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const lockPath = path.resolve(path.dirname(fixture.stateFile), "locks", "supervisor", "run.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    `${JSON.stringify({
      pid: 999_999,
      label: "supervisor-loop",
      acquired_at: "2026-03-20T00:00:00.000Z",
      host: "other-host",
      owner: "other-user",
    }, null, 2)}\n`,
    "utf8",
  );

  const supervisor = new Supervisor(fixture.config);
  await assert.rejects(
    supervisor.runRecoveryAction("requeue", issueNumber),
    /Cannot run recovery action while supervisor is active: .*ambiguous owner metadata/,
  );
  assert.deepEqual(JSON.parse(await fs.readFile(lockPath, "utf8")), {
    pid: 999_999,
    label: "supervisor-loop",
    acquired_at: "2026-03-20T00:00:00.000Z",
    host: "other-host",
    owner: "other-user",
  });
});

test("runRecoveryAction fail-closes requeue while corrupted JSON state is quarantined", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  await fs.writeFile(fixture.stateFile, "{not-json}\n", "utf8");

  const supervisor = new Supervisor(fixture.config);
  const result = await supervisor.runRecoveryAction("requeue", 91);

  assert.equal(result.action, "requeue");
  assert.equal(result.issueNumber, 91);
  assert.equal(result.outcome, "rejected");
  assert.match(
    result.summary,
    /Blocked execution-changing command: corrupted JSON supervisor state detected at .*state\.json\./,
  );
  assert.equal(result.previousState, null);
  assert.equal(result.nextState, null);
  assert.equal(result.recoveryReason, null);
});

test("pruneOrphanedWorkspaces prunes eligible orphan workspaces and reports skipped ineligible ones", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  fixture.config.cleanupOrphanedWorkspacesAfterHours = 24;

  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  await fs.mkdir(path.join(fixture.repoPath, "docs"), { recursive: true });
  await fs.writeFile(path.join(fixture.repoPath, "docs", "keep.md"), "keep docs directory\n", "utf8");
  await fs.writeFile(path.join(fixture.repoPath, "docs", "recent-orphan-delete.md"), "tracked orphan activity\n", "utf8");
  git(["-C", fixture.repoPath, "add", "docs/keep.md", "docs/recent-orphan-delete.md"]);
  git(["-C", fixture.repoPath, "commit", "-m", "Add nested orphan activity fixture"]);
  git(["-C", fixture.repoPath, "push", "origin", "main"]);

  const eligibleIssueNumber = 91;
  const eligibleBranch = branchName(fixture.config, eligibleIssueNumber);
  const eligibleWorkspace = path.join(fixture.workspaceRoot, `issue-${eligibleIssueNumber}`);
  git(["-C", fixture.repoPath, "worktree", "add", "-b", eligibleBranch, eligibleWorkspace, "origin/main"]);

  const recentIssueNumber = 92;
  const recentBranch = branchName(fixture.config, recentIssueNumber);
  const recentWorkspace = path.join(fixture.workspaceRoot, `issue-${recentIssueNumber}`);
  git(["-C", fixture.repoPath, "worktree", "add", "-b", recentBranch, recentWorkspace, "origin/main"]);

  const oldTime = new Date("2026-03-18T00:00:00.000Z");
  await fs.utimes(eligibleWorkspace, oldTime, oldTime);
  const recentActivityFile = path.join(recentWorkspace, "docs", "recent-orphan-delete.md");
  git(["-C", recentWorkspace, "rm", "docs/recent-orphan-delete.md"]);
  const recentActivityTimestamp = new Date((await fs.stat(path.dirname(recentActivityFile))).mtimeMs).toISOString();
  await fs.utimes(recentWorkspace, oldTime, oldTime);

  const supervisor = new Supervisor(fixture.config);
  const result = await supervisor.pruneOrphanedWorkspaces();

  assert.deepEqual(result, {
    action: "prune-orphaned-workspaces",
    outcome: "completed",
    summary: "Pruned 1 orphaned workspace(s); skipped 1 orphaned workspace(s).",
    pruned: [
      {
        issueNumber: eligibleIssueNumber,
        workspaceName: `issue-${eligibleIssueNumber}`,
        workspacePath: eligibleWorkspace,
        branch: eligibleBranch,
        modifiedAt: oldTime.toISOString(),
        reason: "safe orphaned git worktree",
      },
    ],
    skipped: [
      {
        issueNumber: recentIssueNumber,
        workspaceName: `issue-${recentIssueNumber}`,
        workspacePath: recentWorkspace,
        branch: recentBranch,
        modifiedAt: recentActivityTimestamp,
        eligibility: "recent",
        reason: "workspace modified within 24h grace period",
      },
    ],
  });

  await assert.rejects(fs.access(eligibleWorkspace));
  await fs.access(recentWorkspace);
  assert.match(git(["-C", fixture.repoPath, "branch", "--list", eligibleBranch]), /^$/);
  assert.match(git(["-C", fixture.repoPath, "branch", "--list", recentBranch]), new RegExp(recentBranch));
});

test("acquireSupervisorLock emits typed run-lock blockage events", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const emitted: unknown[] = [];
  const supervisor = new Supervisor(fixture.config, {
    onEvent: (event) => {
      emitted.push(event);
    },
  });
  await writeCurrentReconciliationPhase(fixture.config, "tracked_merged_but_open_issues");

  const heldLock = await supervisor.acquireSupervisorLock("run-once");
  assert.equal(heldLock.acquired, true);

  try {
    const blockedLock = await supervisor.acquireSupervisorLock("run-once");
    assert.equal(blockedLock.acquired, false);
  } finally {
    await heldLock.release();
    await clearCurrentReconciliationPhase(fixture.config);
  }

  assert.equal(emitted.length, 1);
  assert.deepEqual(
    { ...((emitted[0] ?? {}) as Record<string, unknown>), at: "normalized" },
    {
      type: "supervisor.run_lock.blocked",
      family: "run_lock",
      command: "run-once",
      reason: emitted[0] && typeof emitted[0] === "object" ? (emitted[0] as { reason?: unknown }).reason : undefined,
      reconciliationPhase: "tracked_merged_but_open_issues",
      at: "normalized",
    },
  );
});

test("status --why explains why the current runnable issue was selected", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "91": createRecord({
        issue_number: 91,
        state: "done",
        branch: branchName(fixture.config, 91),
        workspace: path.join(fixture.workspaceRoot, "issue-91"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
      "92": createRecord({
        issue_number: 92,
        state: "done",
        branch: branchName(fixture.config, 92),
        workspace: path.join(fixture.workspaceRoot, "issue-92"),
        journal_path: null,
        blocked_reason: null,
        last_error: null,
      }),
      "95": createRecord({
        issue_number: 95,
        state: "blocked",
        branch: branchName(fixture.config, 95),
        workspace: path.join(fixture.workspaceRoot, "issue-95"),
        journal_path: null,
        blocked_reason: "verification",
        last_error: "verification still failing",
        blocked_verification_retry_count: 1,
        repeated_blocker_count: fixture.config.sameBlockerRepeatLimit,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 95,
    title: "Blocked verification retry",
    body: `## Summary
Retry the failing verification.

## Scope
- rerun the failing check

## Acceptance criteria
- verification can pass

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/95",
    labels: [],
    state: "OPEN",
  };
  const predecessorIssueOne: GitHubIssue = {
    number: 91,
    title: "Step 1",
    body: `## Summary
Ship the first step.

## Scope
- start the execution order chain

## Acceptance criteria
- step one lands first

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 1 of 3`,
    createdAt: "2026-03-12T23:55:00Z",
    updatedAt: "2026-03-12T23:55:00Z",
    url: "https://example.test/issues/91",
    labels: [],
    state: "CLOSED",
  };
  const predecessorIssueTwo: GitHubIssue = {
    number: 92,
    title: "Step 2",
    body: `## Summary
Ship the second step.

## Scope
- continue the execution order chain

## Acceptance criteria
- step two lands after step one

## Verification
- npm test -- src/supervisor.test.ts

Part of: #150
Execution order: 2 of 3`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/92",
    labels: [],
    state: "CLOSED",
  };
  const selectedIssue: GitHubIssue = {
    number: 93,
    title: "Step 3",
    body: `## Summary
Ship the third step.

## Scope
- build after the first two steps land

## Acceptance criteria
- status explains why this issue is selected

## Verification
- npm test -- src/supervisor.test.ts

Depends on: #91
Part of: #150
Execution order: 3 of 3`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/93",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listAllIssues: async () => [predecessorIssueOne, predecessorIssueTwo, blockedIssue, selectedIssue],
    listCandidateIssues: async () => [blockedIssue, selectedIssue],
    getPullRequestIfExists: async () => null,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status({ why: true });

  assert.match(status, /selected_issue=#93/);
  assert.match(
    status,
    /selection_reason=ready execution_ready=yes depends_on=91:done execution_order=150\/3 predecessors=91\|92:done retry_state=fresh/,
  );
});

test("status surfaces tracked PR mismatches when GitHub is ready but local state is still blocked", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 171;
  const prNumber = 271;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "manual_review",
        last_error: "waiting on stale review signal",
        last_head_sha: "head-ready-271",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR mismatch",
    body: executionReadyBody("Surface GitHub-ready versus local-blocked tracked PR mismatches."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const readyPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-ready-271",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => readyPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_mismatch issue=#171 pr=#271 recoverability=stale_but_recoverable github_state=ready_to_merge github_blocked_reason=none local_state=blocked local_blocked_reason=manual_review stale_local_blocker=yes$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^recovery_guidance=Tracked PR facts are fresher than local state; run a one-shot supervisor cycle such as `node dist\/index\.js run-once --config \.\.\. --dry-run` to refresh tracked PR state\. Explicit requeue is unavailable for tracked PR work\.$/m,
  );

  const status = await supervisor.status();
  assert.match(
    status,
    /^tracked_pr_mismatch issue=#171 pr=#271 recoverability=stale_but_recoverable github_state=ready_to_merge github_blocked_reason=none local_state=blocked local_blocked_reason=manual_review stale_local_blocker=yes$/m,
  );
  assert.match(
    status,
    /^recovery_guidance=Tracked PR facts are fresher than local state; run a one-shot supervisor cycle such as `node dist\/index\.js run-once --config \.\.\. --dry-run` to refresh tracked PR state\. Explicit requeue is unavailable for tracked PR work\.$/m,
  );
});

test("status skips tracked PR hydration for historical done records", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 171;
  const prNumber = 271;
  const branch = branchName(fixture.config, issueNumber);
  const historicalRecords = Object.fromEntries(
    Array.from({ length: 160 }, (_, index) => {
      const historicalIssueNumber = 3000 + index;
      return [
        String(historicalIssueNumber),
        createRecord({
          issue_number: historicalIssueNumber,
          state: "done",
          branch,
          workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
          journal_path: null,
          pr_number: 5000 + index,
          blocked_reason: null,
          last_head_sha: `done-head-${historicalIssueNumber}`,
        }),
      ];
    }),
  );
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      ...historicalRecords,
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "manual_review",
        last_error: "waiting on stale review signal",
        last_head_sha: "head-ready-271",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR mismatch",
    body: executionReadyBody("Surface GitHub-ready versus local-blocked tracked PR mismatches."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const readyPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-ready-271",
  });

  let getPullRequestIfExistsCalls = 0;
  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async (requestedPrNumber: number) => {
      getPullRequestIfExistsCalls += 1;
      return requestedPrNumber === readyPr.number ? readyPr : null;
    },
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.equal(getPullRequestIfExistsCalls, 1);
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_mismatch issue=#171 pr=#271 recoverability=stale_but_recoverable github_state=ready_to_merge github_blocked_reason=none local_state=blocked local_blocked_reason=manual_review stale_local_blocker=yes$/m,
  );
});

test("status preserves draft tracked PR lifecycle when ready-for-review promotion is blocked by a repo-owned gate", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 174;
  const prNumber = 274;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "verification",
        last_error: "Configured local CI command failed before marking PR #274 ready.",
        last_head_sha: "head-draft-274",
        last_failure_signature: "local-ci-gate-non_zero_exit",
        latest_local_ci_result: {
          outcome: "failed",
          summary: "Configured local CI command failed before marking PR #274 ready.",
          ran_at: "2026-03-13T00:10:00Z",
          head_sha: "head-draft-274",
          execution_mode: "legacy_shell_string",
          command: "npm run verify:paths",
          stderr_summary: "docs/configuration.md contract drift: changed doc contract no longer matches repo-owned verifier expectation",
          failure_class: "non_zero_exit",
          remediation_target: "tracked_publishable_content",
          verifier_drift_hint:
            "repo_owned_verifier_drift: the repo-owned verifier appears to disagree with a changed docs or contract expectation; repair the verifier expectation or the repo content before rerunning local CI.",
        },
        timeline_artifacts: [
          {
            type: "verification_result",
            gate: "local_ci",
            command: "npm run verify:paths",
            head_sha: "head-draft-274",
            outcome: "failed",
            remediation_target: "tracked_publishable_content",
            next_action: "repair_tracked_publishable_content",
            summary: "Configured local CI command failed before marking PR #274 ready.",
            recorded_at: "2026-03-13T00:10:00Z",
          },
        ],
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked draft PR ready gate",
    body: executionReadyBody("Surface draft PR ready-promotion blockers as lifecycle-aware verification gates."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-draft-274",
    isDraft: true,
  });

  const supervisor = new Supervisor({
    ...fixture.config,
    localCiCommand: "npm run verify:paths",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_ready_promotion_blocked issue=#174 pr=#274 recoverability=manual_attention_required github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_ready_promotion_gate issue=#174 pr=#274 gate=local_ci summary=Configured local CI command failed before marking PR #274 ready\.$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_host_local_ci issue=#174 pr=#274 github_checks=green head_sha=head-draft-274 outcome=failed failure_class=non_zero_exit remediation_target=tracked_publishable_content head=current summary=Configured local CI command failed before marking PR #274 ready\. command=npm run verify:paths stderr_summary=docs\/configuration\.md contract drift: changed doc contract no longer matches repo-owned verifier expectation$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_host_local_ci_hint issue=#174 pr=#274 kind=repo_owned_verifier_drift summary=repo_owned_verifier_drift: the repo-owned verifier appears to disagree with a changed docs or contract expectation; repair the verifier expectation or the repo content before rerunning local CI\.$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^timeline_artifact issue=#174 pr=#274 type=verification_result gate=local_ci outcome=failed head_sha=head-draft-274 remediation_target=tracked_publishable_content next_action=repair_tracked_publishable_content command=npm run verify:paths summary=Configured local CI command failed before marking PR #274 ready\.$/m,
  );
  assert.deepEqual(report.trackedIssues[0]?.timelineArtifacts, state.issues[String(issueNumber)]?.timeline_artifacts);
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^recovery_guidance=PR #274 is still draft because ready-for-review promotion is blocked by a repo-owned gate\. The same blocker is still present, so rerunning the supervisor alone will not help\. Failed gate: npm run verify:paths\. Fix the gate in the tracked workspace first, then rerun it to promote the PR\.$/m,
  );
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /^tracked_pr_mismatch /m);

  const status = await supervisor.status();
  assert.match(
    status,
    /^tracked_pr_ready_promotion_blocked issue=#174 pr=#274 recoverability=manual_attention_required github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    status,
    /^tracked_pr_ready_promotion_gate issue=#174 pr=#274 gate=local_ci summary=Configured local CI command failed before marking PR #274 ready\.$/m,
  );
  assert.match(
    status,
    /^tracked_pr_host_local_ci issue=#174 pr=#274 github_checks=green head_sha=head-draft-274 outcome=failed failure_class=non_zero_exit remediation_target=tracked_publishable_content head=current summary=Configured local CI command failed before marking PR #274 ready\. command=npm run verify:paths stderr_summary=docs\/configuration\.md contract drift: changed doc contract no longer matches repo-owned verifier expectation$/m,
  );
  assert.match(
    status,
    /^tracked_pr_host_local_ci_hint issue=#174 pr=#274 kind=repo_owned_verifier_drift summary=repo_owned_verifier_drift: the repo-owned verifier appears to disagree with a changed docs or contract expectation; repair the verifier expectation or the repo content before rerunning local CI\.$/m,
  );
  assert.match(
    status,
    /^recovery_guidance=PR #274 is still draft because ready-for-review promotion is blocked by a repo-owned gate\. The same blocker is still present, so rerunning the supervisor alone will not help\. Failed gate: npm run verify:paths\. Fix the gate in the tracked workspace first, then rerun it to promote the PR\.$/m,
  );
  assert.doesNotMatch(status, /^tracked_pr_mismatch /m);
});

test("status marks old-head ready-promotion blockers as stale in recovery guidance", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 175;
  const prNumber = 275;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        pr_number: prNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: "verification",
        last_error: "Configured local CI command failed before marking PR #275 ready.",
        last_head_sha: "head-old-275",
        last_failure_signature: "local-ci-gate-non_zero_exit",
        latest_local_ci_result: {
          outcome: "failed",
          summary: "Configured local CI command failed before marking PR #275 ready.",
          ran_at: "2026-03-13T00:10:00Z",
          head_sha: "head-old-275",
          execution_mode: "legacy_shell_string",
          failure_class: "non_zero_exit",
          remediation_target: "tracked_publishable_content",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked stale draft PR ready gate",
    body: executionReadyBody("Surface stale draft PR ready-promotion blockers without implying the gate still fails."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-new-275",
    isDraft: true,
    currentHeadCiGreenAt: "2026-03-13T00:12:00Z",
  });

  const supervisor = new Supervisor({
    ...fixture.config,
    localCiCommand: "npm run verify:paths",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_ready_promotion_blocked issue=#175 pr=#275 recoverability=stale_but_recoverable github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^recovery_guidance=PR #275 is still draft, but the stored ready-for-review verification blocker is stale relative to the current head\. Run a one-shot supervisor cycle to refresh tracked PR state before assuming the gate still fails\.$/m,
  );
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /The same blocker is still present/);
});

test("status marks same-head ready-promotion blockers as stale when fresh blocker evidence is absent", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 176;
  const prNumber = 276;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        pr_number: prNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: "verification",
        last_error: "Tracked durable artifacts failed workstation-local path hygiene before marking PR #276 ready.",
        last_head_sha: "head-draft-276",
        last_failure_signature: "workstation-local-path-hygiene-failed",
        last_tracked_pr_progress_snapshot: JSON.stringify({
          headRefOid: "head-old-276",
          reviewDecision: null,
          mergeStateStatus: "CLEAN",
          copilotReviewState: null,
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
          configuredBotCurrentHeadObservedAt: null,
          configuredBotCurrentHeadStatusState: null,
          currentHeadCiGreenAt: "2026-03-13T00:08:00Z",
          configuredBotRateLimitedAt: null,
          configuredBotDraftSkipAt: null,
          configuredBotTopLevelReviewStrength: null,
          configuredBotTopLevelReviewSubmittedAt: null,
          checks: ["build:pass:SUCCESS:CI"],
          unresolvedReviewThreadIds: [],
        }),
        latest_local_ci_result: null,
        last_host_local_pr_blocker_comment_signature: null,
        last_host_local_pr_blocker_comment_head_sha: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked stale same-head draft PR ready gate",
    body: executionReadyBody("Surface stale same-head ready-promotion blockers without implying the gate still fails."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-draft-276",
    isDraft: true,
  });

  const supervisor = new Supervisor({
    ...fixture.config,
    localCiCommand: "npm run verify:paths",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_ready_promotion_blocked issue=#176 pr=#276 recoverability=stale_but_recoverable github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^recovery_guidance=PR #276 is still draft, but the stored ready-for-review verification blocker is stale relative to the current head\. Run a one-shot supervisor cycle to refresh tracked PR state before assuming the gate still fails\.$/m,
  );
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /The same blocker is still present/);
});

test("status keeps same-head host-local ready-promotion blockers current when the current head observation exists without a persisted blocker comment", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 177;
  const prNumber = 277;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        pr_number: prNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: "verification",
        last_error: "Tracked durable artifacts failed workstation-local path hygiene before marking PR #277 ready.",
        last_head_sha: "head-draft-277",
        last_failure_signature: "workstation-local-path-hygiene-failed",
        last_observed_host_local_pr_blocker_head_sha: "head-draft-277",
        last_observed_host_local_pr_blocker_signature: "workstation-local-path-hygiene-failed",
        last_tracked_pr_progress_snapshot: JSON.stringify({
          headRefOid: "head-old-277",
          reviewDecision: null,
          mergeStateStatus: "CLEAN",
          copilotReviewState: null,
          copilotReviewRequestedAt: null,
          copilotReviewArrivedAt: null,
          configuredBotCurrentHeadObservedAt: null,
          configuredBotCurrentHeadStatusState: null,
          currentHeadCiGreenAt: "2026-03-13T00:08:00Z",
          configuredBotRateLimitedAt: null,
          configuredBotDraftSkipAt: null,
          configuredBotTopLevelReviewStrength: null,
          configuredBotTopLevelReviewSubmittedAt: null,
          checks: ["build:pass:SUCCESS:CI"],
          unresolvedReviewThreadIds: [],
        }),
        latest_local_ci_result: null,
        last_host_local_pr_blocker_comment_signature: null,
        last_host_local_pr_blocker_comment_head_sha: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked current same-head draft PR ready gate",
    body: executionReadyBody("Surface current same-head ready-promotion blockers when comment publication is unavailable."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-draft-277",
    isDraft: true,
  });

  const supervisor = new Supervisor({
    ...fixture.config,
    localCiCommand: "npm run verify:paths",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_ready_promotion_blocked issue=#177 pr=#277 recoverability=manual_attention_required github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_ready_promotion_gate issue=#177 pr=#277 gate=workstation_local_path_hygiene remediation_target=tracked_publishable_content summary=Tracked durable artifacts failed workstation-local path hygiene before marking PR #277 ready\.$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^recovery_guidance=PR #277 is still draft because ready-for-review promotion is blocked by a repo-owned gate\. The same blocker is still present, so rerunning the supervisor alone will not help\./m,
  );
  assert.doesNotMatch(
    report.detailedStatusLines.join("\n"),
    /stored ready-for-review verification blocker is stale relative to the current head/,
  );
});

test("status preserves manual-review ready-promotion path hygiene remediation targets", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 179;
  const prNumber = 279;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        pr_number: prNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: "verification",
        last_error:
          "Tracked durable artifacts failed workstation-local path hygiene before marking PR #279 ready. Review repo policy or exclusions for expected-local durable artifacts.",
        last_head_sha: "head-draft-279",
        last_failure_signature: "workstation-local-path-hygiene-failed",
        last_failure_context: {
          category: "blocked",
          summary:
            "Tracked durable artifacts failed workstation-local path hygiene before marking PR #279 ready. Review repo policy or exclusions for expected-local durable artifacts.",
          signature: "workstation-local-path-hygiene-failed",
          command: "npm run verify:paths",
          details: [`WORKLOG.md:2 matched /${"Users"}/placeholder via "<workstation-local>"`],
          url: null,
          updated_at: "2026-03-13T00:10:00Z",
        },
        last_observed_host_local_pr_blocker_head_sha: "head-draft-279",
        last_observed_host_local_pr_blocker_signature: "workstation-local-path-hygiene-failed",
        last_host_local_pr_blocker_comment_signature:
          "workstation-local-path-hygiene-failed|gate=workstation_local_path_hygiene|failure=workstation-local-path-hygiene-failed|target=manual_review",
        last_host_local_pr_blocker_comment_head_sha: "head-draft-279",
        latest_local_ci_result: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked manual path hygiene draft PR ready gate",
    body: executionReadyBody("Surface manual ready-promotion path hygiene blockers."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-draft-279",
    isDraft: true,
  });

  const supervisor = new Supervisor({
    ...fixture.config,
    localCiCommand: "npm run verify:paths",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_ready_promotion_gate issue=#179 pr=#279 gate=workstation_local_path_hygiene remediation_target=manual_review summary=Tracked durable artifacts failed workstation-local path hygiene before marking PR #279 ready\. Review repo policy or exclusions for expected-local durable artifacts\.$/m,
  );
});

test("status distinguishes repairable ready-promotion path hygiene blockers queued for repair", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 178;
  const prNumber = 278;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "repairing_ci",
        branch,
        pr_number: prNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: null,
        last_error:
          "Ready-promotion path hygiene found actionable publishable tracked content; supervisor will retry a repair turn before marking the draft PR ready. Actionable files: scripts/check-paths.sh.",
        last_head_sha: "head-draft-278",
        last_failure_signature: "workstation-local-path-hygiene-failed",
        last_failure_context: {
          category: "blocked",
          summary:
            "Ready-promotion path hygiene found actionable publishable tracked content; supervisor will retry a repair turn before marking the draft PR ready. Actionable files: scripts/check-paths.sh.",
          signature: "workstation-local-path-hygiene-failed",
          command: "npm run verify:paths",
          details: [`scripts/check-paths.sh:4 matched /${"home"}/placeholder via "<workspace-root>"`],
          url: null,
          updated_at: "2026-03-13T00:10:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked repairable draft PR ready gate",
    body: executionReadyBody("Surface repairable draft PR ready-promotion blockers."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-draft-278",
    isDraft: true,
  });

  const supervisor = new Supervisor({
    ...fixture.config,
    localCiCommand: "npm run verify:paths",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status();
  assert.match(
    status,
    /^no_active_tracked_record issue=#178 classification=repair_already_queued state=repairing_ci reason=repairable_path_hygiene_retry_state$/m,
  );
  assert.match(
    status,
    /^tracked_pr_ready_promotion_blocked issue=#178 pr=#278 recoverability=repair_queued github_state=draft_pr local_state=repairing_ci local_blocked_reason=none stale_local_blocker=no$/m,
  );
  assert.match(
    status,
    /^tracked_pr_ready_promotion_gate issue=#178 pr=#278 gate=workstation_local_path_hygiene remediation_target=repair_already_queued summary=Ready-promotion path hygiene found actionable publishable tracked content; supervisor will retry a repair turn before marking the draft PR ready\. Actionable files: scripts\/check-paths\.sh\.$/m,
  );
  assert.match(
    status,
    /^recovery_guidance=PR #278 is still draft because ready-for-review promotion found repairable workstation-local path hygiene findings\. The supervisor has queued a repair turn for the actionable publishable tracked files before retrying promotion\.$/m,
  );
});

test("status surfaces host-local CI blocker details for tracked PR mismatches", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 171;
  const prNumber = 271;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "verification",
        last_error:
          "Configured local CI command could not run before marking PR #271 ready because the workspace toolchain is unavailable. Remediation target: workspace environment.",
        last_head_sha: "head-ready-271",
        last_failure_signature: "local-ci-gate-workspace_toolchain_missing",
        latest_local_ci_result: {
          outcome: "failed",
          summary:
            "Configured local CI command could not run before marking PR #271 ready because the workspace toolchain is unavailable. Remediation target: workspace environment.",
          ran_at: "2026-03-13T00:10:00Z",
          head_sha: "head-ready-271",
          execution_mode: "legacy_shell_string",
          failure_class: "workspace_toolchain_missing",
          remediation_target: "workspace_environment",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR host-local CI blocker",
    body: executionReadyBody("Surface host-local tracked PR blockers even when GitHub is green."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const readyPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-ready-271",
    currentHeadCiGreenAt: "2026-03-13T00:12:00Z",
  });

  const supervisor = new Supervisor({
    ...fixture.config,
    localCiCommand: "npm run ci:local",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => readyPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_host_local_ci issue=#171 pr=#271 github_checks=green head_sha=head-ready-271 outcome=failed failure_class=workspace_toolchain_missing remediation_target=workspace_environment head=current summary=Configured local CI command could not run before marking PR #271 ready because the workspace toolchain is unavailable\. Remediation target: workspace environment\.$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_host_local_ci_gap issue=#171 pr=#271 workspace_preparation_command=unset gap=missing_workspace_prerequisite_visibility likely_cause=localCiCommand is configured but workspacePreparationCommand is unset\..*$/m,
  );

  const status = await supervisor.status();
  assert.match(
    status,
    /^tracked_pr_host_local_ci issue=#171 pr=#271 github_checks=green head_sha=head-ready-271 outcome=failed failure_class=workspace_toolchain_missing remediation_target=workspace_environment head=current summary=Configured local CI command could not run before marking PR #271 ready because the workspace toolchain is unavailable\. Remediation target: workspace environment\.$/m,
  );
  assert.match(
    status,
    /^operator_action action=fix_config source=tracked_pr_host_local_ci priority=80 summary=Host-local CI could not run because the workspace environment is missing prerequisites; fix configuration or workspace preparation before continuing\.$/m,
  );
  assert.match(
    status,
    /^tracked_pr_host_local_ci_gap issue=#171 pr=#271 workspace_preparation_command=unset gap=missing_workspace_prerequisite_visibility likely_cause=localCiCommand is configured but workspacePreparationCommand is unset\..*$/m,
  );
});

test("status uses a generic workspace-preparation cause when tracked PR local CI is no longer configured", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 171;
  const prNumber = 271;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "verification",
        last_error:
          "Configured local CI command could not run before marking PR #271 ready because the workspace toolchain is unavailable. Remediation target: workspace environment.",
        last_head_sha: "head-ready-271",
        last_failure_signature: "local-ci-gate-workspace_toolchain_missing",
        latest_local_ci_result: {
          outcome: "failed",
          summary:
            "Configured local CI command could not run before marking PR #271 ready because the workspace toolchain is unavailable. Remediation target: workspace environment.",
          ran_at: "2026-03-13T00:10:00Z",
          head_sha: "head-ready-271",
          execution_mode: "legacy_shell_string",
          failure_class: "workspace_toolchain_missing",
          remediation_target: "workspace_environment",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR host-local CI blocker",
    body: executionReadyBody("Surface host-local tracked PR blockers even when GitHub is green."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const readyPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-ready-271",
    currentHeadCiGreenAt: "2026-03-13T00:12:00Z",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => readyPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^tracked_pr_host_local_ci_gap issue=#171 pr=#271 workspace_preparation_command=unset gap=missing_workspace_prerequisite_visibility likely_cause=workspacePreparationCommand is unset while host-local CI reported missing workspace toolchain prerequisites\.$/m,
  );
  assert.doesNotMatch(
    report.detailedStatusLines.join("\n"),
    /likely_cause=localCiCommand is configured but workspacePreparationCommand is unset\./,
  );

  const status = await supervisor.status();
  assert.match(
    status,
    /^tracked_pr_host_local_ci_gap issue=#171 pr=#271 workspace_preparation_command=unset gap=missing_workspace_prerequisite_visibility likely_cause=workspacePreparationCommand is unset while host-local CI reported missing workspace toolchain prerequisites\.$/m,
  );
  assert.doesNotMatch(
    status,
    /likely_cause=localCiCommand is configured but workspacePreparationCommand is unset\./,
  );
});

test("status does not surface tracked PR mismatch diagnostics after tracked PR recovery persists draft_pr state", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 172;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "draft_pr",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 272,
        blocked_reason: null,
        last_error: null,
        last_head_sha: "head-272",
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        last_recovery_reason:
          "tracked_pr_lifecycle_recovered: resumed issue #172 from failed to draft_pr using fresh tracked PR #272 facts at head head-272",
        last_recovery_at: "2026-03-13T00:20:00Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR recovery converged",
    body: executionReadyBody("Status should reflect the resumed tracked PR lifecycle state."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: 272,
    headRefName: branch,
    headRefOid: "head-272",
    isDraft: true,
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => draftPr,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /^tracked_pr_mismatch /m);
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /^recovery_guidance=/m);

  const status = await supervisor.status();
  assert.doesNotMatch(status, /^tracked_pr_mismatch /m);
  assert.doesNotMatch(status, /^recovery_guidance=/m);
  assert.match(
    status,
    /^latest_recovery issue=#172 at=2026-03-13T00:20:00Z reason=tracked_pr_lifecycle_recovered detail=resumed issue #172 from failed to draft_pr using fresh tracked PR #272 facts at head head-272$/m,
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

test("status does not surface tracked PR mismatch diagnostics after tracked PR recovery persists addressing_review state", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = ["copilot-pull-request-reviewer"];
  const issueNumber = 173;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 273,
        blocked_reason: null,
        last_error: null,
        last_head_sha: "head-273",
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        last_recovery_reason:
          "tracked_pr_lifecycle_recovered: resumed issue #173 from failed to addressing_review using fresh tracked PR #273 facts at head head-273",
        last_recovery_at: "2026-03-13T00:20:00Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR review recovery converged",
    body: executionReadyBody("Status should reflect the resumed tracked PR review lifecycle state."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const reviewPr = createPullRequest({
    number: 273,
    headRefName: branch,
    headRefOid: "head-273",
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => reviewPr,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport();
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /^tracked_pr_mismatch /m);
  assert.doesNotMatch(report.detailedStatusLines.join("\n"), /^recovery_guidance=/m);

  const status = await supervisor.status();
  assert.doesNotMatch(status, /^tracked_pr_mismatch /m);
  assert.doesNotMatch(status, /^recovery_guidance=/m);
  assert.match(
    status,
    /^latest_recovery issue=#173 at=2026-03-13T00:20:00Z reason=tracked_pr_lifecycle_recovered detail=resumed issue #173 from failed to addressing_review using fresh tracked PR #273 facts at head head-273$/m,
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
