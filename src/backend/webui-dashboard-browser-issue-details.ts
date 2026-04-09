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
  externalReviewFollowUpSummary?: string | null;
  latestRecoverySummary?: string | null;
  failureSummary?: string | null;
  lastError?: string | null;
  changeRiskLines?: string[] | null;
  activityContext?: DashboardIssueDetailsActivityContextLike | null;
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
    return (
      "issue=#" +
      latestRecovery.issueNumber +
      " at=" +
      latestRecovery.at +
      " reason=" +
      latestRecovery.reason +
      (latestRecovery.detail ? " detail=" + latestRecovery.detail : "")
    );
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
    .map((reviewWait) =>
      reviewWait.kind +
      " status=" +
      reviewWait.status +
      " provider=" +
      reviewWait.provider +
      " pause_reason=" +
      reviewWait.pauseReason +
      " recent_observation=" +
      reviewWait.recentObservation +
      " observed_at=" +
      (reviewWait.observedAt || "none") +
      " configured_wait_seconds=" +
      (reviewWait.configuredWaitSeconds === null ? "none" : reviewWait.configuredWaitSeconds) +
      " wait_until=" +
      (reviewWait.waitUntil || "none"),
    )
    .join(" | ");
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
