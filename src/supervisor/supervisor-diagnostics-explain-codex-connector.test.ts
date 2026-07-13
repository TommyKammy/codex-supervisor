import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type {
  GitHubIssue,
  SupervisorStateFile,
} from "../core/types";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createPullRequest,
  createSupervisorFixture,
  executionReadyBody,
} from "./supervisor-test-helpers";
import { CODEX_CONNECTOR_REVIEW_BOT_LOGIN } from "../codex-connector-tracked-pr-test-helpers";
import {
  codexConnectorDiagnosticLines,
  createTrackedPullRequestExplainScenario,
  writeExternalReviewDigest,
  writeSupervisorState,
} from "./supervisor-diagnostics-explain-scenarios";

test("status and explain share Codex Connector diagnostics for the same tracked PR", async () => {
  const fixture = await createSupervisorFixture();
  const scenario = createTrackedPullRequestExplainScenario(fixture, {
    issueNumber: 1961,
    prNumber: 2961,
    headSha: "head-1961",
    title: "Codex Connector diagnostic parity",
    summary: "Status and explain should report the same Codex Connector diagnostics.",
    issueCreatedAt: "2026-05-08T03:00:00Z",
    issueUpdatedAt: "2026-05-08T03:30:00Z",
    recordOverrides: {
      codex_connector_review_requested_observed_at: "2026-05-08T03:30:00Z",
      codex_connector_review_requested_head_sha: "head-1961",
    },
    pullRequestOverrides: {
      currentHeadCiGreenAt: "2026-05-08T03:09:36Z",
      configuredBotCurrentHeadObservedAt: null,
      codexConnectorReviewRequestedAt: "2026-05-08T03:30:00Z",
      codexConnectorReviewRequestedHeadSha: "head-1961",
    },
    checks: [{ name: "build", state: "SUCCESS" as const, bucket: "pass" as const, workflow: "CI" }],
  });
  await writeSupervisorState(fixture, scenario.state);

  const supervisor = new Supervisor({
    ...fixture.config,
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => scenario.issue,
    listAllIssues: async () => [scenario.issue],
    listCandidateIssues: async () => [scenario.issue],
    resolvePullRequestForBranch: async () => scenario.pr,
    getChecks: async () => scenario.checks,
    getUnresolvedReviewThreads: async () => [],
  };

  const [status, explanation] = await Promise.all([
    supervisor.statusReport({ why: true }),
    supervisor.explain(scenario.issueNumber),
  ]);

  assert.deepEqual(
    codexConnectorDiagnosticLines(status.detailedStatusLines.join("\n")).sort(),
    codexConnectorDiagnosticLines(explanation).sort(),
  );
});

test("explain surfaces merged PR convergence as an operator event for a tracked record", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 156;
  const prNumber = 656;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "done",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        last_recovery_reason: `merged_pr_convergence: tracked PR #${prNumber} merged; marked issue #${issueNumber} done`,
        last_recovery_at: "2026-04-25T00:30:00Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const owningIssue: GitHubIssue = {
    number: issueNumber,
    title: "Done issue after tracked PR convergence",
    body: executionReadyBody("Explain should show the merged PR convergence event."),
    createdAt: "2026-04-25T00:00:00Z",
    updatedAt: "2026-04-25T00:30:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "CLOSED",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => owningIssue,
    listAllIssues: async () => [owningIssue],
    listCandidateIssues: async () => [],
    getPullRequestIfExists: async () =>
      createPullRequest({
        number: prNumber,
        headRefName: branch,
        mergedAt: "2026-04-25T00:25:00Z",
      }),
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^operator_event type=merged_pr_convergence issue=#156 at=2026-04-25T00:30:00Z detail=tracked PR #656 merged; marked issue #156 done$/m,
  );
  assert.match(
    explanation,
    /^latest_recovery issue=#156 at=2026-04-25T00:30:00Z reason=merged_pr_convergence detail=tracked PR #656 merged; marked issue #156 done$/m,
  );
});

