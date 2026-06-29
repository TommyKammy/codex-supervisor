import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";
import {
  hasProcessedReviewThread,
  latestReviewThreadCommentFingerprint,
  localReviewBlocksMerge,
  processedReviewThreadFingerprintKey,
  processedReviewThreadKey,
  reviewLoopRetryBudgetExhaustedForThread,
} from "../review-handling";
import {
  clusterConfiguredBotReviewThreads,
} from "../codex-connector-review-churn";
import {
  codexConnectorMustFixReviewThreads,
  commitShasEqualForComparison,
  evaluateCodexConnectorConvergencePolicy,
  latestCodexConnectorReviewCommentNode,
  latestCodexConnectorReviewCommentFingerprint,
  latestCodexConnectorPSeverity,
  latestCodexConnectorReviewComment,
} from "../codex-connector-review-policy";
import {
  configuredBotReviewFollowUpState,
  configuredBotReviewThreads,
  latestReviewComment,
  latestReviewCommentAuthorIsAllowedBot,
  manualReviewThreads,
  nonActionableConfiguredBotReviewThreads,
  pendingBotReviewThreads,
} from "../review-thread-reporting";
import { configuredReviewProviderKinds } from "../core/review-providers";
import {
  currentHeadCodexRepairProofRejectionReasons,
  hasFreshCurrentHeadCodexSuccessReviewedCommit,
  projectCurrentHeadCodexRepairProof,
} from "../current-head-codex-repair-proof";
import { currentHeadPassingNonReviewChecks } from "../local-ci-policy";
import {
  buildCodexConnectorStillValidReviewRepairTargets,
  type CodexConnectorValidReviewRepairTarget,
} from "../codex-connector-valid-review-repair";
import {
  STALE_REVIEW_BOT_MANUAL_NEXT_STEP,
  VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY,
  VERIFIED_CURRENT_HEAD_REPAIR_MANUAL_NEXT_STEP,
  VERIFIED_NO_SOURCE_CHANGE_MANUAL_NEXT_STEP,
  classifyStaleReviewBotAutoRepairSuppressionPolicy,
  classifyStaleReviewBotRemediationPolicy,
  type StaleReviewBotAutoRepairSuppressedReason,
  type StaleReviewBotClassificationPolicyDecision,
} from "./stale-review-bot-classification-policy";

export {
  hasCurrentHeadVerifiedRepairResidueArtifact,
  VERIFIED_CURRENT_HEAD_REPAIR_REVIEW_THREAD_RESIDUE_TARGET,
} from "../current-head-codex-repair-proof";

export interface StaleReviewBotRemediationDto {
  issueNumber: number;
  prNumber: number | null;
  reasonCode: "stale_review_bot";
  currentHeadSha: string;
  processedOnCurrentHead: "yes" | "no" | "unknown";
  codeCiState: "green" | "not_green" | "unknown";
  classification:
    | "actionable_current_diff"
    | "metadata_only"
    | "metadata_only_missing_current_head_review"
    | "metadata_only_current_head_converged"
    | "verified_no_source_change_pending_thread_resolution"
    | "verified_current_head_repair_pending_thread_resolution"
    | "unresolved_work"
    | "unknown_needs_operator";
  codexCurrentHeadReviewState: "observed" | "requested" | "missing" | "not_applicable";
  reviewThreadUrl: string | null;
  verificationEvidenceSummary: string | null;
  missingProbeReason: string | null;
  manualNextStep: string;
  summary: string;
}

export interface StaleReviewBotThreadDiagnosticsDto {
  issueNumber: number;
  prNumber: number | null;
  currentHeadSuccess: "yes" | "no" | "unknown";
  unresolvedCurrentThreads: number;
  actionableMustFixThreads: number;
  verifiedStaleResidueThreads: number;
  missingVerificationEvidenceThreads: number;
  repeatStopExhausted: "yes" | "no";
  autoRepairSuppressedReason: StaleReviewBotAutoRepairSuppressedReason;
  currentHeadRepairProofRejectionReasons?: string[];
  validRepairTargets?: CodexConnectorValidReviewRepairTarget[];
}

type RepositoryFileContents = Record<string, string | null | undefined>;

export function formatStaleReviewBotTokenValue(value: string): string {
  return value.replace(/\r?\n/gu, "\\n");
}

function processedOnCurrentHead(record: Pick<IssueRunRecord, "last_failure_context">): "yes" | "no" | "unknown" {
  let sawYes = false;
  let sawNo = false;

  for (const detail of record.last_failure_context?.details ?? []) {
    const match = detail.match(/\bprocessed_on_current_head=(yes|no)\b/u);
    if (match?.[1] === "yes") {
      sawYes = true;
    } else if (match?.[1] === "no") {
      sawNo = true;
    }
  }

  if (sawYes && sawNo) {
    return "unknown";
  }
  if (sawYes) {
    return "yes";
  }
  if (sawNo) {
    return "no";
  }
  return "unknown";
}

function codeCiState(
  pr: Pick<GitHubPullRequest, "currentHeadCiGreenAt"> | null,
  checks: Pick<PullRequestCheck, "bucket">[],
): StaleReviewBotRemediationDto["codeCiState"] {
  if (checks.some((check) => check.bucket === "fail" || check.bucket === "pending" || check.bucket === "cancel")) {
    return "not_green";
  }

  if (checks.length > 0 && checks.every((check) => check.bucket === "pass" || check.bucket === "skipping")) {
    return "green";
  }

  return pr?.currentHeadCiGreenAt ? "green" : "unknown";
}

function allChecksPassing(checks: Pick<PullRequestCheck, "bucket">[]): boolean {
  return checks.length > 0 && checks.every((check) => check.bucket === "pass" || check.bucket === "skipping");
}

function hasFailingChecks(checks: Pick<PullRequestCheck, "bucket">[]): boolean {
  return checks.some((check) => check.bucket === "fail");
}

function hasPendingChecks(checks: Pick<PullRequestCheck, "bucket">[]): boolean {
  return checks.some((check) => check.bucket === "pending" || check.bucket === "cancel");
}

