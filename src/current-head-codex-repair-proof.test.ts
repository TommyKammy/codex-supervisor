import assert from "node:assert/strict";
import test from "node:test";
import { CODEX_CONNECTOR_REVIEW_BOT_LOGIN } from "./codex-connector-tracked-pr-test-helpers";
import {
  currentHeadCodexRepairProofRejectionReasons,
  projectCurrentHeadCodexRepairProof,
  VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET,
} from "./current-head-codex-repair-proof";
import {
  createConfig,
  createPullRequest,
  createRecord,
  createReviewThread,
} from "./pull-request-state-test-helpers";

function codexThread(args: {
  id: string;
  commentId: string;
  severity?: "P1" | "P2";
  line: number;
}) {
  return createReviewThread({
    id: args.id,
    path: "scripts/evaluate_dataset.py",
    line: args.line,
    comments: {
      nodes: [
        {
          id: args.commentId,
          body: `${args.severity ?? "P1"}: Verify this current-head residue is covered.`,
          createdAt: "2026-06-26T06:20:00Z",
          url: `https://example.test/pr/72#discussion_${args.id}`,
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });
}

test("projectCurrentHeadCodexRepairProof accepts structured P1 residue proof with exact current-head local CI", () => {
  const headSha = "f9e584d660a4ae175a9b72980e2dcc83d9d86413";
  const threads = [
    codexThread({ id: "thread-p1-a", commentId: "comment-p1-a", line: 1293 }),
    codexThread({ id: "thread-p1-b", commentId: "comment-p1-b", line: 1318 }),
  ];
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    localCiCommand: "python3 scripts/ci/repo_hygiene.py",
  });
  const record = createRecord({
    last_head_sha: headSha,
    blocked_reason: "manual_review",
    codex_connector_review_requested_observed_at: "2026-06-26T06:10:00Z",
    codex_connector_review_requested_head_sha: headSha,
    processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
    processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Configured local CI passed on current head.",
      ran_at: "2026-06-26T06:35:00Z",
      head_sha: headSha,
      execution_mode: "shell",
      command: "python3 scripts/ci/repo_hygiene.py",
      failure_class: null,
      remediation_target: null,
    },
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm run build",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Earlier generic build passed before the focused current-head probe.",
        recorded_at: "2026-07-01T06:51:00Z",
      },
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "python3 scripts/ci/repo_hygiene.py",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Current head rejects the active Connector residue cases.",
        recorded_at: "2026-06-26T06:36:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
        processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
      },
    ],
  });
  const pr = createPullRequest({
    headRefOid: headSha,
    configuredBotCurrentHeadObservedAt: "2026-06-26T06:30:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    codexConnectorReviewRequestedAt: "2026-06-26T06:10:00Z",
    codexConnectorReviewRequestedHeadSha: headSha,
  });

  const proof = projectCurrentHeadCodexRepairProof({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: threads,
  });

  assert.equal(proof?.source, "structured_artifact");
  assert.equal(proof?.localVerificationEvidenceSource, "latest_local_ci_result");
  assert.equal(proof?.currentConfiguredThreadCount, 2);
});