test("explain surfaces Codex Connector review-request fallback lifecycle for the tracked PR", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 1925;
  const prNumber = 2925;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "waiting_ci",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        last_head_sha: "head-1925",
        codex_connector_review_requested_observed_at: "2026-05-08T03:30:00Z",
        codex_connector_review_requested_head_sha: "head-1925",
        codex_connector_review_request_comment_identity_status: "available",
        codex_connector_review_request_comment_database_id: 2925001,
        codex_connector_review_request_comment_node_id: "IC_head_1925_initial",
        codex_connector_review_request_comment_url:
          "https://github.com/owner/repo/pull/2925#issuecomment-2925001",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Codex Connector fallback lifecycle",
    body: executionReadyBody("Explain should report Codex Connector fallback lifecycle."),
    createdAt: "2026-05-08T03:00:00Z",
    updatedAt: "2026-05-08T03:30:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor({
    ...fixture.config,
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () =>
      createPullRequest({
        number: prNumber,
        headRefName: branch,
        headRefOid: "head-1925",
        currentHeadCiGreenAt: "2026-05-08T03:09:36Z",
        configuredBotCurrentHeadObservedAt: null,
        codexConnectorReviewRequestedAt: "2026-05-08T03:30:00Z",
        codexConnectorReviewRequestedHeadSha: "head-1925",
      }),
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^codex_connector_review_fallback status=request_posted_no_current_head_signal provider=codex current_head_sha=head-1925 current_head_observed_at=none required_checks_green_at=2026-05-08T03:09:36Z timeout_action=request_review_comment requested_at=2026-05-08T03:30:00Z requested_head_sha=head-1925 review_signal=missing note=request_comment_is_not_review_completion retry_status=eligible retry_count=0 retry_limit=1 retry_wait_until=2026-05-08T03:40:00\.000Z request_comment_identity=database_id=2925001,node_id=IC_head_1925_initial,url=https:\/\/github\.com\/owner\/repo\/pull\/2925#issuecomment-2925001 next_action=retry_request_review_comment wait_until=2026-05-08T03:19:36\.000Z$/m,
  );
  assert.match(
    explanation,
    /^codex_connector_convergence status=re_requested_review provider=codex current_head_sha=head-1925 current_head_observed_at=none latest_signal_head_sha=none highest_severity=none finding_count=0 merge_effect=blocked next_action=wait_for_requested_review$/m,
  );
});

test("explain distinguishes hydrated same-head Codex Connector review requests", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 1958;
  const prNumber = 2958;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "waiting_ci",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        last_head_sha: "head-1958",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Codex Connector hydrated request lifecycle",
    body: executionReadyBody("Explain should report Codex Connector hydrated request lifecycle."),
    createdAt: "2026-05-08T03:00:00Z",
    updatedAt: "2026-05-08T03:30:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor({
    ...fixture.config,
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () =>
      createPullRequest({
        number: prNumber,
        headRefName: branch,
        headRefOid: "head-1958",
        currentHeadCiGreenAt: "2026-05-08T03:09:36Z",
        configuredBotCurrentHeadObservedAt: null,
        codexConnectorReviewRequestedAt: "2026-05-08T03:30:00Z",
        codexConnectorReviewRequestedHeadSha: "head-1958",
      }),
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^codex_connector_review_fallback status=request_posted_no_current_head_signal provider=codex current_head_sha=head-1958 current_head_observed_at=none required_checks_green_at=2026-05-08T03:09:36Z timeout_action=request_review_comment requested_at=2026-05-08T03:30:00Z requested_head_sha=head-1958 review_signal=missing note=request_comment_is_not_review_completion retry_status=eligible retry_count=0 retry_limit=1 retry_wait_until=2026-05-08T03:40:00\.000Z request_comment_identity=unavailable next_action=retry_request_review_comment wait_until=2026-05-08T03:19:36\.000Z$/m,
  );
  assert.match(
    explanation,
    /^codex_connector_convergence status=same_head_request_hydrated provider=codex current_head_sha=head-1958 current_head_observed_at=none latest_signal_head_sha=none highest_severity=none finding_count=0 merge_effect=blocked next_action=wait_for_requested_review$/m,
  );
  assert.match(
    explanation,
    /^codex_connector_operator_diagnostic interpretation=review_gate_waiting current_head_sha=head-1958 latest_configured_bot_review_sha=none current_head_review_signal=missing actionable_current_diff_threads=0 next_action=wait_for_requested_review$/m,
  );
});

