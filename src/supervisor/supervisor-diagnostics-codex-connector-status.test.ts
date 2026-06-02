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
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
  createTrackedPullRequestStatusScenario,
  createTrackedStatusIssue,
  staleResidueDiagnosticLines,
  writeSupervisorState,
} from "./supervisor-diagnostics-status-scenarios";
import {
  clearCurrentReconciliationPhase,
  writeCurrentReconciliationPhase,
} from "./supervisor-reconciliation-phase";

test("status surfaces Codex Connector review-request fallback lifecycle for the active PR", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 1925;
  const prNumber = 2925;
  const scenario = createTrackedPullRequestStatusScenario(fixture, {
    issueNumber,
    prNumber,
    recordOverrides: {
      codex_connector_review_requested_observed_at: "2026-05-08T03:30:00Z",
      codex_connector_review_requested_head_sha: "head-1925",
    },
  });
  await writeSupervisorState(fixture, scenario.state);

  const supervisor = new Supervisor({
    ...fixture.config,
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    resolvePullRequestForBranch: async () =>
      createPullRequest({
        number: prNumber,
        headRefName: scenario.branch,
        headRefOid: "head-1925",
        currentHeadCiGreenAt: "2026-05-08T03:09:36Z",
        configuredBotCurrentHeadObservedAt: null,
        codexConnectorReviewRequestedAt: "2026-05-08T03:30:00Z",
        codexConnectorReviewRequestedHeadSha: "head-1925",
      }),
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport({ why: true });

  assert.match(
    report.detailedStatusLines.join("\n"),
    /^codex_connector_review_fallback status=request_posted_no_current_head_signal provider=codex current_head_sha=head-1925 current_head_observed_at=none required_checks_green_at=2026-05-08T03:09:36Z timeout_action=request_review_comment requested_at=2026-05-08T03:30:00Z requested_head_sha=head-1925 review_signal=missing note=request_comment_is_not_review_completion retry_status=eligible retry_count=0 retry_limit=1 retry_wait_until=2026-05-08T03:40:00\.000Z request_comment_identity=unavailable next_action=retry_request_review_comment wait_until=2026-05-08T03:19:36\.000Z$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^codex_connector_convergence status=re_requested_review provider=codex current_head_sha=head-1925 current_head_observed_at=none latest_signal_head_sha=none highest_severity=none finding_count=0 merge_effect=blocked next_action=wait_for_requested_review$/m,
  );
});

test("status --why distinguishes hydrated same-head Codex Connector review requests", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 1958;
  const prNumber = 2958;
  const scenario = createTrackedPullRequestStatusScenario(fixture, {
    issueNumber,
    prNumber,
  });
  await writeSupervisorState(fixture, scenario.state);

  const supervisor = new Supervisor({
    ...fixture.config,
    reviewBotLogins: ["chatgpt-codex-connector"],
    configuredBotCurrentHeadSignalTimeoutMinutes: 10,
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    resolvePullRequestForBranch: async () =>
      createPullRequest({
        number: prNumber,
        headRefName: scenario.branch,
        headRefOid: "head-1958",
        currentHeadCiGreenAt: "2026-05-08T03:09:36Z",
        configuredBotCurrentHeadObservedAt: null,
        codexConnectorReviewRequestedAt: "2026-05-08T03:30:00Z",
        codexConnectorReviewRequestedHeadSha: "head-1958",
      }),
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const report = await supervisor.statusReport({ why: true });

  assert.match(
    report.detailedStatusLines.join("\n"),
    /^codex_connector_review_fallback status=request_posted_no_current_head_signal provider=codex current_head_sha=head-1958 current_head_observed_at=none required_checks_green_at=2026-05-08T03:09:36Z timeout_action=request_review_comment requested_at=2026-05-08T03:30:00Z requested_head_sha=head-1958 review_signal=missing note=request_comment_is_not_review_completion retry_status=eligible retry_count=0 retry_limit=1 retry_wait_until=2026-05-08T03:40:00\.000Z request_comment_identity=unavailable next_action=retry_request_review_comment wait_until=2026-05-08T03:19:36\.000Z$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^codex_connector_convergence status=same_head_request_hydrated provider=codex current_head_sha=head-1958 current_head_observed_at=none latest_signal_head_sha=none highest_severity=none finding_count=0 merge_effect=blocked next_action=wait_for_requested_review$/m,
  );
  assert.match(
    report.detailedStatusLines.join("\n"),
    /^codex_connector_operator_diagnostic interpretation=review_gate_waiting current_head_sha=head-1958 latest_configured_bot_review_sha=none current_head_review_signal=missing actionable_current_diff_threads=0 next_action=wait_for_requested_review$/m,
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

test("status reports Codex Connector P1 policy blocks with thread diagnostics", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 146;
  const prNumber = 246;
  const branch = branchName(fixture.config, issueNumber);
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
        blocked_reason: "stale_review_bot",
        last_error: "Codex Connector P1 finding remains unresolved.",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const pr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-246",
    isDraft: false,
    configuredBotCurrentHeadObservedAt: "2026-03-11T14:05:00Z",
  });
  const p1Thread = {
    id: "thread-p1",
    isResolved: false,
    isOutdated: false,
    path: "src/supervisor/policy.ts",
    line: 42,
    comments: {
      nodes: [
        {
          id: "comment-p1",
          body:
            "**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub> Restore fail-closed review handling**",
          createdAt: "2026-03-11T14:06:00Z",
          url: "https://example.test/pr/246#discussion_r1",
          author: {
            login: "chatgpt-codex-connector[bot]",
            typeName: "Bot",
          },
        },
      ],
    },
  };
  const p2Thread = {
    id: "thread-p2",
    isResolved: false,
    isOutdated: false,
    path: "src/supervisor/retry.ts",
    line: 50,
    comments: {
      nodes: [
        {
          id: "comment-p2",
          body: "P2: Repair the retry path so failed verification cannot be reported as success.",
          createdAt: "2026-03-11T14:07:00Z",
          url: "https://example.test/pr/246#discussion_r2",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  };
  const p3NitpickThread = {
    id: "thread-p3-softened",
    isResolved: false,
    isOutdated: false,
    path: "src/supervisor/naming.ts",
    line: 60,
    comments: {
      nodes: [
        {
          id: "comment-p3-softened",
          body: "P3: Nitpick: prefer a shorter helper name for readability.",
          createdAt: "2026-03-11T14:08:00Z",
          url: "https://example.test/pr/246#discussion_r3",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  };
  const p3RiskThread = {
    id: "thread-p3-escalated",
    isResolved: false,
    isOutdated: false,
    path: "src/supervisor/restore.ts",
    line: 70,
    comments: {
      nodes: [
        {
          id: "comment-p3-escalated",
          body: "P3: This cleanup can cause a regression in the restore failure path.",
          createdAt: "2026-03-11T14:09:00Z",
          url: "https://example.test/pr/246#discussion_r4",
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
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => pr,
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [],
    getUnresolvedReviewThreads: async () => [p1Thread, p2Thread, p3NitpickThread, p3RiskThread],
  };

  const status = await supervisor.status({ why: true });
  assert.match(
    status,
    /^codex_connector_policy_block count=3 severity=P1 file=src\/supervisor\/policy\.ts line=42 thread_url=https:\/\/example\.test\/pr\/246#discussion_r1 next_action=fix_on_new_head_or_wait_for_github_thread_resolution_or_use_explicit_manual_operator_path$/m,
  );
  assert.match(
    status,
    /^codex_connector_operator_diagnostic interpretation=actionable_current_diff current_head_sha=head-246 latest_configured_bot_review_sha=head-246 current_head_review_signal=observed actionable_current_diff_threads=3 next_action=repair_must_fix_findings$/m,
  );
  assert.match(status, /^codex_connector_policy_review p2_actionable=1 p3_softened=1 p3_escalated=1$/m);
  assert.doesNotMatch(status, /^codex_connector_policy_block .*severity=nitpick_only/m);
});

test("status --why reports Codex Connector review churn for concentrated P2 cascades", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 2217;
  const prNumber = 1388;
  const branch = branchName(fixture.config, issueNumber);
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
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const pr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-1388",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    configuredBotCurrentHeadObservedAt: "2026-06-01T06:09:54Z",
  });
  const reviewThreads = [
    ["thread-authority", 109, "P2: Reject release-bundle authority claims before RC/GA readiness assertions."],
    ["thread-truth", 243, "P2: Block inventory truth-source assertions that present the bundle as authoritative."],
    ["thread-scope", 304, "P2: Detect excluded scope claims for subordinate release-bundle sources."],
    ["thread-regex", 326, "P2: Generalize the forbidden claim regex instead of adding another readiness variant."],
  ].map(([id, line, body]) => ({
    id,
    isResolved: false,
    isOutdated: false,
    path: "scripts/verify-phase-65-1-release-bundle-inventory.sh",
    line,
    comments: {
      nodes: [
        {
          id: `${id}-comment`,
          body,
          createdAt: "2026-06-01T06:10:00Z",
          url: `https://example.test/pr/1388#discussion_${id}`,
          author: {
            login: "chatgpt-codex-connector[bot]",
            typeName: "Bot",
          },
        },
      ],
    },
  }));

  const supervisor = new Supervisor({
    ...fixture.config,
    reviewBotLogins: ["chatgpt-codex-connector[bot]"],
    codexConnectorReviewChurnMustFixThreshold: 4,
    codexConnectorReviewChurnFileConcentrationPercent: 75,
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => pr,
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => reviewThreads,
  };

  const status = await supervisor.status({ why: true });

  assert.match(
    status,
    /^codex_connector_review_churn status=clustered_root_cause_repair must_fix=4 threshold=4 highest_severity=P2 concentration_basis=file dominant_file=scripts\/verify-phase-65-1-release-bundle-inventory\.sh dominant_file_threads=4 dominant_file_percent=100 file_concentration_threshold_percent=75 clusters=\d+ largest_cluster=\d+ largest_cluster_percent=\d+ categories=.*truth_source.* representative_threads=thread-authority,thread-truth,thread-scope,thread-regex signature=codex-review-churn:P2:scripts\/verify-phase-65-1-release-bundle-inventory\.sh:.* next_action=cluster_root_cause_repair$/m,
  );
  assert.match(
    status,
    /^codex_connector_operator_diagnostic interpretation=actionable_current_diff current_head_sha=head-1388 latest_configured_bot_review_sha=head-1388 current_head_review_signal=observed actionable_current_diff_threads=4 next_action=repair_must_fix_findings$/m,
  );
});

test("status --why compacts Codex Connector churn around current clusters before outdated residue", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 2227;
  const prNumber = 3227;
  const branch = branchName(fixture.config, issueNumber);
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
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const pr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-2227",
    isDraft: false,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    configuredBotCurrentHeadObservedAt: "2026-06-02T05:00:00Z",
  });
  const currentThreads = [
    ["thread-current-auth", 41, "P2: Require the auth context before accepting Connector churn state."],
    ["thread-current-auth-2", 44, "P2: Require the auth context before accepting Connector churn state in the retry path."],
    ["thread-current-scope", 88, "P2: Keep repository scope explicitly bound before selecting current clusters."],
  ].map(([id, line, body]) => ({
    id,
    isResolved: false,
    isOutdated: false,
    path: "src/supervisor/codex-connector-diagnostics-presenter.ts",
    line,
    comments: {
      nodes: [
        {
          id: `${id}-comment`,
          body,
          createdAt: "2026-06-02T05:01:00Z",
          url: `https://example.test/pr/3227#discussion_${id}`,
          author: {
            login: "chatgpt-codex-connector[bot]",
            typeName: "Bot",
          },
        },
      ],
    },
  }));
  const outdatedThreads = Array.from({ length: 12 }, (_, index) => ({
    id: `thread-outdated-${index}`,
    isResolved: false,
    isOutdated: true,
    path: "src/supervisor/old-diagnostic.ts",
    line: 100 + index,
    comments: {
      nodes: [
        {
          id: `thread-outdated-${index}-comment`,
          body: "P2: Old outdated Connector residue from an earlier head.",
          createdAt: "2026-06-02T04:00:00Z",
          url: `https://example.test/pr/3227#discussion_outdated_${index}`,
          author: {
            login: "chatgpt-codex-connector[bot]",
            typeName: "Bot",
          },
        },
      ],
    },
  }));

  const supervisor = new Supervisor({
    ...fixture.config,
    reviewBotLogins: ["chatgpt-codex-connector[bot]"],
    codexConnectorReviewChurnMustFixThreshold: 3,
    codexConnectorReviewChurnFileConcentrationPercent: 75,
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => pr,
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [...outdatedThreads, ...currentThreads],
  };

  const status = await supervisor.status({ why: true });

  assert.match(
    status,
    /^codex_connector_current_clusters current_effective_must_fix=3 dominant_file=src\/supervisor\/codex-connector-diagnostics-presenter\.ts dominant_file_threads=3 dominant_file_percent=100 clusters=2 categories=.*auth.*scope.* representative_threads=thread-current-auth,thread-current-auth-2,thread-current-scope representative_urls=https:\/\/example\.test\/pr\/3227#discussion_thread-current-auth,https:\/\/example\.test\/pr\/3227#discussion_thread-current-auth-2,https:\/\/example\.test\/pr\/3227#discussion_thread-current-scope outdated_unresolved_residue=12 next_action=repair_must_fix_findings$/m,
  );
  assert.doesNotMatch(status, /^codex_connector_current_clusters .*thread-outdated-/m);
});

test("status compares Codex Connector churn progress against the previous tracked PR snapshot", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 1391;
  const prNumber = 2391;
  const branch = branchName(fixture.config, issueNumber);
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
        last_head_sha: "head-current-1391",
        last_tracked_pr_progress_snapshot: JSON.stringify({
          headRefOid: "head-previous-1391",
          reviewDecision: null,
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
          unresolvedReviewThreadIds: ["thread-previous-0", "thread-previous-1", "thread-previous-2", "thread-previous-3"],
          codexConnectorReviewChurnProgress: {
            currentHeadSha: "head-previous-1391",
            currentEffectiveMustFixCount: 4,
            dominantFile: "src/release-readiness.ts",
            dominantFilePercent: 100,
            clusterCategorySignature: "readiness_claim+truth_source",
            representativeThreadIds: ["thread-previous-0", "thread-previous-1", "thread-previous-2", "thread-previous-3"],
          },
        }),
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const pr = createPullRequest({
    number: prNumber,
    headRefName: branch,
    headRefOid: "head-current-1391",
    isDraft: false,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    configuredBotCurrentHeadObservedAt: "2026-06-01T06:20:00Z",
  });
  const activeThreads = Array.from({ length: 2 }, (_, index) => ({
    id: `thread-current-${index}`,
    isResolved: false,
    isOutdated: false,
    path: "src/release-readiness.ts",
    line: 120 + index,
    comments: {
      nodes: [
        {
          id: `thread-current-${index}-comment`,
          body: "P2: Block release readiness truth-source claims until the verifier proves the authoritative source.",
          createdAt: "2026-06-01T06:20:00Z",
          url: `https://example.test/pr/1391#discussion_current_${index}`,
          author: {
            login: "chatgpt-codex-connector[bot]",
            typeName: "Bot",
          },
        },
      ],
    },
  }));
  const outdatedThreads = Array.from({ length: 3 }, (_, index) => ({
    id: `thread-outdated-${index}`,
    isResolved: false,
    isOutdated: true,
    path: "src/release-readiness.ts",
    line: 140 + index,
    comments: {
      nodes: [
        {
          id: `thread-outdated-${index}-comment`,
          body: "P2: Old unresolved outdated thread that must not count against current-head progress.",
          createdAt: "2026-06-01T06:10:00Z",
          url: `https://example.test/pr/1391#discussion_outdated_${index}`,
          author: {
            login: "chatgpt-codex-connector[bot]",
            typeName: "Bot",
          },
        },
      ],
    },
  }));

  const supervisor = new Supervisor({
    ...fixture.config,
    reviewBotLogins: ["chatgpt-codex-connector[bot]"],
    codexConnectorReviewChurnMustFixThreshold: 2,
    codexConnectorReviewChurnFileConcentrationPercent: 75,
  });
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => pr,
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [...activeThreads, ...outdatedThreads],
  };

  const status = await supervisor.status({ why: true });

  assert.match(
    status,
    /^codex_connector_review_churn_progress classification=improving current_head_sha=head-current-1391 previous_head_sha=head-previous-1391 current_effective_must_fix=2 previous_effective_must_fix=4 effective_must_fix_delta=-2 dominant_file=src\/release-readiness\.ts previous_dominant_file=src\/release-readiness\.ts dominant_file_percent=100 cluster_category_signature=.*truth_source.* previous_cluster_category_signature=.*readiness_claim.*truth_source.* representative_threads=thread-current-0,thread-current-1$/m,
  );
});

test("status waits for current-head Codex review when non-outdated threads came from a stale review commit", async (t) => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-19T09:14:00Z");
  t.after(() => {
    Date.now = originalDateNow;
  });
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

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
        blocked_reason: null,
        last_error: null,
        provider_success_head_sha: staleReviewHead,
        provider_success_observed_at: "2026-05-18T22:30:16Z",
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

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
    {
      id: "PRRT_kwDOSfC_1M6DF5s0",
      isResolved: false,
      isOutdated: true,
      path: "src/writeback-ingest.ts",
      line: 400,
      comments: {
        nodes: [
          {
            id: "comment-stale-2",
            body: "P2: Accept refreshes already reflected in HRCore.",
            createdAt: "2026-05-18T22:32:00Z",
            url: "https://example.test/pr/147#discussion_r2",
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
    listCandidateIssues: async () => [],
    listAllIssues: async () => [],
    getPullRequestIfExists: async () => pr,
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => staleCommitThreads,
  };

  const status = await supervisor.status({ why: true });
  assert.match(
    status,
    /^codex_connector_review_fallback status=request_eligible provider=codex current_head_sha=c1ac7215a12398842152b1daf42311faef297317 current_head_observed_at=none required_checks_green_at=2026-05-19T09:03:41Z timeout_action=request_review_comment requested_at=none requested_head_sha=none review_signal=missing note=request_comment_is_not_review_completion next_action=request_current_head_review wait_until=2026-05-19T09:13:41\.000Z$/m,
  );
  assert.doesNotMatch(status, /^codex_connector_review_fallback status=timeout_elapsed\b.*\brequested_at=none\b/m);
  assert.match(
    status,
    /^codex_connector_convergence status=stale_review_commit_residue provider=codex current_head_sha=c1ac7215a12398842152b1daf42311faef297317 current_head_observed_at=none latest_signal_head_sha=98da2474c530b76dae67b5a6f43e0671b989f65a highest_severity=none finding_count=0 merge_effect=blocked next_action=request_current_head_review stale_review_commit_threads=1 stale_review_commit_thread_ids=PRRT_kwDOSfC_1M6DF5s7$/m,
  );
  assert.match(
    status,
    /^codex_connector_operator_diagnostic interpretation=current_head_review_pending_with_stale_threads current_head_sha=c1ac7215a12398842152b1daf42311faef297317 latest_configured_bot_review_sha=98da2474c530b76dae67b5a6f43e0671b989f65a current_head_review_signal=missing actionable_current_diff_threads=0 stale_review_commit_threads=1 stale_review_commit_thread_ids=PRRT_kwDOSfC_1M6DF5s7 next_action=request_current_head_review$/m,
  );
  assert.doesNotMatch(status, /^operator_action action=continue /m);
  assert.doesNotMatch(status, /^codex_connector_operator_diagnostic interpretation=actionable_current_diff /m);
  assert.doesNotMatch(status, /^codex_connector_policy_block /m);
});

test("status --why requests Codex current-head review for metadata-only missing review residue", async (t) => {
  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-05-21T20:45:06Z");
  t.after(() => {
    Date.now = originalDateNow;
  });
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  fixture.config.configuredBotCurrentHeadSignalTimeoutMinutes = 10;
  fixture.config.configuredBotCurrentHeadSignalTimeoutAction = "request_review_comment";
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

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
    title: "Status metadata-only current-head request",
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
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => pr,
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [staleMetadataThread],
  };

  const status = await supervisor.status({ why: true });

  assert.match(
    status,
    /^stale_review_bot_remediation issue=#144 pr=#148 reason=stale_review_bot code_ci=green current_head_sha=f3addc310b0ff8e4fc53d9f3e0ab783af70a552f processed_on_current_head=unknown classification=metadata_only_missing_current_head_review codex_current_head_review_state=missing review_thread_url=none manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note summary=stale_configured_bot_thread_metadata_only_pending_current_head_review_request$/m,
  );
  assert.match(
    status,
    /^codex_connector_review_fallback status=request_eligible provider=codex current_head_sha=f3addc310b0ff8e4fc53d9f3e0ab783af70a552f current_head_observed_at=none required_checks_green_at=2026-05-21T20:32:06Z timeout_action=request_review_comment requested_at=none requested_head_sha=none review_signal=missing note=request_comment_is_not_review_completion next_action=request_current_head_review wait_until=/m,
  );
  assert.match(
    status,
    /^codex_connector_operator_diagnostic interpretation=stale_review_residue current_head_sha=f3addc310b0ff8e4fc53d9f3e0ab783af70a552f latest_configured_bot_review_sha=none current_head_review_signal=missing actionable_current_diff_threads=0 next_action=request_current_head_review$/m,
  );
  assert.doesNotMatch(status, /^codex_connector_operator_diagnostic .*next_action=inspect_exact_review_thread_then_resolve_or_leave_manual_note$/m);
});

test("status --why selects manual-review tracked PR when Codex current-head review request is eligible", async (t) => {
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
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => pr,
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [],
  };

  const status = await supervisor.status({ why: true });

  assert.match(status, /^selected_issue=#2072$/m);
  assert.match(status, /^selection_reason=ready .*retry_state=resume:blocked$/m);
  assert.match(
    status,
    /^codex_connector_review_fallback status=request_eligible provider=codex .* next_action=request_current_head_review /m,
  );
  assert.match(
    status,
    /^tracked_pr_mismatch issue=#2072 pr=#177 .*local_state=blocked local_blocked_reason=manual_review /m,
  );
  assert.doesNotMatch(status, /^operator_action action=manual_review /m);
  assert.doesNotMatch(status, /^restart_recommendation category=manual_review_before_restart /m);
  assert.doesNotMatch(status, /^selected_issue=none$/m);
});

test("status --why selects stale-review-bot tracked PR when Codex current-head review request is eligible", async (t) => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  fixture.config.configuredBotInitialGraceWaitSeconds = 0;
  fixture.config.configuredBotCurrentHeadSignalTimeoutMinutes = 10;
  fixture.config.configuredBotCurrentHeadSignalTimeoutAction = "request_review_comment";
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });

  const issueNumber = 2096;
  const prNumber = 179;
  const branch = branchName(fixture.config, issueNumber);
  const currentHead = "ad2a7f2d9c62f52f190d42884f1844c5b5da2096";
  const staleReviewHead = "1bd7511632c6db5bf1f1bbe91f0b5c4cebad2096";
  const staleThread = {
    id: "thread-stale-review-bot-current-head",
    isResolved: false,
    isOutdated: true,
    path: "src/review-policy.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: "comment-stale-review-bot-current-head",
          body: "P2: metadata-only stale configured-bot finding.",
          createdAt: "2026-05-22T00:00:00Z",
          url: "https://example.test/pr/179#discussion_stale_review_bot_current_head",
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  };
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
        blocked_reason: "stale_review_bot",
        provider_success_head_sha: staleReviewHead,
        provider_success_observed_at: "2026-05-21T23:50:00Z",
        copilot_review_timed_out_at: "2026-05-22T00:10:00.000Z",
        copilot_review_timeout_action: "request_review_comment",
        codex_connector_review_requested_observed_at: null,
        codex_connector_review_requested_head_sha: null,
        processed_review_thread_ids: [`${staleThread.id}@${currentHead}`],
        processed_review_thread_fingerprints: [`${staleThread.id}@${currentHead}#${staleThread.comments.nodes[0].id}`],
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "Codex Connector request eligible stale review bot recovery",
    body: executionReadyBody("Request current-head Codex review when stale review bot residue is request eligible."),
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
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => pr,
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [staleThread],
  };

  const status = await supervisor.status({ why: true });

  assert.match(status, /^selected_issue=#2096$/m);
  assert.match(status, /^selection_reason=ready .*retry_state=resume:blocked$/m);
  assert.match(status, /^runnable_issues=#2096 ready=execution_ready$/m);
  assert.match(
    status,
    /^codex_connector_review_fallback status=request_eligible provider=codex .* next_action=request_current_head_review /m,
  );
  assert.doesNotMatch(status, /^operator_action action=continue /m);
  assert.doesNotMatch(status, /^selected_issue=none$/m);
});

test("status --why fails closed for codex processed residue without current-head verification evidence", async (t) => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  const issueNumber = 398;
  const prNumber = 498;
  const headSha = "5de0d3844468d4a77cab512f8dcbe46171166c3a";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-398",
    commentId: "comment-398",
    path: "src/query.ts",
    line: 12,
    commentBody: "P1: Fix this stale finding before merge.",
    discussionUrl: "https://example.test/pr/498#discussion_r398",
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

  const trackedIssue = createTrackedStatusIssue({
    issueNumber,
    title: "Status why classifies codex processed residue",
    summary: "Keep Codex processed residue blocked until current-head verification evidence exists.",
    createdAt: "2026-05-13T00:00:00Z",
  });
  const pr = createPullRequest(scenario.pullRequestPatch);
  const staleMetadataThread = scenario.reviewThread;

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => pr,
    getChecks: async () => scenario.passingChecks,
    getUnresolvedReviewThreads: async () => [staleMetadataThread],
  };

  const status = await supervisor.status({ why: true });

  assert.match(
    status,
    /^stale_review_bot_remediation issue=#398 pr=#498 reason=stale_review_bot code_ci=green current_head_sha=5de0d3844468d4a77cab512f8dcbe46171166c3a processed_on_current_head=yes classification=unknown_needs_operator codex_current_head_review_state=missing review_thread_url=https:\/\/example\.test\/pr\/498#discussion_r398 manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note missing_probe_reason=current_head_verification_evidence_missing summary=code_or_ci_green_but_review_thread_metadata_unresolved$/m,
  );
  assert.match(
    status,
    /^stale_review_bot_thread_diagnostics issue=#398 pr=#498 current_head_success=no unresolved_current_threads=1 actionable_must_fix_threads=1 verified_stale_residue_threads=0 missing_verification_evidence_threads=1 repeat_stop_exhausted=no auto_repair_suppressed_reason=missing_verification_probe$/m,
  );
  assert.match(
    status,
    /^codex_connector_operator_diagnostic interpretation=stale_review_residue current_head_sha=5de0d3844468d4a77cab512f8dcbe46171166c3a latest_configured_bot_review_sha=5de0d3844468d4a77cab512f8dcbe46171166c3a current_head_review_signal=missing actionable_current_diff_threads=unknown next_action=inspect_exact_review_thread_then_resolve_or_leave_manual_note$/m,
  );
  assert.doesNotMatch(status, /^operator_action action=resolve_stale_review_bot source=stale_review_bot_remediation /m);
  assert.match(status, /^operator_action action=manual_review source=stale_review_bot_remediation /m);
});

test("status --why distinguishes codex verified current-head repair residue from no-source-change residue", async (t) => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  const issueNumber = 399;
  const prNumber = 499;
  const headSha = "76060523f803ebe25832cb2c355aaaa9530502f3";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-399",
    commentId: "comment-399",
    path: "scripts/verify-closeout.sh",
    line: 124,
    commentBody: "P2: Cover the production-secret closeout overclaim.",
    discussionUrl: "https://example.test/pr/499#discussion_r399",
    severity: "P2",
    verifiedRepair: {
      summary: "Focused verifier passed after the repair commit.",
      ranAt: "2026-05-13T00:18:00Z",
      command: "npm test -- src/supervisor/supervisor-diagnostics-status-selection.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-13T00:12:00Z",
      observedAt: "2026-05-13T00:17:00Z",
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

  const trackedIssue = createTrackedStatusIssue({
    issueNumber,
    title: "Status why classifies Codex verified repair residue",
    summary: "Classify verified Codex repair residue separately from no-source-change residue.",
    createdAt: "2026-05-13T00:00:00Z",
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotLatestReviewedCommitSha: "1bd7511632c6db5bf1f1bbe91f0b5c4cebad1770",
  });
  const staleMetadataThread = scenario.reviewThread;

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => pr,
    getChecks: async () => scenario.passingChecks,
    getUnresolvedReviewThreads: async () => [staleMetadataThread],
  };

  const status = await supervisor.status({ why: true });

  assert.match(
    status,
    /^stale_review_bot_remediation issue=#399 pr=#499 reason=stale_review_bot code_ci=green current_head_sha=76060523f803ebe25832cb2c355aaaa9530502f3 processed_on_current_head=yes classification=verified_current_head_repair_pending_thread_resolution codex_current_head_review_state=observed review_thread_url=https:\/\/example\.test\/pr\/499#discussion_r399 manual_next_step=resolve_verified_repaired_configured_bot_threads_then_rerun_supervisor verification_evidence=Focused_verifier_passed_after_the_repair_commit\.;codex_pr_success_comment_after_current_head_request summary=verified_current_head_repair_configured_bot_thread_resolution_pending$/m,
  );
  assert.doesNotMatch(status, /classification=verified_no_source_change_pending_thread_resolution/);
});

test("status --why surfaces verified Codex residue remediation for manual_review fallthrough", async (t) => {
  const fixture = await createSupervisorFixture();
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  fixture.config.verifiedCurrentHeadRepairReviewThreadAutoResolve = true;
  const issueNumber = 143;
  const prNumber = 147;
  const headSha = "68401b26947918f0ce2280a9526ab68298b1a25c";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_kwDOSfC_1M6DBYp8",
    commentId: "comment-PRRT_kwDOSfC_1M6DBYp8",
    path: "src/writeback-ingest.ts",
    line: 42,
    commentBody: "P2: Update the published writeback response schema.",
    discussionUrl: "https://example.test/pr/147#discussion_r147",
    severity: "P2",
    verifiedRepair: {
      summary: "verify-pre-pr passed with 96 tests.",
      ranAt: "2026-05-18T07:18:00Z",
      command: "npm run verify:pre-pr",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-18T07:12:00Z",
      observedAt: "2026-05-18T07:17:00Z",
    },
  });
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        ...scenario.recordPatch,
        state: "blocked",
        blocked_reason: "manual_review",
        last_failure_signature: "PRRT_kwDOSfC_1M6DBYp8",
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue = createTrackedStatusIssue({
    issueNumber,
    title: "Tracked PR manual_review bypasses verified Codex residue remediation",
    summary: "Resolve verified stale Codex review residue after manual review fallthrough.",
    createdAt: "2026-05-18T00:00:00Z",
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => pr,
    getChecks: async () => scenario.passingChecks,
    getUnresolvedReviewThreads: async () => [scenario.reviewThread],
  };

  const status = await supervisor.status({ why: true });

  assert.match(
    status,
    /^stale_review_bot_remediation issue=#143 pr=#147 reason=stale_review_bot code_ci=green current_head_sha=68401b26947918f0ce2280a9526ab68298b1a25c processed_on_current_head=yes classification=verified_current_head_repair_pending_thread_resolution codex_current_head_review_state=observed review_thread_url=https:\/\/example\.test\/pr\/147#discussion_r147 manual_next_step=resolve_verified_repaired_configured_bot_threads_then_rerun_supervisor verification_evidence=verify-pre-pr_passed_with_96_tests\.;codex_pr_success_comment_after_current_head_request summary=verified_current_head_repair_configured_bot_thread_resolution_pending$/m,
  );
  assert.match(status, /^operator_action action=resolve_stale_review_bot source=stale_review_bot_remediation /m);
  assert.doesNotMatch(status, /run-once --config \.\.\. --dry-run/);
});

