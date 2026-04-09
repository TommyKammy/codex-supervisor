import { GitHubClient } from "./github";
import {
  runLocalReview,
  shouldRunLocalReview,
  type LocalReviewResult,
  type PreMergeResidualFinding,
} from "./local-review";
import {
  localReviewBlocksReady,
  localReviewFailureContext,
  localReviewHighSeverityNeedsBlock,
  localReviewRepairContinuationFailureContext,
  localReviewRepairContinuationSummary,
  localReviewRequiresManualReview,
  localReviewRetryLoopCandidate,
  localReviewRetryLoopStalled,
  localReviewStallFailureContext,
} from "./review-handling";
import { IssueJournalSync, MemoryArtifacts } from "./run-once-issue-preparation";
import { StateStore } from "./core/state-store";
import {
  FailureContext,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  LatestLocalCiResult,
  PullRequestCheck,
  ReviewThread,
  RunState,
  SupervisorConfig,
  SupervisorStateFile,
} from "./core/types";
import { nowIso, truncate } from "./core/utils";
import { runLocalCiGate, runWorkspacePreparationGate, type LocalCiCommandRunner } from "./local-ci";
import {
  buildWorkstationLocalPathFailureContext,
  runWorkstationLocalPathGate,
  type WorkstationLocalPathGateResult,
} from "./workstation-local-path-gate";
import {
  emitSupervisorEvent,
  maybeBuildReviewWaitChangedEvent,
  type SupervisorEventSink,
} from "./supervisor/supervisor-events";
import { parseIssueMetadata } from "./issue-metadata";
import { commitAndPushTrackedFiles, getWorkspaceStatus } from "./core/workspace";
import {
  derivePostTurnLocalReviewDecision,
  derivePostTurnLocalReviewFailurePatch,
} from "./post-turn-pull-request-policy";

export interface PostTurnPullRequestContext {
  state: SupervisorStateFile;
  record: IssueRunRecord;
  issue: GitHubIssue;
  workspacePath: string;
  syncJournal: IssueJournalSync;
  memoryArtifacts: MemoryArtifacts;
  pr: GitHubPullRequest;
  options: { dryRun: boolean };
}

export interface PostTurnPullRequestResult {
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}

export interface PullRequestLifecycleSnapshot {
  recordForState: IssueRunRecord;
  nextState: RunState;
  failureContext: FailureContext | null;
  reviewWaitPatch: Partial<Pick<IssueRunRecord, "review_wait_started_at" | "review_wait_head_sha">>;
  copilotRequestObservationPatch: Partial<
    Pick<IssueRunRecord, "copilot_review_requested_observed_at" | "copilot_review_requested_head_sha">
  >;
  mergeLatencyVisibilityPatch: Pick<
    IssueRunRecord,
    "provider_success_observed_at" | "provider_success_head_sha" | "merge_readiness_last_evaluated_at"
  >;
  copilotTimeoutPatch: Pick<
    IssueRunRecord,
    "copilot_review_timed_out_at" | "copilot_review_timeout_action" | "copilot_review_timeout_reason"
  >;
}

type HostLocalTrackedPrBlockerGateType = "workspace_preparation" | "local_ci";

const SUPERVISOR_JOURNAL_NORMALIZATION_COMMIT_MESSAGE = "Normalize supervisor-owned issue journals for path hygiene";

function workspacePreparationFailureClass(
  signature: string | null | undefined,
): Exclude<LatestLocalCiResult["failure_class"], "unset_contract"> | null {
  if (!signature?.startsWith("workspace-preparation-gate-")) {
    return null;
  }

  const failureClass = signature.slice("workspace-preparation-gate-".length);
  switch (failureClass) {
    case "missing_command":
    case "workspace_toolchain_missing":
    case "worktree_helper_missing":
    case "non_zero_exit":
      return failureClass;
    default:
      return null;
  }
}

function workspacePreparationRemediationTarget(
  failureClass: Exclude<LatestLocalCiResult["failure_class"], "unset_contract"> | null,
): string {
  switch (failureClass) {
    case "worktree_helper_missing":
    case "missing_command":
      return "supervisor_config";
    case "workspace_toolchain_missing":
    case "non_zero_exit":
    default:
      return "workspace_environment";
  }
}