test("explain reports stale review residue without implying an unposted Codex request timed out", async (t) => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-19T09:14:00Z");
  t.after(() => {
    Date.now = originalDateNow;
  });
  const fixture = await createSupervisorFixture();
  const issueNumber = 143;
  const prNumber = 147;
  const branch = branchName(fixture.config, issueNumber);
  const currentHead = "c1ac7215a12398842152b1daf42311faef297317";
  const staleReviewHead = "98da2474c530b76dae67b5a6f43e0671b989f65a";
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch,
        pr_number: prNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        last_head_sha: currentHead,
        provider_success_head_sha: staleReviewHead,
        provider_success_observed_at: "2026-05-18T22:30:16Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain Codex stale review residue",
    body: executionReadyBody("Explain should request a current-head Codex review for stale residue."),
    createdAt: "2026-05-19T09:00:00Z",
    updatedAt: "2026-05-19T09:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: currentHead,
    isDraft: false,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    currentHeadCiGreenAt: "2026-05-19T09:03:41Z",
    configuredBotCurrentHeadObservedAt: null,
    configuredBotLatestReviewedCommitSha: staleReviewHead,
    configuredBotTopLevelReviewStrength: "blocking",
    configuredBotTopLevelReviewSubmittedAt: "2026-05-18T22:30:16Z",
    requiredConversationResolution: {
      state: "enabled",
      source: "branch_protection",
      details: ["required_conversation_resolution=true"],
    },
  });
  const staleCommitThreads = [
    {
      id: "PRRT_kwDOSfC_1M6DF5s7",
      isResolved: false,
      isOutdated: false,
      path: "src/local-sqlite.ts",
      line: 120,
      comments: {
        nodes: [
          {
            id: "comment-stale-1",
            body: "P1: Run new migrations for existing local databases.",
            createdAt: "2026-05-18T22:31:00Z",
            url: "https://example.test/pr/147#discussion_r1",
            author: {
              login: "chatgpt-codex-connector",
              typeName: "Bot",
            },
          },
        ],
      },
    },
  ];

  const supervisor = new Supervisor({
    ...fixture.config,
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => staleCommitThreads,
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^codex_connector_review_fallback status=request_eligible provider=codex current_head_sha=c1ac7215a12398842152b1daf42311faef297317 current_head_observed_at=none required_checks_green_at=2026-05-19T09:03:41Z timeout_action=request_review_comment requested_at=none requested_head_sha=none review_signal=missing note=request_comment_is_not_review_completion next_action=request_current_head_review wait_until=2026-05-19T09:13:41\.000Z$/m,
  );
  assert.doesNotMatch(explanation, /^codex_connector_review_fallback status=timeout_elapsed\b.*\brequested_at=none\b/m);
  assert.match(
    explanation,
    /^codex_connector_convergence status=stale_review_commit_residue provider=codex current_head_sha=c1ac7215a12398842152b1daf42311faef297317 current_head_observed_at=none latest_signal_head_sha=98da2474c530b76dae67b5a6f43e0671b989f65a highest_severity=none finding_count=0 merge_effect=blocked next_action=request_current_head_review stale_review_commit_threads=1 stale_review_commit_thread_ids=PRRT_kwDOSfC_1M6DF5s7$/m,
  );
});