function hasCleanMergeState(pr: GitHubPullRequest): boolean {
  return pr.state === "OPEN" && !pr.isDraft && pr.mergeStateStatus === "CLEAN" && pr.mergeable === "MERGEABLE";
}

function hasMergeConflictState(pr: GitHubPullRequest): boolean {
  return pr.state !== "OPEN" || pr.isDraft || pr.mergeStateStatus === "DIRTY" || pr.mergeable === "CONFLICTING";
}

function currentHeadSuccess(pr: GitHubPullRequest | null): StaleReviewBotThreadDiagnosticsDto["currentHeadSuccess"] {
  if (!pr) {
    return "unknown";
  }
  return hasCurrentHeadSuccessSignal(pr) ? "yes" : "no";
}

export function isProvenStaleReviewMetadataClassification(
  classification: StaleReviewBotRemediationDto["classification"],
): boolean {
  return (
    classification === "metadata_only" ||
    classification === "metadata_only_current_head_converged" ||
    classification === "verified_no_source_change_pending_thread_resolution" ||
    classification === "verified_current_head_repair_pending_thread_resolution"
  );
}

export function isVerifiedStaleResidueClassification(
  classification: StaleReviewBotRemediationDto["classification"],
): boolean {
  return (
    classification === "verified_no_source_change_pending_thread_resolution" ||
    classification === "verified_current_head_repair_pending_thread_resolution"
  );
}

function verifiedAutoResolveEnabled(
  config: SupervisorConfig,
  classification: StaleReviewBotRemediationDto["classification"],
): boolean {
  return (
    (classification === "verified_no_source_change_pending_thread_resolution" &&
      config.verifiedNoSourceChangeReviewThreadAutoResolve === true) ||
    (classification === "verified_current_head_repair_pending_thread_resolution" &&
      config.verifiedCurrentHeadRepairReviewThreadAutoResolve === true)
  );
}

function classifyAutoRepairSuppression(args: {
  config: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  remediation: StaleReviewBotRemediationDto;
  actionableMustFixThreads: ReviewThread[];
  repeatStopExhausted: boolean;
}): StaleReviewBotAutoRepairSuppressedReason {
  const { config, pr, checks, remediation } = args;
  return classifyStaleReviewBotAutoRepairSuppressionPolicy({
    hasConfigAndPr: Boolean(config && pr),
    repeatStopExhausted: args.repeatStopExhausted,
    manualOrUnconfiguredReviewThreads: Boolean(
      config &&
        (manualReviewThreads(config, args.reviewThreads).length > 0 ||
          nonActionableConfiguredBotReviewThreads(config, args.reviewThreads).length > 0),
    ),
    mergeConflictState: Boolean(pr && hasMergeConflictState(pr)),
    failingChecks: hasFailingChecks(checks),
    pendingChecks: hasPendingChecks(checks),
    missingProbeReason: remediation.missingProbeReason,
    verifiedStaleResidue: isVerifiedStaleResidueClassification(remediation.classification),
    actionableClusterCount: clusterConfiguredBotReviewThreads(args.actionableMustFixThreads).length,
    verifiedAutoResolveEnabled: Boolean(config && verifiedAutoResolveEnabled(config, remediation.classification)),
  });
}

function codexConnectorCurrentHeadReviewState(args: {
  config: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  reviewThreads: ReviewThread[];
}): "observed" | "requested" | "missing" | "not_applicable" {
  if (!args.config || !configuredReviewProviderKinds(args.config).includes("codex")) {
    return "not_applicable";
  }

  if (hasFreshCurrentHeadCodexSuccessReviewedCommit(args.pr, args.reviewThreads)) {
    return "observed";
  }

  if (
    args.pr.configuredBotCurrentHeadObservationSource === "codex_pr_success_comment" &&
    args.pr.configuredBotCurrentHeadObservedAt
  ) {
    return "observed";
  }

  const recordRequestedSha = args.record.codex_connector_review_requested_head_sha;
  const prRequestedSha = args.pr.codexConnectorReviewRequestedHeadSha;
  if (
    (args.record.codex_connector_review_requested_observed_at || args.pr.codexConnectorReviewRequestedAt) &&
    (recordRequestedSha ?? prRequestedSha) === args.pr.headRefOid
  ) {
    return "requested";
  }

  return "missing";
}

function currentHeadVerificationEvidenceSummary(
  config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">,
  record: Pick<IssueRunRecord, "latest_local_ci_result" | "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  checks: Pick<PullRequestCheck, "bucket" | "name" | "workflow">[],
  allowCheckEvidence: boolean,
): string | null {
  const latestLocalCi = record.latest_local_ci_result;
  if (latestLocalCi?.outcome === "passed" && latestLocalCi.head_sha === pr.headRefOid) {
    return latestLocalCi.summary || latestLocalCi.command || "current_head_local_ci_passed";
  }

  const timelineEvidence = (record.timeline_artifacts ?? []).find(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.gate === "codex_turn" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === pr.headRefOid,
  );
  if (timelineEvidence) {
    return timelineEvidence.summary || timelineEvidence.command || "current_head_verification_passed";
  }

  const nonReviewChecks = currentHeadPassingNonReviewChecks(config, checks);
  if (allowCheckEvidence && nonReviewChecks.length > 0) {
    const checkNames = nonReviewChecks
      .map((check) => check.name?.trim())
      .filter((name): name is string => Boolean(name))
      .slice(0, 3)
      .join(",");
    return checkNames ? `current_head_checks_passed:${checkNames}` : "current_head_checks_passed";
  }

  return null;
}

function hasCurrentHeadCodexTurnVerification(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): boolean {
  return (record.timeline_artifacts ?? []).some(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.gate === "codex_turn" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === pr.headRefOid &&
      !artifact.repair_targets?.includes("verified_no_source_change_review_thread_residue"),
  );
}

function hasCurrentHeadLocalCiVerification(
  record: Pick<IssueRunRecord, "latest_local_ci_result">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): boolean {
  return record.latest_local_ci_result?.outcome === "passed" && record.latest_local_ci_result.head_sha === pr.headRefOid;
}

