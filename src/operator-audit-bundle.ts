import type {
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  LatestLocalCiResult,
  TimelineArtifact,
} from "./core/types";
import {
  extractIssueJournalHandoff,
  normalizeDurableTrackedArtifactContent,
  type IssueJournalHandoff,
} from "./core/journal";
import {
  buildIssueRunTimelineExport,
  type IssueRunTimelineEvent,
  type IssueRunTimelineExport,
} from "./timeline-artifacts";

export const OPERATOR_AUDIT_BUNDLE_SCHEMA_VERSION = 1;

type EvidenceAvailability = "available" | "missing";

export interface OperatorAuditBundleEvidence<T> {
  status: EvidenceAvailability;
  value: T | null;
  summary: string;
}

export interface OperatorAuditBundleDto {
  schemaVersion: typeof OPERATOR_AUDIT_BUNDLE_SCHEMA_VERSION;
  advisoryOnly: true;
  issue: {
    number: number;
    title: string;
    url: string;
    state: string;
    createdAt: string;
    updatedAt: string;
    bodySnapshot: string;
  };
  pullRequest: OperatorAuditBundleEvidence<{
    number: number;
    title: string;
    url: string;
    state: string;
    isDraft: boolean;
    headRefName: string;
    headRefOid: string;
    createdAt: string;
    mergedAt: string | null;
  }>;
  stateRecord: OperatorAuditBundleEvidence<{
    state: IssueRunRecord["state"];
    branch: string;
    prNumber: number | null;
    headSha: string | null;
    blockedReason: IssueRunRecord["blocked_reason"];
    attempts: {
      total: number;
      implementation: number;
      repair: number;
    };
    lastError: string | null;
    lastFailureKind: IssueRunRecord["last_failure_kind"];
    lastFailureSignature: string | null;
    updatedAt: string;
  }>;
  journal: OperatorAuditBundleEvidence<IssueJournalHandoff>;
  localCi: OperatorAuditBundleEvidence<LatestLocalCiResult>;
  pathHygiene: OperatorAuditBundleEvidence<{
    outcome: TimelineArtifact["outcome"];
    summary: string;
    command: string | null;
    headSha: string | null;
    remediationTarget: TimelineArtifact["remediation_target"];
    nextAction: string;
    recordedAt: string;
    repairTargets: string[];
  }>;
  staleConfiguredBotRemediation: OperatorAuditBundleEvidence<unknown>;
  recoveryEvents: OperatorAuditBundleEvidence<IssueRunTimelineEvent[]>;
  timeline: IssueRunTimelineExport | null;
  verificationCommands: OperatorAuditBundleEvidence<string[]>;
}

