import type { DashboardIssueActivityContextLike } from "./webui-dashboard-browser-logic";

export interface DashboardIssueReviewWaitLike {
  kind?: string | null;
  status?: string | null;
  provider?: string | null;
  pauseReason?: string | null;
  recentObservation?: string | null;
  observedAt?: string | null;
  configuredWaitSeconds?: number | null;
  waitUntil?: string | null;
}

export interface DashboardIssueLatestRecoveryLike {
  issueNumber?: number | null;
  at?: string | null;
  reason?: string | null;
  detail?: string | null;
}

export interface DashboardIssueTimelineEventLike {
  issue_number?: number | null;
  pr_number?: number | null;
  event_type?: string | null;
  timestamp?: string | null;
  outcome?: string | null;
  summary?: string | null;
  head_sha?: string | null;
  remediation_target?: string | null;
  next_action?: string | null;
}

export interface DashboardIssueTimelineLike {
  issue_number?: number | null;
  pr_number?: number | null;
  events?: DashboardIssueTimelineEventLike[] | null;
}

export interface DashboardIssueDetailsActivityContextLike extends DashboardIssueActivityContextLike {
  handoffSummary?: string | null;
  localReviewRoutingSummary?: string | null;
  verificationPolicySummary?: string | null;
  durableGuardrailSummary?: string | null;
  externalReviewFollowUpSummary?: string | null;
  latestRecovery?: DashboardIssueLatestRecoveryLike | null;
  localReviewSummaryPath?: string | null;
  externalReviewMissesPath?: string | null;
  reviewWaits?: DashboardIssueReviewWaitLike[] | null;
}

export interface DashboardIssueExplainLike {
  state?: string | null;
  blockedReason?: string | null;
  runnable?: boolean | null;
  selectionReason?: string | null;
  reasons?: string[] | null;
  loopRuntimeBlockerSummary?: string | null;
  externalReviewFollowUpSummary?: string | null;
  latestRecoverySummary?: string | null;
  failureSummary?: string | null;
  lastError?: string | null;
  changeRiskLines?: string[] | null;
  activityContext?: DashboardIssueDetailsActivityContextLike | null;
  timeline?: DashboardIssueTimelineLike | null;
}

export interface DashboardIssueDetailSection {
  title: string;
  items: Array<[string, string]>;
}

export interface DashboardIssueDetailFormatters {
  formatRetryContextSummary: (activityContext: DashboardIssueActivityContextLike | null | undefined) => string | null;
  formatRecoveryLoopSummary: (activityContext: DashboardIssueActivityContextLike | null | undefined) => string | null;
  formatRecentPhaseChanges: (activityContext: DashboardIssueActivityContextLike | null | undefined) => string | null;
}

export function formatLatestRecovery(
  activityContext: DashboardIssueDetailsActivityContextLike | null | undefined,
  fallbackSummary: string | null | undefined,
): string {
  const latestRecovery = activityContext?.latestRecovery;
  if (latestRecovery) {
    const issueNumber = Number.isInteger(latestRecovery.issueNumber) ? latestRecovery.issueNumber : null;
    const at = latestRecovery.at?.trim() || null;
    const reason = latestRecovery.reason?.trim() || null;
    const detail = latestRecovery.detail?.trim() || null;

    if (issueNumber !== null && at && reason) {
      return "issue=#" + issueNumber + " at=" + at + " reason=" + reason + (detail ? " detail=" + detail : "");
    }
  }
  if (fallbackSummary) {
    return fallbackSummary;
  }
  return "none";
}

export function formatReviewWaits(activityContext: DashboardIssueDetailsActivityContextLike | null | undefined): string {
  const reviewWaits = Array.isArray(activityContext?.reviewWaits) ? activityContext.reviewWaits : [];
  if (reviewWaits.length === 0) {
    return "none";
  }
  return reviewWaits
    .map((reviewWait) => {
      const kind = reviewWait.kind ?? "none";
      const status = reviewWait.status ?? "none";
      const provider = reviewWait.provider ?? "none";
      const pauseReason = reviewWait.pauseReason ?? "none";
      const recentObservation = reviewWait.recentObservation ?? "none";
      const observedAt = reviewWait.observedAt ?? "none";
      const configuredWaitSeconds = reviewWait.configuredWaitSeconds == null ? "none" : reviewWait.configuredWaitSeconds;
      const waitUntil = reviewWait.waitUntil ?? "none";

      return (
        kind +
        " status=" +
        status +
        " provider=" +
        provider +
        " pause_reason=" +
        pauseReason +
        " recent_observation=" +
        recentObservation +
        " observed_at=" +
        observedAt +
        " configured_wait_seconds=" +
        configuredWaitSeconds +
        " wait_until=" +
        waitUntil
      );
    })
    .join(" | ");
}

