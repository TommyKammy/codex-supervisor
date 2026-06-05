import test from "node:test";
import assert from "node:assert/strict";
import { createConfig, createPullRequest, createRecord, createReviewThread } from "../turn-execution-test-helpers";
import {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
} from "../codex-connector-tracked-pr-test-helpers";
import { buildStaleReviewBotRemediation, buildStaleReviewBotThreadDiagnostics } from "./stale-review-bot-remediation";

test("buildStaleReviewBotRemediation classifies same-head Codex no-major comment despite stale blocking review strength", () => {
  const issueNumber = 110;
  const prNumber = 115;
  const headSha = "c184c41883b831ab6b85bf3467a66a5c01fd49fa";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-mutation-lock-stale-recovery",
    commentId: "comment-mutation-lock-stale-recovery",
    path: "src/mutation-lock.ts",
    line: 42,
    severity: "P2",
    commentBody: "P2: Verify stale mutation lock recovery only releases the acquired lock instance.",
    discussionUrl: "https://example.test/pr/115#discussion_r115",
    verifiedRepair: {
      summary: "Focused mutation lock verifier passed on the current head.",
      ranAt: "2026-05-21T11:10:00Z",
      command: "npm test -- src/supervisor/stale-review-bot-remediation.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-21T11:05:00Z",
      observedAt: "2026-05-21T11:09:00Z",
    },
  });
  const config = createConfig({ reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN] });
  const record = createRecord(scenario.recordPatch);
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadStatusState: null,
    configuredBotTopLevelReviewStrength: "blocking",
  });

  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
  });
  const diagnostics = buildStaleReviewBotThreadDiagnostics({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
    remediation,
  });

  assert.equal(remediation?.classification, "verified_current_head_repair_pending_thread_resolution");
  assert.equal(remediation?.codexCurrentHeadReviewState, "observed");
  assert.equal(
    remediation?.missingProbeReason,
    null,
  );
  assert.match(
    remediation?.verificationEvidenceSummary ?? "",
    /Focused mutation lock verifier passed on the current head.;codex_pr_success_comment_after_current_head_request/,
  );
  assert.equal(diagnostics?.currentHeadSuccess, "yes");
});

test("buildStaleReviewBotRemediation accepts green current-head checks as verified repair evidence after no-major", () => {
  const issueNumber = 187;
  const prNumber = 194;
  const headSha = "69b6043b941527645dd5df24535cd095cd627a0a";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_current_head_repaired_residue",
    commentId: "PRRC_current_head_repaired_residue",
    path: "src/app.ts",
    line: 76,
    severity: "P2",
    commentBody: "P2: Earlier current-diff finding is repaired on the latest head.",
    discussionUrl: "https://example.test/pr/194#discussion_r3316522484",
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-28T09:31:32Z",
      observedAt: "2026-05-28T09:35:46Z",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    latest_local_ci_result: null,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm run verify:pre-pr",
        head_sha: "older-repair-head",
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "A previous repair head passed before the latest cleanup commit.",
        recorded_at: "2026-05-28T09:02:10Z",
      },
    ],
    repair_attempt_count: 2,
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    currentHeadCiGreenAt: "2026-05-28T09:22:05Z",
    configuredBotCurrentHeadStatusState: null,
    configuredBotTopLevelReviewStrength: "blocking",
  });
  const checks = [
    { name: CODEX_CONNECTOR_REVIEW_BOT_LOGIN, state: "SUCCESS", bucket: "pass" as const },
    { name: "verify-pre-pr", state: "SUCCESS", bucket: "pass" as const, workflow: "CI" },
  ];

  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks,
    reviewThreads: [scenario.reviewThread],
  });
  const diagnostics = buildStaleReviewBotThreadDiagnostics({
    config,
    record,
    pr,
    checks,
    reviewThreads: [scenario.reviewThread],
    remediation,
  });

  assert.equal(remediation?.classification, "verified_current_head_repair_pending_thread_resolution");
  assert.equal(remediation?.codexCurrentHeadReviewState, "observed");
  assert.equal(remediation?.missingProbeReason, null);
  assert.match(
    remediation?.verificationEvidenceSummary ?? "",
    /current_head_checks_passed:verify-pre-pr;codex_pr_success_comment_after_current_head_request/,
  );
  assert.equal(diagnostics?.verifiedStaleResidueThreads, 1);
  assert.equal(diagnostics?.missingVerificationEvidenceThreads, 0);
  assert.equal(diagnostics?.repeatStopExhausted, "no");
  assert.equal(diagnostics?.autoRepairSuppressedReason, "none");
});

