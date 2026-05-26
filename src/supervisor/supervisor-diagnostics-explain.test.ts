import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { GitHubIssue, SupervisorStateFile } from "../core/types";
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
} from "../codex-connector-tracked-pr-test-helpers";
import {
  codexConnectorDiagnosticLines,
  createConfiguredBotReviewThread,
  createTrackedPullRequestExplainScenario,
  writeExternalReviewDigest,
  writeSupervisorState,
} from "./supervisor-diagnostics-explain-scenarios";

test("explain reports dependency blockers for a non-runnable issue", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const dependencyIssue: GitHubIssue = {
    number: 91,
    title: "Step 1",
    body: `## Summary
Ship the first step.

## Scope
- land the dependency first

## Acceptance criteria
- step one completes before step two

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/91",
    labels: [],
    state: "OPEN",
  };
  const blockedIssue: GitHubIssue = {
    number: 93,
    title: "Step 2",
    body: `## Summary
Ship the second step.

## Scope
- wait for the dependency to finish first

## Acceptance criteria
- explain shows the dependency gate

## Verification
- npm test -- src/supervisor.test.ts

Depends on: #91`,
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/93",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [dependencyIssue, blockedIssue],
    listCandidateIssues: async () => [dependencyIssue, blockedIssue],
  };

  const report = await supervisor.explainReport(93);
  assert.equal(report.issueNumber, 93);
  assert.equal(report.title, "Step 2");
  assert.equal(report.state, "untracked");
  assert.equal(report.blockedReason, "none");
  assert.equal(report.runnable, false);
  assert.deepEqual(report.reasons, ["dependency depends on #91"]);

  const explanation = await supervisor.explain(93);

  assert.match(explanation, /^issue=#93$/m);
  assert.match(explanation, /^state=untracked$/m);
  assert.match(explanation, /^runnable=no$/m);
  assert.match(explanation, /^reason_1=dependency depends on #91$/m);
});

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

test("explain reports candidate filtering for a non-candidate issue", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const filteredIssue: GitHubIssue = {
    number: 94,
    title: "Filtered out of candidate selection",
    body: executionReadyBody("Explain should report when scheduler filters out the issue."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/94",
    labels: [],
    state: "CLOSED",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => filteredIssue,
    listAllIssues: async () => [filteredIssue],
    listCandidateIssues: async () => [],
  };

  const explanation = await supervisor.explain(94);

  assert.match(explanation, /^issue=#94$/m);
  assert.match(explanation, /^state=untracked$/m);
  assert.match(explanation, /^runnable=no$/m);
  assert.match(explanation, /^reason_1=candidate filtered_by_candidate_list$/m);
});

test("explain resolves tracked PR numbers to the owning issue context", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 155;
  const prNumber = 655;
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
        last_error: "waiting on review feedback",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const owningIssue: GitHubIssue = {
    number: issueNumber,
    title: "Owning issue for tracked PR explain",
    body: executionReadyBody("Explain should resolve tracked PR numbers to the owning issue context."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async (requestedIssueNumber: number) => {
      assert.equal(requestedIssueNumber, issueNumber);
      return owningIssue;
    },
    listAllIssues: async () => [owningIssue],
    listCandidateIssues: async () => [owningIssue],
    getPullRequestIfExists: async (requestedPrNumber: number) => {
      assert.equal(requestedPrNumber, prNumber);
      return createPullRequest({
        number: prNumber,
        headRefName: branch,
        headRefOid: "head-655",
        isDraft: true,
      });
    },
  };

  const explanation = await supervisor.explain(prNumber);

  assert.match(
    explanation,
    new RegExp(
      `^lookup_target=tracked_pr query=#${prNumber} owner_issue=#${issueNumber} branch=${branch} tracked_state=blocked tracked_blocked_reason=manual_review pr_state=draft$`,
      "m",
    ),
  );
  assert.match(explanation, new RegExp(`^issue=#${issueNumber}$`, "m"));
  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.doesNotMatch(explanation, /candidate filtered_by_candidate_list/);
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
    /^codex_connector_review_fallback status=request_posted_no_current_head_signal provider=codex current_head_sha=head-1925 current_head_observed_at=none required_checks_green_at=2026-05-08T03:09:36Z timeout_action=request_review_comment requested_at=2026-05-08T03:30:00Z requested_head_sha=head-1925 review_signal=missing note=request_comment_is_not_review_completion retry_status=eligible retry_count=0 retry_limit=1 retry_wait_until=2026-05-08T03:40:00\.000Z request_comment_identity=unavailable next_action=retry_request_review_comment wait_until=2026-05-08T03:19:36\.000Z$/m,
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

test("explain surfaces loop-off as an operator blocker for active tracked work", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 189;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "queued",
        branch,
        pr_number: 289,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain loop-off tracked work blocker",
    body: executionReadyBody("Explain should show that tracked work cannot advance while the loop is off."),
    createdAt: "2026-03-25T00:00:00Z",
    updatedAt: "2026-03-25T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
  };

  const report = await supervisor.explainReport(issueNumber);
  assert.equal(
    report.loopRuntimeBlockerSummary,
    "loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#189 first_state=queued first_pr=#289 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=if_blocker_remains_run_status_why_and_doctor_then_inspect_runtime_marker_and_config",
  );

  const explanation = await supervisor.explain(issueNumber);
  assert.match(
    explanation,
    /^loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#189 first_state=queued first_pr=#289 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=if_blocker_remains_run_status_why_and_doctor_then_inspect_runtime_marker_and_config$/m,
  );
  assert.match(
    explanation,
    /^restart_recommendation category=restart_required_for_convergence source=loop_runtime_blocker summary=Restarting the supported supervisor loop is required before active tracked work can converge\.$/m,
  );
});

test("explain loop-off blocker summarizes all tracked work even when the explained issue is untracked", async () => {
  const fixture = await createSupervisorFixture();
  const explainedIssueNumber = 190;
  const firstTrackedIssueNumber = 150;
  const secondTrackedIssueNumber = 189;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(firstTrackedIssueNumber)]: createRecord({
        issue_number: firstTrackedIssueNumber,
        state: "blocked",
        branch: branchName(fixture.config, firstTrackedIssueNumber),
        pr_number: null,
        workspace: path.join(fixture.workspaceRoot, `issue-${firstTrackedIssueNumber}`),
        journal_path: null,
      }),
      [String(secondTrackedIssueNumber)]: createRecord({
        issue_number: secondTrackedIssueNumber,
        state: "queued",
        branch: branchName(fixture.config, secondTrackedIssueNumber),
        pr_number: 289,
        workspace: path.join(fixture.workspaceRoot, `issue-${secondTrackedIssueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const explainedIssue: GitHubIssue = {
    number: explainedIssueNumber,
    title: "Explain untracked issue while loop-off tracked work exists",
    body: executionReadyBody("Explain should report the shared loop-off blocker even for an untracked issue."),
    createdAt: "2026-03-25T00:00:00Z",
    updatedAt: "2026-03-25T00:00:00Z",
    url: `https://example.test/issues/${explainedIssueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => explainedIssue,
    listAllIssues: async () => [explainedIssue],
    listCandidateIssues: async () => [explainedIssue],
  };

  const report = await supervisor.explainReport(explainedIssueNumber);
  assert.equal(
    report.loopRuntimeBlockerSummary,
    "loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#189 first_state=queued first_pr=#289 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=if_blocker_remains_run_status_why_and_doctor_then_inspect_runtime_marker_and_config",
  );

  const explanation = await supervisor.explain(explainedIssueNumber);
  assert.match(
    explanation,
    /^loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#189 first_state=queued first_pr=#289 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=if_blocker_remains_run_status_why_and_doctor_then_inspect_runtime_marker_and_config$/m,
  );
});

test("explain omits the loop-off blocker when tracked work is blocked-only", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 191;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        blocked_reason: "manual_review",
        branch,
        pr_number: 291,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain blocked-only tracked issue without loop restart hint",
    body: executionReadyBody("Blocked-only tracked work should not emit the shared loop-off restart blocker."),
    createdAt: "2026-03-25T00:00:00Z",
    updatedAt: "2026-03-25T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
  };

  const report = await supervisor.explainReport(issueNumber);
  assert.equal(report.loopRuntimeBlockerSummary, null);

  const explanation = await supervisor.explain(issueNumber);
  assert.doesNotMatch(explanation, /^loop_runtime_blocker /m);
});

test("explain surfaces degraded full inventory refresh without requiring a fresh full issue list", async () => {
  const fixture = await createSupervisorFixture();
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

  const issue: GitHubIssue = {
    number: 94,
    title: "Filtered out of candidate selection",
    body: executionReadyBody("Explain should report degraded full-inventory refresh state."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: "https://example.test/issues/94",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => issue,
    listAllIssues: async () => {
      throw new Error("unexpected listAllIssues call");
    },
    listCandidateIssues: async () => [],
  };

  const explanation = await supervisor.explain(94);

  assert.match(explanation, /^inventory_refresh=degraded source=gh issue list recorded_at=2026-03-26T00:00:00Z message=Failed to parse JSON from gh issue list: Unexpected token \] in JSON at position 1$/m);
  assert.match(explanation, /^reason_1=candidate filtered_by_candidate_list$/m);
  assert.match(explanation, /^reason_2=inventory_refresh degraded$/m);
});

test("explain reports retry-budget blockers for verification-blocked issues", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "95": createRecord({
        issue_number: 95,
        state: "blocked",
        branch: branchName(fixture.config, 95),
        workspace: path.join(fixture.workspaceRoot, "issue-95"),
        journal_path: null,
        blocked_reason: "verification",
        last_error: "verification still failing",
        blocked_verification_retry_count: fixture.config.blockedVerificationRetryLimit,
        repeated_blocker_count: 1,
        repeated_failure_signature_count: 1,
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

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [blockedIssue],
    listCandidateIssues: async () => [blockedIssue],
  };

  const explanation = await supervisor.explain(95);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^blocked_reason=verification$/m);
  assert.match(explanation, /^runnable=no$/m);
  assert.match(
    explanation,
    new RegExp(`^reason_1=retry_budget blocked_verification_retry_count=${fixture.config.blockedVerificationRetryLimit}\\/${fixture.config.blockedVerificationRetryLimit}$`, "m"),
  );
  assert.match(explanation, /^reason_2=local_state blocked$/m);
  assert.match(explanation, /^last_error=verification still failing$/m);
});

