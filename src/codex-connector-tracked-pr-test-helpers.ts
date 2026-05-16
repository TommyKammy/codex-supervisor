import type { FailureContext, GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread } from "./core/types";

export const CODEX_CONNECTOR_REVIEW_BOT_LOGIN = "chatgpt-codex-connector";

const STALE_REVIEW_BOT_SUMMARY =
  "1 configured bot review thread(s) remain unresolved after processing on the current head without measurable progress and now require manual attention.";

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
  if (verifiedRepair) {
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
      configuredBotCurrentHeadStatusState: "SUCCESS",
      configuredBotTopLevelReviewStrength: null,
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