test("buildStaleReviewBotRemediation keeps P1 current-head repair residue blocked after no-major", () => {
  const issueNumber = 188;
  const prNumber = 195;
  const headSha = "f2b1be31eaf78a3d1c7f1ccd28e730bb38e00b1d";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_current_head_repaired_p1_residue",
    commentId: "PRRC_current_head_repaired_p1_residue",
    path: "src/app.ts",
    line: 88,
    severity: "P1",
    commentBody: "P1: Do not auto-resolve higher-severity current-head repair residue.",
    discussionUrl: "https://example.test/pr/195#discussion_r3316522485",
    verifiedRepair: {
      summary: "Focused verifier passed after the repair commit.",
      ranAt: "2026-05-28T09:38:46Z",
      command: "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-28T09:31:32Z",
      observedAt: "2026-05-28T09:35:46Z",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord(scenario.recordPatch);
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    configuredBotCurrentHeadStatusState: null,
    configuredBotTopLevelReviewStrength: "blocking",
  });

  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
  });
  const diagnostics = buildStaleReviewBotThreadDiagnostics({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
    remediation,
  });

  assert.equal(remediation?.classification, "unresolved_work");
  assert.equal(remediation?.codexCurrentHeadReviewState, "observed");
  assert.equal(diagnostics?.verifiedStaleResidueThreads, 0);
  assert.equal(diagnostics?.autoRepairSuppressedReason, "not_verified_stale_residue");
});

test("buildStaleReviewBotRemediation rejects review-bot-only checks as verified repair evidence", () => {
  const issueNumber = 187;
  const prNumber = 194;
  const headSha = "69b6043b941527645dd5df24535cd095cd627a0a";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "PRRT_current_head_repaired_residue",
    commentId: "PRRC_current_head_repaired_residue",
    path: "src/app.ts",
    line: 76,
    severity: "P2",
    commentBody: "P2: Earlier current-diff finding is repaired on the latest head.",
    discussionUrl: "https://example.test/pr/194#discussion_r3316522484",
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-28T09:31:32Z",
      observedAt: "2026-05-28T09:35:46Z",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    latest_local_ci_result: null,
    timeline_artifacts: [],
    repair_attempt_count: 2,
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    currentHeadCiGreenAt: "2026-05-28T09:22:05Z",
    configuredBotCurrentHeadStatusState: null,
    configuredBotTopLevelReviewStrength: "blocking",
  });
  const checks = [{ name: CODEX_CONNECTOR_REVIEW_BOT_LOGIN, state: "SUCCESS", bucket: "pass" as const }];

  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks,
    reviewThreads: [scenario.reviewThread],
  });
  const diagnostics = buildStaleReviewBotThreadDiagnostics({
    config,
    record,
    pr,
    checks,
    reviewThreads: [scenario.reviewThread],
    remediation,
  });

  assert.equal(remediation?.classification, "unknown_needs_operator");
  assert.equal(remediation?.codexCurrentHeadReviewState, "observed");
  assert.equal(remediation?.missingProbeReason, "current_head_verification_evidence_missing");
  assert.equal(remediation?.verificationEvidenceSummary, null);
  assert.equal(diagnostics?.verifiedStaleResidueThreads, 0);
  assert.equal(diagnostics?.missingVerificationEvidenceThreads, 1);
  assert.equal(diagnostics?.autoRepairSuppressedReason, "repeat_stop_exhausted");
});

