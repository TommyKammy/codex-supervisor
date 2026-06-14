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
  createConfig,
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
  formatStaleReviewMetadataConvergenceDiagnostic,
  formatStaleReviewBotTerminalStopLine,
} from "./stale-review-bot-diagnostics-presenter";
import {
  buildCodexConnectorDiagnosticBundle,
  formatStaleReviewResidueOperatorDiagnostic,
} from "./supervisor-status-review-bot";
import { buildStaleReviewBotRemediation } from "./stale-review-bot-remediation";
import {
  clearCurrentReconciliationPhase,
  writeCurrentReconciliationPhase,
} from "./supervisor-reconciliation-phase";

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

test("stale review-bot presenter keeps residue and metadata diagnostic lines stable", () => {
  const remediation = {
    issueNumber: 366,
    prNumber: 44,
    reasonCode: "stale_review_bot" as const,
    currentHeadSha: "deadbeef",
    processedOnCurrentHead: "yes" as const,
    codeCiState: "green" as const,
    classification: "metadata_only_missing_current_head_review" as const,
    codexCurrentHeadReviewState: "missing" as const,
    reviewThreadUrl: "https://example.test/pr/44#discussion_r44",
    verificationEvidenceSummary: null,
    missingProbeReason: null,
    manualNextStep: "inspect_exact_review_thread_then_resolve_or_leave_manual_note",
    summary: "code_or_ci_green_but_review_thread_metadata_unresolved",
  };

  assert.equal(
    formatStaleReviewResidueOperatorDiagnostic(remediation),
    "codex_connector_operator_diagnostic interpretation=stale_review_residue current_head_sha=deadbeef latest_configured_bot_review_sha=deadbeef current_head_review_signal=missing actionable_current_diff_threads=0 next_action=request_current_head_review",
  );
  assert.equal(
    formatStaleReviewMetadataConvergenceDiagnostic({
      remediation: {
        ...remediation,
        classification: "metadata_only" as const,
        codexCurrentHeadReviewState: "observed" as const,
      },
      pr: createPullRequest({
        headRefOid: "deadbeef",
        configuredBotCurrentHeadObservedAt: "2026-05-15T00:17:00Z",
      }),
    }),
    "codex_connector_convergence status=stale_review_metadata provider=codex current_head_sha=deadbeef current_head_observed_at=2026-05-15T00:17:00Z latest_signal_head_sha=deadbeef highest_severity=none finding_count=0 merge_effect=ready next_action=merge_ready stale_review_metadata_classification=metadata_only issue=#366 pr=#44",
  );
  assert.equal(
    formatStaleReviewBotTerminalStopLine({
      remediation,
      diagnostics: {
        issueNumber: 366,
        prNumber: 44,
        currentHeadSuccess: "yes",
        unresolvedCurrentThreads: 1,
        actionableMustFixThreads: 0,
        verifiedStaleResidueThreads: 0,
        missingVerificationEvidenceThreads: 0,
        repeatStopExhausted: "no",
        autoRepairSuppressedReason: "not_verified_stale_residue",
      },
    }),
    "stale_review_bot_terminal_stop issue=#366 pr=#44 reason=metadata_only_review_thread_resolution_pending classification=metadata_only_missing_current_head_review head_freshness=processed_on_current_head:yes,current_head_success:yes review_thread_classification=unresolved:1,must_fix:0,verified_residue:0 auto_repair_suppressed_reason=not_verified_stale_residue next_action=request_current_head_review",
  );
});

test("stale review-bot terminal stop only reports merge-ready when GitHub is merge-ready", () => {
  const remediation = {
    issueNumber: 401,
    prNumber: 501,
    reasonCode: "stale_review_bot" as const,
    currentHeadSha: "head-401",
    processedOnCurrentHead: "yes" as const,
    codeCiState: "green" as const,
    classification: "verified_current_head_repair_pending_thread_resolution" as const,
    codexCurrentHeadReviewState: "observed" as const,
    reviewThreadUrl: "https://example.test/pr/501#discussion_r401",
    verificationEvidenceSummary: "focused_verifier_passed;codex_pr_success_comment_after_current_head_request",
    missingProbeReason: null,
    manualNextStep: "resolve_verified_repaired_configured_bot_threads_then_rerun_supervisor",
    summary: "verified_current_head_repair_configured_bot_thread_resolution_pending",
  };
  const diagnostics = {
    issueNumber: 401,
    prNumber: 501,
    currentHeadSuccess: "yes" as const,
    unresolvedCurrentThreads: 1,
    actionableMustFixThreads: 1,
    verifiedStaleResidueThreads: 1,
    missingVerificationEvidenceThreads: 0,
    repeatStopExhausted: "no" as const,
    autoRepairSuppressedReason: "none" as const,
  };

  assert.match(
    formatStaleReviewBotTerminalStopLine({
      remediation,
      diagnostics,
      pr: createPullRequest({ reviewDecision: "CHANGES_REQUESTED" }),
    }) ?? "",
    /next_action=resolve_verified_review_thread_metadata$/,
  );
  assert.match(
    formatStaleReviewBotTerminalStopLine({
      remediation,
      diagnostics,
      pr: createPullRequest(),
      checks: [{ bucket: "pass" }],
    }) ?? "",
    /next_action=merge_ready$/,
  );
  assert.match(
    formatStaleReviewBotTerminalStopLine({
      remediation,
      diagnostics,
      pr: createPullRequest(),
      checks: [],
    }) ?? "",
    /next_action=resolve_verified_review_thread_metadata$/,
  );
});

