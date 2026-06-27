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
    configuredBotCurrentHeadObservedAt: "2026-06-27T00:53:12Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotCurrentHeadCodexSuccessReviewedCommitSha: "647c90b90b",
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