test("buildStaleReviewBotRemediation fails closed when covered evidence lacks current-head Codex no-major signal", () => {
  const issueNumber = 110;
  const prNumber = 115;
  const headSha = "c184c41883b831ab6b85bf3467a66a5c01fd49fa";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-mutation-lock-stale-recovery",
    commentId: "comment-mutation-lock-stale-recovery",
    path: "src/mutation-lock.ts",
    line: 42,
    commentBody: "P1: Verify stale mutation lock recovery only releases the acquired lock instance.",
    discussionUrl: "https://example.test/pr/115#discussion_r115",
    verifiedRepair: {
      summary: "Focused mutation lock verifier passed on the current head.",
      ranAt: "2026-05-21T11:10:00Z",
      command: "npm test -- src/supervisor/stale-review-bot-remediation.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const config = createConfig({ reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN] });
  const record = createRecord(scenario.recordPatch);
  const pr = createPullRequest(scenario.pullRequestPatch);

  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
  });

  assert.equal(remediation?.classification, "unknown_needs_operator");
  assert.equal(remediation?.codexCurrentHeadReviewState, "missing");
  assert.equal(remediation?.missingProbeReason, "current_head_codex_no_major_signal_missing");
});

test("buildStaleReviewBotRemediation verifies concrete P2 path-list repair without no-major signal", () => {
  const issueNumber = 2258;
  const prNumber = 3258;
  const headSha = "a74dcf7f47e4282b0f944ab0f1a43b53fa9c87de";
  const policyPath = "src/mvp-a-onboarding-traceability.ts";
  const documentPath = "docs/mvp-a/policy/onboarding-traceability.md";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-hrcore-path-list-residue",
    commentId: "comment-hrcore-path-list-residue",
    path: policyPath,
    line: 42,
    severity: "P2",
    commentBody:
      `P2: Add \`${documentPath}\` to both the loader path list and the policy scan path list.`,
    discussionUrl: "https://example.test/pr/3258#discussion_r2258",
    verifiedRepair: {
      summary: "Focused traceability verifier passed after the repair commit.",
      ranAt: "2026-06-05T21:10:00Z",
      command: "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    repair_attempt_count: 1,
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    currentHeadCiGreenAt: "2026-06-05T21:12:00Z",
    configuredBotCurrentHeadStatusState: null,
    configuredBotTopLevelReviewStrength: "blocking",
  });

  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
    repositoryFileContents: {
      [policyPath]: [
        "const LOADER_PATHS = [",
        `  "${documentPath}",`,
        "];",
        "const POLICY_SCAN_PATHS = [",
        `  "${documentPath}",`,
        "];",
      ].join("\n"),
    },
  });
  const diagnostics = buildStaleReviewBotThreadDiagnostics({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
    remediation,
  });

  assert.equal(remediation?.classification, "verified_current_head_repair_pending_thread_resolution");
  assert.equal(remediation?.codexCurrentHeadReviewState, "missing");
  assert.equal(remediation?.missingProbeReason, null);
  assert.match(
    remediation?.verificationEvidenceSummary ?? "",
    /deterministic_repair_probe:path_present_in_reviewed_file:docs\/mvp-a\/policy\/onboarding-traceability\.md:2/,
  );
  assert.equal(diagnostics?.verifiedStaleResidueThreads, 1);
  assert.equal(diagnostics?.repeatStopExhausted, "no");
  assert.equal(diagnostics?.autoRepairSuppressedReason, "none");
});