test("projectCurrentHeadCodexRepairProof accepts thread-scoped proof after reviewed-current-head no-major without request marker", () => {
  const headSha = "647c90b90b820cb17b83d2d80b5dddd3e789028b";
  const threads = [
    codexThread({ id: "thread-no-major-a", commentId: "comment-no-major-a", severity: "P2", line: 432 }),
    codexThread({ id: "thread-no-major-b", commentId: "comment-no-major-b", severity: "P2", line: 757 }),
  ];
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    localCiCommand: "python3 scripts/ci/repo_hygiene.py",
  });
  const record = createRecord({
    last_head_sha: headSha,
    blocked_reason: "manual_review",
    processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
    processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Repo hygiene passed on current head.",
      ran_at: "2026-06-27T00:50:00Z",
      head_sha: headSha,
      execution_mode: "shell",
      command: "python3 scripts/ci/repo_hygiene.py",
      failure_class: null,
      remediation_target: null,
    },
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "python3 scripts/ci/repo_hygiene.py",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Rechecked unresolved review cluster; no source changes needed.",
        recorded_at: "2026-06-27T00:50:21Z",
        processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
        processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
      },
    ],
  });
  const pr = createPullRequest({
    headRefOid: headSha,
    configuredBotCurrentHeadObservedAt: "2026-06-27T00:54:12Z",
    configuredBotCurrentHeadObservationSource: "status_context",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: "647c90b90b",
    configuredBotCurrentHeadCodexSuccessObservedAt: "2026-06-27T00:53:12Z",
  });

  const proof = projectCurrentHeadCodexRepairProof({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: threads,
  });

  assert.equal(proof?.source, "thread_scoped_verification_artifact");
  assert.equal(proof?.localVerificationEvidenceSource, "latest_local_ci_result");
  assert.match(proof?.summary ?? "", /codex_no_major_support=codex_pr_success_comment_reviewed_current_head/);
  assert.deepEqual(currentHeadCodexRepairProofRejectionReasons({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: threads,
  }), []);
});

test("projectCurrentHeadCodexRepairProof accepts record-scoped processed evidence with current-head clean comment", () => {
  const headSha = "74d44b0a48f7b65fbcc9361a6509727c3ba987dc";
  const threads = [
    codexThread({ id: "thread-current-clean-a", commentId: "comment-current-clean-a", severity: "P1", line: 494 }),
    codexThread({ id: "thread-current-clean-b", commentId: "comment-current-clean-b", severity: "P2", line: 826 }),
  ];
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    localCiCommand: "python3 -m pytest tests/test_desktop_api_auth.py tests/test_poc_web_api.py -q",
  });
  const record = createRecord({
    last_head_sha: headSha,
    blocked_reason: "manual_review",
    codex_connector_review_requested_observed_at: "2026-07-01T06:41:26Z",
    codex_connector_review_requested_head_sha: headSha,
    processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
    processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "python3 -m pytest tests/test_desktop_api_auth.py tests/test_poc_web_api.py -q",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Focused current-head probe covered the stale Connector findings.",
        recorded_at: "2026-07-01T06:52:31Z",
      },
    ],
  });
  const pr = createPullRequest({
    headRefOid: headSha,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    reviewDecision: null,
    currentHeadCiGreenAt: "2026-07-01T06:52:00Z",
    configuredBotCurrentHeadObservedAt: "2026-07-01T06:50:19Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: "74d44b0a48",
    configuredBotCurrentHeadCodexSuccessObservedAt: "2026-07-01T06:50:19Z",
  });

  const proof = projectCurrentHeadCodexRepairProof({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: threads,
    allowRecordProcessedThreadEvidence: true,
  });

  assert.equal(proof?.source, "record_processed_thread_evidence");
  assert.equal(proof?.localVerificationEvidenceSource, "scoped_repair_timeline_artifact_with_non_review_checks");
  assert.equal(proof?.processedThreadEvidenceCount, 4);
  assert.match(proof?.summary ?? "", /codex_no_major_support=codex_pr_success_comment_reviewed_current_head/);
});