test("explain reports manual review blockers for blocked issues", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "97": createRecord({
        issue_number: 97,
        state: "blocked",
        branch: branchName(fixture.config, 97),
        workspace: path.join(fixture.workspaceRoot, "issue-97"),
        journal_path: null,
        blocked_reason: "manual_review",
        last_error: "waiting on human review",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 97,
    title: "Manual review blocker",
    body: `## Summary
Wait for a human review before proceeding.

## Scope
- hold the rollout until the reviewer signs off

## Acceptance criteria
- explain shows the manual block reason

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/97",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [blockedIssue],
    listCandidateIssues: async () => [blockedIssue],
  };

  const explanation = await supervisor.explain(97);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.match(explanation, /^runnable=no$/m);
  assert.match(explanation, /^reason_1=manual_block manual_review$/m);
  assert.match(explanation, /^reason_2=local_state blocked$/m);
});

test("explain preserves original runtime failure context for no-PR manual-review recovery", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "99": createRecord({
        issue_number: 99,
        state: "blocked",
        branch: branchName(fixture.config, 99),
        workspace: path.join(fixture.workspaceRoot, "issue-99"),
        journal_path: null,
        blocked_reason: "manual_review",
        last_error: "Issue #99 cannot be reconciled automatically because the preserved no-PR branch is not safe for automatic recovery.",
        last_failure_context: {
          category: "blocked",
          summary: "Issue #99 cannot be reconciled automatically because the preserved no-PR branch is not safe for automatic recovery.",
          signature: "failed-no-pr-manual-review-required",
          command: null,
          details: [
            "state=failed",
            "tracked_pr=none",
            "branch_state=manual_review_required",
            "preserved_partial_work=yes",
            "tracked_file_count=1",
            "tracked_files=feature.txt",
          ],
          url: null,
          updated_at: "2026-03-13T00:25:00Z",
        },
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
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 99,
    title: "Preserve runtime failure context after no-PR manual review recovery",
    body: `## Summary
Keep the original runtime failure visible after no-PR manual-review recovery.

## Scope
- preserve runtime failure diagnostics alongside the manual-review blocker

## Acceptance criteria
- explain shows both the manual-review blocker and the original runtime failure summary

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/99",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [blockedIssue],
    listCandidateIssues: async () => [blockedIssue],
  };

  const explanation = await supervisor.explain(99);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.match(explanation, /^failure_summary=Issue #99 cannot be reconciled automatically because the preserved no-PR branch is not safe for automatic recovery\.$/m);
  assert.match(explanation, /^partial_work=preserved tracked_files=feature\.txt$/m);
  assert.match(explanation, /^runtime_failure_kind=codex_exit$/m);
  assert.match(explanation, /^runtime_failure_summary=Selected model is at capacity\. Please try a different model\.$/m);
});

test("explain reports stale configured-bot blockers distinctly from generic manual review", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "98": createRecord({
        issue_number: 98,
        state: "blocked",
        branch: branchName(fixture.config, 98),
        workspace: path.join(fixture.workspaceRoot, "issue-98"),
        journal_path: null,
        pr_number: 198,
        blocked_reason: "stale_review_bot",
        last_error: "configured bot review stayed stale on the current head",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 98,
    title: "Stale configured bot blocker",
    body: `## Summary
Show stale configured-bot review blockers distinctly in explain output.

## Scope
- surface stale configured-bot review-state as its own blocker class

## Acceptance criteria
- explain distinguishes stale configured-bot review-state from generic manual review

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/98",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [blockedIssue],
    listCandidateIssues: async () => [blockedIssue],
  };

  const explanation = await supervisor.explain(98);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^blocked_reason=stale_review_bot$/m);
  assert.match(explanation, /^runnable=no$/m);
  assert.match(explanation, /^stale_diagnostic kind=stale_review_bot recoverability=provider_outage_suspected$/m);
  assert.match(explanation, /^reason_1=manual_block stale_review_bot$/m);
  assert.match(explanation, /^reason_2=local_state blocked$/m);
});

test("explain keeps non-actionable same-head configured-bot blockers on manual review without claiming current-head processing", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 96;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: "manual_review",
        last_error:
          "1 configured bot review thread(s) remain unresolved, but the latest comment is no longer actionable by an allowed review bot on the current head, so manual attention is required.",
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved, but the latest comment is no longer actionable by an allowed review bot on the current head, so manual attention is required.",
          signature: "non-actionable-bot:thread-1",
          command: null,
          details: [
            "reviewer=octocat file=src/file.ts line=12 processed_on_current_head=no latest_comment_actionable=no",
          ],
          url: "https://example.test/pr/196#discussion_r2",
          updated_at: "2026-03-13T00:20:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain non-actionable same-head configured bot blockers",
    body: `## Summary
Explain should keep non-actionable same-head configured-bot blockers on manual review without implying current-head reprocessing.

## Scope
- surface unresolved configured-bot threads whose latest comment is no longer actionable

## Acceptance criteria
- explain keeps the blocker on manual_review and shows processed_on_current_head=no

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.match(
    explanation,
    /^failure_summary=1 configured bot review thread\(s\) remain unresolved, but the latest comment is no longer actionable by an allowed review bot on the current head, so manual attention is required\.$/m,
  );
  assert.doesNotMatch(explanation, /^failure_details=.*processed_on_current_head=yes/m);
});

test("explain reports effective configured-bot thread diagnostics for outdated Codex residue", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  const scenario = createTrackedPullRequestExplainScenario(fixture, {
    issueNumber: 183,
    prNumber: 283,
    headSha: "5de0d3844468d4a77cab512f8dcbe46171166c3a",
    title: "Explain HRCore shaped outdated Codex residue",
    summary: "Report effective unresolved review-thread diagnostics.",
    issueCreatedAt: "2026-05-15T00:00:00Z",
    issueUpdatedAt: "2026-05-15T00:00:00Z",
    pullRequestOverrides: {
      mergeStateStatus: "BLOCKED",
      mergeable: "MERGEABLE",
      currentHeadCiGreenAt: "2026-05-15T00:10:00Z",
      configuredBotCurrentHeadObservedAt: "2026-05-15T00:16:00Z",
      configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
      configuredBotCurrentHeadStatusState: "SUCCESS",
      configuredBotTopLevelReviewStrength: null,
    },
    checks: [{ name: "build", state: "SUCCESS" as const, bucket: "pass" as const, workflow: "CI" }],
  });
  await writeSupervisorState(fixture, scenario.state);

  const outdatedThread = createConfiguredBotReviewThread({
    threadId: "PRRT_hrcore_183_outdated",
    commentId: "PRRC_hrcore_183_outdated",
    isOutdated: true,
    path: "src/review-policy.ts",
    line: 42,
    body: "P1: stale finding from a previous diff.",
    createdAt: "2026-05-15T00:05:00Z",
    url: "https://example.test/pr/283#discussion_r183",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => scenario.issue,
    listAllIssues: async () => [scenario.issue],
    listCandidateIssues: async () => [scenario.issue],
    resolvePullRequestForBranch: async () => scenario.pr,
    getPullRequestIfExists: async () => scenario.pr,
    getChecks: async () => scenario.checks,
    getUnresolvedReviewThreads: async () => [outdatedThread],
  };

  const explanation = await supervisor.explain(scenario.issueNumber);

  assert.match(
    explanation,
    /^review_thread_effective_diagnostics raw_configured_bot_unresolved=1 effective_configured_bot_unresolved=0 threads=PRRT_hrcore_183_outdated:configured_bot_outdated:effective=no:path=src\/review-policy\.ts:line=42:comment=PRRC_hrcore_183_outdated:author=chatgpt-codex-connector:url=https:\/\/example\.test\/pr\/283#discussion_r183$/m,
  );
});

test("explain surfaces same-head no-actionable configured-bot blockers as stale review blockers", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 95;
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        blocked_reason: "stale_review_bot",
        last_error:
          "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:thread-1",
          command: null,
          details: [
            "reviewer=octocat file=src/file.ts line=12 processed_on_current_head=yes",
          ],
          url: "https://example.test/pr/195#discussion_r2",
          updated_at: "2026-03-13T00:20:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain same-head no-actionable configured bot blockers as stale",
    body: `## Summary
Explain should surface same-head no-actionable configured-bot blockers as stale review blockers.

## Scope
- distinguish explicit no-actionable current-head bot signals from generic manual review

## Acceptance criteria
- explain reports stale_review_bot and processed_on_current_head=yes for the blocker details

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^blocked_reason=stale_review_bot$/m);
  assert.match(
    explanation,
    /^failure_summary=1 configured bot review thread\(s\) remain unresolved after processing on the current head without measurable progress and now require manual attention\.$/m,
  );
  assert.doesNotMatch(explanation, /^blocked_reason=manual_review$/m);
});

test("explain surfaces stale configured-bot remediation with the exact review thread", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = ["coderabbitai", "coderabbitai[bot]"];
  const issueNumber = 195;
  const prNumber = 295;
  const headSha = "head-195";
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "stale_review_bot",
        last_head_sha: headSha,
        last_error:
          "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:thread-1",
          command: null,
          details: [
            "reviewer=coderabbitai[bot] file=src/file.ts line=12 processed_on_current_head=yes",
            "reviewer=coderabbitai[bot] file=src/other.ts line=24 processed_on_current_head=no",
          ],
          url: "https://example.test/pr/295#discussion_r295",
          updated_at: "2026-03-13T00:20:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain stale configured bot remediation",
    body: executionReadyBody("Explain should point operators at the stale configured-bot review thread."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: prNumber,
    headRefName: branchName(fixture.config, issueNumber),
    headRefOid: headSha,
    currentHeadCiGreenAt: "2026-03-13T00:19:00Z",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.explainReport(issueNumber);
  assert.deepEqual(report.staleReviewBotRemediation, {
    issueNumber,
    prNumber,
    reasonCode: "stale_review_bot",
    currentHeadSha: headSha,
    processedOnCurrentHead: "unknown",
    codeCiState: "green",
    classification: "unresolved_work",
    codexCurrentHeadReviewState: "not_applicable",
    reviewThreadUrl: "https://example.test/pr/295#discussion_r295",
    verificationEvidenceSummary: null,
    missingProbeReason: null,
    manualNextStep: "inspect_exact_review_thread_then_resolve_or_leave_manual_note",
    summary: "code_or_ci_green_but_review_thread_metadata_unresolved",
  });

  const explanation = await supervisor.explain(issueNumber);
  assert.match(
    explanation,
    /^stale_review_bot_remediation issue=#195 pr=#295 reason=stale_review_bot code_ci=green current_head_sha=head-195 processed_on_current_head=unknown classification=unresolved_work review_thread_url=https:\/\/example\.test\/pr\/295#discussion_r295 manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note summary=code_or_ci_green_but_review_thread_metadata_unresolved$/m,
  );
});

test("explain classifies handled stale configured-bot review threads as metadata-only", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = ["coderabbitai", "coderabbitai[bot]"];
  const issueNumber = 196;
  const prNumber = 296;
  const headSha = "head-196";
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "stale_review_bot",
        last_head_sha: headSha,
        processed_review_thread_ids: [`thread-1@${headSha}`],
        processed_review_thread_fingerprints: [`thread-1@${headSha}#comment-1`],
        last_error:
          "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:thread-1",
          command: null,
          details: ["reviewer=coderabbitai[bot] file=src/file.ts line=12 processed_on_current_head=yes"],
          url: "https://example.test/pr/296#discussion_r296",
          updated_at: "2026-03-13T00:20:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain handled stale configured bot metadata",
    body: executionReadyBody("Explain should identify stale configured-bot provider metadata drift."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: prNumber,
    headRefName: branchName(fixture.config, issueNumber),
    headRefOid: headSha,
    configuredBotCurrentHeadObservedAt: "2026-03-13T00:19:00Z",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    currentHeadCiGreenAt: "2026-03-13T00:19:00Z",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const staleMetadataThread = {
    id: "thread-1",
    isResolved: false,
    isOutdated: false,
    path: "src/file.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Please address this stale finding.",
          createdAt: "2026-03-13T00:05:00Z",
          url: "https://example.test/pr/296#discussion_r296",
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
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [staleMetadataThread],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^blocked_reason=stale_review_bot$/m);
  assert.match(
    explanation,
    /^stale_review_bot_remediation issue=#196 pr=#296 reason=stale_review_bot code_ci=green current_head_sha=head-196 processed_on_current_head=yes classification=metadata_only review_thread_url=https:\/\/example\.test\/pr\/296#discussion_r296 manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note summary=stale_configured_bot_thread_metadata_only$/m,
  );
  assert.match(
    explanation,
    /^no_active_tracked_record issue=#196 classification=stale_review_bot_remediation state=blocked reason=metadata_only$/m,
  );
  assert.doesNotMatch(explanation, /provider_outage_suspected/);
  assert.doesNotMatch(explanation, /stale_review_bot_provider_signal_missing/);
});

test("explain keeps configured-bot success without current-head observation as unresolved work", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = ["coderabbitai", "coderabbitai[bot]"];
  const issueNumber = 197;
  const prNumber = 297;
  const headSha = "head-197";
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "stale_review_bot",
        last_head_sha: headSha,
        processed_review_thread_ids: [`thread-1@${headSha}`],
        processed_review_thread_fingerprints: [`thread-1@${headSha}#comment-1`],
        last_error:
          "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:thread-1",
          command: null,
          details: ["reviewer=coderabbitai[bot] file=src/file.ts line=12 processed_on_current_head=yes"],
          url: "https://example.test/pr/297#discussion_r297",
          updated_at: "2026-03-13T00:20:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain unobserved configured bot success",
    body: executionReadyBody("Explain should require observed current-head configured-bot evidence."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: prNumber,
    headRefName: branchName(fixture.config, issueNumber),
    headRefOid: headSha,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadStatusState: "SUCCESS",
    currentHeadCiGreenAt: "2026-03-13T00:19:00Z",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const staleMetadataThread = {
    id: "thread-1",
    isResolved: false,
    isOutdated: false,
    path: "src/file.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-1",
          body: "Please address this stale finding.",
          createdAt: "2026-03-13T00:05:00Z",
          url: "https://example.test/pr/297#discussion_r297",
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
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [staleMetadataThread],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^stale_review_bot_remediation issue=#197 pr=#297 reason=stale_review_bot code_ci=green current_head_sha=head-197 processed_on_current_head=yes classification=unresolved_work review_thread_url=https:\/\/example\.test\/pr\/297#discussion_r297 manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note summary=code_or_ci_green_but_review_thread_metadata_unresolved$/m,
  );
  assert.match(explanation, /^stale_diagnostic kind=stale_review_bot recoverability=provider_outage_suspected$/m);
  assert.doesNotMatch(explanation, /classification=metadata_only/m);
});

test("explain fails closed for processed Codex must-fix residue without verification evidence", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = ["chatgpt-codex-connector"];
  const issueNumber = 198;
  const prNumber = 398;
  const headSha = "head-198";
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "stale_review_bot",
        last_head_sha: headSha,
        processed_review_thread_ids: [`thread-198@${headSha}`],
        processed_review_thread_fingerprints: [`thread-198@${headSha}#comment-198`],
        last_error:
          "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:thread-198",
          command: null,
          details: ["reviewer=chatgpt-codex-connector file=src/file.ts line=12 processed_on_current_head=yes"],
          url: "https://example.test/pr/398#discussion_r398",
          updated_at: "2026-05-13T00:20:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain Codex processed metadata residue",
    body: executionReadyBody("Explain should keep Codex must-fix residue blocked without verification evidence."),
    createdAt: "2026-05-13T00:00:00Z",
    updatedAt: "2026-05-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: prNumber,
    headRefName: branchName(fixture.config, issueNumber),
    headRefOid: headSha,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadStatusState: "SUCCESS",
    currentHeadCiGreenAt: "2026-05-13T00:19:00Z",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
  const staleMetadataThread = {
    id: "thread-198",
    isResolved: false,
    isOutdated: false,
    path: "src/file.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-198",
          body: "P2: Fix this stale finding before merge.",
          createdAt: "2026-05-13T00:05:00Z",
          url: "https://example.test/pr/398#discussion_r398",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [staleMetadataThread],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^stale_review_bot_remediation issue=#198 pr=#398 reason=stale_review_bot code_ci=green current_head_sha=head-198 processed_on_current_head=yes classification=unknown_needs_operator codex_current_head_review_state=missing review_thread_url=https:\/\/example\.test\/pr\/398#discussion_r398 manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note missing_probe_reason=current_head_verification_evidence_missing summary=code_or_ci_green_but_review_thread_metadata_unresolved$/m,
  );
  assert.match(
    explanation,
    /^stale_review_bot_thread_diagnostics issue=#198 pr=#398 current_head_success=no unresolved_current_threads=1 actionable_must_fix_threads=1 verified_stale_residue_threads=0 missing_verification_evidence_threads=1 repeat_stop_exhausted=no auto_repair_suppressed_reason=missing_verification_probe$/m,
  );
  assert.match(
    explanation,
    /^codex_connector_operator_diagnostic interpretation=stale_review_residue current_head_sha=head-198 latest_configured_bot_review_sha=head-198 current_head_review_signal=missing actionable_current_diff_threads=unknown next_action=inspect_exact_review_thread_then_resolve_or_leave_manual_note$/m,
  );
});

test("explain names missing verification for manual-review Codex no-major residue", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  const issueNumber = 1702;
  const prNumber = 1802;
  const headSha = "12b099926c39c8b7502176339ea34750e6a807a4";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-current-head-residue",
    commentId: "comment-current-head-residue",
    path: "src/review-state.ts",
    line: 42,
    commentBody: "P2: Preserve current-head review metadata convergence.",
    discussionUrl: "https://example.test/pr/1802#discussion_current_head_residue",
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-23T01:09:53Z",
      observedAt: "2026-05-23T01:14:50Z",
    },
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        ...scenario.recordPatch,
        state: "blocked",
        blocked_reason: "manual_review",
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain HRCore shaped missing verification Codex residue",
    body: executionReadyBody("Explain the missing verification predicate for current-head Codex residue."),
    createdAt: "2026-05-23T00:00:00Z",
    updatedAt: "2026-05-23T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest(scenario.pullRequestPatch);
  const outdatedThreads = [
    "PRRT_kwDOSfC_1M6EPhQ2",
    "PRRT_kwDOSfC_1M6EPhQ3",
    "PRRT_kwDOSfC_1M6EPhQ5",
  ].map((threadId, index) => ({
    ...scenario.reviewThread,
    id: threadId,
    isOutdated: true,
    path: `src/earlier-review-state-${index}.ts`,
    line: 80 + index,
    comments: {
      nodes: [
        {
          ...scenario.reviewThread.comments.nodes[0],
          id: `comment-outdated-residue-${index}`,
          body: "P1: Earlier-head Codex residue remains unresolved on GitHub.",
          url: `https://example.test/pr/1802#discussion_${threadId}`,
        },
      ],
    },
  }));

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [scenario.reviewThread, ...outdatedThreads],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^stale_review_bot_remediation issue=#1702 pr=#1802 reason=stale_review_bot code_ci=green current_head_sha=12b099926c39c8b7502176339ea34750e6a807a4 processed_on_current_head=yes classification=unknown_needs_operator codex_current_head_review_state=observed review_thread_url=https:\/\/example\.test\/pr\/1802#discussion_current_head_residue manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note missing_probe_reason=current_head_verification_evidence_missing summary=code_or_ci_green_but_review_thread_metadata_unresolved$/m,
  );
  assert.match(
    explanation,
    /^stale_review_bot_thread_diagnostics issue=#1702 pr=#1802 current_head_success=yes unresolved_current_threads=1 actionable_must_fix_threads=1 verified_stale_residue_threads=0 missing_verification_evidence_threads=1 repeat_stop_exhausted=no auto_repair_suppressed_reason=missing_verification_probe$/m,
  );
  assert.match(
    explanation,
    /^codex_connector_operator_diagnostic interpretation=stale_review_residue current_head_sha=12b099926c39c8b7502176339ea34750e6a807a4 latest_configured_bot_review_sha=12b099926c39c8b7502176339ea34750e6a807a4 current_head_review_signal=observed actionable_current_diff_threads=unknown next_action=inspect_exact_review_thread_then_resolve_or_leave_manual_note$/m,
  );
  assert.doesNotMatch(explanation, /^codex_connector_convergence status=repairing_must_fix /m);
  assert.doesNotMatch(explanation, /^codex_connector_operator_diagnostic interpretation=actionable_current_diff /m);
});