export function currentHeadVerifiedRepairResidueArtifactEvidenceSummary(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}): string | null {
  const proof = projectCurrentHeadCodexRepairProof(args);
  if (!proof) {
    return null;
  }
  if (proof.localVerificationEvidenceSource === "scoped_repair_timeline_artifact_with_non_review_checks") {
    return `${proof.summary};local_verification=${proof.localVerificationEvidenceSummary}`;
  }
  return proof.summary;
}

function hasCurrentHeadNoSourceChangeCodexTurnVerification(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
  reviewThreads: ReviewThread[],
): boolean {
  return (record.timeline_artifacts ?? []).some(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.gate === "codex_turn" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === pr.headRefOid &&
      artifact.repair_targets?.includes("verified_no_source_change_review_thread_residue") === true &&
      noSourceChangeArtifactCoversReviewThreads(artifact, pr, reviewThreads),
  );
}

function hasCurrentHeadMarkedNoSourceChangeCodexTurnVerification(
  record: Pick<IssueRunRecord, "timeline_artifacts">,
  pr: Pick<GitHubPullRequest, "headRefOid">,
): boolean {
  return (record.timeline_artifacts ?? []).some(
    (artifact) =>
      artifact.type === "verification_result" &&
      artifact.gate === "codex_turn" &&
      artifact.outcome === "passed" &&
      artifact.head_sha === pr.headRefOid &&
      artifact.repair_targets?.includes("verified_no_source_change_review_thread_residue") === true,
  );
}

function allCodexConnectorRepairResidueThreadsAreP2(reviewThreads: ReviewThread[]): boolean {
  return reviewThreads.length > 0 && reviewThreads.every((thread) => latestCodexConnectorPSeverity(thread) === "P2");
}

function noSourceChangeArtifactCoversReviewThreads(
  artifact: NonNullable<IssueRunRecord["timeline_artifacts"]>[number],
  pr: Pick<GitHubPullRequest, "headRefOid">,
  reviewThreads: ReviewThread[],
): boolean {
  if (reviewThreads.length === 0) {
    return false;
  }
  const processedThreadIds = artifact.processed_review_thread_ids ?? [];
  const processedThreadFingerprints = artifact.processed_review_thread_fingerprints ?? [];
  if (processedThreadIds.length === 0 && processedThreadFingerprints.length === 0) {
    return false;
  }
  return reviewThreads.every((thread) => {
    const latestFingerprint = latestReviewThreadCommentFingerprint(thread);
    if (latestFingerprint) {
      return processedThreadFingerprints.includes(
        processedReviewThreadFingerprintKey(thread.id, pr.headRefOid, latestFingerprint),
      );
    }
    return processedThreadIds.includes(processedReviewThreadKey(thread.id, pr.headRefOid));
  });
}

function normalizeRepositoryPath(value: string): string {
  return value.trim().replace(/^\.\/+/u, "").replace(/\\/gu, "/");
}

function repositoryFileContent(
  contents: RepositoryFileContents | undefined,
  path: string | null | undefined,
): string | null {
  if (!contents || !path) {
    return null;
  }
  const normalizedPath = normalizeRepositoryPath(path);
  return contents[normalizedPath] ?? contents[path] ?? null;
}

function extractConcreteRepoPaths(body: string): string[] {
  const paths = new Set<string>();
  const pathPattern =
    /(?:`([^`\r\n]+\.(?:tsx|jsx|mdx|ya?ml|toml|json|scss|html|conf|txt|ts|js|md|py|rb|go|rs|java|kt|cs|php|sh|sql|ini|cfg|csv|tsv|css))(?![\w.-])`)|((?:[\w.-]+\/)+[\w.-]+\.(?:tsx|jsx|mdx|ya?ml|toml|json|scss|html|conf|txt|ts|js|md|py|rb|go|rs|java|kt|cs|php|sh|sql|ini|cfg|csv|tsv|css))(?![\w.-])/giu;
  for (const match of body.matchAll(pathPattern)) {
    const path = normalizeRepositoryPath(match[1] ?? match[2] ?? "");
    if (path && !path.startsWith("/") && !/^[a-z]:\//iu.test(path) && path.includes("/")) {
      paths.add(path);
    }
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function hasAdditivePathListRepairIntent(body: string): boolean {
  if (
    /\b(?:remove|delete|drop|exclude|avoid|deduplicat(?:e|ed|es|ing|ion)|de-duplicat(?:e|ed|es|ing|ion))\b/iu.test(
      body,
    )
  ) {
    return false;
  }

  return (
    /\b(?:add|include|insert|append|restore|register|wire)\b/iu.test(body) &&
    /\b(?:path|paths|list|lists|array|arrays|loader|loaders|scan|scans|coverage|expectation|expectations)\b/iu.test(body)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function countExactRepoPathOccurrences(haystack: string, repoPath: string): number {
  const pathTokenBoundary = "[A-Za-z0-9._/-]";
  const pattern = new RegExp(`(?<!${pathTokenBoundary})${escapeRegExp(repoPath)}(?!${pathTokenBoundary})`, "gu");
  return Array.from(haystack.matchAll(pattern)).length;
}

function maskComments(source: string): string {
  let masked = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "\"" || char === "'" || char === "`") {
      const literal = readStringLiteral(source, index);
      if (!literal) {
        masked += char;
        continue;
      }
      masked += source.slice(index, literal.next);
      index = literal.next - 1;
      continue;
    }
    if (char === "/" && next === "/") {
      masked += "  ";
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        masked += " ";
        index += 1;
      }
      if (source[index] === "\n") {
        masked += "\n";
      }
      continue;
    }
    if (char === "/" && next === "*") {
      masked += "  ";
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        masked += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (index < source.length) {
        masked += "  ";
        index += 1;
      }
      continue;
    }
    masked += char;
  }
  return masked;
}

function readStringLiteral(source: string, start: number): { value: string; next: number } | null {
  const quote = source[start];
  if (quote !== "\"" && quote !== "'" && quote !== "`") {
    return null;
  }

  let value = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      const escaped = source[index + 1];
      if (escaped !== undefined) {
        value += escaped;
        index += 1;
      }
      continue;
    }
    if (char === quote) {
      return { value, next: index + 1 };
    }
    value += char;
  }

  return null;
}