test("explain requests Codex current-head review for metadata-only missing review residue", async (t) => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-21T20:45:06Z");
  t.after(() => {
    Date.now = originalDateNow;
  });
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  fixture.config.configuredBotCurrentHeadSignalTimeoutMinutes = 10;
  fixture.config.configuredBotCurrentHeadSignalTimeoutAction = "request_review_comment";
  const issueNumber = 144;
  const prNumber = 148;
  const branch = branchName(fixture.config, issueNumber);
  const currentHead = "f3addc310b0ff8e4fc53d9f3e0ab783af70a552f";
  const staleReviewHead = "d0800e414f305e8ce4f4f9785fc4ee6ad2ba0c90";
  const staleMetadataThread = {
    id: "thread-current-head-request",
    isResolved: false,
    isOutdated: true,
    path: "src/supervisor/status.ts",
    line: 88,
    comments: {
      nodes: [
        {
          id: "comment-current-head-request",
          body: "P2: stale metadata-only schema finding.",
          createdAt: "2026-05-21T20:00:00Z",
          url: "https://example.test/pr/148#discussion_current_head_request",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        pr_number: prNumber,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        last_head_sha: currentHead,
        blocked_reason: "stale_review_bot",
        copilot_review_timed_out_at: "2026-05-21T20:42:06Z",
        copilot_review_timeout_action: "request_review_comment",
        last_tracked_pr_repeat_failure_decision: "stop_no_progress",
        processed_review_thread_ids: [`${staleMetadataThread.id}@${currentHead}`],
        processed_review_thread_fingerprints: [`${staleMetadataThread.id}@${currentHead}#${staleMetadataThread.comments.nodes[0].id}`],
        provider_success_head_sha: staleReviewHead,
        provider_success_observed_at: "2026-05-21T20:00:06Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain metadata-only current-head request",
    body: executionReadyBody("Request current-head Codex review for metadata-only residue."),
    createdAt: "2026-05-21T20:00:00Z",
    updatedAt: "2026-05-21T20:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: currentHead,
    isDraft: false,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    currentHeadCiGreenAt: "2026-05-21T20:32:06Z",
    configuredBotLatestReviewedCommitSha: staleReviewHead,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotTopLevelReviewStrength: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
    requiredConversationResolution: {
      state: "enabled",
      source: "branch_protection",
      details: ["required_conversation_resolution=true"],
    },
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [staleMetadataThread],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^runnable=yes$/m);
  assert.match(explanation, /^selection_reason=ready .*retry_state=resume:blocked$/m);
  assert.match(
    explanation,
    /^stale_review_bot_remediation issue=#144 pr=#148 reason=stale_review_bot code_ci=green current_head_sha=f3addc310b0ff8e4fc53d9f3e0ab783af70a552f processed_on_current_head=unknown classification=metadata_only_missing_current_head_review codex_current_head_review_state=missing review_thread_url=none manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note summary=stale_configured_bot_thread_metadata_only_pending_current_head_review_request$/m,
  );
  assert.match(
    explanation,
    /^codex_connector_review_fallback status=request_eligible provider=codex current_head_sha=f3addc310b0ff8e4fc53d9f3e0ab783af70a552f current_head_observed_at=none required_checks_green_at=2026-05-21T20:32:06Z timeout_action=request_review_comment requested_at=none requested_head_sha=none review_signal=missing note=request_comment_is_not_review_completion next_action=request_current_head_review wait_until=/m,
  );
  assert.match(
    explanation,
    /^codex_connector_operator_diagnostic interpretation=stale_review_residue current_head_sha=f3addc310b0ff8e4fc53d9f3e0ab783af70a552f latest_configured_bot_review_sha=none current_head_review_signal=missing actionable_current_diff_threads=0 next_action=request_current_head_review$/m,
  );
  assert.doesNotMatch(explanation, /^codex_connector_operator_diagnostic .*next_action=inspect_exact_review_thread_then_resolve_or_leave_manual_note$/m);
});

test("explain treats request-eligible manual-review Codex recovery as selectable", async (t) => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  fixture.config.configuredBotInitialGraceWaitSeconds = 0;
  fixture.config.configuredBotCurrentHeadSignalTimeoutMinutes = 10;
  fixture.config.configuredBotCurrentHeadSignalTimeoutAction = "request_review_comment";
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 2072;
  const prNumber = 177;
  const branch = branchName(fixture.config, issueNumber);
  const currentHead = "ad2a7f2d9c62f52f190d42884f1844c5b5da2072";
  const staleReviewHead = "1bd7511632c6db5bf1f1bbe91f0b5c4cebad1770";
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
        last_head_sha: currentHead,
        blocked_reason: "manual_review",
        review_wait_started_at: "2026-05-22T00:00:00Z",
        review_wait_head_sha: currentHead,
        provider_success_head_sha: staleReviewHead,
        provider_success_observed_at: "2026-05-21T23:50:00Z",
        copilot_review_timed_out_at: "2026-05-22T00:10:00.000Z",
        copilot_review_timeout_action: "request_review_comment",
        codex_connector_review_requested_observed_at: null,
        codex_connector_review_requested_head_sha: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Codex Connector request eligible manual review recovery",
    body: executionReadyBody("Request current-head Codex review when stale manual review residue is request eligible."),
    createdAt: "2026-05-22T00:00:00Z",
    updatedAt: "2026-05-22T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: currentHead,
    isDraft: false,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    currentHeadCiGreenAt: "2026-05-22T00:00:00Z",
    configuredBotLatestReviewedCommitSha: staleReviewHead,
    configuredBotCurrentHeadObservedAt: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^runnable=yes$/m);
  assert.match(explanation, /^selection_reason=ready .*retry_state=resume:blocked$/m);
  assert.match(
    explanation,
    /^codex_connector_review_fallback status=request_eligible provider=codex .* next_action=request_current_head_review /m,
  );
  assert.match(
    explanation,
    /^tracked_pr_mismatch issue=#2072 pr=#177 .*local_state=blocked local_blocked_reason=manual_review /m,
  );
  assert.doesNotMatch(explanation, /^reason_\d+=manual_block manual_review$/m);
  assert.doesNotMatch(explanation, /^restart_recommendation category=manual_review_before_restart /m);
});