test("explain distinguishes Codex verified current-head repair residue from no-source-change residue", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  const issueNumber = 199;
  const prNumber = 399;
  const headSha = "head-199";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-199",
    commentId: "comment-199",
    path: "src/repair.ts",
    line: 42,
    commentBody: "P1: Verify the repaired authorization guard before merge.",
    discussionUrl: "https://example.test/pr/399#discussion_r399",
    verifiedRepair: {
      summary: "Focused verifier passed after the repair commit.",
      ranAt: "2026-05-15T00:18:00Z",
      command: "npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-15T00:12:00Z",
      observedAt: "2026-05-15T00:17:00Z",
    },
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        ...scenario.recordPatch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain Codex verified repair metadata residue",
    body: executionReadyBody("Explain should classify verified Codex repair residue distinctly."),
    createdAt: "2026-05-15T00:00:00Z",
    updatedAt: "2026-05-15T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest(scenario.pullRequestPatch);

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => scenario.passingChecks,
    getUnresolvedReviewThreads: async () => [scenario.reviewThread],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^stale_review_bot_remediation issue=#199 pr=#399 reason=stale_review_bot code_ci=green current_head_sha=head-199 processed_on_current_head=yes classification=verified_current_head_repair_pending_thread_resolution codex_current_head_review_state=observed review_thread_url=https:\/\/example\.test\/pr\/399#discussion_r399 manual_next_step=resolve_verified_repaired_configured_bot_threads_then_rerun_supervisor verification_evidence=Focused_verifier_passed_after_the_repair_commit\.;codex_pr_success_comment_after_current_head_request summary=verified_current_head_repair_configured_bot_thread_resolution_pending$/m,
  );
  assert.doesNotMatch(explanation, /classification=verified_no_source_change_pending_thread_resolution/);
});

