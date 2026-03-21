import { GitHubClient } from "../github";
import { DEFAULT_CANDIDATE_DISCOVERY_FETCH_WINDOW } from "../core/config";
import {
  findBlockingIssue,
  findHighRiskBlockingAmbiguity,
  lintExecutionReadyIssueBody,
  parseIssueMetadata,
} from "../issue-metadata";
import {
  formatExecutionReadyMissingFields,
  isEligibleForSelection,
  shouldEnforceExecutionReady,
} from "./supervisor-execution-policy";
import {
  evaluateAutonomousExecutionTrust,
  isAutonomousExecutionTrustBlockedRecord,
} from "./supervisor-trust-gate";
import {
  CandidateDiscoveryDiagnostics,
  GitHubIssue,
  SupervisorConfig,
  SupervisorStateFile,
} from "../core/types";
import { formatSelectionReason } from "./supervisor-selection-issue-explain";

type ReadinessSummaryGitHub =
  Pick<GitHubClient, "listCandidateIssues">
  & Partial<Pick<GitHubClient, "getCandidateDiscoveryDiagnostics">>;
type SelectionWhyGitHub = Pick<GitHubClient, "listAllIssues" | "listCandidateIssues">;

export interface SupervisorSelectionSummaryDto {
  selectedIssueNumber: number | null;
  selectionReason: string | null;
}

export interface SupervisorCandidateDiscoveryDto {
  fetchWindow: number;
  strategy: "paginated";
  truncated: boolean;
  observedMatchingOpenIssues: number | null;
  warning: string | null;
}

export interface SupervisorRunnableIssueDto {
  issueNumber: number;
  title: string;
  readiness: string;
}

export interface SupervisorBlockedIssueDto {
  issueNumber: number;
  title: string;
  blockedBy: string;
}

export interface SupervisorReadinessSummaryDto {
  runnableIssues: SupervisorRunnableIssueDto[];
  blockedIssues: SupervisorBlockedIssueDto[];
  readinessLines: string[];
}

export function formatCandidateDiscoveryBehaviorLine(
  config: Pick<SupervisorConfig, "candidateDiscoveryFetchWindow">,
  prefix = "candidate_discovery",
): string {
  const fetchWindow = config.candidateDiscoveryFetchWindow ?? DEFAULT_CANDIDATE_DISCOVERY_FETCH_WINDOW;
  return `${prefix} fetch_window=${fetchWindow} strategy=paginated`;
}

export function formatCandidateDiscoveryStatusLine(
  diagnostics: CandidateDiscoveryDiagnostics | null,
): string | null {
  if (!diagnostics?.truncated) {
    return null;
  }

  return [
    "candidate_discovery_warning=matching_open_issues_exceed_first_page_window",
    `fetch_window=${diagnostics.fetchWindow}`,
    `observed_matching_open_issues=${diagnostics.observedMatchingOpenIssues}+`,
    "runnable_selection_incomplete=yes",
  ].join(" ");
}

export function formatCandidateDiscoveryWarningDetail(
  diagnostics: CandidateDiscoveryDiagnostics | null,
): string | null {
  if (!diagnostics?.truncated) {
    return null;
  }

  return `Candidate discovery may be truncated: more than ${diagnostics.fetchWindow} matching open issues exceed the current first-page fetch window, so runnable selection may be incomplete.`;
}

export function buildCandidateDiscoverySummary(
  config: Pick<SupervisorConfig, "candidateDiscoveryFetchWindow">,
  diagnostics: CandidateDiscoveryDiagnostics | null,
): SupervisorCandidateDiscoveryDto {
  const fetchWindow = diagnostics?.fetchWindow ?? (
    config.candidateDiscoveryFetchWindow ?? DEFAULT_CANDIDATE_DISCOVERY_FETCH_WINDOW
  );
  return {
    fetchWindow,
    strategy: "paginated",
    truncated: diagnostics?.truncated ?? false,
    observedMatchingOpenIssues: diagnostics?.observedMatchingOpenIssues ?? null,
    warning: formatCandidateDiscoveryWarningDetail(diagnostics),
  };
}

