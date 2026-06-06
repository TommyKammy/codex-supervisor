import type { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../core/types";
import {
  hasProcessedReviewThread,
  latestReviewThreadCommentFingerprint,
  processedReviewThreadFingerprintKey,
  processedReviewThreadKey,
} from "../review-handling";
import {
  clusterConfiguredBotReviewThreads,
  codexConnectorMustFixReviewThreads,
  commitShasEqualForComparison,
  evaluateCodexConnectorConvergencePolicy,
  latestCodexConnectorPSeverity,
  latestCodexConnectorReviewComment,
} from "../codex-connector-review-policy";
import {
  configuredBotReviewFollowUpState,
  configuredBotReviewThreads,
  manualReviewThreads,
  nonActionableConfiguredBotReviewThreads,
  pendingBotReviewThreads,
} from "../review-thread-reporting";
import {
  configuredReviewBotLogins,
  configuredReviewProviderKinds,
  normalizeReviewProviderLogin,
} from "../core/review-providers";

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

export type StaleReviewBotAutoRepairSuppressedReason =
  | "none"
  | "opt_in_disabled"
  | "too_many_clusters"
  | "missing_verification_probe"
  | "manual_or_unconfigured_review_threads"
  | "merge_conflict"
  | "failing_checks"
  | "pending_checks"
  | "repeat_stop_exhausted"
  | "not_verified_stale_residue";

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
}

const STALE_REVIEW_BOT_MANUAL_NEXT_STEP =
  "inspect_exact_review_thread_then_resolve_or_leave_manual_note";
const STALE_REVIEW_BOT_SUMMARY =
  "code_or_ci_green_but_review_thread_metadata_unresolved";
const STALE_REVIEW_BOT_METADATA_ONLY_SUMMARY =
  "stale_configured_bot_thread_metadata_only";
const STALE_REVIEW_BOT_METADATA_CURRENT_HEAD_SUMMARY =
  "stale_configured_bot_thread_metadata_only_pending_current_head_review_request";
const VERIFIED_NO_SOURCE_CHANGE_MANUAL_NEXT_STEP =
  "resolve_verified_configured_bot_threads_then_rerun_supervisor";
const VERIFIED_NO_SOURCE_CHANGE_SUMMARY =
  "verified_no_source_change_configured_bot_thread_resolution_pending";
const VERIFIED_CURRENT_HEAD_REPAIR_MANUAL_NEXT_STEP =
  "resolve_verified_repaired_configured_bot_threads_then_rerun_supervisor";
const VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY =
  "verified_current_head_repair_configured_bot_thread_resolution_pending";