test("status --why names missing verification for manual-review Codex no-major residue", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  const issueNumber = 171;
  const prNumber = 180;
  const headSha = "12b099926c39c8b7502176339ea34750e6a807a4";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-current-head-residue",
    commentId: "comment-current-head-residue",
    path: "src/review-state.ts",
    line: 42,
    commentBody: "P1: Preserve current-head review metadata convergence.",
    discussionUrl: "https://example.test/pr/180#discussion_current_head_residue",
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-23T01:09:53Z",
      observedAt: "2026-05-23T01:14:50Z",
    },
  });
  const currentHeadThreads = Array.from({ length: 9 }, (_, index) => ({
    ...scenario.reviewThread,
    id: `thread-current-head-residue-${index + 1}`,
    path: `src/review-state-${index + 1}.ts`,
    line: 42 + index,
    comments: {
      nodes: [
        {
          ...scenario.reviewThread.comments.nodes[0],
          id: `comment-current-head-residue-${index + 1}`,
          body: `P${index % 2 === 0 ? "1" : "2"}: Preserve current-head review metadata convergence ${index + 1}.`,
          url:
            index === 0
              ? "https://example.test/pr/180#discussion_current_head_residue"
              : `https://example.test/pr/180#discussion_current_head_residue_${index + 1}`,
        },
      ],
    },
  }));
  const outdatedThreadIds = [
    "PRRT_kwDOSfC_1M6EPhQ2",
    "PRRT_kwDOSfC_1M6EPhQ3",
    "PRRT_kwDOSfC_1M6EPhQ5",
    "PRRT_kwDOSfC_1M6EPnsk",
    "PRRT_kwDOSfC_1M6EPnsl",
    "PRRT_kwDOSfC_1M6EP0bA",
    "PRRT_kwDOSfC_1M6EP-tV",
    "PRRT_kwDOSfC_1M6EQH1Y",
    "PRRT_kwDOSfC_1M6EQO1-",
    "PRRT_kwDOSfC_1M6EQTkd",
  ];
  const currentHeadFailureDetails = currentHeadThreads.map((thread) => {
    const comment = thread.comments.nodes[0];
    return `reviewer=${CODEX_CONNECTOR_REVIEW_BOT_LOGIN} file=${thread.path} line=${thread.line} p_severity=${
      comment.body.startsWith("P1:") ? "P1" : "P2"
    } processed_on_current_head=yes`;
  });
  const outdatedFailureDetails = outdatedThreadIds.map(
    (threadId, index) =>
      `reviewer=${CODEX_CONNECTOR_REVIEW_BOT_LOGIN} file=src/earlier-review-state-${index}.ts line=${80 + index} p_severity=P1 processed_on_current_head=no thread_id=${threadId}`,
  );
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        ...scenario.recordPatch,
        state: "blocked",
        blocked_reason: "manual_review",
        last_tracked_pr_repeat_failure_decision: "stop_no_progress",
        last_failure_signature: `stalled-bot:${outdatedThreadIds.join(",")}`,
        last_failure_context: {
          ...scenario.staleReviewFailureContext,
          signature: `stalled-bot:${outdatedThreadIds.join(",")}`,
          details: [...currentHeadFailureDetails, ...outdatedFailureDetails],
        },
        processed_review_thread_ids: currentHeadThreads.map((thread) => `${thread.id}@${headSha}`),
        processed_review_thread_fingerprints: currentHeadThreads.map((thread) => {
          const comment = thread.comments.nodes[0];
          return `${thread.id}@${headSha}#${comment.id}`;
        }),
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "HRCore shaped missing verification Codex residue",
    body: executionReadyBody("Surface the missing verification predicate for current-head Codex residue."),
    createdAt: "2026-05-23T00:00:00Z",
    updatedAt: "2026-05-23T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadStatusState: null,
    configuredBotTopLevelReviewStrength: "blocking",
  });
  const outdatedThreads = outdatedThreadIds.map((threadId, index) => ({
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
          url: `https://example.test/pr/180#discussion_${threadId}`,
        },
      ],
    },
  }));

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    getIssue: async () => trackedIssue,
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => pr,
    resolvePullRequestForBranch: async () => pr,
    getChecks: async () => [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    getUnresolvedReviewThreads: async () => [...currentHeadThreads, ...outdatedThreads],
  };

  const status = await supervisor.status({ why: true });
  const explanation = await supervisor.explain(issueNumber);

  assert.match(status, /^no_active_tracked_record issue=#171 classification=stale_review_bot_remediation state=blocked reason=unknown_needs_operator$/m);
  assert.match(
    status,
    /^stale_review_bot_remediation issue=#171 pr=#180 reason=stale_review_bot code_ci=green current_head_sha=12b099926c39c8b7502176339ea34750e6a807a4 processed_on_current_head=unknown classification=unknown_needs_operator codex_current_head_review_state=observed review_thread_url=https:\/\/example\.test\/pr\/180#discussion_current_head_residue manual_next_step=inspect_exact_review_thread_then_resolve_or_leave_manual_note missing_probe_reason=current_head_verification_evidence_missing summary=code_or_ci_green_but_review_thread_metadata_unresolved$/m,
  );
  assert.match(
    status,
    /^stale_review_bot_thread_diagnostics issue=#171 pr=#180 current_head_success=yes unresolved_current_threads=9 actionable_must_fix_threads=9 verified_stale_residue_threads=0 missing_verification_evidence_threads=9 repeat_stop_exhausted=yes auto_repair_suppressed_reason=repeat_stop_exhausted$/m,
  );
  assert.match(
    status,
    /^codex_connector_operator_diagnostic interpretation=stale_review_residue current_head_sha=12b099926c39c8b7502176339ea34750e6a807a4 latest_configured_bot_review_sha=none current_head_review_signal=observed actionable_current_diff_threads=unknown next_action=inspect_exact_review_thread_then_resolve_or_leave_manual_note$/m,
  );
  assert.doesNotMatch(status, /^codex_connector_convergence\b/m);
  assert.doesNotMatch(status, /^codex_connector_operator_diagnostic interpretation=actionable_current_diff /m);
  assert.deepEqual(staleResidueDiagnosticLines(status).sort(), staleResidueDiagnosticLines(explanation).sort());
});