export async function buildReadinessSummary(
  github: ReadinessSummaryGitHub,
  config: SupervisorConfig,
  state: SupervisorStateFile,
  candidateDiscoveryDiagnostics: CandidateDiscoveryDiagnostics | null | undefined = undefined,
): Promise<SupervisorReadinessSummaryDto> {
  const diagnostics =
    candidateDiscoveryDiagnostics === undefined
      ? typeof github.getCandidateDiscoveryDiagnostics === "function"
        ? await github.getCandidateDiscoveryDiagnostics()
        : null
      : candidateDiscoveryDiagnostics;
  const candidateDiscoveryWarningLine = formatCandidateDiscoveryStatusLine(diagnostics);
  const issues = await github.listCandidateIssues();
  const runnableIssues: SupervisorRunnableIssueDto[] = [];
  const blockedIssues: SupervisorBlockedIssueDto[] = [];

  for (const issue of issues) {
    if (config.skipTitlePrefixes.some((prefix) => issue.title.startsWith(prefix))) {
      continue;
    }

    const existing = state.issues[String(issue.number)];
    const readiness = lintExecutionReadyIssueBody(issue);
    if (shouldEnforceExecutionReady(existing) && !readiness.isExecutionReady) {
      blockedIssues.push({
        issueNumber: issue.number,
        title: issue.title,
        blockedBy: `requirements:${formatExecutionReadyMissingFields(readiness.missingRequired)}`,
      });
      continue;
    }

    const clarificationBlock = findHighRiskBlockingAmbiguity(issue);
    if (clarificationBlock) {
      blockedIssues.push({
        issueNumber: issue.number,
        title: issue.title,
        blockedBy: `clarification:${clarificationBlock.ambiguityClasses.join("|")}:${clarificationBlock.riskyChangeClasses.join("|")}`,
      });
      continue;
    }

    const trustDecision = evaluateAutonomousExecutionTrust(config, issue);
    if (!trustDecision.allowed) {
      blockedIssues.push({
        issueNumber: issue.number,
        title: issue.title,
        blockedBy: `trust_gate:${trustDecision.readinessToken}`,
      });
      continue;
    }

    const blockingIssue = findBlockingIssue(issue, issues, state);
    if (blockingIssue) {
      blockedIssues.push({
        issueNumber: issue.number,
        title: issue.title,
        blockedBy: blockingIssue.reason,
      });
      continue;
    }

    if (
      !isEligibleForSelection(existing, config) &&
      !(isAutonomousExecutionTrustBlockedRecord(existing) && trustDecision.allowed)
    ) {
      blockedIssues.push({
        issueNumber: issue.number,
        title: issue.title,
        blockedBy: `local_state:${existing?.state ?? "unknown"}`,
      });
      continue;
    }

    runnableIssues.push({
      issueNumber: issue.number,
      title: issue.title,
      readiness: formatRunnableReadinessReason(issue, issues, state, readiness.isExecutionReady),
    });
  }

  return {
    runnableIssues,
    blockedIssues,
    readinessLines: [
      ...(candidateDiscoveryWarningLine === null ? [] : [candidateDiscoveryWarningLine]),
      `runnable_issues=${runnableIssues.length > 0 ? runnableIssues.map((issue) => `#${issue.issueNumber} ready=${issue.readiness}`).join(",") : "none"}`,
      `blocked_issues=${blockedIssues.length > 0 ? blockedIssues.map((issue) => `#${issue.issueNumber} blocked_by=${issue.blockedBy}`).join("; ") : "none"}`,
    ],
  };
}

export async function buildSelectionWhySummary(
  github: SelectionWhyGitHub,
  config: SupervisorConfig,
  state: SupervisorStateFile,
): Promise<string[]> {
  const summary = await buildSelectionSummary(github, config, state);
  return [
    summary.selectedIssueNumber === null ? "selected_issue=none" : `selected_issue=#${summary.selectedIssueNumber}`,
    `selection_reason=${summary.selectionReason ?? "no_runnable_issue"}`,
  ];
}

export async function buildSelectionSummary(
  github: SelectionWhyGitHub,
  config: SupervisorConfig,
  state: SupervisorStateFile,
): Promise<SupervisorSelectionSummaryDto> {
  const candidateIssues = await github.listCandidateIssues();
  const issues = await github.listAllIssues();

  for (const issue of candidateIssues) {
    if (config.skipTitlePrefixes.some((prefix) => issue.title.startsWith(prefix))) {
      continue;
    }

    const existing = state.issues[String(issue.number)];
    const readiness = lintExecutionReadyIssueBody(issue);
    if (shouldEnforceExecutionReady(existing) && !readiness.isExecutionReady) {
      continue;
    }

    if (findHighRiskBlockingAmbiguity(issue)) {
      continue;
    }

    const trustDecision = evaluateAutonomousExecutionTrust(config, issue);
    if (!trustDecision.allowed) {
      continue;
    }

    if (findBlockingIssue(issue, issues, state)) {
      continue;
    }

    if (
      !isEligibleForSelection(existing, config) &&
      !(isAutonomousExecutionTrustBlockedRecord(existing) && trustDecision.allowed)
    ) {
      continue;
    }

    return {
      selectedIssueNumber: issue.number,
      selectionReason: formatSelectionReason(issue, issues, state, existing, readiness.isExecutionReady, config),
    };
  }

  return {
    selectedIssueNumber: null,
    selectionReason: "no_runnable_issue",
  };
}

function formatRunnableReadinessReason(
  issue: GitHubIssue,
  issues: GitHubIssue[],
  state: SupervisorStateFile,
  isExecutionReady: boolean,
): string {
  const metadata = parseIssueMetadata(issue);
  const reasons = [isExecutionReady ? "execution_ready" : "requirements_skipped"];

  if (metadata.dependsOn.length > 0) {
    const satisfiedDependencies = metadata.dependsOn.filter(
      (dependencyNumber) => state.issues[String(dependencyNumber)]?.state === "done",
    );

    if (satisfiedDependencies.length > 0) {
      reasons.push(`depends_on_satisfied:${satisfiedDependencies.join("|")}`);
    }
  }

  if (
    metadata.parentIssueNumber !== null &&
    metadata.executionOrderIndex !== null &&
    metadata.executionOrderIndex > 1
  ) {
    const clearedPredecessors = issues
      .filter((candidate) => candidate.number !== issue.number)
      .map((candidate) => ({
        issue: candidate,
        metadata: parseIssueMetadata(candidate),
      }))
      .filter(
        ({ metadata: candidateMetadata }) =>
          candidateMetadata.parentIssueNumber === metadata.parentIssueNumber &&
          candidateMetadata.executionOrderIndex !== null &&
          candidateMetadata.executionOrderIndex < metadata.executionOrderIndex!,
      )
      .sort(
        (left, right) =>
          (left.metadata.executionOrderIndex ?? Number.MAX_SAFE_INTEGER) -
          (right.metadata.executionOrderIndex ?? Number.MAX_SAFE_INTEGER),
      )
      .map(({ issue: predecessorIssue }) => predecessorIssue.number)
      .filter((predecessorNumber) => state.issues[String(predecessorNumber)]?.state === "done");

    if (clearedPredecessors.length > 0) {
      reasons.push(`execution_order_satisfied:${clearedPredecessors.join("|")}`);
    }
  }

  return reasons.join("+");
}