interface StaleReviewBotClassification {
  classification: StaleReviewBotRemediationDto["classification"];
  summary: string;
  verificationEvidenceSummary?: string | null;
  missingProbeReason?: string | null;
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

function isConfiguredReviewBotCheck(
  config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">,
  check: Pick<PullRequestCheck, "name" | "workflow">,
): boolean {
  const configuredBotLogins = configuredReviewBotLogins(config);
  const configuredProviderKinds = configuredReviewProviderKinds(config);
  const labels = [check.name, check.workflow].flatMap((label) => {
    const normalized = label?.trim().toLowerCase();
    return normalized ? [normalized] : [];
  });

  return labels.some((label) => {
    const login = normalizeReviewProviderLogin(label);
    if (login && configuredBotLogins.includes(login)) {
      return true;
    }
    if (configuredBotLogins.some((configuredLogin) => label.includes(configuredLogin))) {
      return true;
    }
    if (configuredProviderKinds.includes("codex") && label.includes("codex") && (label.includes("connector") || label.includes("review"))) {
      return true;
    }
    if (configuredProviderKinds.includes("coderabbit") && label.includes("coderabbit")) {
      return true;
    }
    return configuredProviderKinds.includes("copilot") && label.includes("copilot") && label.includes("review");
  });
}

function currentHeadPassingNonReviewChecks(
  config: Pick<SupervisorConfig, "reviewBotLogins" | "configuredReviewProviders">,
  checks: Pick<PullRequestCheck, "bucket" | "name" | "workflow">[],
): Pick<PullRequestCheck, "bucket" | "name" | "workflow">[] {
  if (!allChecksPassing(checks)) {
    return [];
  }
  return checks.filter((check) => check.bucket === "pass" && !isConfiguredReviewBotCheck(config, check));
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

function isVerifiedStaleResidueClassification(classification: StaleReviewBotRemediationDto["classification"]): boolean {
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
  if (!config || !pr) {
    return "not_verified_stale_residue";
  }

  if (args.repeatStopExhausted) {
    return "repeat_stop_exhausted";
  }
  if (manualReviewThreads(config, args.reviewThreads).length > 0 || nonActionableConfiguredBotReviewThreads(config, args.reviewThreads).length > 0) {
    return "manual_or_unconfigured_review_threads";
  }
  if (hasMergeConflictState(pr)) {
    return "merge_conflict";
  }
  if (hasFailingChecks(checks)) {
    return "failing_checks";
  }
  if (hasPendingChecks(checks)) {
    return "pending_checks";
  }
  if (remediation.missingProbeReason) {
    return "missing_verification_probe";
  }
  if (!isVerifiedStaleResidueClassification(remediation.classification)) {
    if (clusterConfiguredBotReviewThreads(args.actionableMustFixThreads).length > 1) {
      return "too_many_clusters";
    }
    return "not_verified_stale_residue";
  }
  if (!verifiedAutoResolveEnabled(config, remediation.classification)) {
    return "opt_in_disabled";
  }

  return "none";
}

function codexConnectorCurrentHeadReviewState(args: {
  config: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
}): "observed" | "requested" | "missing" | "not_applicable" {
  if (!args.config || !configuredReviewProviderKinds(args.config).includes("codex")) {
    return "not_applicable";
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
  >;
}): string | null {
  if (
    args.pr.configuredBotCurrentHeadObservationSource !== "codex_pr_success_comment" ||
    !hasCurrentHeadSuccessSignal(args.pr)
  ) {
    return null;
  }

  const observedAt = validTimestamp(args.pr.configuredBotCurrentHeadObservedAt);
  if (!observedAt) {
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

function classifyCodexMetadataOnly(args: {
  config: SupervisorConfig;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  repositoryFileContents?: RepositoryFileContents;
}): StaleReviewBotClassification {
  const unresolvedWork = {
    classification: "unresolved_work" as const,
    summary: STALE_REVIEW_BOT_SUMMARY,
  };

  const configuredThreads = configuredBotReviewThreads(args.config, args.reviewThreads);
  if (configuredThreads.length === 0) {
    return unresolvedWork;
  }

  const currentConfiguredThreads = configuredThreads.filter((thread) => !thread.isOutdated);
  if (
    manualReviewThreads(args.config, args.reviewThreads).length > 0 ||
    args.record.last_head_sha !== args.pr.headRefOid ||
    !allChecksPassing(args.checks) ||
    hasMergeConflictState(args.pr) ||
    pendingBotReviewThreads(args.config, args.record, args.pr, currentConfiguredThreads).length > 0 ||
    configuredBotReviewFollowUpState(args.config, args.record, args.pr, currentConfiguredThreads) === "eligible" ||
    !currentConfiguredThreads.every((thread) => hasProcessedReviewThread(args.record, args.pr, thread))
  ) {
    return unresolvedWork;
  }

  const policy = evaluateCodexConnectorConvergencePolicy(args.config, args.pr, args.reviewThreads);
  if (!policy) {
    return {
      classification: "unknown_needs_operator",
      summary: STALE_REVIEW_BOT_SUMMARY,
    };
  }

  if (policy.outcome === "missing_current_head_review") {
    return {
      classification: "metadata_only_missing_current_head_review",
      summary: STALE_REVIEW_BOT_METADATA_CURRENT_HEAD_SUMMARY,
    };
  }

  if (policy.outcome === "must_fix_remaining") {
    const hasUnprocessedMustFix = codexConnectorMustFixReviewThreads(args.reviewThreads).some(
      (thread) => !hasProcessedReviewThread(args.record, args.pr, thread),
    );
    if (hasUnprocessedMustFix) {
      return {
        classification: "actionable_current_diff",
        summary: STALE_REVIEW_BOT_SUMMARY,
      };
    }
    const checkEvidenceCanProveRepair = args.record.repair_attempt_count > 0;
    const verificationEvidenceSummary = currentHeadVerificationEvidenceSummary(
      args.config,
      args.record,
      args.pr,
      args.checks,
      checkEvidenceCanProveRepair,
    );
    if (verificationEvidenceSummary) {
      const noMajorSignalEvidence = currentHeadCodexNoMajorSignalEvidence({
        record: args.record,
        pr: args.pr,
      });
      if (!noMajorSignalEvidence) {
        const deterministicProbeEvidence = deterministicRepairProbeEvidence({
          reviewThreads: args.reviewThreads,
          repositoryFileContents: args.repositoryFileContents,
        });
        if (deterministicProbeEvidence) {
          return {
            classification: "verified_current_head_repair_pending_thread_resolution",
            summary: VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY,
            verificationEvidenceSummary: `${verificationEvidenceSummary};${deterministicProbeEvidence}`,
          };
        }
        return {
          classification: "unknown_needs_operator",
          summary: STALE_REVIEW_BOT_SUMMARY,
          verificationEvidenceSummary,
          missingProbeReason: "current_head_codex_no_major_signal_missing",
        };
      }
      const mustFixReviewThreads = codexConnectorMustFixReviewThreads(args.reviewThreads);
      const hasMarkedNoSourceChangeRepair = hasCurrentHeadMarkedNoSourceChangeCodexTurnVerification(
        args.record,
        args.pr,
      );
      const verifiedNoSourceChangeRepair = hasCurrentHeadNoSourceChangeCodexTurnVerification(
        args.record,
        args.pr,
        mustFixReviewThreads,
      );
      const hasExplicitCurrentHeadRepairVerification =
        hasCurrentHeadCodexTurnVerification(args.record, args.pr) ||
        (!hasMarkedNoSourceChangeRepair && hasCurrentHeadLocalCiVerification(args.record, args.pr));
      const verifiedCurrentHeadRepair =
        hasExplicitCurrentHeadRepairVerification || (!hasMarkedNoSourceChangeRepair && args.record.repair_attempt_count > 0);
      if (!verifiedCurrentHeadRepair && !verifiedNoSourceChangeRepair) {
        return {
          classification: "unknown_needs_operator",
          summary: STALE_REVIEW_BOT_SUMMARY,
          verificationEvidenceSummary,
          missingProbeReason: hasMarkedNoSourceChangeRepair
            ? "current_head_no_source_thread_evidence_missing"
            : "current_head_repair_evidence_missing",
        };
      }
      if (
        (verifiedCurrentHeadRepair || verifiedNoSourceChangeRepair) &&
        !allCodexConnectorRepairResidueThreadsAreP2(mustFixReviewThreads)
      ) {
        return {
          classification: "unresolved_work",
          summary: STALE_REVIEW_BOT_SUMMARY,
          verificationEvidenceSummary,
        };
      }
      return {
        classification: verifiedCurrentHeadRepair
          ? "verified_current_head_repair_pending_thread_resolution"
          : "verified_no_source_change_pending_thread_resolution",
        summary: verifiedCurrentHeadRepair
          ? VERIFIED_CURRENT_HEAD_REPAIR_SUMMARY
          : VERIFIED_NO_SOURCE_CHANGE_SUMMARY,
        verificationEvidenceSummary: `${verificationEvidenceSummary};${noMajorSignalEvidence}`,
      };
    }
    return {
      classification: "unknown_needs_operator",
      summary: STALE_REVIEW_BOT_SUMMARY,
      missingProbeReason: "current_head_verification_evidence_missing",
    };
  }

  if (policy.outcome === "converged" || policy.outcome === "nitpick_only") {
    return {
      classification: "metadata_only_current_head_converged",
      summary: STALE_REVIEW_BOT_METADATA_ONLY_SUMMARY,
    };
  }

  return {
    classification: "unknown_needs_operator",
    summary: STALE_REVIEW_BOT_SUMMARY,
  };
}

function classifyRemediation(args: {
  config: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  repositoryFileContents?: RepositoryFileContents;
}): StaleReviewBotClassification {
  const unresolvedWork = {
    classification: "unresolved_work" as const,
    summary: STALE_REVIEW_BOT_SUMMARY,
  };
  if (!args.config || !args.pr) {
    return unresolvedWork;
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

  if (
    configuredThreads.length === 0 ||
    manualReviewThreads(config, reviewThreads).length > 0 ||
    record.last_head_sha !== pr.headRefOid ||
    !pr.configuredBotCurrentHeadObservedAt ||
    pr.configuredBotCurrentHeadStatusState !== "SUCCESS" ||
    !allChecksPassing(checks) ||
    !hasCleanMergeState(pr) ||
    pendingBotReviewThreads(config, record, pr, configuredThreads).length > 0 ||
    configuredBotReviewFollowUpState(config, record, pr, configuredThreads) === "eligible" ||
    !configuredThreads.every((thread) => hasProcessedReviewThread(record, pr, thread))
  ) {
    return unresolvedWork;
  }

  return {
    classification: "metadata_only",
    summary: STALE_REVIEW_BOT_METADATA_ONLY_SUMMARY,
  };
}

export function buildStaleReviewBotRemediation(args: {
  config?: SupervisorConfig | null;
  record: IssueRunRecord;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads?: ReviewThread[];
  repositoryFileContents?: RepositoryFileContents;
}): StaleReviewBotRemediationDto | null {
  if (args.record.blocked_reason !== "stale_review_bot" && args.record.blocked_reason !== "manual_review") {
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
  const actionableMustFixThreads = config && configuredReviewProviderKinds(config).includes("codex")
    ? codexConnectorMustFixReviewThreads(reviewThreads)
    : config && args.pr
      ? pendingBotReviewThreads(config, args.record, args.pr, configuredThreads)
      : [];
  const currentHeadReviewRequestPending =
    remediation.classification === "metadata_only_missing_current_head_review" &&
    remediation.codexCurrentHeadReviewState === "missing";
  const isVerifiedResidue = isVerifiedStaleResidueClassification(remediation.classification);
  const repeatStopExhausted =
    currentHeadReviewRequestPending || isVerifiedResidue
      ? false
      : args.record.last_tracked_pr_repeat_failure_decision === "stop_no_progress" ||
        (config && args.pr
          ? configuredBotReviewFollowUpState(config, args.record, args.pr, configuredThreads) === "exhausted"
          : false);
  const verifiedStaleResidueThreads = isVerifiedResidue
    ? unresolvedConfiguredThreads.length
    : 0;
  const missingVerificationEvidenceThreads = remediation.missingProbeReason ? Math.max(actionableMustFixThreads.length, 1) : 0;

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
  };
}