test("projectCurrentHeadCodexRepairProof keeps processed Codex evidence after trusted supervisor stale reply", () => {
  const headSha = "7cbf3d07397c51cb7a4de4ff47875154cce6f6c6";
  const thread = codexThread({
    id: "PRRT_current_clean_supervisor_reply",
    commentId: "comment-codex-before-clean",
    severity: "P2",
    line: 810,
  });
  thread.comments.nodes[0]!.createdAt = "2026-07-06T01:36:26Z";
  thread.comments.nodes.push({
    id: "comment-supervisor-stale-reply",
    body: [
      `The supervisor reprocessed this configured-bot finding on the current head \`${headSha}\` and classified it as stale.`,
      `Audit: issue=#216 pr=#220 head=${headSha} thread=${thread.id} reason=stale_review_bot.`,
      "Evidence: location=scripts/evaluate_dataset.py:810 processed_on_current_head=yes.",
      "Under the configured `reply_and_resolve` policy, the supervisor is auto-resolving this stale thread now.",
    ].join("\n\n"),
    createdAt: "2026-07-06T02:17:27Z",
    url: "https://example.test/pr/220#discussion_r3526118509",
    author: {
      login: "TommyKammy",
      typeName: "User",
    },
  });
  const config = createConfig({
    repoSlug: "TommyKammy/VeriDoc",
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    localCiCommand: "python3 -m unittest tests.test_evaluate_dataset",
  });
  const record = createRecord({
    last_head_sha: headSha,
    blocked_reason: "manual_review",
    codex_connector_review_requested_observed_at: "2026-07-06T02:09:23Z",
    codex_connector_review_requested_head_sha: headSha,
    processed_review_thread_ids: [`${thread.id}@${headSha}`],
    processed_review_thread_fingerprints: [`${thread.id}@${headSha}#comment-codex-before-clean`],
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "python3 -m unittest tests.test_evaluate_dataset",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Reverified unresolved Connector review cluster as covered by existing P9 harness guards/tests.",
        recorded_at: "2026-07-06T02:16:30Z",
      },
    ],
  });
  const pr = createPullRequest({
    headRefOid: headSha,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    reviewDecision: null,
    currentHeadCiGreenAt: "2026-07-06T01:59:38Z",
    configuredBotCurrentHeadObservedAt: "2026-07-06T02:15:17Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: "7cbf3d0739",
    configuredBotCurrentHeadCodexSuccessObservedAt: "2026-07-06T02:15:17Z",
    codexConnectorReviewRequestedAt: "2026-07-06T02:09:23Z",
    codexConnectorReviewRequestedHeadSha: headSha,
  });

  const proof = projectCurrentHeadCodexRepairProof({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [thread],
    allowRecordProcessedThreadEvidence: true,
  });

  assert.equal(proof?.source, "record_processed_thread_evidence");
});

test("projectCurrentHeadCodexRepairProof rejects record-scoped proof before latest thread comments", () => {
  const headSha = "74d44b0a48f7b65fbcc9361a6509727c3ba987dc";
  const threads = [
    codexThread({ id: "thread-old-proof-a", commentId: "comment-old-proof-a", severity: "P2", line: 494 }),
  ];
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
  });
  const record = createRecord({
    last_head_sha: headSha,
    blocked_reason: "manual_review",
    processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
    processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm run build",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "This pass predates the latest Connector finding.",
        recorded_at: "2026-06-26T06:19:00Z",
      },
    ],
  });
  const pr = createPullRequest({
    headRefOid: headSha,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    reviewDecision: null,
    configuredBotCurrentHeadObservedAt: "2026-07-01T06:50:19Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: "74d44b0a48",
    configuredBotCurrentHeadCodexSuccessObservedAt: "2026-07-01T06:50:19Z",
  });

  const proof = projectCurrentHeadCodexRepairProof({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: threads,
    allowRecordProcessedThreadEvidence: true,
  });

  assert.equal(proof, null);
});

test("projectCurrentHeadCodexRepairProof requires record evidence for outdated P1 coverage threads", () => {
  const headSha = "74d44b0a48f7b65fbcc9361a6509727c3ba987dc";
  const currentThread = codexThread({
    id: "thread-current-p2",
    commentId: "comment-current-p2",
    severity: "P2",
    line: 494,
  });
  const outdatedP1Thread = {
    ...codexThread({
      id: "thread-outdated-p1",
      commentId: "comment-outdated-p1",
      severity: "P1",
      line: 826,
    }),
    isOutdated: true,
  };
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
  });
  const record = createRecord({
    last_head_sha: headSha,
    blocked_reason: "manual_review",
    processed_review_thread_ids: [`${currentThread.id}@${headSha}`],
    processed_review_thread_fingerprints: [
      `${currentThread.id}@${headSha}#${currentThread.comments.nodes[0]!.id}`,
    ],
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm run build",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Focused current-head probe covered only the current thread.",
        recorded_at: "2026-07-01T06:52:31Z",
      },
    ],
  });
  const pr = createPullRequest({
    headRefOid: headSha,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    reviewDecision: null,
    configuredBotCurrentHeadObservedAt: "2026-07-01T06:50:19Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: "74d44b0a48",
    configuredBotCurrentHeadCodexSuccessObservedAt: "2026-07-01T06:50:19Z",
  });

  assert.equal(projectCurrentHeadCodexRepairProof({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [currentThread, outdatedP1Thread],
    allowRecordProcessedThreadEvidence: true,
  }), null);
});