function buildTrackedPrHostLocalBlockerComment(args: {
  pr: Pick<GitHubPullRequest, "headRefOid">;
  gateType: HostLocalTrackedPrBlockerGateType;
  blockerSignature: string;
  failureClass: string;
  remediationTarget: string;
  summary: string;
}): string {
  return [
    `Supervisor host-local ${args.gateType} blocker on tracked PR head \`${args.pr.headRefOid}\`.`,
    "",
    `- gate type: \`${args.gateType}\``,
    `- blocker signature: \`${args.blockerSignature}\``,
    `- failure class: \`${args.failureClass}\``,
    `- remediation target: \`${args.remediationTarget}\``,
    `- summary: ${args.summary}`,
    "",
    "GitHub checks may still be green because this blocker is host-local to the supervisor workspace.",
  ].join("\n");
}

async function maybeCommentOnTrackedPrHostLocalBlocker(args: {
  github: Partial<Pick<GitHubClient, "addIssueComment">>;
  stateStore: Pick<StateStore, "touch" | "save">;
  state: SupervisorStateFile;
  record: IssueRunRecord;
  pr: GitHubPullRequest;
  syncJournal: IssueJournalSync;
  gateType: HostLocalTrackedPrBlockerGateType;
  blockerSignature: string | null;
  failureClass: string | null;
  remediationTarget: string | null;
  summary: string | null;
}): Promise<IssueRunRecord> {
  if (!args.github.addIssueComment) {
    return args.record;
  }

  if (!args.blockerSignature || !args.failureClass || !args.remediationTarget || !args.summary) {
    return args.record;
  }

  if (
    args.record.last_host_local_pr_blocker_comment_head_sha === args.pr.headRefOid
    && args.record.last_host_local_pr_blocker_comment_signature === args.blockerSignature
  ) {
    return args.record;
  }

  try {
    await args.github.addIssueComment(
      args.pr.number,
      buildTrackedPrHostLocalBlockerComment({
        pr: args.pr,
        gateType: args.gateType,
        blockerSignature: args.blockerSignature,
        failureClass: args.failureClass,
        remediationTarget: args.remediationTarget,
        summary: args.summary,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Failed to post tracked PR host-local blocker comment for PR #${args.pr.number}: ${truncate(message, 500) ?? "unknown error"}`,
    );
    return args.record;
  }

  const updatedRecord = args.stateStore.touch(args.record, {
    last_host_local_pr_blocker_comment_head_sha: args.pr.headRefOid,
    last_host_local_pr_blocker_comment_signature: args.blockerSignature,
  });
  args.state.issues[String(updatedRecord.issue_number)] = updatedRecord;
  await args.stateStore.save(args.state);
  await args.syncJournal(updatedRecord);
  return updatedRecord;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMarkdownSectionContent(body: string, title: string): string | null {
  const lines = body.split(/\r?\n/);
  const headingPattern = new RegExp(`^\\s*##\\s*${escapeRegExp(title)}\\s*$`, "i");

  for (let index = 0; index < lines.length; index += 1) {
    if (!headingPattern.test(lines[index] ?? "")) {
      continue;
    }

    const sectionLines: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^\s*##\s*\S/.test(lines[cursor] ?? "")) {
        break;
      }

      sectionLines.push(lines[cursor] ?? "");
    }

    const content = sectionLines.join("\n").trim();
    return content.length > 0 ? content : null;
  }

  return null;
}

function renderResidualLines(finding: Pick<PreMergeResidualFinding, "start" | "end">): string | null {
  if (finding.start == null) {
    return null;
  }

  return finding.end != null && finding.end !== finding.start
    ? `${finding.start}-${finding.end}`
    : `${finding.start}`;
}

function isIssueSchedulingMetadataLine(line: string): boolean {
  return /^(Part of|Depends on|Parallelizable|Execution order):/i.test(line.trim());
}

function sanitizeVerificationLines(content: string | null, fallbackLocation: string): string[] {
  if (!content) {
    return [`- add and run the narrowest targeted verification for ${fallbackLocation}.`];
  }

  const sanitized = content
    .split(/\r?\n/)
    .filter((line) => !isIssueSchedulingMetadataLine(line))
    .filter((line, index, lines) => line.trim() !== "" || (index > 0 && lines[index - 1]?.trim() !== ""));

  return sanitized.length > 0
    ? sanitized
    : [`- add and run the narrowest targeted verification for ${fallbackLocation}.`];
}

function buildResidualFollowUpIssueDraft(args: {
  sourceIssue: GitHubIssue;
  pr: GitHubPullRequest;
  localReview: LocalReviewResult;
  residualFinding: PreMergeResidualFinding;
}): { title: string; body: string } {
  const { sourceIssue, pr, localReview, residualFinding } = args;
  const metadata = parseIssueMetadata(sourceIssue);
  const sourceVerification = findMarkdownSectionContent(sourceIssue.body, "Verification");
  const renderedLines = renderResidualLines(residualFinding);
  const location = residualFinding.file
    ? `\`${residualFinding.file}${renderedLines ? `:${renderedLines}` : ""}\``
    : "the bounded residual area";
  const title = truncate(
    `Follow-up: ${sourceIssue.title} (#${sourceIssue.number}) - ${residualFinding.summary}`,
    240,
  ) ?? `Follow-up: issue #${sourceIssue.number}`;
  const verificationLines = sanitizeVerificationLines(sourceVerification, location);

  return {
    title,
    body: [
      "## Summary",
      `Resolve the residual non-blocking finding left behind by source issue #${sourceIssue.number} after PR #${pr.number} merges.`,
      "",
      "## Scope",
      `- address the residual finding: ${residualFinding.summary}`,
      `- focus changes on ${location}.`,
      "- keep unrelated behavior unchanged outside this follow-up.",
      "",
      "## Acceptance criteria",
      `- the residual finding from source issue #${sourceIssue.number} is resolved or explicitly dismissed with rationale.`,
      "- any targeted coverage or guardrail needed for this residual is added.",
      `- traceability back to source issue #${sourceIssue.number} and PR #${pr.number} remains documented.`,
      "",
      "## Verification",
      ...verificationLines,
      `- confirm the residual finding for ${location} is covered by the updated verification.`,
      "",
      ...(metadata.parentIssueNumber ? [`Part of: #${metadata.parentIssueNumber}`] : []),
      `Depends on: #${sourceIssue.number}`,
      "Parallelizable: No",
      "",
      "## Execution order",
      "1 of 1",
      "",
      "## Traceability",
      `- Source issue: #${sourceIssue.number}`,
      `- Source PR: #${pr.number}`,
      `- Pre-merge final evaluation outcome: ${localReview.finalEvaluation.outcome}`,
      `- Residual finding key: \`${residualFinding.findingKey}\``,
      `- Severity: ${residualFinding.severity}`,
      ...(residualFinding.category ? [`- Category: ${residualFinding.category}`] : []),
      ...(residualFinding.file ? [`- File: \`${residualFinding.file}\``] : []),
      ...(renderedLines ? [`- Lines: ${renderedLines}`] : []),
      `- Summary: ${residualFinding.summary}`,
      `- Rationale: ${residualFinding.rationale}`,
      `- Source artifact: \`${localReview.summaryPath}\``,
    ].join("\n"),
  };
}

async function createResidualFollowUpIssues(args: {
  github: Partial<Pick<GitHubClient, "createIssue">>;
  issue: GitHubIssue;
  pr: GitHubPullRequest;
  localReview: LocalReviewResult;
}): Promise<void> {
  if (!args.github.createIssue) {
    throw new Error("GitHub issue creation is unavailable for follow-up-eligible residual findings.");
  }

  const residualFindings = args.localReview.finalEvaluation.residualFindings.filter(
    (finding) => finding.resolution === "follow_up_candidate",
  );

  for (const residualFinding of residualFindings) {
    const draft = buildResidualFollowUpIssueDraft({
      sourceIssue: args.issue,
      pr: args.pr,
      localReview: args.localReview,
      residualFinding,
    });
    await args.github.createIssue(draft.title, draft.body);
  }
}

export interface HandlePostTurnPullRequestTransitionsArgs {
  config: SupervisorConfig;
  stateStore: Pick<StateStore, "touch" | "save">;
  github: Pick<GitHubClient, "getPullRequest" | "getChecks" | "getUnresolvedReviewThreads" | "markPullRequestReady"> &
    Partial<Pick<GitHubClient, "createIssue" | "addIssueComment">>;
  context: PostTurnPullRequestContext;
  derivePullRequestLifecycleSnapshot: (
    record: IssueRunRecord,
    pr: GitHubPullRequest,
    checks: PullRequestCheck[],
    reviewThreads: ReviewThread[],
    recordPatch?: Partial<IssueRunRecord>,
  ) => PullRequestLifecycleSnapshot;
  applyFailureSignature: (
    record: IssueRunRecord,
    failureContext: FailureContext | null,
  ) => Pick<IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count">;
  blockedReasonFromReviewState: (
    record: IssueRunRecord,
    pr: GitHubPullRequest,
    checks: PullRequestCheck[],
    reviewThreads: ReviewThread[],
  ) => IssueRunRecord["blocked_reason"];
  summarizeChecks: (checks: PullRequestCheck[]) => { hasPending: boolean; hasFailing: boolean };
  configuredBotReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[];
  manualReviewThreads: (config: SupervisorConfig, reviewThreads: ReviewThread[]) => ReviewThread[];
  mergeConflictDetected: (pr: GitHubPullRequest) => boolean;
  runLocalReviewImpl?: typeof runLocalReview;
  runWorkspacePreparationCommand?: LocalCiCommandRunner;
  runLocalCiCommand?: LocalCiCommandRunner;
  runWorkstationLocalPathGate?: (args: { workspacePath: string; gateLabel: string }) => Promise<WorkstationLocalPathGateResult>;
  emitEvent?: SupervisorEventSink;
  loadOpenPullRequestSnapshot?: (prNumber: number) => Promise<{
    pr: GitHubPullRequest;
    checks: PullRequestCheck[];
    reviewThreads: ReviewThread[];
  }>;
}

async function loadOpenPullRequestSnapshot(
  github: Pick<GitHubClient, "getPullRequest" | "getChecks" | "getUnresolvedReviewThreads">,
  prNumber: number,
): Promise<{
  pr: GitHubPullRequest;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
}> {
  const pr = await github.getPullRequest(prNumber);
  const checks = await github.getChecks(prNumber);
  const reviewThreads = await github.getUnresolvedReviewThreads(prNumber);
  return { pr, checks, reviewThreads };
}

export async function handlePostTurnPullRequestTransitionsPhase(
  args: HandlePostTurnPullRequestTransitionsArgs,
): Promise<PostTurnPullRequestResult> {
  const runLocalReviewImpl = args.runLocalReviewImpl ?? runLocalReview;
  const loadOpenPullRequestSnapshotImpl =
    args.loadOpenPullRequestSnapshot ?? ((prNumber: number) => loadOpenPullRequestSnapshot(args.github, prNumber));
  const runWorkstationLocalPathGateImpl = args.runWorkstationLocalPathGate ?? runWorkstationLocalPathGate;
  const { config, stateStore, github } = args;
  const { state, issue, workspacePath, syncJournal, memoryArtifacts, options } = args.context;
  let { record, pr } = args.context;

  let ranLocalReviewThisCycle = false;
  const refreshed = await loadOpenPullRequestSnapshotImpl(pr.number);
  const refreshedCheckSummary = args.summarizeChecks(refreshed.checks);

  if (
    shouldRunLocalReview(config, record, refreshed.pr) &&
    !refreshedCheckSummary.hasPending &&
    !refreshedCheckSummary.hasFailing &&
    args.configuredBotReviewThreads(config, refreshed.reviewThreads).length === 0 &&
    (!config.humanReviewBlocksMerge || args.manualReviewThreads(config, refreshed.reviewThreads).length === 0) &&
    !args.mergeConflictDetected(refreshed.pr) &&
    !options.dryRun
  ) {
    ranLocalReviewThisCycle = true;
    record = stateStore.touch(record, { state: "local_review" });
    state.issues[String(record.issue_number)] = record;
    await stateStore.save(state);
    await syncJournal(record);

    try {
      const localReview = await runLocalReviewImpl({
        config,
        issue,
        branch: record.branch,
        workspacePath,
        defaultBranch: config.defaultBranch,
        pr: refreshed.pr,
        alwaysReadFiles: memoryArtifacts.alwaysReadFiles,
        onDemandFiles: memoryArtifacts.onDemandFiles,
      });
      const localReviewDecision = derivePostTurnLocalReviewDecision({
        config,
        record,
        pr: refreshed.pr,
        localReview,
      });
      record = stateStore.touch(record, localReviewDecision.recordPatch);

      if (localReviewDecision.shouldCreateFollowUpIssues) {
        await createResidualFollowUpIssues({
          github,
          issue,
          pr: refreshed.pr,
          localReview,
        });
      }
    } catch (error) {
      record = stateStore.touch(record, derivePostTurnLocalReviewFailurePatch({ pr: refreshed.pr, error }));
    }

    state.issues[String(record.issue_number)] = record;
    await stateStore.save(state);
    await syncJournal(record);
  }

  if (
    refreshed.pr.isDraft &&
    !refreshedCheckSummary.hasPending &&
    !refreshedCheckSummary.hasFailing &&
    args.configuredBotReviewThreads(config, refreshed.reviewThreads).length === 0 &&
    (!config.humanReviewBlocksMerge || args.manualReviewThreads(config, refreshed.reviewThreads).length === 0) &&
    !args.mergeConflictDetected(refreshed.pr) &&
    !localReviewRequiresManualReview(config, record, refreshed.pr) &&
    !localReviewBlocksReady(config, record, refreshed.pr) &&
    !options.dryRun
  ) {
    const pathHygieneGate = await runWorkstationLocalPathGateImpl({
      workspacePath,
      gateLabel: `before marking PR #${refreshed.pr.number} ready`,
    });
    if (!pathHygieneGate.ok) {
      const failureContext = pathHygieneGate.failureContext;
      record = stateStore.touch(record, {
        state: "blocked",
        last_error: truncate(
          failureContext?.summary
            ?? `Tracked durable artifacts failed workstation-local path hygiene before marking PR #${refreshed.pr.number} ready.`,
          1000,
        ),
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: "verification",
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
      await syncJournal(record);
      return {
        record,
        pr: refreshed.pr,
        checks: refreshed.checks,
        reviewThreads: refreshed.reviewThreads,
      };
    }
    const rewrittenJournalPaths = pathHygieneGate.rewrittenJournalPaths ?? [];
    if (rewrittenJournalPaths.length > 0) {
      let persistedNormalizationCommit = false;
      try {
        persistedNormalizationCommit = await commitAndPushTrackedFiles({
          workspacePath,
          branch: refreshed.pr.headRefName,
          remoteBranchExists: true,
          filePaths: rewrittenJournalPaths,
          commitMessage: SUPERVISOR_JOURNAL_NORMALIZATION_COMMIT_MESSAGE,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failureContext = buildWorkstationLocalPathFailureContext({
          gateLabel: `before marking PR #${refreshed.pr.number} ready`,
          details: [
            `journal normalization persistence failed for ${rewrittenJournalPaths.join(", ")}: ${message}`,
          ],
        });
        record = stateStore.touch(record, {
          state: "blocked",
          last_error: truncate(failureContext.summary, 1000),
          last_failure_kind: null,
          last_failure_context: failureContext,
          ...args.applyFailureSignature(record, failureContext),
          blocked_reason: "verification",
        });
        state.issues[String(record.issue_number)] = record;
        await stateStore.save(state);
        await syncJournal(record);
        return {
          record,
          pr: refreshed.pr,
          checks: refreshed.checks,
          reviewThreads: refreshed.reviewThreads,
        };
      }
      if (!persistedNormalizationCommit) {
        const failureContext = buildWorkstationLocalPathFailureContext({
          gateLabel: `before marking PR #${refreshed.pr.number} ready`,
          details: [
            `journal normalization reported rewritten paths for ${rewrittenJournalPaths.join(", ")} but did not create a commit to publish.`,
          ],
        });
        record = stateStore.touch(record, {
          state: "blocked",
          last_error: truncate(failureContext.summary, 1000),
          last_failure_kind: null,
          last_failure_context: failureContext,
          ...args.applyFailureSignature(record, failureContext),
          blocked_reason: "verification",
        });
        state.issues[String(record.issue_number)] = record;
        await stateStore.save(state);
        await syncJournal(record);
        return {
          record,
          pr: refreshed.pr,
          checks: refreshed.checks,
          reviewThreads: refreshed.reviewThreads,
        };
      }

      const persisted = await loadOpenPullRequestSnapshotImpl(refreshed.pr.number);
      record = stateStore.touch(record, {
        state: "draft_pr",
        pr_number: persisted.pr.number,
        last_head_sha: persisted.pr.headRefOid,
        blocked_reason: null,
        last_error: null,
        last_failure_kind: null,
        last_failure_context: null,
        last_failure_signature: null,
        repeated_failure_signature_count: 0,
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
      await syncJournal(record);
      return {
        record,
        pr: persisted.pr,
        checks: persisted.checks,
        reviewThreads: persisted.reviewThreads,
      };
    }

    const workspacePreparationGate = await runWorkspacePreparationGate({
      config,
      workspacePath,
      gateLabel: `before marking PR #${refreshed.pr.number} ready`,
      runWorkspacePreparationCommand: args.runWorkspacePreparationCommand,
    });
    if (!workspacePreparationGate.ok) {
      const failureContext = workspacePreparationGate.failureContext;
      record = stateStore.touch(record, {
        state: "blocked",
        last_error: truncate(failureContext?.summary, 1000),
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: "verification",
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
      await syncJournal(record);
      record = await maybeCommentOnTrackedPrHostLocalBlocker({
        github,
        stateStore,
        state,
        record,
        pr: refreshed.pr,
        syncJournal,
        gateType: "workspace_preparation",
        blockerSignature: failureContext?.signature ?? null,
        failureClass: workspacePreparationFailureClass(failureContext?.signature),
        remediationTarget: workspacePreparationRemediationTarget(workspacePreparationFailureClass(failureContext?.signature)),
        summary: failureContext?.summary ?? null,
      });
      return {
        record,
        pr: refreshed.pr,
        checks: refreshed.checks,
        reviewThreads: refreshed.reviewThreads,
      };
    }

    const localCiGate = await runLocalCiGate({
      config,
      workspacePath,
      gateLabel: `before marking PR #${refreshed.pr.number} ready`,
      runLocalCiCommand: args.runLocalCiCommand,
    });
    if (!localCiGate.ok) {
      const failureContext = localCiGate.failureContext;
      record = stateStore.touch(record, {
        state: "blocked",
        latest_local_ci_result: localCiGate.latestResult
          ? {
              ...localCiGate.latestResult,
              head_sha: refreshed.pr.headRefOid,
            }
          : null,
        last_error: truncate(failureContext?.summary, 1000),
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: "verification",
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
      await syncJournal(record);
      record = await maybeCommentOnTrackedPrHostLocalBlocker({
        github,
        stateStore,
        state,
        record,
        pr: refreshed.pr,
        syncJournal,
        gateType: "local_ci",
        blockerSignature: failureContext?.signature ?? null,
        failureClass: localCiGate.latestResult?.failure_class ?? null,
        remediationTarget: localCiGate.latestResult?.remediation_target ?? null,
        summary: failureContext?.summary ?? localCiGate.latestResult?.summary ?? null,
      });
      return {
        record,
        pr: refreshed.pr,
        checks: refreshed.checks,
        reviewThreads: refreshed.reviewThreads,
      };
    }
    record = stateStore.touch(record, {
      latest_local_ci_result: localCiGate.latestResult
        ? {
            ...localCiGate.latestResult,
            head_sha: refreshed.pr.headRefOid,
          }
        : null,
    });
    state.issues[String(record.issue_number)] = record;
    await stateStore.save(state);
    await syncJournal(record);
    const localWorkspaceStatus = await getWorkspaceStatus(workspacePath, record.branch, config.defaultBranch);
    if (localWorkspaceStatus.headSha !== refreshed.pr.headRefOid) {
      const failureContext = buildWorkstationLocalPathFailureContext({
        gateLabel: `before marking PR #${refreshed.pr.number} ready`,
        details: [
          `local workspace HEAD ${localWorkspaceStatus.headSha} does not match PR head ${refreshed.pr.headRefOid}; the ready gate is failing closed until the local commit is published.`,
        ],
      });
      record = stateStore.touch(record, {
        state: "blocked",
        last_error: truncate(failureContext.summary, 1000),
        last_failure_kind: null,
        last_failure_context: failureContext,
        ...args.applyFailureSignature(record, failureContext),
        blocked_reason: "verification",
      });
      state.issues[String(record.issue_number)] = record;
      await stateStore.save(state);
      await syncJournal(record);
      return {
        record,
        pr: refreshed.pr,
        checks: refreshed.checks,
        reviewThreads: refreshed.reviewThreads,
      };
    }
    await github.markPullRequestReady(refreshed.pr.number);
  }

  const postReady = await loadOpenPullRequestSnapshotImpl(pr.number);
  const currentHeadLocalReviewTracked =
    record.last_head_sha === postReady.pr.headRefOid && record.local_review_head_sha === postReady.pr.headRefOid;
  const retryLoopCandidate =
    !ranLocalReviewThisCycle &&
    localReviewRetryLoopCandidate(
      config,
      record,
      postReady.pr,
      postReady.checks,
      postReady.reviewThreads,
      args.manualReviewThreads,
      args.configuredBotReviewThreads,
      args.summarizeChecks,
      args.mergeConflictDetected,
    );
  const repeatedLocalReviewSignatureCount =
    retryLoopCandidate && currentHeadLocalReviewTracked
      ? record.repeated_local_review_signature_count + 1
      : !ranLocalReviewThisCycle && currentHeadLocalReviewTracked
        ? 0
        : record.repeated_local_review_signature_count;
  const refreshedLifecycle = args.derivePullRequestLifecycleSnapshot(
    record,
    postReady.pr,
    postReady.checks,
    postReady.reviewThreads,
    { repeated_local_review_signature_count: repeatedLocalReviewSignatureCount },
  );
  const localReviewRepairSummary =
    refreshedLifecycle.nextState === "local_review_fix"
      ? localReviewRepairContinuationSummary(config, refreshedLifecycle.recordForState, postReady.pr)
      : null;
  const postReadyLocalReviewFailureContext =
    refreshedLifecycle.nextState === "blocked" &&
    localReviewRetryLoopStalled(
      config,
      refreshedLifecycle.recordForState,
      postReady.pr,
      postReady.checks,
      postReady.reviewThreads,
      args.manualReviewThreads,
      args.configuredBotReviewThreads,
      args.summarizeChecks,
      args.mergeConflictDetected,
        )
      ? localReviewStallFailureContext(refreshedLifecycle.recordForState)
      : refreshedLifecycle.nextState === "blocked" &&
          localReviewHighSeverityNeedsBlock(config, refreshedLifecycle.recordForState, postReady.pr)
        ? localReviewFailureContext(refreshedLifecycle.recordForState)
        : refreshedLifecycle.nextState === "local_review_fix"
          ? localReviewRepairContinuationFailureContext(config, refreshedLifecycle.recordForState, postReady.pr)
          : null;
  const effectiveFailureContext = refreshedLifecycle.failureContext ?? postReadyLocalReviewFailureContext;
  record = stateStore.touch(record, {
    pr_number: postReady.pr.number,
    ...refreshedLifecycle.reviewWaitPatch,
    ...refreshedLifecycle.copilotRequestObservationPatch,
    ...refreshedLifecycle.mergeLatencyVisibilityPatch,
    ...refreshedLifecycle.copilotTimeoutPatch,
    state: refreshedLifecycle.nextState,
    last_head_sha: postReady.pr.headRefOid,
    repeated_local_review_signature_count: repeatedLocalReviewSignatureCount,
    last_error:
      refreshedLifecycle.nextState === "blocked" && effectiveFailureContext
        ? truncate(effectiveFailureContext.summary, 1000)
        : localReviewRepairSummary
          ? truncate(localReviewRepairSummary, 1000)
          : record.last_error,
    last_failure_context: effectiveFailureContext,
    ...args.applyFailureSignature(record, effectiveFailureContext),
    blocked_reason:
      refreshedLifecycle.nextState === "blocked"
        ? args.blockedReasonFromReviewState(
            refreshedLifecycle.recordForState,
            postReady.pr,
            postReady.checks,
            postReady.reviewThreads,
          ) ??
          ((localReviewRetryLoopStalled(
            config,
            refreshedLifecycle.recordForState,
            postReady.pr,
            postReady.checks,
            postReady.reviewThreads,
            args.manualReviewThreads,
            args.configuredBotReviewThreads,
            args.summarizeChecks,
            args.mergeConflictDetected,
          ) ||
            localReviewHighSeverityNeedsBlock(config, refreshedLifecycle.recordForState, postReady.pr))
            ? "verification"
            : null)
        : null,
  });
  state.issues[String(record.issue_number)] = record;
  await stateStore.save(state);
  emitSupervisorEvent(args.emitEvent, maybeBuildReviewWaitChangedEvent(args.context.record, record, postReady.pr.number));

  return {
    record,
    pr: postReady.pr,
    checks: postReady.checks,
    reviewThreads: postReady.reviewThreads,
  };
}
