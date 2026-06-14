import type { FailureContext, GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread } from "./core/types";

export const CODEX_CONNECTOR_REVIEW_BOT_LOGIN = "chatgpt-codex-connector";
export const CODEX_CONNECTOR_DEFAULT_HEAD_SHA = "head-1995";
export const CODEX_CONNECTOR_STALE_HEAD_SHA = "head-old";

const STALE_REVIEW_BOT_SUMMARY =
  "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.";

export const codexConnectorPassingChecks: PullRequestCheck[] = [
  {
    name: "build",
    state: "SUCCESS",
    bucket: "pass",
    workflow: "CI",
  },
];

type CodexConnectorRequestScenarioOptions = {
  issueNumber?: number;
  prNumber?: number;
  headSha?: string;
  staleHeadSha?: string;
  requestedAt?: string;
  retryCount?: number;
  now?: string;
};

export type CodexConnectorReviewRequestScenario = {
  recordPatch: Partial<IssueRunRecord>;
  pullRequestPatch: Partial<GitHubPullRequest>;
  reviewThreads: ReviewThread[];
  configuredThreads: ReviewThread[];
  checks: PullRequestCheck[];
  now?: string;
};

function createCodexConnectorThread({
  threadId,
  commentId,
  headSha,
  body,
}: {
  threadId: string;
  commentId: string;
  headSha: string;
  body: string;
}): ReviewThread {
  return {
    id: threadId,
    isResolved: false,
    isOutdated: false,
    path: "src/review-policy.ts",
    line: 12,
    comments: {
      nodes: [
        {
          id: commentId,
          body,
          createdAt: "2026-05-08T03:20:00Z",
          url: `https://example.test/pr/1995#discussion_${threadId}_${headSha}`,
          author: {
            login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
            typeName: "Bot",
          },
        },
      ],
    },
  };
}

export function createCodexConnectorStaleHeadRequestScenario({
  issueNumber = 1995,
  prNumber = 1995,
  headSha = CODEX_CONNECTOR_DEFAULT_HEAD_SHA,
  staleHeadSha = CODEX_CONNECTOR_STALE_HEAD_SHA,
}: CodexConnectorRequestScenarioOptions = {}): CodexConnectorReviewRequestScenario {
  return {
    recordPatch: {
      issue_number: issueNumber,
      state: "blocked",
      pr_number: prNumber,
      last_head_sha: headSha,
      blocked_reason: "stale_review_bot",
      provider_success_head_sha: staleHeadSha,
      external_review_head_sha: staleHeadSha,
    },
    pullRequestPatch: {
      number: prNumber,
      headRefOid: headSha,
      configuredBotLatestReviewedCommitSha: staleHeadSha,
      configuredBotCurrentHeadObservedAt: null,
    },
    reviewThreads: [],
    configuredThreads: [],
    checks: codexConnectorPassingChecks,
  };
}

export function createCodexConnectorStaleReviewCommitRequestScenario({
  issueNumber = 1995,
  prNumber = 1995,
  headSha = CODEX_CONNECTOR_DEFAULT_HEAD_SHA,
  staleHeadSha = CODEX_CONNECTOR_STALE_HEAD_SHA,
}: CodexConnectorRequestScenarioOptions = {}): CodexConnectorReviewRequestScenario {
  const reviewThread = createCodexConnectorThread({
    threadId: "thread-stale-review-commit",
    commentId: "comment-stale-review-commit",
    headSha: staleHeadSha,
    body: "P1: Re-run the current-head review before treating this stale review commit as merge-ready.",
  });

  return {
    recordPatch: {
      issue_number: issueNumber,
      state: "blocked",
      pr_number: prNumber,
      last_head_sha: headSha,
      blocked_reason: "stale_review_bot",
    },
    pullRequestPatch: {
      number: prNumber,
      headRefOid: headSha,
      configuredBotLatestReviewedCommitSha: staleHeadSha,
      configuredBotCurrentHeadObservedAt: null,
    },
    reviewThreads: [reviewThread],
    configuredThreads: [reviewThread],
    checks: codexConnectorPassingChecks,
  };
}

export function createCodexConnectorSameHeadRequestScenario({
  issueNumber = 1995,
  prNumber = 1995,
  headSha = CODEX_CONNECTOR_DEFAULT_HEAD_SHA,
  requestedAt = "2026-05-08T03:30:00Z",
  now,
}: CodexConnectorRequestScenarioOptions = {}): CodexConnectorReviewRequestScenario {
  return {
    recordPatch: {
      issue_number: issueNumber,
      pr_number: prNumber,
      codex_connector_review_requested_observed_at: requestedAt,
      codex_connector_review_requested_head_sha: headSha,
    },
    pullRequestPatch: {
      number: prNumber,
      headRefOid: headSha,
      codexConnectorReviewRequestedAt: requestedAt,
      codexConnectorReviewRequestedHeadSha: headSha,
    },
    reviewThreads: [],
    configuredThreads: [],
    checks: codexConnectorPassingChecks,
    now,
  };
}

export function createCodexConnectorRequestRetryScenario({
  retryCount = 0,
  now = "2026-05-08T03:40:00.000Z",
  ...options
}: CodexConnectorRequestScenarioOptions = {}): CodexConnectorReviewRequestScenario {
  const scenario = createCodexConnectorSameHeadRequestScenario(options);
  return {
    ...scenario,
    recordPatch: {
      ...scenario.recordPatch,
      codex_connector_review_request_retry_count: retryCount,
      codex_connector_review_request_retry_head_sha: null,
      codex_connector_review_request_last_retried_at: null,
    },
    now,
  };
}