test("explain marks tracked stale configured-bot blockers runnable after reply_and_resolve is enabled", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.staleConfiguredBotReviewPolicy = "reply_and_resolve";
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "97": createRecord({
        issue_number: 97,
        state: "blocked",
        branch: branchName(fixture.config, 97),
        workspace: path.join(fixture.workspaceRoot, "issue-97"),
        journal_path: null,
        pr_number: 197,
        blocked_reason: "stale_review_bot",
        last_error: "configured bot review stayed stale on the current head",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 97,
    title: "Recoverable stale configured bot blocker",
    body: `## Summary
Show recoverable stale configured-bot review blockers as runnable when auto-handling is enabled.

## Scope
- reflect auto-recoverable stale configured-bot blockers in explain output

## Acceptance criteria
- explain reports the issue as runnable once reply_and_resolve can handle the stale bot review

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/97",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [blockedIssue],
    listCandidateIssues: async () => [blockedIssue],
  };

  const explanation = await supervisor.explain(97);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^blocked_reason=stale_review_bot$/m);
  assert.match(explanation, /^runnable=yes$/m);
  assert.match(explanation, /^stale_diagnostic kind=stale_review_bot recoverability=stale_but_recoverable$/m);
  assert.doesNotMatch(explanation, /^reason_1=manual_block stale_review_bot$/m);
  assert.match(explanation, /^selection_reason=ready execution_ready=yes depends_on=none execution_order=none predecessors=none retry_state=stale_review_bot_recovery:reply_and_resolve$/m);
});

test("explain stops advertising stale configured-bot recovery after the current head reply was already recorded", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.staleConfiguredBotReviewPolicy = "reply_only";
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "97": createRecord({
        issue_number: 97,
        state: "blocked",
        branch: branchName(fixture.config, 97),
        workspace: path.join(fixture.workspaceRoot, "issue-97"),
        journal_path: null,
        pr_number: 197,
        blocked_reason: "stale_review_bot",
        last_head_sha: "head-197",
        last_error: "configured bot review stayed stale on the current head",
        last_failure_signature: "stalled-bot:thread-1",
        last_stale_review_bot_reply_head_sha: "head-197",
        last_stale_review_bot_reply_signature: "stalled-bot:thread-1",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: 97,
    title: "Already handled stale configured bot blocker",
    body: `## Summary
Keep already-handled stale configured-bot blockers out of the runnable queue.

## Scope
- stop advertising stale-review recovery after the current head reply already ran

## Acceptance criteria
- explain reports the issue as non-runnable after the current head/signature reply is already recorded

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/97",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [blockedIssue],
    listCandidateIssues: async () => [blockedIssue],
  };

  const explanation = await supervisor.explain(97);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^blocked_reason=stale_review_bot$/m);
  assert.match(explanation, /^runnable=no$/m);
  assert.match(explanation, /^stale_diagnostic kind=stale_review_bot recoverability=stale_already_handled$/m);
  assert.match(explanation, /^reason_1=manual_block stale_review_bot$/m);
  assert.doesNotMatch(explanation, /retry_state=stale_review_bot_recovery:/m);
});