export function formatIssueNumber(value: number | null | undefined): string {
  return Number.isInteger(value) ? "#" + value : "none";
}

export function formatIssueTimelineSummary(timeline: DashboardIssueTimelineLike | null | undefined): string {
  if (!timeline) {
    return "No issue-run timeline is recorded for this issue.";
  }
  const events = Array.isArray(timeline.events) ? timeline.events : [];
  return "issue=" + formatIssueNumber(timeline.issue_number) +
    " pr=" + formatIssueNumber(timeline.pr_number) +
    " events=" + events.length;
}

export function formatIssueTimelineEvent(event: DashboardIssueTimelineEventLike): string {
  const eventType = event.event_type?.trim() || "unknown";
  const outcome = event.outcome?.trim() || "unknown";
  const timestamp = event.timestamp?.trim() || "timestamp=none";
  const summary = event.summary?.trim() || "No summary reported.";
  const headSha = event.head_sha?.trim() || "none";
  const remediationTarget = event.remediation_target?.trim() || "none";
  const nextAction = event.next_action?.trim() || "none";
  return (
    "evidence type=" +
    eventType +
    " outcome=" +
    outcome +
    " at=" +
    timestamp +
    " head_sha=" +
    headSha +
    " remediation_target=" +
    remediationTarget +
    " action=" +
    nextAction +
    " summary=" +
    summary
  );
}

export function formatIssueTimelineEvents(timeline: DashboardIssueTimelineLike | null | undefined): string[] {
  const events = Array.isArray(timeline?.events) ? timeline.events : [];
  return events.map(formatIssueTimelineEvent);
}

export function buildIssueExplainSections(
  explain: DashboardIssueExplainLike | null | undefined,
  formatters: DashboardIssueDetailFormatters,
): DashboardIssueDetailSection[] {
  if (!explain) {
    return [];
  }

  const activityContext = explain.activityContext ?? null;
  const { formatRetryContextSummary, formatRecoveryLoopSummary, formatRecentPhaseChanges } = formatters;
  function buildDetailItems(pairs: Array<[string, string | null | undefined]>): Array<[string, string]> {
    return pairs.filter(
      (pair): pair is [string, string] => pair[1] !== null && pair[1] !== undefined && pair[1] !== "" && pair[1] !== "none",
    );
  }

  return [
    {
      title: "Selection context",
      items: buildDetailItems([
        ["state", explain.state],
        ["blocked_reason", explain.blockedReason],
        ["runnable", explain.runnable ? "yes" : "no"],
        ["selection_reason", explain.selectionReason || "none"],
        ["reasons", (explain.reasons || []).join(" | ") || "none"],
        ["loop_runtime_blocker", explain.loopRuntimeBlockerSummary || "none"],
      ]),
    },
    {
      title: "Operator activity",
      items: buildDetailItems([
        ["handoff_summary", activityContext ? activityContext.handoffSummary || "none" : "none"],
        ["local_review_routing", activityContext ? activityContext.localReviewRoutingSummary || "none" : "none"],
        ["verification_policy", activityContext ? activityContext.verificationPolicySummary || "none" : "none"],
        ["durable_guardrails", activityContext ? activityContext.durableGuardrailSummary || "none" : "none"],
        [
          "follow_up",
          explain.externalReviewFollowUpSummary ||
            (activityContext ? activityContext.externalReviewFollowUpSummary || "none" : "none"),
        ],
        ["change_risk", (explain.changeRiskLines || []).join(" | ") || "none"],
      ]),
    },
    {
      title: "Review waits",
      items: buildDetailItems([
        ["waits", formatReviewWaits(activityContext)],
        ["local_review_summary_path", activityContext ? activityContext.localReviewSummaryPath || "none" : "none"],
        ["external_review_misses_path", activityContext ? activityContext.externalReviewMissesPath || "none" : "none"],
      ]),
    },
    {
      title: "Latest recovery",
      items: buildDetailItems([["latest_recovery", formatLatestRecovery(activityContext, explain.latestRecoverySummary)]]),
    },
    {
      title: "Retry and recovery",
      items: buildDetailItems([
        ["retry_summary", formatRetryContextSummary(activityContext) || "none"],
        ["recovery_loop", formatRecoveryLoopSummary(activityContext) || "none"],
        ["recent_phase_changes", formatRecentPhaseChanges(activityContext) || "none"],
      ]),
    },
    {
      title: "Recent failure",
      items: buildDetailItems([
        ["failure_summary", explain.failureSummary || "none"],
        ["last_error", explain.lastError || "none"],
      ]),
    },
  ].filter((section) => section.items.length > 0);
}