test("buildStaleReviewBotRemediation probes the Codex finding when a supervisor reply is newest", () => {
  const issueNumber = 2258;
  const prNumber = 3258;
  const headSha = "c6437ebc0252efc8d09a28e20d8339f5957afd98";
  const policyPath = "src/mvp-a-onboarding-traceability.ts";
  const documentPath = "docs/mvp-a/policy/onboarding-traceability.md";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-hrcore-path-list-reply-residue",
    commentId: "comment-hrcore-path-list-reply-residue",
    path: policyPath,
    line: 42,
    severity: "P2",
    commentBody: `P2: Add \`${documentPath}\` to both the loader path list and the policy scan path list.`,
    discussionUrl: "https://example.test/pr/3258#discussion_r2258_reply",
    verifiedRepair: {
      summary: "Focused traceability verifier passed after the repair commit.",
      ranAt: "2026-06-05T21:10:00Z",
      command: "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    repair_attempt_count: 1,
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
    processed_review_thread_fingerprints: [`${scenario.reviewThread.id}@${headSha}#comment-supervisor-reply`],
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    currentHeadCiGreenAt: "2026-06-05T21:12:00Z",
    configuredBotCurrentHeadStatusState: null,
    configuredBotTopLevelReviewStrength: "blocking",
  });
  const reviewThread = {
    ...scenario.reviewThread,
    comments: {
      nodes: [
        ...scenario.reviewThread.comments.nodes,
        {
          id: "comment-supervisor-reply",
          body: "Supervisor reply: verified the repair and attempting thread resolution.",
          createdAt: "2026-06-05T21:12:30Z",
          url: "https://example.test/pr/3258#discussion_r2258_reply_followup",
          author: {
            login: "github-actions[bot]",
            typeName: "Bot",
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
    reviewThreads: [reviewThread],
    repositoryFileContents: {
      [policyPath]: [
        "const LOADER_PATHS = [",
        `  "${documentPath}",`,
        "];",
        "const POLICY_SCAN_PATHS = [",
        `  "${documentPath}",`,
        "];",
      ].join("\n"),
    },
  });

  assert.equal(remediation?.classification, "verified_current_head_repair_pending_thread_resolution");
  assert.equal(remediation?.missingProbeReason, null);
  assert.match(
    remediation?.verificationEvidenceSummary ?? "",
    /deterministic_repair_probe:path_present_in_reviewed_file:docs\/mvp-a\/policy\/onboarding-traceability\.md:2/,
  );
});

test("buildStaleReviewBotRemediation rejects non-additive path-list findings", () => {
  const issueNumber = 2258;
  const prNumber = 3258;
  const headSha = "42b76077b9db2fcac4b9d1c7c05c5d03a1f0f12a";
  const policyPath = "src/mvp-a-onboarding-traceability.ts";
  const documentPath = "docs/mvp-a/policy/onboarding-traceability.md";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-hrcore-path-list-deduplicate-residue",
    commentId: "comment-hrcore-path-list-deduplicate-residue",
    path: policyPath,
    line: 42,
    severity: "P2",
    commentBody: `P2: Deduplicate \`${documentPath}\` from the loader path list.`,
    discussionUrl: "https://example.test/pr/3258#discussion_r2258_deduplicate",
    verifiedRepair: {
      summary: "Focused traceability verifier passed after the repair commit.",
      ranAt: "2026-06-05T21:10:00Z",
      command: "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    repair_attempt_count: 1,
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    currentHeadCiGreenAt: "2026-06-05T21:12:00Z",
    configuredBotCurrentHeadStatusState: null,
    configuredBotTopLevelReviewStrength: "blocking",
  });

  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
    repositoryFileContents: {
      [policyPath]: [
        "const LOADER_PATHS = [",
        `  "${documentPath}",`,
        `  "${documentPath}",`,
        "];",
      ].join("\n"),
    },
  });

  assert.equal(remediation?.classification, "unknown_needs_operator");
  assert.equal(remediation?.missingProbeReason, "current_head_codex_no_major_signal_missing");
  assert.doesNotMatch(remediation?.verificationEvidenceSummary ?? "", /deterministic_repair_probe/);
});