type CodexConnectorTrackedReviewScenarioOptions = {
  issueNumber: number;
  prNumber: number;
  headSha: string;
  branch?: string;
  threadId: string;
  commentId: string;
  path: string;
  line: number;
  commentBody: string;
  discussionUrl: string;
  severity?: string;
  verifiedRepair?: {
    summary: string;
    ranAt: string;
    command: string;
    evidenceSource?: "latest_local_ci_result" | "codex_turn_timeline_artifact";
  };
  currentHeadNoMajorReview?: {
    requestedAt?: string;
    observedAt?: string;
  };
};

export function createCodexConnectorTrackedReviewResidueScenario({
  issueNumber,
  prNumber,
  headSha,
  branch = `codex/issue-${issueNumber}`,
  threadId,
  commentId,
  path,
  line,
  commentBody,
  discussionUrl,
  severity = "P1",
  verifiedRepair,
  currentHeadNoMajorReview,
}: CodexConnectorTrackedReviewScenarioOptions): {
  recordPatch: Partial<IssueRunRecord>;
  pullRequestPatch: Partial<GitHubPullRequest>;
  reviewThread: ReviewThread;
  staleReviewFailureContext: FailureContext;
  passingChecks: PullRequestCheck[];
} {
  const reviewDetail = `reviewer=${CODEX_CONNECTOR_REVIEW_BOT_LOGIN} file=${path} line=${line} p_severity=${severity} processed_on_current_head=yes`;
  const recordPatch: Partial<IssueRunRecord> = {
    issue_number: issueNumber,
    state: "blocked",
    branch,
    pr_number: prNumber,
    last_head_sha: headSha,
    blocked_reason: "stale_review_bot",
    copilot_review_timed_out_at: "2026-05-15T00:20:00Z",
    copilot_review_timeout_action: "request_review_comment",
    processed_review_thread_ids: [`${threadId}@${headSha}`],
    processed_review_thread_fingerprints: [`${threadId}@${headSha}#${commentId}`],
    last_failure_signature: `stalled-bot:${threadId}`,
    last_failure_context: {
      category: "manual",
      summary: STALE_REVIEW_BOT_SUMMARY,
      signature: `stalled-bot:${threadId}`,
      command: null,
      details: [reviewDetail],
      url: discussionUrl,
      updated_at: "2026-05-15T00:20:00Z",
    },
  };
  if (currentHeadNoMajorReview) {
    recordPatch.codex_connector_review_requested_observed_at =
      currentHeadNoMajorReview.requestedAt ?? "2026-05-15T00:12:00Z";
    recordPatch.codex_connector_review_requested_head_sha = headSha;
  }
  if (verifiedRepair?.evidenceSource !== "codex_turn_timeline_artifact" && verifiedRepair) {
    recordPatch.latest_local_ci_result = {
      outcome: "passed",
      summary: verifiedRepair.summary,
      ran_at: verifiedRepair.ranAt,
      head_sha: headSha,
      execution_mode: "shell",
      command: verifiedRepair.command,
      failure_class: null,
      remediation_target: null,
    };
  } else if (verifiedRepair) {
    recordPatch.latest_local_ci_result = null;
    recordPatch.timeline_artifacts = [
      {
        type: "verification_result",
        gate: "codex_turn",
        command: verifiedRepair.command,
        head_sha: headSha,
        outcome: "passed",
        remediation_target: null,
        next_action: "continue",
        summary: verifiedRepair.summary,
        recorded_at: verifiedRepair.ranAt,
        processed_review_thread_ids: [`${threadId}@${headSha}`],
        processed_review_thread_fingerprints: [`${threadId}@${headSha}#${commentId}`],
      },
    ];
  }

  return {
    recordPatch,
    pullRequestPatch: {
      number: prNumber,
      title: verifiedRepair
        ? "Tracked PR verified current-head repair Codex residue"
        : "Tracked PR verified no-source-change Codex residue",
      isDraft: false,
      headRefName: branch,
      headRefOid: headSha,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
      currentHeadCiGreenAt: verifiedRepair ? "2026-05-15T00:19:00Z" : "2026-05-15T00:10:00Z",
      configuredBotCurrentHeadObservedAt: null,
      configuredBotCurrentHeadObservationSource: null,
      configuredBotCurrentHeadStatusState: "SUCCESS",
      configuredBotTopLevelReviewStrength: null,
      ...(currentHeadNoMajorReview
        ? {
            codexConnectorReviewRequestedAt:
              currentHeadNoMajorReview.requestedAt ?? "2026-05-15T00:12:00Z",
            codexConnectorReviewRequestedHeadSha: headSha,
            configuredBotCurrentHeadObservedAt:
              currentHeadNoMajorReview.observedAt ?? "2026-05-15T00:16:00Z",
            configuredBotCurrentHeadObservationSource: "codex_pr_success_comment",
          }
        : {}),
    },
    reviewThread: {
      id: threadId,
      isResolved: false,
      isOutdated: false,
      path,
      line,
      comments: {
        nodes: [
          {
            id: commentId,
            body: commentBody,
            createdAt: "2026-05-15T00:05:00Z",
            url: discussionUrl,
            author: {
              login: CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
              typeName: "Bot",
            },
          },
        ],
      },
    },
    staleReviewFailureContext: {
      category: "manual",
      summary: STALE_REVIEW_BOT_SUMMARY,
      signature: `stalled-bot:${threadId}`,
      command: null,
      details: [reviewDetail],
      url: discussionUrl,
      updated_at: "2026-05-15T00:20:00Z",
    },
    passingChecks: [
      { name: verifiedRepair ? "focused verifier" : "build", state: "SUCCESS", bucket: "pass", workflow: "CI" },
    ],
  };
}
