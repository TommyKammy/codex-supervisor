import assert from "node:assert/strict";
import test from "node:test";
import type {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReviewThread,
  SupervisorConfig,
  WorkspaceStatus,
} from "../core/types";
import { mapConfiguredReviewProviders } from "../core/review-providers";
import {
  createConfig,
  createIssue,
  createPullRequest,
  createRecord,
  createReviewThread,
} from "../turn-execution-test-helpers";
import {
  createCheckedInReplayCorpusConfig as createCheckedInReplayCorpusConfigFacade,
  deriveReplayCorpusPromotionWorthinessHints as deriveReplayCorpusPromotionWorthinessHintsFacade,
  formatReplayCorpusMismatchDetailsArtifact as formatReplayCorpusMismatchDetailsArtifactFacade,
  formatReplayCorpusMismatchSummaryLine as formatReplayCorpusMismatchSummaryLineFacade,
  formatReplayCorpusOutcomeMismatch as formatReplayCorpusOutcomeMismatchFacade,
  formatReplayCorpusRunSummary as formatReplayCorpusRunSummaryFacade,
  loadReplayCorpus as loadReplayCorpusFacade,
  promoteCapturedReplaySnapshot as promoteCapturedReplaySnapshotFacade,
  runReplayCorpus as runReplayCorpusFacade,
  suggestReplayCorpusCaseIds as suggestReplayCorpusCaseIdsFacade,
  summarizeReplayCorpusPromotion as summarizeReplayCorpusPromotionFacade,
  syncReplayCorpusMismatchDetailsArtifact as syncReplayCorpusMismatchDetailsArtifactFacade,
} from "./replay-corpus";
import { createCheckedInReplayCorpusConfig } from "./replay-corpus-config";
import {
  formatReplayCorpusMismatchDetailsArtifact,
  syncReplayCorpusMismatchDetailsArtifact,
} from "./replay-corpus-mismatch-artifact";
import {
  formatReplayCorpusMismatchSummaryLine,
  formatReplayCorpusOutcomeMismatch,
  formatReplayCorpusRunSummary,
} from "./replay-corpus-mismatch-formatting";
import { promoteCapturedReplaySnapshot } from "./replay-corpus-promotion";
import { suggestReplayCorpusCaseIds } from "./replay-corpus-promotion-case-id";
import {
  deriveReplayCorpusPromotionWorthinessHints,
  summarizeReplayCorpusPromotion,
} from "./replay-corpus-promotion-summary";
import { loadReplayCorpus, runReplayCorpus } from "./replay-corpus-runner";
import { replaySupervisorCycleDecisionSnapshot } from "./supervisor-cycle-replay";
import { buildSupervisorCycleDecisionSnapshot } from "./supervisor-cycle-snapshot";

const CODEX_CONNECTOR_REVIEW_BOT_LOGIN = "chatgpt-codex-connector";

function createCodexOnlyReplayConfig(): SupervisorConfig {
  const reviewBotLogins = [CODEX_CONNECTOR_REVIEW_BOT_LOGIN];
  return createConfig({
    localReviewEnabled: false,
    localReviewPosture: "off",
    reviewBotLogins,
    configuredReviewProviders: mapConfiguredReviewProviders(reviewBotLogins),
    humanReviewBlocksMerge: true,
  });
}

function createWorkspaceStatus(args: {
  branch: string;
  headSha: string;
}): WorkspaceStatus {
  return {
    branch: args.branch,
    headSha: args.headSha,
    hasUncommittedChanges: false,
    baseAhead: 1,
    baseBehind: 0,
    remoteBranchExists: true,
    remoteAhead: 0,
    remoteBehind: 0,
  };
}