function matchingArrayEnd(source: string, start: number): number | null {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\"" || char === "'" || char === "`") {
      const literal = readStringLiteral(source, index);
      if (!literal) {
        return null;
      }
      index = literal.next - 1;
      continue;
    }
    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return null;
}

function directStringValuesInArray(source: string, start: number, end: number): Set<string> {
  const values = new Set<string>();
  let nestingDepth = 0;
  for (let index = start + 1; index < end; index += 1) {
    const char = source[index];
    if (char === "\"" || char === "'" || char === "`") {
      const literal = readStringLiteral(source, index);
      if (!literal) {
        return values;
      }
      if (nestingDepth === 0) {
        values.add(literal.value);
      }
      index = literal.next - 1;
      continue;
    }
    if (char === "[" || char === "{" || char === "(") {
      nestingDepth += 1;
    } else if ((char === "]" || char === "}" || char === ")") && nestingDepth > 0) {
      nestingDepth -= 1;
    }
  }
  return values;
}

interface RequestedPathListSelector {
  label: string;
  requiredTokens: string[];
  allowExpectationTokens: boolean;
}

function requestedPathListSelectors(body: string): RequestedPathListSelector[] {
  const selectors: RequestedPathListSelector[] = [];
  const normalizedBody = body.toLowerCase();
  const addSelector = (selector: RequestedPathListSelector) => {
    if (!selectors.some((candidate) => candidate.label === selector.label)) {
      selectors.push(selector);
    }
  };

  if (/\bload(?:er|ers|ing)?\b/iu.test(body)) {
    addSelector({ label: "loader", requiredTokens: ["loader"], allowExpectationTokens: false });
  }
  if (/\bpolicy\s+scans?\b/iu.test(body)) {
    addSelector({ label: "policy_scan", requiredTokens: ["policy", "scan"], allowExpectationTokens: false });
  } else if (/\bscans?\b/iu.test(body)) {
    addSelector({ label: "scan", requiredTokens: ["scan"], allowExpectationTokens: false });
  }
  if (/\bcoverage\b/iu.test(body) && /\bexpect(?:ation|ations|ed)?\b/iu.test(body)) {
    addSelector({
      label: "coverage_expectation",
      requiredTokens: ["coverage", "expect"],
      allowExpectationTokens: true,
    });
  }

  return normalizedBody.includes("list") || normalizedBody.includes("array") ? selectors : [];
}

function identifierTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .map((token) => token.toLowerCase())
    .filter(Boolean)
    .map((token) => {
      const singular = token.replace(/s$/u, "");
      return singular.startsWith("expect") ? "expect" : singular;
    });
}

function arrayIdentifierContextTokens(source: string, arrayStart: number): string[] {
  const prefix = source.slice(Math.max(0, arrayStart - 160), arrayStart);
  const candidates = [
    ...prefix.matchAll(/\b([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)?)\s*(?::\s*[^=:\r\n]+)?=\s*$/gu),
    ...prefix.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*$/gu),
  ];
  const context = candidates[candidates.length - 1]?.[1] ?? "";
  return identifierTokens(context);
}

function arrayMatchesRequestedSelector(tokens: string[], selector: RequestedPathListSelector): boolean {
  if (tokens.length === 0 || !selector.requiredTokens.every((token) => tokens.includes(token))) {
    return false;
  }

  if (tokens.some((token) => (
    token === "disable" ||
    token === "disabled" ||
    token === "exclude" ||
    token === "excluded" ||
    token === "exclusion" ||
    token === "ignore" ||
    token === "ignored" ||
    token === "omit" ||
    token === "omitted" ||
    token === "skip" ||
    token === "skipped"
  ))) {
    return false;
  }

  if (!selector.allowExpectationTokens && tokens.some((token) => (
    token === "expect" ||
    token === "expected" ||
    token === "expectation" ||
    token === "fixture" ||
    token === "mock" ||
    token === "sample" ||
    token === "test"
  ))) {
    return false;
  }

  return true;
}

function requestedLiveRepoPathArrayMemberships(
  source: string,
  repoPath: string,
  selectors: RequestedPathListSelector[],
): string[] | null {
  if (countExactRepoPathOccurrences(source, repoPath) === 0) {
    return null;
  }
  if (selectors.length === 0) {
    return null;
  }

  const uncommentedSource = maskComments(source);
  const matchedSelectors = new Set<string>();
  for (let index = 0; index < uncommentedSource.length; index += 1) {
    const char = uncommentedSource[index];
    if (char === "\"" || char === "'" || char === "`") {
      const literal = readStringLiteral(uncommentedSource, index);
      if (!literal) {
        continue;
      }
      index = literal.next - 1;
      continue;
    }
    if (char !== "[") {
      continue;
    }

    const end = matchingArrayEnd(uncommentedSource, index);
    if (end === null) {
      continue;
    }
    if (!directStringValuesInArray(uncommentedSource, index, end).has(repoPath)) {
      index = end;
      continue;
    }

    const contextTokens = arrayIdentifierContextTokens(uncommentedSource, index);
    for (const selector of selectors) {
      if (arrayMatchesRequestedSelector(contextTokens, selector)) {
        matchedSelectors.add(selector.label);
      }
    }
    index = end;
  }

  return selectors.every((selector) => matchedSelectors.has(selector.label))
    ? selectors.map((selector) => selector.label)
    : null;
}