test("projectCurrentHeadCodexRepairProof rejects no-source artifacts for record-scoped repair proof", () => {
  const headSha = "74d44b0a48f7b65fbcc9361a6509727c3ba987dc";
  const threads = [
    codexThread({ id: "thread-no-source-proof", commentId: "comment-no-source-proof", severity: "P2", line: 494 }),
  ];
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
  });
  const record = createRecord({
    last_head_sha: headSha,
    blocked_reason: "manual_review",
    processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
    processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npm run build",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "No-source revalidation belongs to the no-source auto-resolve path.",
        recorded_at: "2026-07-01T06:52:31Z",
        repair_targets: ["verified_no_source_change_review_thread_residue"],
      },
    ],
  });
  const pr = createPullRequest({
    headRefOid: headSha,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    reviewDecision: null,
    configuredBotCurrentHeadObservedAt: "2026-07-01T06:50:19Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: "74d44b0a48",
    configuredBotCurrentHeadCodexSuccessObservedAt: "2026-07-01T06:50:19Z",
  });

  assert.equal(projectCurrentHeadCodexRepairProof({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: threads,
    allowRecordProcessedThreadEvidence: true,
  }), null);
});

test("projectCurrentHeadCodexRepairProof rejects summary-only verification evidence", () => {
  const headSha = "7f2ebe6039905200cf06756e8e4b55185439f52f";
  const threads = [
    codexThread({ id: "thread-summary-only-a", commentId: "comment-summary-only-a", severity: "P2", line: 148 }),
    codexThread({ id: "thread-summary-only-b", commentId: "comment-summary-only-b", severity: "P2", line: 320 }),
  ];
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    localCiCommand: "python3 scripts/ci/repo_hygiene.py",
  });
  const record = createRecord({
    last_head_sha: headSha,
    blocked_reason: "manual_review",
    last_codex_summary: [
      "Verified live PR state on the current head and no product-code change was needed.",
      "Tests: rtk python3 -m unittest discover; rtk python3 scripts/ci/repo_hygiene.py; rtk git diff --check",
    ].join("\n"),
    processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
    processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
    latest_local_ci_result: null,
    timeline_artifacts: [],
  });
  const pr = createPullRequest({
    headRefOid: headSha,
    configuredBotCurrentHeadObservedAt: "2026-06-27T14:28:46Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: "7f2ebe6039",
    configuredBotCurrentHeadCodexSuccessObservedAt: "2026-06-27T14:28:46Z",
  });

  assert.equal(projectCurrentHeadCodexRepairProof({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: threads,
  }), null);
  assert.deepEqual(currentHeadCodexRepairProofRejectionReasons({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: threads,
  }), [
    "current_head_repair_proof_structured_artifact_missing",
    "current_head_repair_proof_latest_local_ci_result_missing",
  ]);
});