test("buildStaleReviewBotRemediation does not truncate longer path extensions during repair probes", () => {
  const issueNumber = 2258;
  const prNumber = 3258;
  const headSha = "ac62cb8f11f71737ccd02f93f9c81c917797d6b3";
  const policyPath = "src/mvp-a-onboarding-traceability.ts";
  const componentPath = "src/view.tsx";
  const documentPath = "docs/page.mdx";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-hrcore-long-extension-residue",
    commentId: "comment-hrcore-long-extension-residue",
    path: policyPath,
    line: 42,
    severity: "P2",
    commentBody: `P2: Add \`${componentPath}\` and \`${documentPath}\` to the policy scan path list.`,
    discussionUrl: "https://example.test/pr/3258#discussion_r2258_extensions",
    verifiedRepair: {
      summary: "Focused traceability verifier passed after the repair commit.",
      ranAt: "2026-06-05T21:10:00Z",
      command: "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    repair_attempt_count: 1,
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    currentHeadCiGreenAt: "2026-06-05T21:12:00Z",
    configuredBotCurrentHeadStatusState: null,
    configuredBotTopLevelReviewStrength: "blocking",
  });

  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
    repositoryFileContents: {
      [policyPath]: [
        "const POLICY_SCAN_PATHS = [",
        "  \"src/view.ts\",",
        "  \"src/view.ts\",",
        "  \"docs/page.md\",",
        "  \"docs/page.md\",",
        "];",
      ].join("\n"),
    },
  });

  assert.equal(remediation?.classification, "unknown_needs_operator");
  assert.equal(remediation?.missingProbeReason, "current_head_codex_no_major_signal_missing");
  assert.doesNotMatch(remediation?.verificationEvidenceSummary ?? "", /deterministic_repair_probe/);
});

test("buildStaleReviewBotRemediation requires exact path token matches during repair probes", () => {
  const issueNumber = 2258;
  const prNumber = 3258;
  const headSha = "3d3b78d7ddc0ee8a31382bd131998c13226b5d63";
  const policyPath = "src/mvp-a-onboarding-traceability.ts";
  const requestedDocumentPath = "docs/page.md";
  const siblingDocumentPath = "docs/page.mdx";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-hrcore-exact-path-residue",
    commentId: "comment-hrcore-exact-path-residue",
    path: policyPath,
    line: 42,
    severity: "P2",
    commentBody: `P2: Add \`${requestedDocumentPath}\` to the policy scan path list.`,
    discussionUrl: "https://example.test/pr/3258#discussion_r2258_exact",
    verifiedRepair: {
      summary: "Focused traceability verifier passed after the repair commit.",
      ranAt: "2026-06-05T21:10:00Z",
      command: "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    repair_attempt_count: 1,
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    currentHeadCiGreenAt: "2026-06-05T21:12:00Z",
    configuredBotCurrentHeadStatusState: null,
    configuredBotTopLevelReviewStrength: "blocking",
  });

  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
    repositoryFileContents: {
      [policyPath]: [
        "const POLICY_SCAN_PATHS = [",
        `  "${siblingDocumentPath}",`,
        `  "${siblingDocumentPath}",`,
        "];",
      ].join("\n"),
    },
  });

  assert.equal(remediation?.classification, "unknown_needs_operator");
  assert.equal(remediation?.missingProbeReason, "current_head_codex_no_major_signal_missing");
  assert.doesNotMatch(remediation?.verificationEvidenceSummary ?? "", /deterministic_repair_probe/);
});