export function extractIssueVerificationCommands(issueBody: string): string[] {
  const lines = issueBody.split(/\r?\n/u);
  const headingIndex = lines.findIndex((line) => /^##\s+Verification\s*$/iu.test(line.trim()));
  if (headingIndex < 0) {
    return [];
  }

  const commands: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (/^##\s+/u.test(line.trim())) {
      break;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/u)?.[1] ?? trimmed;
    const fenced = bullet.match(/^`([^`]+)`$/u)?.[1] ?? bullet;
    commands.push(fenced);
  }

  return commands;
}

function sanitizeBundleValue<T>(value: T, workspacePath: string): T {
  if (typeof value === "string") {
    return normalizeDurableTrackedArtifactContent(value, workspacePath) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeBundleValue(entry, workspacePath)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeBundleValue(entry, workspacePath)]),
    ) as T;
  }
  return value;
}

function evidence<T>(value: T | null, missingSummary: string): OperatorAuditBundleEvidence<T> {
  return value === null
    ? {
      status: "missing",
      value: null,
      summary: missingSummary,
    }
    : {
      status: "available",
      value,
      summary: "Evidence is available.",
    };
}

function latestPathHygieneArtifact(record: IssueRunRecord | null): TimelineArtifact | null {
  const artifacts = record?.timeline_artifacts ?? [];
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const artifact = artifacts[index];
    if (artifact.gate === "workstation_local_path_hygiene") {
      return artifact;
    }
  }
  return null;
}

export function buildOperatorAuditBundle(args: {
  issue: GitHubIssue;
  record?: IssueRunRecord | null;
  pr?: GitHubPullRequest | null;
  journalContent?: string | null;
  staleConfiguredBotRemediation?: unknown | null;
}): OperatorAuditBundleDto {
  const record = args.record ?? null;
  const pr = args.pr ?? null;
  const workspacePath = record?.workspace ?? ".";
  const timeline = record ? buildIssueRunTimelineExport({ record, pr }) : null;
  const pathHygieneArtifact = latestPathHygieneArtifact(record);
  const verificationCommands = extractIssueVerificationCommands(args.issue.body ?? "");
  const recoveryEvents = timeline?.events.filter((event) => event.event_type === "recovery" && event.outcome !== "missing") ?? [];

  const bundle: OperatorAuditBundleDto = {
    schemaVersion: OPERATOR_AUDIT_BUNDLE_SCHEMA_VERSION,
    advisoryOnly: true,
    issue: {
      number: args.issue.number,
      title: args.issue.title,
      url: args.issue.url,
      state: args.issue.state ?? "UNKNOWN",
      createdAt: args.issue.createdAt,
      updatedAt: args.issue.updatedAt,
      bodySnapshot: args.issue.body ?? "",
    },
    pullRequest: evidence(pr
      ? {
        number: pr.number,
        title: pr.title,
        url: pr.url,
        state: pr.state,
        isDraft: pr.isDraft,
        headRefName: pr.headRefName,
        headRefOid: pr.headRefOid,
        createdAt: pr.createdAt,
        mergedAt: pr.mergedAt ?? null,
      }
      : null, "No pull request is recorded for this tracked issue."),
    stateRecord: evidence(record
      ? {
        state: record.state,
        branch: record.branch,
        prNumber: record.pr_number,
        headSha: record.last_head_sha,
        blockedReason: record.blocked_reason,
        attempts: {
          total: record.attempt_count,
          implementation: record.implementation_attempt_count,
          repair: record.repair_attempt_count,
        },
        lastError: record.last_error,
        lastFailureKind: record.last_failure_kind,
        lastFailureSignature: record.last_failure_signature,
        updatedAt: record.updated_at,
      }
      : null, "No supervisor state record is tracked for this issue."),
    journal: evidence(args.journalContent !== undefined && args.journalContent !== null
      ? extractIssueJournalHandoff(args.journalContent)
      : null, "No issue journal content is available for this issue."),
    localCi: evidence(record?.latest_local_ci_result ?? null, "No local CI result is recorded for this issue run."),
    pathHygiene: evidence(pathHygieneArtifact
      ? {
        outcome: pathHygieneArtifact.outcome,
        summary: pathHygieneArtifact.summary,
        command: pathHygieneArtifact.command,
        headSha: pathHygieneArtifact.head_sha,
        remediationTarget: pathHygieneArtifact.remediation_target,
        nextAction: pathHygieneArtifact.next_action,
        recordedAt: pathHygieneArtifact.recorded_at,
        repairTargets: pathHygieneArtifact.repair_targets ?? [],
      }
      : null, "No workstation-local path hygiene result is recorded for this issue run."),
    staleConfiguredBotRemediation: evidence(
      args.staleConfiguredBotRemediation ?? null,
      "No stale configured-bot remediation result is recorded for this issue run.",
    ),
    recoveryEvents: evidence(
      recoveryEvents.length > 0 ? recoveryEvents : null,
      "No recovery event is recorded for this issue run.",
    ),
    timeline,
    verificationCommands: evidence(
      verificationCommands.length > 0 ? verificationCommands : null,
      "No verification commands are listed in the issue body.",
    ),
  };

  return sanitizeBundleValue(bundle, workspacePath);
}

export function renderOperatorAuditBundleDto(dto: OperatorAuditBundleDto): string {
  return `${JSON.stringify(dto, null, 2)}\n`;
}