test("projectCurrentHeadCodexRepairProof rejects thread-scoped no-major proof for an older reviewed commit", () => {
  const headSha = "647c90b90b820cb17b83d2d80b5dddd3e789028b";
  const threads = [
    codexThread({ id: "thread-old-no-major", commentId: "comment-old-no-major", severity: "P2", line: 432 }),
  ];
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    localCiCommand: "python3 scripts/ci/repo_hygiene.py",
  });
  const record = createRecord({
    last_head_sha: headSha,
    blocked_reason: "manual_review",
    processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
    processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Repo hygiene passed on current head.",
      ran_at: "2026-06-27T00:50:00Z",
      head_sha: headSha,
      execution_mode: "shell",
      command: "python3 scripts/ci/repo_hygiene.py",
      failure_class: null,
      remediation_target: null,
    },
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "python3 scripts/ci/repo_hygiene.py",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Rechecked unresolved review cluster; no source changes needed.",
        recorded_at: "2026-06-27T00:50:21Z",
        processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
        processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
      },
    ],
  });
  const pr = createPullRequest({
    headRefOid: headSha,
    configuredBotCurrentHeadObservedAt: "2026-06-27T00:53:12Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: "dbe5e968ce",
    configuredBotCurrentHeadCodexSuccessObservedAt: "2026-06-27T00:53:12Z",
  });

  assert.equal(projectCurrentHeadCodexRepairProof({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: threads,
  }), null);
  assert.deepEqual(currentHeadCodexRepairProofRejectionReasons({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: threads,
  }), ["current_head_repair_proof_repair_target_missing"]);
});

test("projectCurrentHeadCodexRepairProof rejects reviewed-current-head no-major before a later blocker", () => {
  const headSha = "647c90b90b820cb17b83d2d80b5dddd3e789028b";
  const threads = [
    codexThread({ id: "thread-after-no-major", commentId: "comment-after-no-major", severity: "P2", line: 432 }),
  ];
  threads[0]!.comments.nodes[0]!.createdAt = "2026-06-27T00:54:12Z";
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    localCiCommand: "python3 scripts/ci/repo_hygiene.py",
  });
  const record = createRecord({
    last_head_sha: headSha,
    blocked_reason: "manual_review",
    processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
    processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Repo hygiene passed on current head.",
      ran_at: "2026-06-27T00:55:00Z",
      head_sha: headSha,
      execution_mode: "shell",
      command: "python3 scripts/ci/repo_hygiene.py",
      failure_class: null,
      remediation_target: null,
    },
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "python3 scripts/ci/repo_hygiene.py",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Rechecked unresolved review cluster; no source changes needed.",
        recorded_at: "2026-06-27T00:55:21Z",
        processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
        processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
      },
    ],
  });
  const pr = createPullRequest({
    headRefOid: headSha,
    configuredBotCurrentHeadObservedAt: "2026-06-27T00:54:12Z",
    configuredBotCurrentHeadObservationSource: "review_thread_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: "647c90b90b",
    configuredBotCurrentHeadCodexSuccessObservedAt: "2026-06-27T00:53:12Z",
  });

  assert.equal(projectCurrentHeadCodexRepairProof({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: threads,
  }), null);
});

test("projectCurrentHeadCodexRepairProof rejects reviewed-current-head no-major before a later actionable observation", () => {
  const headSha = "647c90b90b820cb17b83d2d80b5dddd3e789028b";
  const threads = [
    codexThread({ id: "thread-before-no-major", commentId: "comment-before-no-major", severity: "P2", line: 432 }),
  ];
  threads[0]!.comments.nodes[0]!.createdAt = "2026-06-27T00:52:12Z";
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    localCiCommand: "python3 scripts/ci/repo_hygiene.py",
  });
  const record = createRecord({
    last_head_sha: headSha,
    blocked_reason: "manual_review",
    processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
    processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Repo hygiene passed on current head.",
      ran_at: "2026-06-27T00:55:00Z",
      head_sha: headSha,
      execution_mode: "shell",
      command: "python3 scripts/ci/repo_hygiene.py",
      failure_class: null,
      remediation_target: null,
    },
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "python3 scripts/ci/repo_hygiene.py",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Rechecked unresolved review cluster; no source changes needed.",
        recorded_at: "2026-06-27T00:55:21Z",
        processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
        processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
      },
    ],
  });
  const pr = createPullRequest({
    headRefOid: headSha,
    configuredBotCurrentHeadObservedAt: "2026-06-27T00:55:12Z",
    configuredBotCurrentHeadObservationSource: "status_context",
    configuredBotCurrentHeadStatusState: null,
    configuredBotCurrentHeadActionableObservedAt: "2026-06-27T00:54:12Z",
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: "647c90b90b",
    configuredBotCurrentHeadCodexSuccessObservedAt: "2026-06-27T00:53:12Z",
  });

  assert.equal(projectCurrentHeadCodexRepairProof({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: threads,
  }), null);
});