function deterministicRepairProbeEvidence(args: {
  reviewThreads: ReviewThread[];
  repositoryFileContents?: RepositoryFileContents;
}): string | null {
  const mustFixThreads = codexConnectorMustFixReviewThreads(args.reviewThreads);
  if (!allCodexConnectorRepairResidueThreadsAreP2(mustFixThreads)) {
    return null;
  }

  const evidence: string[] = [];
  for (const thread of mustFixThreads) {
    const source = repositoryFileContent(args.repositoryFileContents, thread.path);
    if (!source) {
      return null;
    }

    const codexFindingBody = latestCodexConnectorReviewComment(thread)?.body ?? "";
    if (!hasAdditivePathListRepairIntent(codexFindingBody)) {
      return null;
    }
    const requestedPathLists = requestedPathListSelectors(codexFindingBody);
    if (requestedPathLists.length === 0) {
      return null;
    }
    const concretePaths = extractConcreteRepoPaths(codexFindingBody);
    if (concretePaths.length === 0) {
      return null;
    }
    const pathEvidence: string[] = [];
    for (const concretePath of concretePaths) {
      const liveListMemberships = requestedLiveRepoPathArrayMemberships(source, concretePath, requestedPathLists);
      if (!liveListMemberships) {
        return null;
      }
      pathEvidence.push(
        `deterministic_repair_probe:path_present_in_requested_live_lists:${concretePath}:${liveListMemberships.join(",")}`,
      );
    }
    evidence.push(...pathEvidence);
  }

  return evidence.length > 0 ? evidence.join(";") : null;
}

function requiresDeterministicRepairProbeEvidence(reviewThreads: ReviewThread[]): boolean {
  return codexConnectorMustFixReviewThreads(reviewThreads).some((thread) => {
    const codexFindingBody = latestCodexConnectorReviewComment(thread)?.body ?? "";
    return (
      requestedPathListSelectors(codexFindingBody).length > 0 &&
      extractConcreteRepoPaths(codexFindingBody).length > 0
    );
  });
}

function validTimestamp(value: string | null | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return value;
}

function hasCurrentHeadSuccessSignal(
  pr: Pick<
    GitHubPullRequest,
    | "configuredBotCurrentHeadObservedAt"
    | "configuredBotCurrentHeadObservationSource"
    | "configuredBotCurrentHeadStatusState"
  >,
): boolean {
  if (pr.configuredBotCurrentHeadStatusState === "SUCCESS" && validTimestamp(pr.configuredBotCurrentHeadObservedAt)) {
    return true;
  }

  return Boolean(
    pr.configuredBotCurrentHeadObservationSource === "codex_pr_success_comment" &&
      validTimestamp(pr.configuredBotCurrentHeadObservedAt),
  );
}

function currentHeadCodexNoMajorSignalEvidence(args: {
  record: Pick<
    IssueRunRecord,
    "codex_connector_review_requested_observed_at" | "codex_connector_review_requested_head_sha"
  >;
  pr: Pick<
    GitHubPullRequest,
    | "headRefOid"
    | "codexConnectorReviewRequestedAt"
    | "codexConnectorReviewRequestedHeadSha"
    | "configuredBotCurrentHeadObservedAt"
    | "configuredBotCurrentHeadObservationSource"
    | "configuredBotCurrentHeadStatusState"
    | "configuredBotCurrentHeadActionableObservedAt"
    | "configuredBotCurrentHeadCodexSuccessReviewedCommitSha"
    | "configuredBotCurrentHeadCodexSuccessObservedAt"
  >;
  reviewThreads: ReviewThread[];
  currentConfiguredThreads: ReviewThread[];
}): string | null {
  if (
    hasFreshCurrentHeadCodexSuccessReviewedCurrentConfiguredFindings({
      pr: args.pr,
      reviewThreads: args.reviewThreads,
      currentConfiguredThreads: args.currentConfiguredThreads,
    })
  ) {
    return "codex_pr_success_comment_reviewed_current_head";
  }
  if (!hasCurrentHeadSuccessSignal(args.pr)) {
    return null;
  }

  const observedAt = validTimestamp(args.pr.configuredBotCurrentHeadObservedAt);
  if (!observedAt) {
    return null;
  }
  if (args.pr.configuredBotCurrentHeadObservationSource !== "codex_pr_success_comment") {
    return null;
  }

  const requestedAt =
    validTimestamp(args.record.codex_connector_review_requested_observed_at) ??
    validTimestamp(args.pr.codexConnectorReviewRequestedAt);
  const requestedHeadSha =
    args.record.codex_connector_review_requested_head_sha ?? args.pr.codexConnectorReviewRequestedHeadSha;
  if (!requestedAt || !commitShasEqualForComparison(requestedHeadSha, args.pr.headRefOid)) {
    return null;
  }

  if (Date.parse(observedAt) < Date.parse(requestedAt)) {
    return null;
  }

  return "codex_pr_success_comment_after_current_head_request";
}

function hasLocalOrPreMergeBlockers(
  config: SupervisorConfig,
  record: Pick<
    IssueRunRecord,
    | "local_review_head_sha"
    | "local_review_recommendation"
    | "local_review_degraded"
    | "local_review_findings_count"
    | "pre_merge_evaluation_outcome"
    | "pre_merge_must_fix_count"
    | "pre_merge_manual_review_count"
    | "pre_merge_follow_up_count"
  >,
  pr: GitHubPullRequest,
): boolean {
  const explicitPreMergeBlocker =
    record.pre_merge_evaluation_outcome === "fix_blocked" ||
    record.pre_merge_evaluation_outcome === "manual_review_blocked" ||
    record.pre_merge_evaluation_outcome === "follow_up_eligible";
  return Boolean(
    localReviewBlocksMerge(config, record, pr) ||
    record.local_review_degraded ||
      record.local_review_findings_count > 0 ||
      (record.pre_merge_must_fix_count ?? 0) > 0 ||
      (record.pre_merge_manual_review_count ?? 0) > 0 ||
      (record.pre_merge_follow_up_count ?? 0) > 0 ||
      explicitPreMergeBlocker,
  );
}

function latestCommentIsConfiguredCodexFinding(config: SupervisorConfig, thread: ReviewThread): boolean {
  if (!latestReviewCommentAuthorIsAllowedBot(config, thread)) {
    return false;
  }
  const latestComment = latestReviewComment(thread);
  const latestCodexFindingComment = latestCodexConnectorReviewCommentNode(thread);
  return Boolean(
    latestComment &&
      latestCodexFindingComment &&
      latestComment.id === latestCodexFindingComment.id,
  );
}