test("buildStaleReviewBotRemediation requires every requested path before proving repair residue", () => {
  const issueNumber = 2258;
  const prNumber = 3258;
  const headSha = "93cd2756e7a4721e3c6e1fc0f9fe3259b6f7e8f0";
  const policyPath = "src/mvp-a-onboarding-traceability.ts";
  const componentPath = "src/view.tsx";
  const documentPath = "docs/page.mdx";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-hrcore-every-path-residue",
    commentId: "comment-hrcore-every-path-residue",
    path: policyPath,
    line: 42,
    severity: "P2",
    commentBody: `P2: Add \`${componentPath}\` and \`${documentPath}\` to the policy scan path list.`,
    discussionUrl: "https://example.test/pr/3258#discussion_r2258_every",
    verifiedRepair: {
      summary: "Focused traceability verifier passed after the repair commit.",
      ranAt: "2026-06-05T21:10:00Z",
      command: "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
  });
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    verifiedCurrentHeadRepairReviewThreadAutoResolve: true,
  });
  const record = createRecord({
    ...scenario.recordPatch,
    repair_attempt_count: 1,
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
  });
  const pr = createPullRequest({
    ...scenario.pullRequestPatch,
    currentHeadCiGreenAt: "2026-06-05T21:12:00Z",
    configuredBotCurrentHeadStatusState: null,
    configuredBotTopLevelReviewStrength: "blocking",
  });

  const missingDocumentRemediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
    repositoryFileContents: {
      [policyPath]: [
        "const POLICY_SCAN_PATHS = [",
        `  "${componentPath}",`,
        `  "${componentPath}",`,
        "];",
      ].join("\n"),
    },
  });
  const completeRemediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
    repositoryFileContents: {
      [policyPath]: [
        "const LOADER_PATHS = [",
        `  "${componentPath}",`,
        `  "${documentPath}",`,
        "];",
        "const POLICY_SCAN_PATHS = [",
        `  "${componentPath}",`,
        `  "${documentPath}",`,
        "];",
      ].join("\n"),
    },
  });

  assert.equal(missingDocumentRemediation?.classification, "unknown_needs_operator");
  assert.equal(missingDocumentRemediation?.missingProbeReason, "current_head_codex_no_major_signal_missing");
  assert.doesNotMatch(missingDocumentRemediation?.verificationEvidenceSummary ?? "", /deterministic_repair_probe/);
  assert.equal(completeRemediation?.classification, "verified_current_head_repair_pending_thread_resolution");
  assert.match(
    completeRemediation?.verificationEvidenceSummary ?? "",
    /deterministic_repair_probe:path_present_in_reviewed_file:src\/view\.tsx:2/,
  );
  assert.match(
    completeRemediation?.verificationEvidenceSummary ?? "",
    /deterministic_repair_probe:path_present_in_reviewed_file:docs\/page\.mdx:2/,
  );
});

test("buildStaleReviewBotRemediation fails closed when current-head no-major has unprocessed must-fix threads", () => {
  const issueNumber = 110;
  const prNumber = 115;
  const headSha = "c184c41883b831ab6b85bf3467a66a5c01fd49fa";
  const scenario = createCodexConnectorTrackedReviewResidueScenario({
    issueNumber,
    prNumber,
    headSha,
    threadId: "thread-mutation-lock-stale-recovery",
    commentId: "comment-mutation-lock-stale-recovery",
    path: "src/mutation-lock.ts",
    line: 42,
    commentBody: "P1: Verify stale mutation lock recovery only releases the acquired lock instance.",
    discussionUrl: "https://example.test/pr/115#discussion_r115",
    verifiedRepair: {
      summary: "Focused mutation lock verifier passed on the current head.",
      ranAt: "2026-05-21T11:10:00Z",
      command: "npm test -- src/supervisor/stale-review-bot-remediation.test.ts",
      evidenceSource: "codex_turn_timeline_artifact",
    },
    currentHeadNoMajorReview: {
      requestedAt: "2026-05-21T11:05:00Z",
      observedAt: "2026-05-21T11:09:00Z",
    },
  });
  const config = createConfig({ reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN] });
  const record = createRecord({
    ...scenario.recordPatch,
    processed_review_thread_ids: [],
    processed_review_thread_fingerprints: [],
  });
  const pr = createPullRequest(scenario.pullRequestPatch);

  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: scenario.passingChecks,
    reviewThreads: [scenario.reviewThread],
  });

  assert.equal(remediation?.classification, "unresolved_work");
  assert.equal(remediation?.codexCurrentHeadReviewState, "observed");
  assert.equal(remediation?.missingProbeReason, null);
});