test("projectCurrentHeadCodexRepairProof rejects unanchored no-major even when a separate latest reviewed commit matches", () => {
  const headSha = "647c90b90b820cb17b83d2d80b5dddd3e789028b";
  const threads = [
    codexThread({ id: "thread-unanchored-no-major", commentId: "comment-unanchored-no-major", severity: "P2", line: 432 }),
  ];
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    localCiCommand: "python3 scripts/ci/repo_hygiene.py",
  });
  const record = createRecord({
    last_head_sha: headSha,
    blocked_reason: "manual_review",
    processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
    processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
    latest_local_ci_result: {
      outcome: "passed",
      summary: "Repo hygiene passed on current head.",
      ran_at: "2026-06-27T00:50:00Z",
      head_sha: headSha,
      execution_mode: "shell",
      command: "python3 scripts/ci/repo_hygiene.py",
      failure_class: null,
      remediation_target: null,
    },
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "python3 scripts/ci/repo_hygiene.py",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Rechecked unresolved review cluster; no source changes needed.",
        recorded_at: "2026-06-27T00:50:21Z",
        processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
        processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
      },
    ],
  });
  const pr = createPullRequest({
    headRefOid: headSha,
    configuredBotCurrentHeadObservedAt: "2026-06-27T00:53:12Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: null,
    configuredBotLatestReviewedCommitSha: "647c90b90b",
  });

  assert.equal(projectCurrentHeadCodexRepairProof({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: threads,
  }), null);
});

test("projectCurrentHeadCodexRepairProof rejects compound-command artifacts without exact local CI evidence", () => {
  const headSha = "f9e584d660a4ae175a9b72980e2dcc83d9d86413";
  const threads = [
    codexThread({ id: "thread-p1-a", commentId: "comment-p1-a", line: 1293 }),
    codexThread({ id: "thread-p1-b", commentId: "comment-p1-b", line: 1318 }),
  ];
  const config = createConfig({
    reviewBotLogins: [CODEX_CONNECTOR_REVIEW_BOT_LOGIN],
    localCiCommand: "python3 scripts/ci/repo_hygiene.py",
  });
  const compoundCommand =
    "python3 -m unittest tests.test_evaluate_dataset; python3 scripts/ci/repo_hygiene.py; gh pr checks 72";
  const record = createRecord({
    last_head_sha: headSha,
    blocked_reason: "manual_review",
    codex_connector_review_requested_observed_at: "2026-06-26T06:10:00Z",
    codex_connector_review_requested_head_sha: headSha,
    processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
    processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
    latest_local_ci_result: null,
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: compoundCommand,
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "Current head covers both Connector residue cases.",
        recorded_at: "2026-06-26T06:36:00Z",
        repair_targets: [VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET],
        processed_review_thread_ids: threads.map((thread) => `${thread.id}@${headSha}`),
        processed_review_thread_fingerprints: threads.map((thread) => `${thread.id}@${headSha}#${thread.comments.nodes[0]!.id}`),
      },
    ],
  });
  const pr = createPullRequest({
    headRefOid: headSha,
    configuredBotCurrentHeadObservedAt: "2026-06-26T06:30:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    codexConnectorReviewRequestedAt: "2026-06-26T06:10:00Z",
    codexConnectorReviewRequestedHeadSha: headSha,
  });

  assert.equal(projectCurrentHeadCodexRepairProof({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: threads,
  }), null);
  assert.deepEqual(currentHeadCodexRepairProofRejectionReasons({
    config,
    record,
    pr,
    checks: [{ name: "Minimal checks", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: threads,
  }), ["current_head_repair_proof_scoped_artifact_command_mismatch_with_configured_local_ci"]);
});