test("Codex connector operator diagnostic honors auto-repair suppression before merge-ready", () => {
  const issueNumber = 402;
  const prNumber = 502;
  const headSha = "76060523f803ebe25832cb2c355aaaa9530502f5";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-402",
    commentId: "comment-402",
    path: "src/auth-boundary.ts",
    line: 91,
    severity: "P2",
    commentBody: "P2: Prove the repaired auth boundary is covered before merge.",
    discussionUrl: "https://example.test/pr/502#discussion_r402",
    verifiedRepair: {
      summary: "Focused verifier passed after the repair commit.",
      ranAt: "2026-05-15T00:18:00Z",
      command: "npx tsx --test src/supervisor/supervisor-diagnostics-stale-review-bot-status.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-15T00:12:00Z",
      observedAt: "2026-05-15T00:17:00Z",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    processed_review_thread_ids: [
      ...(scenario.recordPatch.processed_review_thread_ids ?? []),
      `thread-402@${headSha}`,
    ],
    processed_review_thread_fingerprints: [
      ...(scenario.recordPatch.processed_review_thread_fingerprints ?? []),
      `thread-402@${headSha}#comment-402-maintainer-follow-up`,
    ],
  });
  const pr = createPullRequest(scenario.pullRequestPatch);
  const suppressedThread = {
    ...scenario.reviewThread,
    comments: {
      nodes: [
        ...scenario.reviewThread.comments.nodes,
        {
          id: "comment-402-maintainer-follow-up",
          body: "Leaving this unresolved until the operator confirms the thread outcome.",
          createdAt: "2026-05-15T00:19:00Z",
          url: "https://example.test/pr/502#discussion_r402_human",
          author: {
            login: "maintainer",
            typeName: "User",
          },
        },
      ],
    },
  };
  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [suppressedThread],
  });
  assert.equal(remediation?.classification, "verified_current_head_repair_pending_thread_resolution");

  const diagnostics = buildCodexConnectorDiagnosticBundle({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [suppressedThread],
    staleReviewBotRemediation: remediation,
  });

  assert.match(
    diagnostics.operatorDiagnosticSummary ?? "",
    /next_action=resolve_verified_repaired_configured_bot_threads_then_rerun_supervisor$/,
  );
  assert.doesNotMatch(diagnostics.operatorDiagnosticSummary ?? "", /next_action=merge_ready$/);

  const missingChecksDiagnostics = buildCodexConnectorDiagnosticBundle({
    config,
    record,
    pr,
    checks: [],
    reviewThreads: [scenario.reviewThread],
    staleReviewBotRemediation: remediation,
  });

  assert.match(
    missingChecksDiagnostics.operatorDiagnosticSummary ?? "",
    /next_action=resolve_verified_repaired_configured_bot_threads_then_rerun_supervisor$/,
  );
  assert.doesNotMatch(missingChecksDiagnostics.operatorDiagnosticSummary ?? "", /next_action=merge_ready$/);
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
  assert.match(
    status,
    /^stale_review_bot_terminal_stop issue=#365 pr=#372 reason=metadata_only_review_thread_resolution_pending classification=metadata_only head_freshness=processed_on_current_head:yes,current_head_success:yes review_thread_classification=unresolved:1,must_fix:\d+,verified_residue:0 auto_repair_suppressed_reason=not_verified_stale_residue next_action=manual_review_thread_handling$/m,
  );
  assert.match(status, /^operator_action action=resolve_stale_review_bot /m);
  assert.doesNotMatch(status, /provider_outage_suspected/);
  assert.doesNotMatch(status, /stale_review_bot_provider_signal_missing/);
});