function createCodexReviewThread(args: {
  id: string;
  commentId: string;
  path: string;
  line: number;
  body: string;
  url: string;
  isOutdated?: boolean;
}): ReviewThread {
  return createReviewThread({
    id: args.id,
    isOutdated: args.isOutdated ?? false,
    path: args.path,
    line: args.line,
    comments: {
      nodes: [
        {
          id: args.commentId,
          body: args.body,
          createdAt: "2026-06-07T02:12:00Z",
          url: args.url,
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  });
}

function createReplaySnapshot(args: {
  config: SupervisorConfig;
  capturedAt: string;
  issue: GitHubIssue;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  workspaceStatus: WorkspaceStatus;
}) {
  return buildSupervisorCycleDecisionSnapshot({
    config: args.config,
    capturedAt: args.capturedAt,
    issue: args.issue,
    record: args.record,
    workspaceStatus: args.workspaceStatus,
    pr: args.pr,
    checks: args.checks,
    reviewThreads: args.reviewThreads,
  });
}

test("replay-corpus facade re-exports the dedicated module entry points", () => {
  assert.equal(createCheckedInReplayCorpusConfigFacade, createCheckedInReplayCorpusConfig);
  assert.equal(loadReplayCorpusFacade, loadReplayCorpus);
  assert.equal(runReplayCorpusFacade, runReplayCorpus);
  assert.equal(formatReplayCorpusMismatchDetailsArtifactFacade, formatReplayCorpusMismatchDetailsArtifact);
  assert.equal(syncReplayCorpusMismatchDetailsArtifactFacade, syncReplayCorpusMismatchDetailsArtifact);
  assert.equal(formatReplayCorpusMismatchSummaryLineFacade, formatReplayCorpusMismatchSummaryLine);
  assert.equal(formatReplayCorpusOutcomeMismatchFacade, formatReplayCorpusOutcomeMismatch);
  assert.equal(formatReplayCorpusRunSummaryFacade, formatReplayCorpusRunSummary);
  assert.equal(suggestReplayCorpusCaseIdsFacade, suggestReplayCorpusCaseIds);
  assert.equal(promoteCapturedReplaySnapshotFacade, promoteCapturedReplaySnapshot);
  assert.equal(deriveReplayCorpusPromotionWorthinessHintsFacade, deriveReplayCorpusPromotionWorthinessHints);
  assert.equal(summarizeReplayCorpusPromotionFacade, summarizeReplayCorpusPromotion);
});

test("Phase 0 replay fixture keeps AegisOps-style GitHub-green repeated Codex feedback terminal", () => {
  const config = createCodexOnlyReplayConfig();
  const issueNumber = 9140;
  const prNumber = 9240;
  const headSha = "head-aegisops-repeat-stop";
  const branch = `codex/issue-${issueNumber}`;
  const thread = createCodexReviewThread({
    id: "thread-production-source-denylist",
    commentId: "comment-production-source-denylist-v1",
    path: "aegisops/source_policy.ts",
    line: 44,
    body:
      "P1: The production source denylist still allows simulator evidence to be treated as launch authority.",
    url: `https://example.test/pull/${prNumber}#discussion_r9140`,
  });
  const record = createRecord({
    issue_number: issueNumber,
    state: "blocked",
    branch,
    pr_number: prNumber,
    workspace: ".",
    journal_path: `.codex-supervisor/issues/${issueNumber}/issue-journal.md`,
    attempt_count: 7,
    implementation_attempt_count: 2,
    repair_attempt_count: 5,
    blocked_reason: "stale_review_bot",
    last_head_sha: headSha,
    review_wait_started_at: "2026-06-07T02:00:00Z",
    review_wait_head_sha: headSha,
    provider_success_observed_at: "2026-06-07T02:10:00Z",
    provider_success_head_sha: headSha,
    merge_readiness_last_evaluated_at: "2026-06-07T02:12:30Z",
    latest_local_ci_result: {
      outcome: "passed",
      summary: "AegisOps focused policy verifier passed on the current head.",
      ran_at: "2026-06-07T02:11:00Z",
      head_sha: headSha,
      execution_mode: "structured",
      command: "npx tsx --test src/supervisor/replay-corpus.test.ts",
      failure_class: null,
      remediation_target: null,
    },
    processed_review_thread_ids: [`${thread.id}@${headSha}`],
    processed_review_thread_fingerprints: [`${thread.id}@${headSha}#comment-production-source-denylist-v1`],
    last_tracked_pr_repeat_failure_decision: "stop_no_progress",
    last_error: "Repeated configured Codex review feedback made no tracked PR progress.",
    last_failure_context: {
      category: "manual",
      summary:
        "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.",
      signature: `stalled-bot:${thread.id}`,
      command: null,
      details: [
        `reviewer=${CODEX_CONNECTOR_REVIEW_BOT_LOGIN} file=${thread.path} line=${thread.line} p_severity=P1 processed_on_current_head=yes`,
      ],
      url: `https://example.test/pull/${prNumber}#discussion_r9140`,
      updated_at: "2026-06-07T02:12:30Z",
    },
    last_failure_signature: `stalled-bot:${thread.id}`,
    updated_at: "2026-06-07T02:13:00Z",
  });
  const pr = createPullRequest({
    number: prNumber,
    title: "AegisOps repeated Codex review feedback terminal fixture",
    url: `https://example.test/pull/${prNumber}`,
    headRefName: branch,
    headRefOid: headSha,
    reviewDecision: "CHANGES_REQUESTED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    currentHeadCiGreenAt: "2026-06-07T02:11:00Z",
    configuredBotCurrentHeadObservedAt: "2026-06-07T02:10:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: "blocking",
    configuredBotTopLevelReviewSubmittedAt: "2026-06-07T02:10:00Z",
  });
  const snapshot = createReplaySnapshot({
    config,
    capturedAt: "2026-06-07T02:15:00Z",
    issue: createIssue({
      number: issueNumber,
      title: "AegisOps repeated Codex review feedback terminal fixture",
      body: "Portable replay fixture for a GitHub-green PR stopped after repeated configured Codex feedback.",
      url: `https://example.test/issues/${issueNumber}`,
      updatedAt: "2026-06-07T02:13:00Z",
    }),
    record,
    pr,
    checks: [{ name: "policy verifier", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [thread],
    workspaceStatus: createWorkspaceStatus({ branch, headSha }),
  });
  const replayed = replaySupervisorCycleDecisionSnapshot(snapshot, config);

  assert.equal(replayed.matchesCapturedDecision, true);
  assert.equal(snapshot.decision.nextState, "blocked");
  assert.equal(snapshot.decision.shouldRunCodex, false);
  assert.equal(snapshot.decision.blockedReason, "stale_review_bot");
  assert.equal(snapshot.decision.failureContext?.signature, `stalled-bot:${thread.id}`);
});

test("Phase 0 replay fixture keeps HRCore-style metadata-only current-head repair evidence terminal", () => {
  const config = createCodexOnlyReplayConfig();
  const issueNumber = 9141;
  const prNumber = 9241;
  const headSha = "head-hrcore-metadata-only";
  const branch = `codex/issue-${issueNumber}`;
  const thread = createCodexReviewThread({
    id: "thread-openapi-onboarding-schema",
    commentId: "comment-openapi-onboarding-schema-v1",
    path: "openapi/hrcore.openapi.json",
    line: 128,
    body:
      "P2: The onboarding schema path list was missing the current repair artifact before this head.",
    url: `https://example.test/pull/${prNumber}#discussion_r9141`,
    isOutdated: true,
  });
  const record = createRecord({
    issue_number: issueNumber,
    state: "blocked",
    branch,
    pr_number: prNumber,
    workspace: ".",
    journal_path: `.codex-supervisor/issues/${issueNumber}/issue-journal.md`,
    attempt_count: 5,
    implementation_attempt_count: 2,
    repair_attempt_count: 3,
    blocked_reason: "stale_review_bot",
    last_head_sha: headSha,
    review_wait_started_at: "2026-06-07T03:00:00Z",
    review_wait_head_sha: headSha,
    provider_success_observed_at: "2026-06-07T03:09:00Z",
    provider_success_head_sha: headSha,
    merge_readiness_last_evaluated_at: "2026-06-07T03:10:00Z",
    timeline_artifacts: [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: "npx tsx --test src/supervisor/stale-review-bot-remediation.test.ts",
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: "HRCore OpenAPI onboarding schema repair evidence passed on the current head.",
        recorded_at: "2026-06-07T03:08:00Z",
        processed_review_thread_ids: [`${thread.id}@${headSha}`],
        processed_review_thread_fingerprints: [`${thread.id}@${headSha}#comment-openapi-onboarding-schema-v1`],
      },
    ],
    processed_review_thread_ids: [`${thread.id}@${headSha}`],
    processed_review_thread_fingerprints: [`${thread.id}@${headSha}#comment-openapi-onboarding-schema-v1`],
    last_error: "Outdated configured Codex metadata remained after current-head repair evidence.",
    last_failure_context: {
      category: "manual",
      summary: "Outdated configured-bot metadata-only residue is blocking the tracked PR.",
      signature: `stalled-bot:${thread.id}`,
      command: null,
      details: [
        `reviewer=${CODEX_CONNECTOR_REVIEW_BOT_LOGIN} file=${thread.path} line=${thread.line} processed_on_current_head=yes`,
      ],
      url: `https://example.test/pull/${prNumber}#discussion_r9141`,
      updated_at: "2026-06-07T03:08:30Z",
    },
    last_failure_signature: `stalled-bot:${thread.id}`,
    updated_at: "2026-06-07T03:10:00Z",
  });
  const pr = createPullRequest({
    number: prNumber,
    title: "HRCore metadata-only current-head repair evidence terminal fixture",
    url: `https://example.test/pull/${prNumber}`,
    headRefName: branch,
    headRefOid: headSha,
    reviewDecision: "APPROVED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    currentHeadCiGreenAt: "2026-06-07T03:08:30Z",
    codexConnectorReviewRequestedAt: "2026-06-07T03:04:00Z",
    codexConnectorReviewRequestedHeadSha: headSha,
    configuredBotCurrentHeadObservedAt: "2026-06-07T03:09:00Z",
    configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
    configuredBotCurrentHeadStatusState: "SUCCESS",
    configuredBotTopLevelReviewStrength: null,
    configuredBotLatestReviewedCommitSha: headSha,
  });
  const snapshot = createReplaySnapshot({
    config,
    capturedAt: "2026-06-07T03:20:00Z",
    issue: createIssue({
      number: issueNumber,
      title: "HRCore metadata-only current-head repair evidence terminal fixture",
      body:
        "Portable replay fixture for metadata-only unresolved configured review feedback after current-head repair evidence.",
      url: `https://example.test/issues/${issueNumber}`,
      updatedAt: "2026-06-07T03:10:00Z",
    }),
    record,
    pr,
    checks: [{ name: "openapi verifier", state: "SUCCESS", bucket: "pass", workflow: "CI" }],
    reviewThreads: [thread],
    workspaceStatus: createWorkspaceStatus({ branch, headSha }),
  });
  const replayed = replaySupervisorCycleDecisionSnapshot(snapshot, config);

  assert.equal(replayed.matchesCapturedDecision, true);
  assert.equal(snapshot.decision.nextState, "ready_to_merge");
  assert.equal(snapshot.decision.shouldRunCodex, false);
  assert.equal(snapshot.decision.blockedReason, null);
  assert.equal(snapshot.decision.failureContext, null);
});