function latestCurrentConfiguredCodexFindingObservedAt(reviewThreads: ReviewThread[]): string | null {
  return reviewThreads.reduce<string | null>((latestObservedAt, thread) => {
    const observedAt = validTimestamp(latestCodexConnectorReviewCommentNode(thread)?.createdAt);
    if (!observedAt) {
      return latestObservedAt;
    }
    if (!latestObservedAt || Date.parse(observedAt) > Date.parse(latestObservedAt)) {
      return observedAt;
    }
    return latestObservedAt;
  }, null);
}

function hasFreshCurrentHeadCodexSuccessReviewedCurrentConfiguredFindings(args: {
  pr: Parameters<typeof hasFreshCurrentHeadCodexSuccessReviewedCommit>[0];
  reviewThreads: ReviewThread[];
  currentConfiguredThreads: ReviewThread[];
}): boolean {
  if (!hasFreshCurrentHeadCodexSuccessReviewedCommit(args.pr, args.reviewThreads)) {
    return false;
  }
  const successObservedAt = validTimestamp(args.pr.configuredBotCurrentHeadCodexSuccessObservedAt);
  const latestCurrentFindingObservedAt = latestCurrentConfiguredCodexFindingObservedAt(args.currentConfiguredThreads);
  return Boolean(
    successObservedAt &&
      (!latestCurrentFindingObservedAt || Date.parse(successObservedAt) >= Date.parse(latestCurrentFindingObservedAt)),
  );
}

function currentHeadCodexCleanCommentResidueEvidence(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  reviewThreads: ReviewThread[];
  currentConfiguredThreads: ReviewThread[];
  mustFixReviewThreads: ReviewThread[];
}): string | null {
  const providerKinds = configuredReviewProviderKinds(args.config);
  if (providerKinds.length === 0 || providerKinds.some((kind) => kind !== "codex")) {
    return null;
  }
  if (args.mustFixReviewThreads.length === 0 || args.currentConfiguredThreads.length === 0) {
    return null;
  }
  if (args.pr.configuredBotTopLevelReviewStrength === "blocking") {
    return null;
  }
  if (!hasCleanMergeState(args.pr)) {
    return null;
  }
  if (hasLocalOrPreMergeBlockers(args.config, args.record, args.pr)) {
    return null;
  }
  if (
    !hasFreshCurrentHeadCodexSuccessReviewedCurrentConfiguredFindings({
      pr: args.pr,
      reviewThreads: args.reviewThreads,
      currentConfiguredThreads: args.currentConfiguredThreads,
    })
  ) {
    return null;
  }
  if (
    args.currentConfiguredThreads.some(
      (thread) =>
        thread.isResolved ||
        thread.isOutdated ||
        !latestCommentIsConfiguredCodexFinding(args.config, thread),
    )
  ) {
    return null;
  }
  if (args.mustFixReviewThreads.some((thread) => latestCodexConnectorPSeverity(thread) === "P0")) {
    return null;
  }

  return [
    "codex_current_head_clean_comment",
    `reviewed_commit=${args.pr.configuredBotCurrentHeadCodexSuccessReviewedCommitSha ?? "unknown"}`,
    `observed_at=${args.pr.configuredBotCurrentHeadCodexSuccessObservedAt ?? "unknown"}`,
    `discounted_threads=${args.mustFixReviewThreads.length}`,
  ].join(":");
}

function classifyCodexMetadataOnly(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  repositoryFileContents?: RepositoryFileContents;
}): StaleReviewBotClassificationPolicyDecision {
  const configuredThreads = configuredBotReviewThreads(args.config, args.reviewThreads);
  const currentConfiguredThreads = configuredThreads.filter((thread) => !thread.isOutdated);
  const policy = evaluateCodexConnectorConvergencePolicy(args.config, args.pr, args.reviewThreads);
  const mustFixReviewThreads = codexConnectorMustFixReviewThreads(args.reviewThreads);
  const currentHeadCleanCommentResidueEvidence = currentHeadCodexCleanCommentResidueEvidence({
    config: args.config,
    record: args.record,
    pr: args.pr,
    reviewThreads: args.reviewThreads,
    currentConfiguredThreads,
    mustFixReviewThreads,
  });
  const hasMarkedNoSourceChangeRepair = hasCurrentHeadMarkedNoSourceChangeCodexTurnVerification(
    args.record,
    args.pr,
  );
  const hasCurrentHeadCodexTurnRepairVerification = hasCurrentHeadCodexTurnVerification(args.record, args.pr);
  const checkEvidenceCanProveRepair = args.record.repair_attempt_count > 0;
  const verificationEvidenceSummary = currentHeadVerificationEvidenceSummary(
    args.config,
    args.record,
    args.pr,
    args.checks,
    checkEvidenceCanProveRepair,
  );
  const verifiedRepairArtifactEvidenceSummary =
    currentHeadVerifiedRepairResidueArtifactEvidenceSummary(args);
  if (verifiedRepairArtifactEvidenceSummary) {
    return {
      classification: "verified_current_head_repair_pending_thread_resolution",
      summary: VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY,
      verificationEvidenceSummary: verifiedRepairArtifactEvidenceSummary,
    };
  }

  return classifyStaleReviewBotRemediationPolicy({
    provider: "codex",
    configuredThreadCount: configuredThreads.length,
    currentConfiguredThreadCount: currentConfiguredThreads.length,
    manualThreadCount: manualReviewThreads(args.config, args.reviewThreads).length,
    sameHead: args.record.last_head_sha === args.pr.headRefOid,
    allChecksPassing: allChecksPassing(args.checks),
    cleanMergeState: hasCleanMergeState(args.pr),
    mergeConflictState: hasMergeConflictState(args.pr),
    pendingBotThreadCount: pendingBotReviewThreads(args.config, args.record, args.pr, currentConfiguredThreads).length,
    followUpState: configuredBotReviewFollowUpState(args.config, args.record, args.pr, currentConfiguredThreads),
    allCurrentConfiguredThreadsProcessed: currentConfiguredThreads.every((thread) =>
      hasProcessedReviewThread(args.record, args.pr, thread),
    ),
    convergenceOutcome: policy?.outcome ?? null,
    hasUnprocessedMustFix: mustFixReviewThreads.some((thread) => !hasProcessedReviewThread(args.record, args.pr, thread)),
    verificationEvidenceSummary,
    noMajorSignalEvidence: currentHeadCodexNoMajorSignalEvidence({
      record: args.record,
      pr: args.pr,
      reviewThreads: args.reviewThreads,
      currentConfiguredThreads,
    }),
    currentHeadCleanCommentResidueEvidence,
    deterministicProbeEvidence: deterministicRepairProbeEvidence({
      reviewThreads: args.reviewThreads,
      repositoryFileContents: args.repositoryFileContents,
    }),
    hasMarkedNoSourceChangeRepair,
    verifiedNoSourceChangeRepair: hasCurrentHeadNoSourceChangeCodexTurnVerification(
      args.record,
      args.pr,
      mustFixReviewThreads,
    ),
    hasExplicitCurrentHeadRepairVerification: hasCurrentHeadCodexTurnRepairVerification,
    hasCurrentHeadRepairCheckVerification:
      !hasMarkedNoSourceChangeRepair && hasCurrentHeadLocalCiVerification(args.record, args.pr),
    repairAttemptCount: args.record.repair_attempt_count,
    allMustFixRepairResidueThreadsAreP2: allCodexConnectorRepairResidueThreadsAreP2(mustFixReviewThreads),
    requiresDeterministicRepairProbeEvidence: requiresDeterministicRepairProbeEvidence(args.reviewThreads),
    currentHeadSuccess: hasCurrentHeadSuccessSignal(args.pr),
  });
}