test("buildStaleReviewBotRemediation ignores unprocessed outdated Codex threads when probing missing verification", () => {
  const issueNumber = 1701;
  const prNumber = 1801;
  const headSha = "12b099926c39c8b7502176339ea34750e6a807a4";
  const currentThreadIds = [
    "PRRT_current_head_residue_one",
    "PRRT_current_head_residue_two",
    "PRRT_current_head_residue_three",
  ];
  const outdatedThreadIds = [
    "PRRT_kwDOSfC_1M6EPhQ2",
    "PRRT_kwDOSfC_1M6EPhQ3",
    "PRRT_kwDOSfC_1M6EPhQ5",
  ];
  const currentThreads = currentThreadIds.map((threadId, index) =>
    createReviewThread({
      id: threadId,
      isOutdated: false,
      path: "src/review-policy.ts",
      line: 40 + index,
      comments: {
        nodes: [
          {
            id: `comment-${threadId}`,
            body: "P1: current-head Codex residue already processed by the supervisor.",
            createdAt: "2026-05-22T10:00:00Z",
            url: `https://example.test/pr/${prNumber}#discussion_${threadId}`,
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  );
  const outdatedThreads = outdatedThreadIds.map((threadId, index) =>
    createReviewThread({
      id: threadId,
      isOutdated: true,
      path: "src/review-policy.ts",
      line: 80 + index,
      comments: {
        nodes: [
          {
            id: `comment-${threadId}`,
            body: "P1: earlier-head Codex residue that remains unresolved on GitHub.",
            createdAt: "2026-05-21T10:00:00Z",
            url: `https://example.test/pr/${prNumber}#discussion_${threadId}`,
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    }),
  );
  const config = createConfig({ reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN] });
  const record = createRecord({
    issue_number: issueNumber,
    state: "blocked",
    pr_number: prNumber,
    last_head_sha: headSha,
    blocked_reason: "stale_review_bot",
    processed_review_thread_ids: currentThreads.map((thread) => `${thread.id}@${headSha}`),
    processed_review_thread_fingerprints: currentThreads.map((thread) => `${thread.id}@${headSha}#comment-${thread.id}`),
    last_failure_context: {
      category: "manual",
      summary: "Current-head Codex residue has no verification artifact.",
      signature: currentThreads.map((thread) => `stalled-bot:${thread.id}`).join("|"),
      command: null,
      details: currentThreads.map(
        (thread) =>
          `reviewer=${CODEX_CONNECTOR_REVIEW_BOT_LOGIN} file=${thread.path} line=${thread.line} p_severity=P1 processed_on_current_head=yes`,
      ),
      url: `https://example.test/pr/${prNumber}#discussion_current_head_residue`,
      updated_at: "2026-05-22T10:20:00Z",
    },
    codex_connector_review_requested_observed_at: "2026-05-22T10:05:00Z",
    codex_connector_review_requested_head_sha: headSha,
  });
  const pr = createPullRequest({
    number: prNumber,
    headRefOid: headSha,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    currentHeadCiGreenAt: "2026-05-22T10:25:00Z",
    codexConnectorReviewRequestedAt: "2026-05-22T10:05:00Z",
    codexConnectorReviewRequestedHeadSha: headSha,
    configuredBotCurrentHeadObservedAt: "2026-05-22T10:15:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
    configuredBotLatestReviewedCommitSha: headSha,
  });

  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: [{ name: "build", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [...currentThreads, ...outdatedThreads],
  });

  assert.equal(remediation?.classification, "unknown_needs_operator");
  assert.equal(remediation?.codexCurrentHeadReviewState, "observed");
  assert.equal(remediation?.missingProbeReason, "current_head_verification_evidence_missing");
});

test("buildStaleReviewBotThreadDiagnostics does not report repeat-stop suppression when Codex current-head request is pending", () => {
  const issueNumber = 168;
  const prNumber = 176;
  const headSha = "f3addc310b0ff8e4fc53d9f3e0ab783af70a552f";
  const staleReviewedSha = "d0800e414f305e8ce4f4f9785fc4ee6ad2ba0c90";
  const reviewThreads = ["thread-date-fields", "thread-correlation-id", "thread-email-expectation", "thread-onboarding-strings"].map(
    (threadId, index) =>
      createReviewThread({
        id: threadId,
        isOutdated: true,
        path: "openapi/hrcore.openapi.json",
        line: 40 + index,
        comments: {
          nodes: [
            {
              id: `comment-${threadId}`,
              body: "P2: stale metadata-only schema finding.",
              createdAt: "2026-05-21T20:00:00Z",
              url: `https://example.test/pr/${prNumber}#discussion_${threadId}`,
              author: {
                login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
                typeName: "Bot",
              },
            },
          ],
        },
      }),
  );
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    configuredBotCurrentHeadSignalTimeoutAction: "request_review_comment",
  });
  const record = createRecord({
    issue_number: issueNumber,
    state: "blocked",
    pr_number: prNumber,
    last_head_sha: headSha,
    blocked_reason: "stale_review_bot",
    copilot_review_timed_out_at: "2026-05-21T20:42:06Z",
    copilot_review_timeout_action: "request_review_comment",
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
    processed_review_thread_ids: reviewThreads.map((thread) => `${thread.id}@${headSha}`),
    processed_review_thread_fingerprints: reviewThreads.map(
      (thread) => `${thread.id}@${headSha}#comment-${thread.id}`,
    ),
    last_failure_context: {
      category: "manual",
      summary: "Outdated configured-bot metadata-only residue is blocking the tracked PR.",
      signature: reviewThreads.map((thread) => `stalled-bot:${thread.id}`).join("|"),
      command: null,
      details: reviewThreads.map(
        (thread) =>
          `reviewer=${CODEX_CONNECTOR_REVIEW_BOT_LOGIN} file=${thread.path} line=${thread.line} processed_on_current_head=yes`,
      ),
      url: "https://example.test/pr/176#discussion_rmetadata",
      updated_at: "2026-05-21T20:42:06Z",
    },
  });
  const pr = createPullRequest({
    number: prNumber,
    headRefOid: headSha,
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
    currentHeadCiGreenAt: "2026-05-21T20:32:06Z",
    configuredBotLatestReviewedCommitSha: staleReviewedSha,
    configuredBotCurrentHeadObservedAt: null,
    configuredBotCurrentHeadObservationSource: null,
    configuredBotCurrentHeadStatusState: null,
    configuredBotTopLevelReviewStrength: null,
    codexConnectorReviewRequestedAt: null,
    codexConnectorReviewRequestedHeadSha: null,
  });

  const remediation = buildStaleReviewBotRemediation({
    config,
    record,
    pr,
    checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads,
  });
  const diagnostics = buildStaleReviewBotThreadDiagnostics({
    config,
    record,
    pr,
    checks: [{ name: "verify-pre-pr", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads,
    remediation,
  });

  assert.equal(remediation?.classification, "metadata_only_missing_current_head_review");
  assert.equal(remediation?.codexCurrentHeadReviewState, "missing");
  assert.equal(diagnostics?.unresolvedCurrentThreads, 0);
  assert.equal(diagnostics?.repeatStopExhausted, "no");
  assert.equal(diagnostics?.autoRepairSuppressedReason, "not_verified_stale_residue");
});
