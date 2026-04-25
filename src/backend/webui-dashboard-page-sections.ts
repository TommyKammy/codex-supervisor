import { type DashboardPanelDefinition, type DashboardPanelId, listDashboardPanels } from "./webui-dashboard-panel-layout";
import type { SetupReadinessFieldKey, SetupReadinessReport } from "../setup-readiness";

export interface DashboardPageSections {
  repoSlugMarkup: string;
  detailsMenuMarkup: string;
  firstRunSetupMarkup: string;
  overviewPanelsMarkup: string;
  detailPanelsMarkup: string;
  footerMarkup: string;
}

function renderDashboardPanelSection(section: "overview" | "details"): string {
  return listDashboardPanels(section)
    .map((panel) => panel.markup)
    .join("\n");
}

function toTitleCase(value: string): string {
  return value.replace(/\b([a-z])/gu, (match) => match.toUpperCase());
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

const panelNavIcons: Record<DashboardPanelId, string> = {
  status:
    '<svg viewBox="0 0 16 16" focusable="false"><path d="M3 12h2V6H3zm4 0h2V3H7zm4 0h2V8h-2z"/></svg>',
  doctor:
    '<svg viewBox="0 0 16 16" focusable="false"><path d="M7 2h2v3h3v2H9v3H7V7H4V5h3z"/></svg>',
  "issue-details":
    '<svg viewBox="0 0 16 16" focusable="false"><path d="M3 2.5h10v11H3zm2 2v1h6v-1zm0 3v1h6v-1zm0 3v1h4v-1z"/></svg>',
  "tracked-history":
    '<svg viewBox="0 0 16 16" focusable="false"><path d="M8 2.5a5.5 5.5 0 105.5 5.5h-2A3.5 3.5 0 118 4.5V2.5zm-.5 2h1v4l2.5 1.5-.5.9L7.5 9z"/></svg>',
  "operator-actions":
    '<svg viewBox="0 0 16 16" focusable="false"><path d="M6.5 2l1 2.2L10 5l-1.8 1.7.4 2.5L6.5 8.1 4.4 9.2l.4-2.5L3 5l2.5-.8zM11 9h2v5h-2zM3 10h2v4H3z"/></svg>',
  "live-events":
    '<svg viewBox="0 0 16 16" focusable="false"><path d="M2.5 8a5.5 5.5 0 1111 0h-2a3.5 3.5 0 10-7 0z"/><circle cx="8" cy="8" r="1.5"/></svg>',
  "operator-timeline":
    '<svg viewBox="0 0 16 16" focusable="false"><path d="M4 3.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 6a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM7 5h6v1H7zm0 6h6v1H7z"/></svg>',
};

function renderPanelNavLink(panel: DashboardPanelDefinition): string {
  const icon = panelNavIcons[panel.id];
  return `<a id="nav-panel-${panel.id}" class="side-nav-link" href="#panel-${panel.id}" data-open-details="true"><span class="side-nav-icon" aria-hidden="true">${icon}</span><span>${toTitleCase(panel.title)}</span></a>`;
}

function renderDetailsMenu(): string {
  return `<nav class="side-nav-card" aria-label="dashboard navigation">
          <div class="side-nav-section">
            <p class="eyebrow">Overview</p>
            <a id="nav-summary-top" class="side-nav-link" href="#summary-top"><span class="side-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M3 3.5h10v2H3zm0 3.5h10v2H3zm0 3.5h6v2H3z"/></svg></span><span>Current Status</span></a>
            <a id="nav-issue-summary" class="side-nav-link" href="#selected-issue-heading"><span class="side-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M3 2.5h10v11H3zm2 2v1h6v-1zm0 3v1h6v-1zm0 3v1h4v-1z"/></svg></span><span>Issue Summary</span></a>
            <a id="nav-first-run-setup" class="side-nav-link" href="#dashboard-first-run-setup"><span class="side-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M8 2.5l5 2v4c0 2.9-2.1 4.7-5 5.5-2.9-.8-5-2.6-5-5.5v-4zm0 2.1L5 5.7v2.8c0 1.8 1.2 3.1 3 3.8 1.8-.7 3-2 3-3.8V5.7zM7.2 7h1.6v2.2H7.2zm0 2.8h1.6v1.2H7.2z"/></svg></span><span>First-run Setup</span></a>
          </div>
          <div class="side-nav-section">
            <p class="eyebrow">Details</p>
            <a id="nav-overview-heading" class="side-nav-link" href="#overview-heading" data-open-details="true"><span class="side-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M8 2.5l5 2v4c0 2.9-2.1 4.7-5 5.5-2.9-.8-5-2.6-5-5.5v-4zm0 2.1L5 5.7v2.8c0 1.8 1.2 3.1 3 3.8 1.8-.7 3-2 3-3.8V5.7zM7.2 7h1.6v2.2H7.2zm0 2.8h1.6v1.2H7.2z"/></svg></span><span>Queue Diagnostics</span></a>
${listDashboardPanels("overview")
  .map((panel) => "            " + renderPanelNavLink(panel))
  .join("\n")}
${listDashboardPanels("details")
  .map((panel) => "            " + renderPanelNavLink(panel))
  .join("\n")}
          </div>
        </nav>`;
}

function readSetupFieldValue(
  report: SetupReadinessReport | null | undefined,
  key: SetupReadinessFieldKey,
): string | null {
  if (!report || !Array.isArray(report.fields)) {
    return null;
  }
  const field = report.fields.find((candidate) => candidate.key === key);
  return typeof field?.value === "string" && field.value.trim() !== "" ? field.value : null;
}

function readRepoContext(report: SetupReadinessReport | null | undefined): {
  repoSlug: string | null;
  repoPath: string | null;
  workspaceRoot: string | null;
} {
  return {
    repoSlug: readSetupFieldValue(report, "repoSlug"),
    repoPath: readSetupFieldValue(report, "repoPath"),
    workspaceRoot: readSetupFieldValue(report, "workspaceRoot"),
  };
}

function renderDashboardFooter(report: SetupReadinessReport | null | undefined): string {
  const { repoPath, workspaceRoot } = readRepoContext(report);
  return `<footer class="dashboard-footer">
          <div class="footer-path-group">
            <span class="eyebrow">Local path</span>
            <code id="repo-path-value" class="context-path">${escapeHtml(repoPath ?? "Not configured")}</code>
          </div>
          <div class="footer-path-group">
            <span class="eyebrow">Workspace root</span>
            <code id="workspace-root-value" class="context-path">${escapeHtml(workspaceRoot ?? "Not configured")}</code>
          </div>
        </footer>`;
}

function renderHeaderRepoSlug(report: SetupReadinessReport | null | undefined): string {
  const { repoSlug } = readRepoContext(report);
  return escapeHtml(repoSlug ?? "Repository unavailable");
}

function renderSetupContextTile(label: string, value: string): string {
  return `<div class="metric-tile">
                <span class="metric-tile-label">${escapeHtml(label)}</span>
                <code class="context-path">${escapeHtml(value)}</code>
              </div>`;
}

function setupToneClass(report: SetupReadinessReport): "ok" | "warn" | "fail" {
  if (report.ready) {
    return "ok";
  }
  return report.blockers.length > 0 || report.hostReadiness.overallStatus === "fail" ? "fail" : "warn";
}

function setupStatusLabel(report: SetupReadinessReport): string {
  if (report.ready) {
    return "Setup ready";
  }
  return report.blockers.length > 0 ? "Setup blocked" : "Setup advisory";
}

function renderSetupActionList(report: SetupReadinessReport): string {
  const requiredActions = report.nextActions.filter((action) => action.required);
  if (requiredActions.length === 0) {
    return `<li>No required setup actions remain.</li>`;
  }
  return requiredActions
    .map((action) => `<li><strong>${escapeHtml(action.action)}</strong><br>${escapeHtml(action.summary)}</li>`)
    .join("\n");
}

function renderDangerousOptInList(report: SetupReadinessReport): string {
  const dangerousFields =
    report.configPostureGroups?.find((group) => group.tier === "dangerous_explicit_opt_in")?.fields ?? [];
  const dangerousActions = report.nextActions.filter((action) => action.source.startsWith("dangerous_explicit_opt_in:"));

  if (dangerousFields.length === 0 && dangerousActions.length === 0) {
    return `<li>No dangerous explicit opt-ins are configured.</li>`;
  }

  const fieldLines = dangerousFields.map((field) => {
    const value = field.value === null ? "unset" : field.value;
    return `<li><strong>${escapeHtml(field.label)}</strong><br>${escapeHtml(field.message)}<br><span class="hint">Current value: ${escapeHtml(value)}</span></li>`;
  });
  const actionLines = dangerousActions.map(
    (action) => `<li><strong>${escapeHtml(action.action)}</strong><br>${escapeHtml(action.summary)}</li>`,
  );
  return [...fieldLines, ...actionLines].join("\n");
}

function renderFirstRunSetupPanel(report: SetupReadinessReport | null | undefined): string {
  if (!report) {
    return "";
  }

  const { repoPath, workspaceRoot } = readRepoContext(report);
  const tone = setupToneClass(report);
  const githubAuthSummary =
    report.hostReadiness.checks.find((check) => check.name === "github_auth")?.summary ??
    `Host readiness: ${report.hostReadiness.overallStatus}.`;
  const localCiSummary =
    report.localCiContract?.summary ?? readSetupFieldValue(report, "localCiCommand") ?? "Local CI command is not configured.";
  const localReviewSummary = report.localReviewPosture?.summary ?? "Local review posture is not configured.";

  return `<section id="dashboard-first-run-setup" class="setup-readiness-panel" aria-labelledby="dashboard-first-run-setup-heading">
          <div class="setup-readiness-header">
            <div>
              <p class="section-kicker">First-run setup</p>
              <h2 id="dashboard-first-run-setup-heading">First-run setup</h2>
              <p class="section-lead">Typed setup-readiness and operator-action posture for this WebUI session.</p>
            </div>
            <span class="summary-pill ${tone}">${setupStatusLabel(report)}</span>
          </div>
          <div class="setup-readiness-body">
            <div class="setup-readiness-section">
              <div class="setup-context-grid">
                ${renderSetupContextTile("Config path", report.configPath)}
                ${renderSetupContextTile("Repository path", repoPath ?? "Not configured")}
                ${renderSetupContextTile("Workspace root", workspaceRoot ?? "Not configured")}
                ${renderSetupContextTile("Loop mode", "WebUI is an operator surface only; no loop ownership or runtime marker is introduced here.")}
              </div>
              <div class="setup-context-grid">
                ${renderSetupContextTile("GitHub auth readiness", githubAuthSummary)}
                ${renderSetupContextTile("Trust posture", report.trustPosture.summary)}
                ${renderSetupContextTile("Local CI posture", localCiSummary)}
                ${renderSetupContextTile("Review provider posture", report.providerPosture.summary)}
                ${renderSetupContextTile("Local review posture", localReviewSummary)}
              </div>
            </div>
            <div class="setup-readiness-section">
              <h3>Required next actions</h3>
              <ul class="setup-readiness-list">
                ${renderSetupActionList(report)}
              </ul>
              <h3>Dangerous explicit opt-ins</h3>
              <ul class="setup-readiness-list setup-danger-zone">
                ${renderDangerousOptInList(report)}
              </ul>
            </div>
          </div>
        </section>`;
}

export function renderDashboardPageSections(
  setupReadiness?: SetupReadinessReport | null,
): DashboardPageSections {
  return {
    repoSlugMarkup: renderHeaderRepoSlug(setupReadiness),
    detailsMenuMarkup: renderDetailsMenu(),
    firstRunSetupMarkup: renderFirstRunSetupPanel(setupReadiness),
    overviewPanelsMarkup: renderDashboardPanelSection("overview"),
    detailPanelsMarkup: renderDashboardPanelSection("details"),
    footerMarkup: renderDashboardFooter(setupReadiness),
  };
}