function classifyRemediation(args: {
  config: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  repositoryFileContents?: RepositoryFileContents;
}): StaleReviewBotClassificationPolicyDecision {
  if (!args.config || !args.pr) {
    return classifyStaleReviewBotRemediationPolicy({
      provider: "configured_bot",
      configuredThreadCount: 0,
      currentConfiguredThreadCount: 0,
      manualThreadCount: 0,
      sameHead: false,
      allChecksPassing: false,
      cleanMergeState: false,
      mergeConflictState: false,
      pendingBotThreadCount: 0,
      followUpState: "inactive",
      allCurrentConfiguredThreadsProcessed: false,
      convergenceOutcome: null,
      hasUnprocessedMustFix: false,
      verificationEvidenceSummary: null,
      noMajorSignalEvidence: null,
      currentHeadCleanCommentResidueEvidence: null,
      deterministicProbeEvidence: null,
      hasMarkedNoSourceChangeRepair: false,
      verifiedNoSourceChangeRepair: false,
      hasExplicitCurrentHeadRepairVerification: false,
      hasCurrentHeadRepairCheckVerification: false,
      repairAttemptCount: 0,
      allMustFixRepairResidueThreadsAreP2: false,
      requiresDeterministicRepairProbeEvidence: false,
      currentHeadSuccess: false,
    });
  }

  const { config, record, pr, checks, reviewThreads } = args;
  const configuredThreads = configuredBotReviewThreads(config, reviewThreads);
  if (configuredReviewProviderKinds(config).includes("codex")) {
    return classifyCodexMetadataOnly({
      config,
      record,
      pr,
      checks,
      reviewThreads,
      repositoryFileContents: args.repositoryFileContents,
    });
  }

  return classifyStaleReviewBotRemediationPolicy({
    provider: "configured_bot",
    configuredThreadCount: configuredThreads.length,
    currentConfiguredThreadCount: configuredThreads.length,
    manualThreadCount: manualReviewThreads(config, reviewThreads).length,
    sameHead: record.last_head_sha === pr.headRefOid,
    allChecksPassing: allChecksPassing(checks),
    cleanMergeState: hasCleanMergeState(pr),
    mergeConflictState: hasMergeConflictState(pr),
    pendingBotThreadCount: pendingBotReviewThreads(config, record, pr, configuredThreads).length,
    followUpState: configuredBotReviewFollowUpState(config, record, pr, configuredThreads),
    allCurrentConfiguredThreadsProcessed: configuredThreads.every((thread) => hasProcessedReviewThread(record, pr, thread)),
    convergenceOutcome: null,
    hasUnprocessedMustFix: false,
    verificationEvidenceSummary: null,
    noMajorSignalEvidence: null,
    currentHeadCleanCommentResidueEvidence: null,
    deterministicProbeEvidence: null,
    hasMarkedNoSourceChangeRepair: false,
    verifiedNoSourceChangeRepair: false,
    hasExplicitCurrentHeadRepairVerification: false,
    hasCurrentHeadRepairCheckVerification: false,
    repairAttemptCount: record.repair_attempt_count,
    allMustFixRepairResidueThreadsAreP2: false,
    requiresDeterministicRepairProbeEvidence: false,
    currentHeadSuccess: Boolean(pr.configuredBotCurrentHeadObservedAt && pr.configuredBotCurrentHeadStatusState === "SUCCESS"),
  });
}