test("explain reports Codex Connector P0 policy blocks with thread diagnostics", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 182;
  const prNumber = 282;
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
        blocked_reason: "stale_review_bot",
        last_error: "Codex Connector P0 finding remains unresolved.",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Codex Connector policy diagnostic",
    body: executionReadyBody("Explain should surface P0 Codex Connector review policy blockers."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const p0Thread = {
    id: "thread-p0",
    isResolved: false,
    isOutdated: false,
    path: "src/supervisor/auth.ts",
    line: 17,
    comments: {
      nodes: [
        {
          id: "comment-p0",
          body: "P0: Do not merge while the authorization bypass remains reachable.",
          createdAt: "2026-03-11T14:06:00Z",
          url: "https://example.test/pr/282#discussion_r2",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  };

  const supervisor = new Supervisor({
    ...fixture.config,
    reviewBotLogins: ["chatgpt-codex-connector"],
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => issue,
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
    resolvePullRequestForBranch: async () =>
      createPullRequest({
        number: prNumber,
        headRefName: branch,
        headRefOid: "head-282",
        isDraft: false,
        configuredBotCurrentHeadObservedAt: "2026-03-11T14:05:00Z",
      }),
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [p0Thread],
  };

  const explanation = await supervisor.explain(issueNumber);
  assert.match(
    explanation,
    /^codex_connector_policy_block count=1 severity=P0 file=src\/supervisor\/auth\.ts line=17 thread_url=https:\/\/example\.test\/pr\/282#discussion_r2 next_action=fix_on_new_head_or_wait_for_github_thread_resolution_or_use_explicit_manual_operator_path$/m,
  );
  assert.match(explanation, /^reason_1=manual_block stale_review_bot$/m);
});

test("explain reuses external-review follow-up reasoning for current-head actionable misses", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 100;
  const workspace = path.join(fixture.workspaceRoot, `issue-${issueNumber}`);
  const artifactPath = path.join(
    fixture.workspaceRoot,
    "reviews",
    "owner-repo",
    `issue-${issueNumber}`,
    "external-review-misses-head-deadbeefcafe.json",
  );
  await writeExternalReviewDigest({
    artifactPath,
    headStatus: "current-head",
    missedFindings: 2,
    sections: [
      "## Durable guardrail (1 finding)",
      "",
      "## Regression test (1 finding)",
    ],
  });

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Reuse external-review follow-up reasoning",
    body: executionReadyBody("Explain should surface the same follow-up actions as status."),
    createdAt: "2026-03-18T00:00:00Z",
    updatedAt: "2026-03-18T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "addressing_review",
        branch: branchName(fixture.config, issueNumber),
        workspace,
        journal_path: null,
        pr_number: issueNumber,
        external_review_head_sha: "deadbeefcafebabe",
        external_review_misses_path: artifactPath,
        external_review_missed_findings_count: 2,
        last_head_sha: "deadbeefcafebabe",
        blocked_reason: null,
        last_error: null,
        last_failure_context: null,
        last_failure_signature: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^external_review_follow_up unresolved=2 actions=durable_guardrail:1\|regression_test:1$/m,
  );
});
