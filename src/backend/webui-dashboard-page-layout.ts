import { renderDashboardPageStyles } from "./webui-dashboard-page-styles";

export interface DashboardPageLayoutInput {
  repoSlugMarkup: string;
  detailsMenuMarkup: string;
  firstRunSetupMarkup?: string;
  overviewPanelsMarkup: string;
  detailPanelsMarkup: string;
  footerMarkup: string;
  browserScript: string;
}

export function renderDashboardPageLayout({
  repoSlugMarkup,
  detailsMenuMarkup,
  firstRunSetupMarkup = "",
  overviewPanelsMarkup,
  detailPanelsMarkup,
  footerMarkup,
  browserScript,
}: DashboardPageLayoutInput): string {
  const safeBrowserScript = browserScript.replace(/<\/script/giu, "<\\/script");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>codex-supervisor operator dashboard</title>
    <style>${renderDashboardPageStyles()}
    </style>
  </head>
  <body>
    <main class="page-shell" data-dashboard-root>
      <header class="masthead">
        <div id="summary-top" class="masthead-bar">
          <div class="masthead-brand">
            <span class="masthead-brand-icon" aria-hidden="true">C</span>
            <span class="masthead-brand-name">codex-supervisor</span>
            <span class="masthead-divider" aria-hidden="true">|</span>
            <strong id="repo-slug-value" class="masthead-repo">${repoSlugMarkup}</strong>
          </div>
          <div class="masthead-meta">
            <div id="connection-state-pill" class="topbar-pill info">Connection: connecting</div>
            <div id="loop-mode-badge" class="topbar-pill info">Mode: local WebUI</div>
            <div id="last-refresh-pill" class="topbar-pill info">Last updated: never</div>
          </div>
        </div>
      </header>
      <div class="app-layout">
        <aside class="side-nav">
${detailsMenuMarkup}
        </aside>
        <div class="page-stack">
        <section class="focus-hero" aria-labelledby="selected-issue-heading">
          <p id="focus-breadcrumb" class="hero-breadcrumb">Current Focus &gt; Waiting for an issue</p>
          <div class="focus-hero-copy">
            <h2 id="selected-issue-heading">No issue loaded</h2>
            <p id="selected-issue-detail" class="section-lead">The selected or next runnable issue will appear here with a short summary.</p>
            <p id="hero-reason" class="hero-reason">Reason: No immediate attention items are reported.</p>
          </div>
          <div id="hero-badge-row" class="hero-badge-row">
            <span class="summary-pill info">Issue state is loading</span>
          </div>
          <div class="hero-action-row">
            <button type="button" id="hero-primary-button" class="hero-primary-button">Refresh Dashboard</button>
            <button type="button" id="hero-secondary-button" class="hero-secondary-button"></button>
            <button type="button" id="hero-tertiary-button" class="hero-tertiary-button">More Actions</button>
          </div>
          <p id="overview-warning" class="hero-warning hint"></p>
          <div class="sr-only">
            <strong id="overview-headline" class="summary-headline">Loading supervisor status</strong>
            <p id="overview-detail" class="summary-detail">The dashboard is collecting the latest state. This may take a few seconds.</p>
            <span id="loop-state-summary" class="summary-pill info">Loop status is loading</span>
            <span id="freshness-state" class="summary-pill info">awaiting refresh</span>
            <span id="refresh-state" class="summary-pill info">idle</span>
            <strong id="primary-action-title">Observe and refresh</strong>
            <p id="primary-action-detail">The queue is quiet right now, so the next supervisor state is observation and refresh.</p>
            <strong id="selected-issue-badge">none</strong>
            <p id="next-issue-title">No issue is selected yet.</p>
            <p id="next-issue-detail">When the supervisor surfaces a selected or runnable issue, it will appear here first.</p>
            <ul id="attention-list" class="summary-list">
              <li>No immediate attention items are reported.</li>
            </ul>
          </div>
          <div id="selected-issue-summary-metrics" class="sr-only">
            <div class="metric-tile panel-empty-state">Load an issue or wait for the selected issue summary.</div>
          </div>
          <div id="selected-issue-summary-notes" class="sr-only">
            <div class="detail-card">
              <h3>What to expect</h3>
              <div class="detail-list">
                <div class="detail-item">This area highlights the selected issue, readiness, blockers, and recent context.</div>
              </div>
            </div>
          </div>
          <div class="sr-only">
            <span class="eyebrow">Connection</span>
            <strong id="connection-state" class="live-value">connecting</strong>
            <span class="eyebrow">Last updated</span>
            <strong id="last-refresh-badge">never</strong>
          </div>
        </section>

${firstRunSetupMarkup}

        <details id="details-disclosure" class="details-disclosure">
          <summary>
            <span>Details &amp; Diagnostics</span>
            <span class="hint">Queue, diagnostics, issue loading, and maintenance actions</span>
          </summary>
          <div class="details-body">
            <section class="section-block" aria-labelledby="overview-heading">
              <div class="section-header">
                <p class="section-kicker">Queue and diagnostics</p>
                <h2 id="overview-heading">Advanced queue context</h2>
                <p class="section-lead">Open this section when you want the full supervisor reasoning, queue details, and environment diagnostics.</p>
              </div>
              <div id="overview-grid" class="overview-grid" aria-label="overview" data-panel-grid="overview">
${overviewPanelsMarkup}
              </div>
            </section>

            <section class="section-block" aria-labelledby="details-heading">
              <div class="section-header">
                <p class="section-kicker">Issue and activity details</p>
                <h2 id="details-heading">Detailed operator view</h2>
                <p class="section-lead">Use these panels for issue inspection, queue history, live events, and maintenance actions.</p>
              </div>
              <div id="details-grid" class="details-grid" aria-label="details" data-panel-grid="details">
${detailPanelsMarkup}
              </div>
            </section>
          </div>
        </details>

${footerMarkup}
        </div>
      </div>
    </main>

    <script>${safeBrowserScript}
    </script>
  </body>
</html>`;
}