export function buildStaleReviewBotRemediation(args: {
  config?: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads?: ReviewThread[];
  repositoryFileContents?: RepositoryFileContents;
}): StaleReviewBotRemediationDto | null {
  const verifiedCurrentHeadRepairProof =
    args.config && args.pr
      ? projectCurrentHeadCodexRepairProof({
          config: args.config,
          record: args.record,
          pr: args.pr,
          checks: args.checks,
          reviewThreads: args.reviewThreads ?? [],
        })
      : null;
  if (
    args.record.blocked_reason !== "stale_review_bot" &&
    args.record.blocked_reason !== "manual_review" &&
    !verifiedCurrentHeadRepairProof
  ) {
    return null;
  }

  const currentHeadSha = args.pr?.headRefOid ?? args.record.last_head_sha;
  if (!currentHeadSha) {
    return null;
  }
  const classification = classifyRemediation({
      config: args.config ?? null,
      record: args.record,
      pr: args.pr,
      checks: args.checks,
      reviewThreads: args.reviewThreads ?? [],
      repositoryFileContents: args.repositoryFileContents,
    });
  if (
    args.record.blocked_reason === "manual_review" &&
    !isVerifiedStaleResidueClassification(classification.classification) &&
    !classification.missingProbeReason
  ) {
    return null;
  }
  const codexCurrentHeadReviewState = args.pr
    ? codexConnectorCurrentHeadReviewState({
      config: args.config ?? null,
      record: args.record,
      pr: args.pr,
      reviewThreads: args.reviewThreads ?? [],
    })
    : "not_applicable";

  return {
    issueNumber: args.record.issue_number,
    prNumber: args.record.pr_number,
    reasonCode: "stale_review_bot",
    currentHeadSha,
    processedOnCurrentHead: processedOnCurrentHead(args.record),
    codeCiState: codeCiState(args.pr, args.checks),
    classification: classification.classification,
    codexCurrentHeadReviewState,
    reviewThreadUrl: args.record.last_failure_context?.url ?? null,
    verificationEvidenceSummary: classification.verificationEvidenceSummary ?? null,
    missingProbeReason: classification.missingProbeReason ?? null,
    manualNextStep:
      classification.classification === "verified_current_head_repair_pending_thread_resolution"
        ? VERIFIED_CURRENT_HEAD_REPAIR_MANUAL_NEXT_STEP
        : classification.classification === "verified_no_source_change_pending_thread_resolution"
        ? VERIFIED_NO_SOURCE_CHANGE_MANUAL_NEXT_STEP
        : STALE_REVIEW_BOT_MANUAL_NEXT_STEP,
    summary: classification.summary,
  };
}

export function buildStaleReviewBotThreadDiagnostics(args: {
  config?: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads?: ReviewThread[];
  remediation?: StaleReviewBotRemediationDto | null;
  repositoryFileContents?: RepositoryFileContents;
}): StaleReviewBotThreadDiagnosticsDto | null {
  const remediation =
    args.remediation ??
    buildStaleReviewBotRemediation({
      config: args.config,
      record: args.record,
      pr: args.pr,
      checks: args.checks,
      reviewThreads: args.reviewThreads,
      repositoryFileContents: args.repositoryFileContents,
    });
  if (!remediation) {
    return null;
  }

  const config = args.config ?? null;
  const reviewThreads = args.reviewThreads ?? [];
  const configuredThreads = config ? configuredBotReviewThreads(config, reviewThreads) : [];
  const unresolvedConfiguredThreads = configuredThreads.filter((thread) => !thread.isResolved && !thread.isOutdated);
  const codexConfigured = config ? configuredReviewProviderKinds(config).includes("codex") : false;
  const actionableMustFixThreads = config && codexConfigured
    ? codexConnectorMustFixReviewThreads(reviewThreads)
    : config && args.pr
      ? pendingBotReviewThreads(config, args.record, args.pr, configuredThreads)
      : [];
  const currentHeadReviewRequestPending =
    remediation.classification === "metadata_only_missing_current_head_review" &&
    remediation.codexCurrentHeadReviewState === "missing";
  const isVerifiedResidue = isVerifiedStaleResidueClassification(remediation.classification);
  const reviewLoopRetryExhausted =
    config && args.pr && actionableMustFixThreads.length > 0
      ? actionableMustFixThreads.every((thread) =>
          reviewLoopRetryBudgetExhaustedForThread(
            args.record,
            args.pr!,
            thread,
            1,
            codexConfigured ? latestCodexConnectorReviewCommentFingerprint(thread) : undefined,
          ),
        )
      : false;
  const repeatStopExhausted =
    currentHeadReviewRequestPending || isVerifiedResidue
      ? false
      : reviewLoopRetryExhausted ||
        args.record.last_tracked_pr_repeat_failure_decision === "stop_no_progress" ||
        (config && args.pr
          ? configuredBotReviewFollowUpState(config, args.record, args.pr, configuredThreads) === "exhausted"
          : false);
  const verifiedStaleResidueThreads = isVerifiedResidue
    ? unresolvedConfiguredThreads.length
    : 0;
  const validRepairTargets =
    config && args.pr
      ? buildCodexConnectorStillValidReviewRepairTargets({
          record: args.record,
          pr: args.pr,
          reviewThreads: actionableMustFixThreads,
        })
      : [];
  const missingVerificationEvidenceThreads = remediation.missingProbeReason
    ? Math.max(actionableMustFixThreads.length - validRepairTargets.length, validRepairTargets.length > 0 ? 0 : 1)
    : 0;
  const currentHeadRepairProofRejectionReasons =
    config &&
    args.pr &&
    codexConfigured &&
    args.record.blocked_reason === "manual_review" &&
    args.record.last_tracked_pr_repeat_failure_decision === "stop_no_progress" &&
    !isVerifiedResidue &&
    actionableMustFixThreads.length > 0
      ? currentHeadCodexRepairProofRejectionReasons({
          config,
          record: args.record,
          pr: args.pr,
          checks: args.checks,
          reviewThreads,
        })
      : [];
  const reportableCurrentHeadRepairProofRejectionReasons = currentHeadRepairProofRejectionReasons.filter(
    (reason) => reason !== "current_head_repair_proof_structured_artifact_missing",
  );

  return {
    issueNumber: args.record.issue_number,
    prNumber: args.record.pr_number,
    currentHeadSuccess: currentHeadSuccess(args.pr),
    unresolvedCurrentThreads: unresolvedConfiguredThreads.length,
    actionableMustFixThreads: actionableMustFixThreads.length,
    verifiedStaleResidueThreads,
    missingVerificationEvidenceThreads,
    repeatStopExhausted: repeatStopExhausted ? "yes" : "no",
    autoRepairSuppressedReason: classifyAutoRepairSuppression({
      config,
      record: args.record,
      pr: args.pr,
      checks: args.checks,
      reviewThreads,
      remediation,
      actionableMustFixThreads,
      repeatStopExhausted,
    }),
    ...(reportableCurrentHeadRepairProofRejectionReasons.length > 0
      ? { currentHeadRepairProofRejectionReasons: reportableCurrentHeadRepairProofRejectionReasons }
      : {}),
    validRepairTargets,
  };
}