test("explain reports tracked PR mismatches when GitHub is ready but local state is still blocked", async () => {
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
    body: `## Summary
Expose stale tracked PR mismatch diagnostics.

## Scope
- make explain show GitHub-ready versus local-blocked state

## Acceptance criteria
- explain says GitHub is ready while local state is stale

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
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
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => readyPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.match(
    explanation,
    /^tracked_pr_mismatch issue=#171 pr=#271 recoverability=stale_but_recoverable github_state=ready_to_merge github_blocked_reason=none local_state=blocked local_blocked_reason=manual_review stale_local_blocker=yes$/m,
  );
  assert.match(
    explanation,
    /^recovery_guidance=Tracked PR facts are fresher than local state; run a one-shot supervisor cycle such as `node dist\/index\.js run-once --config \.\.\. --dry-run` to refresh tracked PR state\. Explicit requeue is unavailable for tracked PR work\.$/m,
  );
});

test("explain marks same-head ready-promotion blockers as stale when fresh blocker evidence is absent", async () => {
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
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
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
    body: executionReadyBody("Explain should surface stale same-head ready-promotion blockers."),
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
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^tracked_pr_ready_promotion_blocked issue=#176 pr=#276 recoverability=stale_but_recoverable github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    explanation,
    /^recovery_guidance=PR #276 is still draft, but the stored ready-for-review verification blocker is stale relative to the current head\. Run a one-shot supervisor cycle to refresh tracked PR state before assuming the gate still fails\.$/m,
  );
  assert.doesNotMatch(explanation, /The same blocker is still present/);
});

test("explain keeps same-head host-local ready-promotion blockers current when the current head observation exists without a persisted blocker comment", async () => {
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
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: "verification",
        last_error: "Configured local CI command failed before marking PR #277 ready.",
        last_head_sha: "head-draft-277",
        last_failure_signature: "local-ci-gate-non_zero_exit",
        last_observed_host_local_pr_blocker_head_sha: "head-draft-277",
        last_observed_host_local_pr_blocker_signature: "local-ci-gate-non_zero_exit",
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
        latest_local_ci_result: {
          outcome: "failed",
          summary: "Configured local CI command failed before marking PR #277 ready.",
          ran_at: "2026-03-13T00:10:00Z",
          head_sha: "head-draft-277",
          execution_mode: "legacy_shell_string",
          command: "npm run verify:paths",
          stderr_summary: "docs/configuration.md contract drift: changed doc contract no longer matches repo-owned verifier expectation",
          failure_class: "non_zero_exit",
          remediation_target: "tracked_publishable_content",
          verifier_drift_hint:
            "repo_owned_verifier_drift: the repo-owned verifier appears to disagree with a changed docs or contract expectation; repair the verifier expectation or the repo content before rerunning local CI.",
        },
        last_host_local_pr_blocker_comment_signature: null,
        last_host_local_pr_blocker_comment_head_sha: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked current same-head draft PR ready gate",
    body: executionReadyBody("Explain should surface current same-head ready-promotion blockers when comment publication is unavailable."),
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
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^tracked_pr_ready_promotion_blocked issue=#177 pr=#277 recoverability=manual_attention_required github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    explanation,
    /^recovery_guidance=PR #277 is still draft because ready-for-review promotion is blocked by a repo-owned gate\. The same blocker is still present, so rerunning the supervisor alone will not help\./m,
  );
  assert.match(
    explanation,
    /^local_ci_result outcome=failed context=blocking failure_class=non_zero_exit remediation_target=tracked_publishable_content head=current head_sha=head-draft-277 ran_at=2026-03-13T00:10:00Z summary=Configured local CI command failed before marking PR #277 ready\. command=npm run verify:paths stderr_summary=docs\/configuration\.md contract drift: changed doc contract no longer matches repo-owned verifier expectation hint=repo_owned_verifier_drift: the repo-owned verifier appears to disagree with a changed docs or contract expectation; repair the verifier expectation or the repo content before rerunning local CI\.$/m,
  );
  assert.doesNotMatch(
    explanation,
    /stored ready-for-review verification blocker is stale relative to the current head/,
  );
});

test("explain reports unpublished local repair commits after publication gate failure", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 190;
  const prNumber = 290;
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
          "Tracked durable artifacts failed workstation-local path hygiene before marking PR #290 ready.",
        last_head_sha: "head-local-290",
        last_failure_signature: "workstation-local-path-hygiene-failed",
        last_host_local_pr_blocker_comment_signature:
          "workstation-local-path-hygiene-failed|gate=workstation_local_path_hygiene|failure=workstation-local-path-hygiene-failed|target=tracked_publishable_content",
        last_host_local_pr_blocker_comment_head_sha: "head-local-290",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain publication failure before push",
    body: executionReadyBody("Explain should show unpublished local repairs when publication fails before push."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const draftPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-pr-290",
    isDraft: true,
  });

  const supervisor = new Supervisor({
    ...fixture.config,
    localCiCommand: "npm run verify:paths",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(
    explanation,
    /^tracked_pr_ready_promotion_blocked issue=#190 pr=#290 recoverability=stale_but_recoverable github_state=draft_pr local_state=blocked local_blocked_reason=verification stale_local_blocker=yes$/m,
  );
  assert.match(
    explanation,
    /^tracked_pr_ready_promotion_gate issue=#190 pr=#290 gate=workstation_local_path_hygiene remediation_target=tracked_publishable_content summary=Tracked durable artifacts failed workstation-local path hygiene before marking PR #290 ready\.$/m,
  );
  assert.match(
    explanation,
    /^tracked_pr_local_repair_commit_unpublished issue=#190 pr=#290 local_repair_commit_unpublished=head-local-290 local_head_sha=head-local-290 remote_head_sha=head-pr-290 publication_gate=failed publication_gate_name=workstation_local_path_hygiene failure_signature=workstation-local-path-hygiene-failed$/m,
  );
});

test("explain distinguishes repairable ready-promotion path hygiene blockers queued for repair", async () => {
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
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
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
    body: executionReadyBody("Explain should surface repairable draft PR ready-promotion blockers."),
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
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => draftPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);
  assert.match(
    explanation,
    /^no_active_tracked_record issue=#178 classification=repair_already_queued state=repairing_ci reason=repairable_path_hygiene_retry_state$/m,
  );
  assert.match(
    explanation,
    /^tracked_pr_ready_promotion_blocked issue=#178 pr=#278 recoverability=repair_queued github_state=draft_pr local_state=repairing_ci local_blocked_reason=none stale_local_blocker=no$/m,
  );
  assert.match(
    explanation,
    /^recovery_guidance=PR #278 is still draft because ready-for-review promotion found repairable workstation-local path hygiene findings\. The supervisor has queued a repair turn for the actionable publishable tracked files before retrying promotion\.$/m,
  );
});

test("explain surfaces baseline-only ready-promotion path hygiene findings as maintenance context", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 180;
  const prNumber = 280;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "pr_open",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: prNumber,
        blocked_reason: null,
        last_error: null,
        last_head_sha: "head-ready-280",
        last_failure_signature: null,
        ready_promotion_maintenance_head_sha: "head-ready-280",
        ready_promotion_maintenance_finding_details: [
          `docs/baseline.md:1 matched /${"home"}/placeholder via "<workstation-local>"`,
        ],
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked baseline path maintenance context",
    body: executionReadyBody("Explain baseline-only ready-promotion path findings."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const openPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-ready-280",
    isDraft: false,
  });

  const supervisor = new Supervisor({
    ...fixture.config,
    localCiCommand: "npm run verify:paths",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => openPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);
  assert.match(
    explanation,
    new RegExp(
      `^tracked_pr_ready_promotion_maintenance issue=#180 pr=#280 gate=workstation_local_path_hygiene readiness=ignored_for_current_pr maintenance=yes findings=1 head_sha=head-ready-280 summary=Baseline-only workstation-local path findings were ignored for current-PR readiness but remain maintenance debt\\. first_finding=docs\\/baseline\\.md:1 matched /${"home"}\\/placeholder via "<workstation-local>"$`,
      "m",
    ),
  );
  assert.doesNotMatch(explanation, /ready_promotion_blocked_workstation_local_path_hygiene/);
});