test("status --why reports effective configured-bot thread diagnostics for outdated Codex residue", async (t) => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  const issueNumber = 183;
  const prNumber = 283;
  const headSha = "5de0d3844468d4a77cab512f8dcbe46171166c3a";
  const { branch, pr, state } = createTrackedPullRequestStatusScenario(fixture, {
    issueNumber,
    prNumber,
    state: "waiting_ci",
    headSha,
    recordOverrides: {
      blocked_reason: null,
      last_error: null,
      last_failure_context: null,
      last_failure_signature: null,
    },
  });
  await writeSupervisorState(fixture, state);
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const trackedIssue = createTrackedStatusIssue({
    issueNumber,
    title: "HRCore shaped outdated Codex residue",
    summary: "Report effective unresolved review-thread diagnostics.",
  });
  const currentHeadPr = createPullRequest({
    ...pr,
    headRefName: branch,
    headRefOid: headSha,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    currentHeadCiGreenAt: "2026-05-15T00:10:00Z",
    configuredBotCurrentHeadObservedAt: "2026-05-15T00:16:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
  });
  const outdatedThread = {
    id: "PRRT_hrcore_183_outdated",
    isResolved: false,
    isOutdated: true,
    path: "src/review-policy.ts",
    line: 42,
    comments: {
      nodes: [
        {
          id: "PRRC_hrcore_183_outdated",
          body: "P1: stale finding from a previous diff.",
          createdAt: "2026-05-15T00:05:00Z",
          url: "https://example.test/pr/283#discussion_r183",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
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
    resolvePullRequestForBranch: async () => currentHeadPr,
    getPullRequestIfExists: async () => currentHeadPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [outdatedThread],
  };

  const status = await supervisor.status({ why: true });

  assert.match(
    status,
    /^review_threads bot_pending=1 bot_unresolved=0 bot_effective_unresolved=0 bot_outdated_unresolved=1 manual=0$/m,
  );
  assert.match(
    status,
    /^review_thread_effective_diagnostics raw_configured_bot_unresolved=1 effective_configured_bot_unresolved=0 current_configured_bot_threads=0 outdated_configured_bot_residue=1 current_thread_ids=none$/m,
  );
});

test("status --why uses the shared stale review-bot presenter for active verified repair residue", async (t) => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  const issueNumber = 400;
  const prNumber = 500;
  const headSha = "76060523f803ebe25832cb2c355aaaa9530502f4";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-400",
    commentId: "comment-400",
    path: "src/auth-boundary.ts",
    line: 91,
    severity: "P2",
    commentBody: "P2: Prove the repaired auth boundary is covered before merge.",
    discussionUrl: "https://example.test/pr/500#discussion_r400",
    verifiedRepair: {
      summary: "Focused verifier passed after the repair commit.",
      ranAt: "2026-05-15T00:18:00Z",
      command: "npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-15T00:12:00Z",
      observedAt: "2026-05-15T00:17:00Z",
    },
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        ...scenario.recordPatch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue = createTrackedStatusIssue({
    issueNumber,
    title: "Status why active Codex verified repair residue",
    summary: "Status should classify active verified Codex repair residue distinctly.",
  });
  const pr = createPullRequest(scenario.pullRequestPatch);

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => pr,
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => scenario.passingChecks,
    getUnresolvedReviewThreads: async () => [scenario.reviewThread],
  };

  const status = await supervisor.status({ why: true });
  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    status,
    /^stale_review_bot_remediation issue=#400 pr=#500 reason=stale_review_bot code_ci=green current_head_sha=76060523f803ebe25832cb2c355aaaa9530502f4 processed_on_current_head=yes classification=verified_current_head_repair_pending_thread_resolution codex_current_head_review_state=observed review_thread_url=https:\/\/example\.test\/pr\/500#discussion_r400 manual_next_step=resolve_verified_repaired_configured_bot_threads_then_rerun_supervisor verification_evidence=Focused_verifier_passed_after_the_repair_commit\.;codex_pr_success_comment_after_current_head_request summary=verified_current_head_repair_configured_bot_thread_resolution_pending$/m,
  );
  assert.match(
    status,
    /^codex_connector_convergence status=stale_review_metadata provider=codex current_head_sha=76060523f803ebe25832cb2c355aaaa9530502f4 current_head_observed_at=2026-05-15T00:17:00Z latest_signal_head_sha=76060523f803ebe25832cb2c355aaaa9530502f4 highest_severity=none finding_count=0 merge_effect=ready next_action=merge_ready stale_review_metadata_classification=verified_current_head_repair_pending_thread_resolution issue=#400 pr=#500$/m,
  );
  assert.doesNotMatch(status, /^codex_connector_convergence status=stale_head /m);
  assert.doesNotMatch(status, /^codex_connector_operator_diagnostic interpretation=actionable_current_diff /m);
  assert.doesNotMatch(status, /^failure_context category=manual summary=1 configured bot review thread\(s\) remain/m);
  assert.doesNotMatch(explanation, /^failure_summary=1 configured bot review thread\(s\) remain/m);
  assert.doesNotMatch(status, /classification=verified_no_source_change_pending_thread_resolution/);
});
