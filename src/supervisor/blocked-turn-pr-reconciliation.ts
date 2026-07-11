import type {
  GitHubPullRequest,
  IssueRunRecord,
  SupervisorStateFile,
} from "../core/types";

type ReadPurpose = "status" | "action";

export interface BlockedTurnPullRequestLookup {
  findOpenPullRequestsForBranch?: (
    branch: string,
    options?: { purpose?: ReadPurpose },
  ) => Promise<GitHubPullRequest[]>;
  getPullRequestIfExists?: (
    prNumber: number,
    options?: { purpose?: ReadPurpose },
  ) => Promise<GitHubPullRequest | null>;
  resolvePullRequestForBranch?: (
    branch: string,
    trackedPrNumber: number | null,
    options?: { purpose?: ReadPurpose },
  ) => Promise<GitHubPullRequest | null>;
}

export type BlockedTurnPullRequestReconciliation =
  | {
      kind: "bound";
      diagnostic: string;
      pullRequest: GitHubPullRequest;
    }
  | {
      kind: "absent" | "ambiguous" | "error";
      diagnostic: string;
      pullRequest: null;
    };

export function blockedTurnPullRequestReconciliationStatusLine(
  record: Pick<
    IssueRunRecord,
    | "blocked_reason"
    | "issue_number"
    | "last_tracked_pr_progress_summary"
    | "pr_number"
    | "state"
  > | null,
): string | null {
  if (!record) {
    return null;
  }
  const summary = record.last_tracked_pr_progress_summary ?? "";
  const reconciliationDiagnostic = summary
    .split(" | ")
    .find((part) => part.startsWith("blocked_turn_pr_reconciliation="));
  if (reconciliationDiagnostic) {
    return reconciliationDiagnostic;
  }
  if (
    record.state === "addressing_review" &&
    record.blocked_reason === "verification" &&
    record.pr_number !== null
  ) {
    return (
      `blocked_turn_pr_reconciliation=scheduled_review_repair ` +
      `issue=#${record.issue_number} pr=#${record.pr_number} ` +
      "independent_verification_blocker=carried"
    );
  }
  return null;
}

function compactDiagnosticDetail(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message.replace(/\s+/g, "_").slice(0, 300) || "unknown";
}

function candidateNumbers(candidates: readonly GitHubPullRequest[]): string {
  return candidates.length === 0
    ? "none"
    : candidates.map((candidate) => `#${candidate.number}`).join(",");
}

export async function reconcileBlockedTurnPullRequest(args: {
  github: BlockedTurnPullRequestLookup;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  defaultBranch: string;
  repoSlug: string;
  purpose?: ReadPurpose;
}): Promise<BlockedTurnPullRequestReconciliation> {
  const branchOwners = Object.values(args.state.issues).filter(
    (candidate) =>
      candidate.issue_number !== args.record.issue_number &&
      candidate.branch === args.record.branch,
  );
  if (branchOwners.length > 0) {
    return {
      kind: "ambiguous",
      diagnostic:
        `blocked_turn_pr_reconciliation=ambiguous branch=${args.record.branch} ` +
        `reason=shared_recorded_branch owners=${branchOwners
          .map((candidate) => `#${candidate.issue_number}`)
          .join(",")}`,
      pullRequest: null,
    };
  }

  try {
    const purpose = args.purpose ?? "action";
    if (!args.github.findOpenPullRequestsForBranch) {
      return {
        kind: "error",
        diagnostic:
          `blocked_turn_pr_reconciliation=error branch=${args.record.branch} ` +
          "detail=ambiguity_aware_lookup_unavailable",
        pullRequest: null,
      };
    }
    const candidates = await args.github.findOpenPullRequestsForBranch(
      args.record.branch,
      { purpose },
    );

    if (candidates.length === 0) {
      return {
        kind: "absent",
        diagnostic: `blocked_turn_pr_reconciliation=absent branch=${args.record.branch}`,
        pullRequest: null,
      };
    }

    const expectedHeadOwner = args.repoSlug.split("/", 1)[0]?.toLowerCase() ?? "";
    const canonicalCandidates = candidates.filter(
      (candidate) =>
        candidate.state === "OPEN" &&
        candidate.mergedAt == null &&
        candidate.headRefName === args.record.branch &&
        candidate.baseRefName === args.defaultBranch &&
        candidate.isCrossRepository === false &&
        candidate.headRepositoryOwner?.login?.toLowerCase() === expectedHeadOwner,
    );
    if (candidates.length !== 1 || canonicalCandidates.length !== 1) {
      return {
        kind: "ambiguous",
        diagnostic:
          `blocked_turn_pr_reconciliation=ambiguous branch=${args.record.branch} ` +
          `reason=no_unique_canonical_open_pr candidates=${candidateNumbers(candidates)}`,
        pullRequest: null,
      };
    }

    const candidate = canonicalCandidates[0]!;
    const hydratedPullRequest = args.github.getPullRequestIfExists
      ? await args.github.getPullRequestIfExists(candidate.number, { purpose })
      : candidate;
    if (
      !hydratedPullRequest ||
      hydratedPullRequest.number !== candidate.number ||
      hydratedPullRequest.state !== "OPEN" ||
      hydratedPullRequest.mergedAt != null ||
      hydratedPullRequest.headRefName !== args.record.branch ||
      hydratedPullRequest.baseRefName !== args.defaultBranch ||
      hydratedPullRequest.headRefOid !== candidate.headRefOid
    ) {
      return {
        kind: "ambiguous",
        diagnostic:
          `blocked_turn_pr_reconciliation=ambiguous branch=${args.record.branch} ` +
          `reason=candidate_changed_during_hydration candidates=${candidateNumbers(candidates)}`,
        pullRequest: null,
      };
    }
    const pullRequest = hydratedPullRequest;
    return {
      kind: "bound",
      diagnostic:
        `blocked_turn_pr_reconciliation=bound branch=${args.record.branch} ` +
        `pr=#${pullRequest.number} head=${pullRequest.headRefOid}`,
      pullRequest,
    };
  } catch (error) {
    return {
      kind: "error",
      diagnostic:
        `blocked_turn_pr_reconciliation=error branch=${args.record.branch} ` +
        `detail=${compactDiagnosticDetail(error)}`,
      pullRequest: null,
    };
  }
}