test("explain reports bootstrap repos as not ready for expected CI and review signals", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 181;
  const prNumber = 281;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
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

  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Bootstrap repo lacks CI and provider signals",
    body: executionReadyBody("Explain should surface repo readiness mismatch for missing PR signals."),
    createdAt: "2026-03-13T00:05:00Z",
    updatedAt: "2026-03-13T00:05:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
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
        isDraft: true,
        reviewDecision: "REVIEW_REQUIRED",
        copilotReviewState: "not_requested",
        currentHeadCiGreenAt: null,
        configuredBotCurrentHeadObservedAt: null,
      }),
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);
  assert.match(
    explanation,
    /^external_signal_readiness status=repo_not_ready_for_expected_signals ci=repo_not_configured review=repo_not_configured workflows=absent$/m,
  );
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

test("explain degrades gracefully when tracked PR mismatch hydration fails", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 172;
  const prNumber = 272;
  const branch = branchName(fixture.config, issueNumber);
  git(["checkout", "-b", branch], fixture.repoPath);

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
        last_head_sha: "head-ready-272",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR mismatch hydration failure",
    body: `## Summary
Explain should still render when tracked PR hydration fails.

## Scope
- keep explain output available during transient GitHub failures

## Acceptance criteria
- explain omits tracked PR mismatch fields when mismatch hydration fails

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const readyPr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-ready-272",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => readyPr,
    getChecks: async () => {
      throw new Error("transient checks failure");
    },
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.explainReport(issueNumber);
  assert.equal(report.trackedPrMismatchSummary, null);
  assert.equal(report.recoveryGuidance, null);

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^blocked_reason=manual_review$/m);
  assert.doesNotMatch(explanation, /^tracked_pr_mismatch /m);
  assert.doesNotMatch(explanation, /^recovery_guidance=/m);
});

test("explain does not keep reporting stale_review_bot after a same-head tracked PR refresh clears it", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 173;
  const branch = branchName(fixture.config, issueNumber);
  const runHeadSha = git(["rev-parse", "HEAD"], fixture.repoPath);
  const config = createConfig({
    ...fixture.config,
    staleConfiguredBotReviewPolicy: "diagnose_only",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 273,
        blocked_reason: "stale_review_bot",
        last_head_sha: runHeadSha,
        last_error: "configured bot review stayed stale on the current head",
        last_failure_signature: "stalled-bot:thread-1",
        last_failure_context: {
          category: "manual",
          summary:
            "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
          signature: "stalled-bot:thread-1",
          command: null,
          details: ["reviewer=copilot-pull-request-reviewer file=src/file.ts line=12 processed_on_current_head=yes"],
          url: "https://example.test/pr/273#discussion_r1",
          updated_at: "2026-03-13T00:20:00Z",
        },
        last_stale_review_bot_reply_head_sha: runHeadSha,
        last_stale_review_bot_reply_signature: "stalled-bot:thread-1",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain clears stale stale_review_bot after tracked PR reconciliation",
    body: `## Summary
Explain should stop reporting stale stale_review_bot blockers after fresh tracked PR hydration clears them.

## Scope
- clear stale same-head configured-bot blockers using authoritative GitHub facts

## Acceptance criteria
- explain reports the refreshed ready-to-merge state after the stale blocker converges

## Verification
- npm test -- src/supervisor/supervisor-diagnostics-explain.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const readyPr = createPullRequest({
    number: 273,
    headRefName: branch,
    headRefOid: runHeadSha,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    reviewDecision: null,
    copilotReviewState: "arrived",
    copilotReviewArrivedAt: "2026-03-13T00:10:00Z",
  });

  const supervisor = new Supervisor(config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => readyPr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
    getPullRequest: async () => readyPr,
    getPullRequestIfExists: async () => readyPr,
    getMergedPullRequestsClosingIssue: async () => [],
    enableAutoMerge: async () => {},
    closeIssue: async () => {
      throw new Error("unexpected closeIssue call");
    },
    createPullRequest: async () => {
      throw new Error("unexpected createPullRequest call");
    },
  };

  await supervisor.runOnce({ dryRun: true });

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^state=ready_to_merge$/m);
  assert.match(explanation, /^blocked_reason=none$/m);
  assert.doesNotMatch(explanation, /^blocked_reason=stale_review_bot$/m);
  assert.doesNotMatch(explanation, /^tracked_pr_mismatch /m);
});

