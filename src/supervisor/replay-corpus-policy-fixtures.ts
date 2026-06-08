import {
  buildReviewPolicyInput,
  type ReviewPolicyBoundaryOutcome,
  type ReviewPolicyInput,
} from "../codex-connector-review-policy";
import type { GitHubPullRequest, ReviewThread } from "../core/types";
import {
  classifyStaleReviewBotAutoRepairSuppressionPolicy,
  type StaleReviewBotAutoRepairSuppressedReason,
} from "./stale-review-bot-classification-policy";

export type ConnectorReviewPolicyReplayNextAction =
  | "fix"
  | "wait"
  | "manual"
  | "metadata_cleanup"
  | "advisory_only";

export interface ConnectorReviewPolicyReplayFixture {
  id: string;
  projectShape: "aegisops" | "hrcore";
  description: string;
  policyInput: ReviewPolicyInput;
  expectedThreadOutcomes: Array<{
    threadId: string;
    boundaryOutcome: ReviewPolicyBoundaryOutcome;
    nextAction: ConnectorReviewPolicyReplayNextAction;
  }>;
  repeatStopSuppressedReason?: StaleReviewBotAutoRepairSuppressedReason;
}

function codexThread(args: {
  id: string;
  body: string;
  path?: string;
  line?: number;
  isOutdated?: boolean;
}): ReviewThread {
  return {
    id: args.id,
    isResolved: false,
    isOutdated: args.isOutdated ?? false,
    path: args.path ?? "src/supervisor/review-policy.ts",
    line: args.line ?? 42,
    comments: {
      nodes: [
        {
          id: `${args.id}-comment`,
          body: args.body,
          createdAt: "2026-06-08T00:00:00Z",
          url: `https://example.test/pr/2293#discussion_${args.id}`,
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  };
}

function manualThread(): ReviewThread {
  return {
    id: "manual-thread",
    isResolved: false,
    isOutdated: false,
    path: "src/supervisor/operator-note.ts",
    line: 18,
    comments: {
      nodes: [
        {
          id: "manual-thread-comment",
          body: "Manual operator review is required before the next automated turn.",
          createdAt: "2026-06-08T00:01:00Z",
          url: "https://example.test/pr/2293#discussion_manual",
          author: {
            login: "maintainer",
            typeName: "User",
          },
        },
      ],
    },
  };
}

function configuredBotThread(): ReviewThread {
  return {
    id: "configured-bot-thread",
    isResolved: false,
    isOutdated: true,
    path: "src/supervisor/configured-bot.ts",
    line: 27,
    comments: {
      nodes: [
        {
          id: "configured-bot-thread-comment",
          body: "Non-Codex configured bot residue without an actionable Codex finding.",
          createdAt: "2026-06-08T00:02:00Z",
          url: "https://example.test/pr/2293#discussion_configured_bot",
          author: {
            login: "chatgpt-codex-connector",
            typeName: "Bot",
          },
        },
      ],
    },
  };
}

function policyInput(args: {
  pr?: Partial<Pick<GitHubPullRequest, "number" | "headRefOid" | "configuredBotCurrentHeadObservedAt" | "configuredBotLatestReviewedCommitSha" | "currentHeadCiGreenAt">>;
  processedThreadIds?: string[];
  processedThreadFingerprints?: string[];
  reviewThreads: ReviewThread[];
}): ReviewPolicyInput {
  const pr = {
    number: 2293,
    headRefOid: "head-current",
    configuredBotCurrentHeadObservedAt: null,
    configuredBotLatestReviewedCommitSha: null,
    currentHeadCiGreenAt: "2026-06-08T00:03:00Z",
    ...args.pr,
  };
  return buildReviewPolicyInput({
    config: {
      reviewBotLogins: ["chatgpt-codex-connector"],
      configuredReviewProviders: [
        {
          kind: "codex",
          reviewerLogins: ["chatgpt-codex-connector"],
          signalSource: "review_threads",
        },
      ],
    },
    pr,
    record: {
      provider_success_head_sha: null,
      external_review_head_sha: null,
      last_head_sha: pr.headRefOid,
      processed_review_thread_ids: args.processedThreadIds ?? [],
      processed_review_thread_fingerprints: args.processedThreadFingerprints ?? [],
    },
    reviewThreads: args.reviewThreads,
  });
}

export function createConnectorReviewPolicyReplayFixtures(): ConnectorReviewPolicyReplayFixture[] {
  const currentHeadP2 = codexThread({
    id: "current-head-p2",
    body: "P2: Keep current-head source work blocked until this regression is fixed.",
  });
  const softP3 = codexThread({
    id: "softened-p3",
    body: "P3: Nitpick: prefer a shorter helper name for readability.",
  });
  const riskP3 = codexThread({
    id: "escalated-p3",
    body: "P3: This cleanup can cause a regression in the restore failure path.",
  });
  const staleP2 = codexThread({
    id: "stale-commit-p2",
    body: "P2: Old-head finding that must wait for current-head Codex review.",
  });
  const metadataP2 = codexThread({
    id: "metadata-only-p2",
    body: "P2: Finding without current-head processing evidence.",
  });

  const mustFixInput = policyInput({
    processedThreadIds: ["current-head-p2@head-current", "escalated-p3@head-current"],
    processedThreadFingerprints: [
      "current-head-p2@head-current#current-head-p2-comment",
      "escalated-p3@head-current#escalated-p3-comment",
    ],
    reviewThreads: [currentHeadP2, riskP3],
  });
  const advisoryInput = policyInput({
    processedThreadIds: ["softened-p3@head-current"],
    processedThreadFingerprints: ["softened-p3@head-current#softened-p3-comment"],
    reviewThreads: [softP3],
  });
  const staleCommitInput = policyInput({
    pr: {
      configuredBotLatestReviewedCommitSha: "head-old",
    },
    reviewThreads: [staleP2, softP3],
  });
  const metadataInput = policyInput({
    reviewThreads: [metadataP2, manualThread(), configuredBotThread()],
  });

  return [
    {
      id: "phase2-aegisops-current-head-must-fix",
      projectShape: "aegisops",
      description: "AegisOps-style current-head Codex findings require source repair.",
      policyInput: mustFixInput,
      expectedThreadOutcomes: [
        {
          threadId: "current-head-p2",
          boundaryOutcome: "must_fix_current_head",
          nextAction: "fix",
        },
        {
          threadId: "escalated-p3",
          boundaryOutcome: "escalated_p3",
          nextAction: "fix",
        },
      ],
    },
    {
      id: "phase2-hrcore-softened-p3-advisory",
      projectShape: "hrcore",
      description: "HRCore-style softened P3 feedback stays advisory-only.",
      policyInput: advisoryInput,
      expectedThreadOutcomes: [
        {
          threadId: "softened-p3",
          boundaryOutcome: "softened_p3_advisory",
          nextAction: "advisory_only",
        },
      ],
    },
    {
      id: "phase2-aegisops-stale-commit-waits",
      projectShape: "aegisops",
      description: "Old-head Codex review residue waits for current-head review instead of blocking merge as source work.",
      policyInput: staleCommitInput,
      expectedThreadOutcomes: [
        {
          threadId: "stale-commit-p2",
          boundaryOutcome: "stale_commit_thread",
          nextAction: "wait",
        },
        {
          threadId: "softened-p3",
          boundaryOutcome: "softened_p3_advisory",
          nextAction: "advisory_only",
        },
      ],
    },
    {
      id: "phase2-hrcore-metadata-residue",
      projectShape: "hrcore",
      description: "Metadata-only, manual, and configured-bot residue remain distinct from current-head source repair.",
      policyInput: metadataInput,
      expectedThreadOutcomes: [
        {
          threadId: "metadata-only-p2",
          boundaryOutcome: "metadata_only_unresolved",
          nextAction: "metadata_cleanup",
        },
        {
          threadId: "manual-thread",
          boundaryOutcome: "manual_thread",
          nextAction: "manual",
        },
        {
          threadId: "configured-bot-thread",
          boundaryOutcome: "configured_bot_thread",
          nextAction: "metadata_cleanup",
        },
      ],
      repeatStopSuppressedReason: classifyStaleReviewBotAutoRepairSuppressionPolicy({
        hasConfigAndPr: true,
        repeatStopExhausted: true,
        manualOrUnconfiguredReviewThreads: false,
        mergeConflictState: false,
        failingChecks: false,
        pendingChecks: false,
        missingProbeReason: null,
        verifiedStaleResidue: false,
        actionableClusterCount: 1,
        verifiedAutoResolveEnabled: false,
      }),
    },
  ];
}
