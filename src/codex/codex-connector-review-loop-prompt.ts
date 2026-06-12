import type { GitHubPullRequest, IssueRunRecord, ReviewThread, RunState } from "../core/types";
import {
  type CodexConnectorReviewChurnDiagnostic,
  codexConnectorStableSameFileChurnSignature,
  isCodexConnectorStableSameFileChurn,
} from "../codex-connector-review-churn";

export interface CodexConnectorStableSameFileChurnDossierInput {
  state: RunState;
  record?: Partial<
    Pick<
      IssueRunRecord,
      | "last_tracked_pr_progress_snapshot"
      | "codex_connector_stable_churn_dossier_consumed_signature"
    >
  > | null;
  pr: GitHubPullRequest | null;
  reviewThreads: ReviewThread[];
}

export interface CodexConnectorReviewGuidanceInput {
  usesCodexConnectorReviewProvider: boolean;
  codexConnectorReviewChurn: CodexConnectorReviewChurnDiagnostic | null;
  codexConnectorMustFixFindingDetails: string[];
  useCodexConnectorReviewThreadFastPath: boolean;
}

function latestReviewComment(thread: ReviewThread): ReviewThread["comments"]["nodes"][number] | undefined {
  return thread.comments.nodes[thread.comments.nodes.length - 1];
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

export function buildCodexConnectorStableSameFileChurnDossier(
  input: CodexConnectorStableSameFileChurnDossierInput,
): string[] {
  if (input.state !== "addressing_review" || !input.record?.last_tracked_pr_progress_snapshot) {
    return [];
  }

  let snapshot: {
    codexConnectorReviewChurnHistory?: Array<{
      reviewedHeadSha: string;
      effectiveMustFixCount: number;
      clusterCategorySignature: string;
    }>;
    codexConnectorStableSameFileChurn?: {
      streak: number;
      dominantFile: string;
      clusterCategorySignature: string;
      currentEffectiveMustFixCount: number;
      reviewedHeadShas: string[];
      representativeThreadIds: string[];
    };
  };
  try {
    snapshot = JSON.parse(input.record.last_tracked_pr_progress_snapshot);
  } catch {
    return [];
  }

  const stable = snapshot.codexConnectorStableSameFileChurn;
  if (!isCodexConnectorStableSameFileChurn(stable)) {
    return [];
  }

  const signature = codexConnectorStableSameFileChurnSignature(stable);
  if (signature === input.record.codex_connector_stable_churn_dossier_consumed_signature) {
    return [];
  }

  const history = (snapshot.codexConnectorReviewChurnHistory ?? []).filter((entry) =>
    stable.reviewedHeadShas.includes(entry.reviewedHeadSha),
  );
  const representativeSourceUrls = uniqueNonEmpty(
    input.reviewThreads
      .filter((thread) => stable.representativeThreadIds.includes(thread.id))
      .flatMap((thread) => {
        const url = latestReviewComment(thread)?.url;
        return url ? [url] : [];
      }),
  );

  return [
    "Codex Connector stable churn dossier:",
    `- Signature: ${signature}`,
    `- Active PR head: ${input.pr?.headRefOid ?? stable.reviewedHeadShas[stable.reviewedHeadShas.length - 1] ?? "unknown"}`,
    `- Recent repair heads: ${stable.reviewedHeadShas.join(", ")}`,
    `- Must-fix count trend: ${
      history.length > 0
        ? history.map((entry) => `${entry.reviewedHeadSha}:${entry.effectiveMustFixCount}`).join(" -> ")
        : String(stable.currentEffectiveMustFixCount)
    }`,
    `- Category signature trend: ${
      history.length > 0
        ? history.map((entry) => `${entry.reviewedHeadSha}:${entry.clusterCategorySignature}`).join(" -> ")
        : stable.clusterCategorySignature
    }`,
    `- Dominant file: ${stable.dominantFile}`,
    `- Current effective must-fix count: ${stable.currentEffectiveMustFixCount}`,
    `- Representative thread ids: ${stable.representativeThreadIds.join(", ") || "none"}`,
    `- Representative URLs: ${representativeSourceUrls.join(", ") || "none"}`,
    "- Route this as one root-cause repair dossier, not per-thread patching.",
    `- Read ${stable.dominantFile} as a whole before editing so the repair addresses the shared enforcement boundary.`,
  ];
}

export function buildCodexConnectorReviewGuidance(input: CodexConnectorReviewGuidanceInput): string[] {
  if (!input.usesCodexConnectorReviewProvider) {
    return [];
  }

  return [
    "Codex Connector review handling:",
    "- P0/P1/P2 and escalated P3 Codex Connector findings are supervisor-enforced must-fix findings.",
    "- Same-head reply-only disagreement does not clear a must-fix finding for merge readiness.",
    "- P3 nitpick-only findings are not enough by themselves to require a same-PR repair pass.",
    "- If the finding is valid, make the smallest valid code fix and push a new PR head.",
    "- If a must-fix finding conflicts with issue scope or appears unsafe to apply, route it to the existing manual/operator review path instead of self-dismissing it.",
    ...(input.codexConnectorReviewChurn
      ? [
          "Codex Connector clustered root-cause repair:",
          `- Triggered: review_churn must_fix=${input.codexConnectorReviewChurn.mustFixCount} threshold=${input.codexConnectorReviewChurn.threshold} concentration_basis=${input.codexConnectorReviewChurn.concentrationBasis} dominant_file=${input.codexConnectorReviewChurn.dominantFile} dominant_file_percent=${input.codexConnectorReviewChurn.dominantFilePercent}`,
          `- Cluster signature: ${input.codexConnectorReviewChurn.signature}`,
          `- Normalized categories: ${input.codexConnectorReviewChurn.normalizedCategories.join(", ")}`,
          `- Representative threads: ${input.codexConnectorReviewChurn.representativeThreadIds.join(", ") || "none"}`,
          "- Treat the comments as one review family before editing; identify the common subject, verb, scope, and truth-category failure that explains the variants.",
          "- Prefer a generalized parser, table-driven verifier, or category-based guard over adding one literal regex or wording patch per thread.",
          "- Use representative examples from the cluster as regression probes, then verify that the broader category is covered without weakening the fail-closed policy.",
        ]
      : []),
    ...(input.codexConnectorMustFixFindingDetails.length > 0 && !input.useCodexConnectorReviewThreadFastPath
      ? [
          "Codex Connector must-fix findings:",
          ...input.codexConnectorMustFixFindingDetails,
        ]
      : []),
  ];
}

export function buildCodexConnectorSpecializedReviewLoopEvidenceLabels(args: {
  codexConnectorReviewChurn: CodexConnectorReviewChurnDiagnostic | null;
  stableSameFileChurnDossier: string[];
}): string[] {
  return [
    ...(args.codexConnectorReviewChurn ? ["Codex Connector clustered root-cause repair"] : []),
    ...(args.stableSameFileChurnDossier.length > 0 ? ["Codex Connector stable churn dossier"] : []),
  ];
}