test("explain surfaces final auto-merge guard evidence", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 174;
  const branch = branchName(fixture.config, issueNumber);
  const state: SupervisorStateFile = {
    activeIssueNumber: issueNumber,
    issues: {
      [String(issueNumber)]: createRecord({
        issue_number: issueNumber,
        state: "merging",
        branch,
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 274,
        last_head_sha: "head-274",
        last_auto_merge_guard_context: {
          category: null,
          summary: "Final auto-merge guard passed for PR #274.",
          signature: "auto-merge-ready:head-274",
          command: null,
          details: ["head_sha=head-274", "checks=green count=1", "configured_bot_blockers=0"],
          url: "https://example.test/pr/274",
          updated_at: "2026-03-13T06:30:00Z",
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Explain final auto-merge guard evidence",
    body: executionReadyBody("Explain final auto-merge guard evidence."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    number: 274,
    headRefName: branch,
    headRefOid: "head-274",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    authStatus: async () => ({ ok: true, message: null }),
    getIssue: async () => trackedIssue,
    listAllIssues: async () => [trackedIssue],
    listCandidateIssues: async () => [trackedIssue],
    resolvePullRequestForBranch: async () => pr,
    getPullRequest: async () => pr,
    getPullRequestIfExists: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
    getMergedPullRequestsClosingIssue: async () => [],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^auto_merge_guard=Final auto-merge guard passed for PR #274\.$/m);
  const detailsLine = explanation.split("\n").find((line) => line.startsWith("auto_merge_guard_details="));
  assert.ok(detailsLine);
  const detailTokens = detailsLine.slice("auto_merge_guard_details=".length).split(" | ");
  assert.ok(detailTokens.includes("head_sha=head-274"));
  assert.ok(detailTokens.includes("checks=green count=1"));
  assert.ok(detailTokens.includes("configured_bot_blockers=0"));
});

test("explain reuses normalized change-risk policy for risky ambiguity blockers", async () => {
  const fixture = await createSupervisorFixture();
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {},
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const ambiguousIssue: GitHubIssue = {
    number: 98,
    title: "Decide which auth flow should ship",
    body: `## Summary
Decide whether to keep the current auth token flow or replace it before rollout.

## Scope
- choose the production authentication path for service-to-service traffic

## Acceptance criteria
- the operator confirms which auth flow should ship

## Verification
- npm test -- src/supervisor.test.ts`,
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/98",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => ambiguousIssue,
    listAllIssues: async () => [ambiguousIssue],
    listCandidateIssues: async () => [ambiguousIssue],
  };

  const explanation = await supervisor.explain(98);

  assert.match(explanation, /^runnable=no$/m);
  assert.match(explanation, /^verification_policy intensity=strong driver=issue_metadata:auth$/m);
  assert.match(explanation, /^reason_1=clarification ambiguity=unresolved_choice risky_change=auth$/m);
});

test("explain reuses normalized changed-file policy for blocked tracked issues", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 99;
  const branch = branchName(fixture.config, issueNumber);
  git(["checkout", "-b", branch], fixture.repoPath);
  await fs.mkdir(path.join(fixture.repoPath, "docs"), { recursive: true });
  await fs.writeFile(path.join(fixture.repoPath, "docs", "guide.md"), "# guide\n", "utf8");
  git(["add", "docs/guide.md"], fixture.repoPath);
  git(["commit", "-m", "Update docs"], fixture.repoPath);

  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      "99": createRecord({
        issue_number: issueNumber,
        state: "blocked",
        branch,
        workspace: fixture.repoPath,
        journal_path: null,
        blocked_reason: "manual_review",
        last_error: "waiting on human review",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const blockedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Blocked docs review",
    body: executionReadyBody("Refresh the operator guide."),
    createdAt: "2026-03-13T00:00:00Z",
    updatedAt: "2026-03-13T00:00:00Z",
    url: "https://example.test/issues/99",
    labels: [],
    state: "OPEN",
  };

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => blockedIssue,
    listAllIssues: async () => [blockedIssue],
    listCandidateIssues: async () => [blockedIssue],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^state=blocked$/m);
  assert.match(explanation, /^change_classes=docs$/m);
  assert.match(explanation, /^verification_policy intensity=focused driver=changed_files:docs$/m);
  assert.match(explanation, /^reason_1=manual_block manual_review$/m);
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

test("explain reuses the recorded recovery reason for a recovered tracked PR issue", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 101;
  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Reuse tracked PR recovery reason in explain",
    body: executionReadyBody("Explain should show the persisted recovery story for tracked PR resumptions."),
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
        state: "reproducing",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 191,
        last_recovery_reason:
          "tracked_pr_head_advanced: resumed issue #101 from blocked to reproducing after tracked PR #191 advanced from head-old-191 to head-new-191",
        last_recovery_at: "2026-03-19T00:20:00Z",
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

  assert.match(explanation, /^state=reproducing$/m);
  assert.match(explanation, /^runnable=yes$/m);
  assert.match(
    explanation,
    /^latest_recovery issue=#101 at=2026-03-19T00:20:00Z reason=tracked_pr_head_advanced detail=resumed issue #101 from blocked to reproducing after tracked PR #191 advanced from head-old-191 to head-new-191$/m,
  );
});

test("explain does not report local_state failed after tracked PR recovery resumes the issue in draft_pr", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 102;
  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR recovery clears stale failed explain diagnostics",
    body: executionReadyBody("Explain should reflect the resumed tracked PR lifecycle state."),
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
        state: "draft_pr",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 192,
        last_recovery_reason:
          "tracked_pr_lifecycle_recovered: resumed issue #102 from failed to draft_pr using fresh tracked PR #192 facts at head head-192",
        last_recovery_at: "2026-03-19T00:20:00Z",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
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

  assert.match(explanation, /^state=draft_pr$/m);
  assert.match(explanation, /^runnable=yes$/m);
  assert.match(
    explanation,
    /^latest_recovery issue=#102 at=2026-03-19T00:20:00Z reason=tracked_pr_lifecycle_recovered detail=resumed issue #102 from failed to draft_pr using fresh tracked PR #192 facts at head head-192$/m,
  );
  assert.doesNotMatch(explanation, /^reason_\d+=local_state failed$/m);
  assert.doesNotMatch(explanation, /^reason_\d+=blocked_failure /m);
});

test("explain does not report local_state failed after tracked PR recovery resumes the issue in addressing_review", async () => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = ["copilot-pull-request-reviewer"];
  const issueNumber = 103;
  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Tracked PR recovery clears stale failed review diagnostics",
    body: executionReadyBody("Explain should reflect the resumed tracked PR review lifecycle state."),
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
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: 193,
        last_head_sha: "head-193",
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        last_recovery_reason:
          "tracked_pr_lifecycle_recovered: resumed issue #103 from failed to addressing_review using fresh tracked PR #193 facts at head head-193",
        last_recovery_at: "2026-03-19T00:20:00Z",
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

  assert.match(explanation, /^state=addressing_review$/m);
  assert.match(explanation, /^runnable=yes$/m);
  assert.match(
    explanation,
    /^latest_recovery issue=#103 at=2026-03-19T00:20:00Z reason=tracked_pr_lifecycle_recovered detail=resumed issue #103 from failed to addressing_review using fresh tracked PR #193 facts at head head-193$/m,
  );
  assert.doesNotMatch(explanation, /^reason_\d+=local_state failed$/m);
  assert.doesNotMatch(explanation, /^reason_\d+=blocked_failure /m);
});

test("explain surfaces failed no-PR transient auto-requeue recovery reasons", async () => {
  const fixture = await createSupervisorFixture();
  const issueNumber = 104;
  const issue: GitHubIssue = {
    number: issueNumber,
    title: "Failed no-PR transient auto-requeue recovery",
    body: executionReadyBody("Explain should show why a transient already-satisfied failed no-PR issue was auto-requeued."),
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
        state: "queued",
        branch: branchName(fixture.config, issueNumber),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        pr_number: null,
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
        stale_stabilizing_no_pr_recovery_count: 1,
        last_runtime_error: "Selected model is at capacity. Please try a different model.",
        last_runtime_failure_kind: "codex_exit",
        last_runtime_failure_context: {
          category: "codex",
          summary: "Selected model is at capacity. Please try a different model.",
          signature: "provider-capacity",
          command: null,
          details: ["provider=codex"],
          url: null,
          updated_at: "2026-03-18T00:10:00Z",
        },
        last_recovery_reason:
          "failed_no_pr_transient_retry: requeued issue #104 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity",
        last_recovery_at: "2026-03-19T00:20:00Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => issue,
    listAllIssues: async () => [issue],
    listCandidateIssues: async () => [issue],
  };

  const explanation = await supervisor.explain(issueNumber);

  assert.match(explanation, /^state=queued$/m);
  assert.match(explanation, /^runnable=yes$/m);
  assert.match(
    explanation,
    /^latest_recovery issue=#104 at=2026-03-19T00:20:00Z reason=failed_no_pr_transient_retry detail=requeued issue #104 from failed to queued after failed no-PR recovery found no meaningful branch diff and matched transient runtime evidence provider-capacity$/m,
  );
  assert.match(explanation, /^runtime_failure_kind=codex_exit$/m);
  assert.match(explanation, /^runtime_failure_summary=Selected model is at capacity\. Please try a different model\.$/m);
});