test("status --why converges processed current-head Codex no-major review threads from stale manual review", async (t) => {
  const fixture = await createSupervisorFixture();
  t.after(async () => {
    await fs.rm(path.dirname(fixture.repoPath), { recursive: true, force: true });
  });
  fixture.config.reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  const issueNumber = 171;
  const prNumber = 180;
  const headSha = "12b099926c39c8b7502176339ea34750e6a807a4";
  const threadIds = [
    "PRRT_kwDOSfC_1M6EPhQy",
    "PRRT_kwDOSfC_1M6EPhQ0",
    "PRRT_kwDOSfC_1M6EPnsm",
    "PRRT_kwDOSfC_1M6EP0a8",
    "PRRT_kwDOSfC_1M6EP0a_",
    "PRRT_kwDOSfC_1M6EP0bC",
    "PRRT_kwDOSfC_1M6EP7Ay",
    "PRRT_kwDOSfC_1M6EP7Az",
    "PRRT_kwDOSfC_1M6EP7A2",
  ];
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: threadIds[0] ?? "PRRT_current_head_residue",
    commentId: "comment-current-head-residue-0",
    path: "src/review-state.ts",
    line: 42,
    commentBody: "P1: Preserve current-head review metadata convergence.",
    discussionUrl: "https://example.test/pr/180#discussion_rcurrent_head_residue",
    verifiedRepair: {
      summary: "verify-pre-pr passed on the current head.",
      ranAt: "2026-05-23T01:01:21Z",
      command: "node dist/index.js verify-pre-pr",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-23T01:09:53Z",
      observedAt: "2026-05-23T01:14:50Z",
    },
  });
  const reviewThreads = threadIds.map((threadId, index) => ({
    ...scenario.reviewThread,
    id: threadId,
    path: `src/review-state-${index}.ts`,
    line: 40 + index,
    comments: {
      nodes: [
        {
          ...scenario.reviewThread.comments.nodes[0],
          id: `comment-current-head-residue-${index}`,
          body: `${index % 2 === 0 ? "P1" : "P2"}: Preserve current-head review metadata convergence.`,
          url: `https://example.test/pr/180#discussion_${threadId}`,
        },
      ],
    },
  }));
  const state: SupervisorStateFile = {
    activeIssueNumber: null,
    issues: {
      [String(issueNumber)]: createRecord({
        ...scenario.recordPatch,
        state: "blocked",
        blocked_reason: "manual_review",
        workspace: path.join(fixture.workspaceRoot, `issue-${issueNumber}`),
        journal_path: null,
        processed_review_thread_ids: threadIds.map((threadId) => `${threadId}@${headSha}`),
        processed_review_thread_fingerprints: threadIds.map(
          (threadId, index) => `${threadId}@${headSha}#comment-current-head-residue-${index}`,
        ),
        last_failure_context: {
          ...scenario.staleReviewFailureContext,
          signature: threadIds.map((threadId) => `stalled-bot:${threadId}`).join("|"),
          details: reviewThreads.map(
            (thread) =>
              `reviewer=${CODEX_CONNECTOR_REVIEW_BOT_LOGIN} file=${thread.path} line=${thread.line} processed_on_current_head=yes`,
          ),
        },
      }),
    },
  };
  await fs.writeFile(fixture.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const trackedIssue: GitHubIssue = {
    number: issueNumber,
    title: "HRCore shaped current-head Codex residue",
    body: executionReadyBody("Recover processed current-head Codex metadata residue from stale manual review."),
    createdAt: "2026-05-23T00:00:00Z",
    updatedAt: "2026-05-23T00:00:00Z",
    url: `https://example.test/issues/${issueNumber}`,
    labels: [],
    state: "OPEN",
  };
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadStatusState: null,
    configuredBotTopLevelReviewStrength: "blocking",
  });

  const supervisor = new Supervisor(fixture.config);
  (supervisor as unknown as { github: Record<string, unknown> }).github = {
    listCandidateIssues: async () => [trackedIssue],
    listAllIssues: async () => [trackedIssue],
    getPullRequestIfExists: async () => pr,
    getChecks: async () => scenario.passingChecks,
    getUnresolvedReviewThreads: async () => reviewThreads,
  };

  const status = await supervisor.status({ why: true });

  assert.match(status, /^no_active_tracked_record issue=#171 classification=stale_review_bot_remediation state=blocked reason=verified_current_head_repair_pending_thread_resolution$/m);
  assert.match(
    status,
    /^stale_review_bot_thread_diagnostics issue=#171 pr=#180 current_head_success=yes unresolved_current_threads=9 actionable_must_fix_threads=9 verified_stale_residue_threads=9 missing_verification_evidence_threads=0 repeat_stop_exhausted=no auto_repair_suppressed_reason=opt_in_disabled$/m,
  );
  assert.match(
    status,
    /^codex_connector_convergence status=stale_review_metadata provider=codex current_head_sha=12b099926c39c8b7502176339ea34750e6a807a4 current_head_observed_at=2026-05-23T01:14:50Z latest_signal_head_sha=12b099926c39c8b7502176339ea34750e6a807a4 highest_severity=none finding_count=0 merge_effect=ready next_action=merge_ready stale_review_metadata_classification=verified_current_head_repair_pending_thread_resolution$/m,
  );
  assert.match(
    status,
    /^codex_connector_operator_diagnostic interpretation=stale_review_residue current_head_sha=12b099926c39c8b7502176339ea34750e6a807a4 latest_configured_bot_review_sha=12b099926c39c8b7502176339ea34750e6a807a4 current_head_review_signal=observed actionable_current_diff_threads=0 next_action=resolve_verified_repaired_configured_bot_threads_then_rerun_supervisor$/m,
  );
  assert.doesNotMatch(status, /^codex_connector_convergence status=repairing_must_fix /m);
  assert.doesNotMatch(status, /^codex_connector_operator_diagnostic interpretation=actionable_current_diff /m);
});
