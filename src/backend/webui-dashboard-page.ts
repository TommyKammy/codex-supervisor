import { renderDashboardBrowserScript } from "./webui-dashboard-browser-script";
import { listDashboardPanels } from "./webui-dashboard-panel-layout";

function renderDashboardPanelSection(section: "overview" | "details"): string {
  return listDashboardPanels(section)
    .map((panel) => panel.markup)
    .join("\n");
}

export function renderSupervisorDashboardPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>codex-supervisor operator dashboard</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3f5f8;
        --sidebar: #2a3f54;
        --sidebar-deep: #1d2b38;
        --sidebar-text: rgba(233, 239, 245, 0.92);
        --sidebar-muted: rgba(203, 214, 226, 0.68);
        --topbar: rgba(255, 255, 255, 0.92);
        --surface: #ffffff;
        --surface-soft: #fafbfd;
        --surface-muted: #f5f7fa;
        --border: #e3e8ef;
        --border-strong: #d1d9e6;
        --text: #2a3f54;
        --muted: #73879c;
        --accent: #1abb9c;
        --accent-strong: #169f84;
        --ok: #1d8f74;
        --warn: #c58b1a;
        --danger: #d9534f;
        --shadow-sm: 0 1px 3px rgba(15, 23, 42, 0.06);
        --shadow-md: 0 10px 24px rgba(15, 23, 42, 0.08);
        --radius-lg: 18px;
        --radius-md: 14px;
        --radius-sm: 10px;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        color: var(--text);
        background:
          radial-gradient(circle at top right, rgba(26, 187, 156, 0.09), transparent 24%),
          linear-gradient(180deg, #f7f9fc 0%, var(--bg) 100%);
      }

      .app-shell {
        display: grid;
        grid-template-columns: 280px minmax(0, 1fr);
        min-height: 100vh;
      }

      .sidebar {
        display: grid;
        grid-template-rows: auto auto 1fr auto;
        gap: 24px;
        padding: 24px 20px;
        color: var(--sidebar-text);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0)),
          linear-gradient(180deg, var(--sidebar) 0%, var(--sidebar-deep) 100%);
        border-right: 1px solid rgba(255, 255, 255, 0.06);
      }

      .brand {
        display: grid;
        gap: 6px;
      }

      .brand-kicker,
      .nav-label,
      .stat-label,
      .section-kicker,
      .panel-header h2,
      .row-label {
        margin: 0;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .brand-kicker,
      .nav-label,
      .section-kicker,
      .panel-header h2,
      .row-label {
        color: var(--muted);
      }

      .brand-title {
        margin: 0;
        font-size: 1.55rem;
        font-weight: 700;
        letter-spacing: -0.03em;
      }

      .brand-note,
      .nav-item small,
      .workspace-card p,
      .hero-copy p,
      .section-lead,
      .panel-subtitle,
      .action-card p {
        margin: 0;
        color: var(--muted);
        line-height: 1.55;
      }

      .brand-note {
        color: var(--sidebar-muted);
      }

      .nav-block {
        display: grid;
        gap: 10px;
      }

      .nav-list {
        display: grid;
        gap: 8px;
      }

      .nav-item {
        display: grid;
        gap: 4px;
        padding: 12px 14px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
      }

      .nav-item strong {
        color: var(--sidebar-text);
        font-size: 0.96rem;
      }

      .nav-item small {
        color: var(--sidebar-muted);
      }

      .workspace-card {
        display: grid;
        gap: 10px;
        padding: 16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.05);
      }

      .workspace-card strong {
        font-size: 1rem;
      }

      .workspace-card p {
        color: var(--sidebar-muted);
      }

      .sidebar-footer {
        color: var(--sidebar-muted);
        font-size: 0.82rem;
      }

      .content {
        min-width: 0;
        padding: 18px;
      }

      .topbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 18px;
        border: 1px solid var(--border);
        border-radius: 16px;
        background: var(--topbar);
        box-shadow: var(--shadow-sm);
        backdrop-filter: blur(10px);
      }

      .topbar-title {
        display: grid;
        gap: 4px;
      }

      .topbar-title h1 {
        margin: 0;
        font-size: 1.65rem;
        letter-spacing: -0.03em;
      }

      .topbar-title p {
        margin: 0;
        color: var(--muted);
      }

      .topbar-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .topbar-pill {
        padding: 10px 14px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--surface);
        color: var(--muted);
        font-size: 0.9rem;
      }

      .page {
        display: grid;
        gap: 18px;
        margin-top: 18px;
      }

      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr);
        gap: 18px;
      }

      .hero-card,
      .summary-card,
      .stat-card,
      .panel {
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--surface);
        box-shadow: var(--shadow-sm);
      }

      .hero-card,
      .summary-card {
        padding: 20px 22px;
      }

      .hero-copy {
        display: grid;
        gap: 10px;
      }

      .hero-copy h2 {
        margin: 0;
        font-size: clamp(2rem, 4vw, 3rem);
        line-height: 1;
        letter-spacing: -0.045em;
      }

      .summary-card {
        display: grid;
        gap: 10px;
        background: linear-gradient(180deg, #ffffff, #f8fbfd);
      }

      .summary-card strong {
        font-size: 1.25rem;
      }

      .summary-list {
        display: grid;
        gap: 10px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .summary-list li {
        color: var(--muted);
      }

      .summary-list strong {
        display: block;
        margin-bottom: 2px;
        font-size: 0.95rem;
        color: var(--text);
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 14px;
      }

      .stat-card {
        display: grid;
        gap: 8px;
        padding: 18px;
      }

      .stat-label {
        color: var(--muted);
      }

      .stat-card strong {
        font-size: 1.35rem;
        letter-spacing: -0.03em;
        word-break: break-word;
      }

      .dashboard-section {
        display: grid;
        gap: 14px;
      }

      .section-header {
        display: grid;
        gap: 6px;
        padding: 0 2px;
      }

      .section-header h2 {
        margin: 0;
        font-size: 1.45rem;
        letter-spacing: -0.03em;
      }

      .overview-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.45fr) minmax(320px, 1fr);
        gap: 16px;
      }

      .details-grid {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 16px;
      }

      .panel {
        min-width: 0;
        overflow: hidden;
      }

      .panel-shell {
        display: grid;
        gap: 0;
      }

      .panel-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 12px;
        align-items: start;
        padding: 16px 18px 14px;
        border-bottom: 1px solid var(--border);
        background: linear-gradient(180deg, #ffffff, #fbfcfe);
      }

      .panel-header-main,
      .panel-heading {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      .panel-header-aside {
        display: grid;
        gap: 8px;
        justify-items: end;
        min-width: 0;
      }

      .panel-header-meta,
      .panel-header-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
      }

      .panel-body {
        padding: 18px;
      }

      #panel-issue-details {
        grid-column: span 7;
      }

      #panel-tracked-history {
        grid-column: span 5;
      }

      #panel-operator-actions {
        grid-column: span 4;
      }

      #panel-live-events {
        grid-column: span 4;
      }

      #panel-operator-timeline {
        grid-column: span 4;
      }

      .metric {
        font-size: 2rem;
        line-height: 1;
        font-weight: 700;
        letter-spacing: -0.04em;
      }

      .metric.ok,
      .live-value.ok {
        color: var(--ok);
      }

      .metric.warn,
      .live-value.warn {
        color: var(--warn);
      }

      .metric.fail,
      .live-value.fail,
      .danger {
        color: var(--danger);
      }

      .panel-empty-state,
      .hint {
        color: var(--muted);
      }

      .stack,
      .row,
      .detail-stack,
      .detail-list,
      .event-list {
        display: grid;
        gap: 10px;
      }

      .list {
        margin: 0;
        padding-left: 18px;
      }

      .list li + li {
        margin-top: 8px;
      }

      .code,
      pre,
      .detail-empty {
        margin: 0;
        padding: 14px 16px;
        border: 0;
        border-radius: var(--radius-sm);
        background: #1f3042;
        color: #edf3f9;
        overflow: auto;
        font: 0.86rem/1.55 "Consolas", "SFMono-Regular", monospace;
      }

      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }

      .toolbar input {
        min-width: 180px;
        padding: 11px 13px;
        border: 1px solid var(--border-strong);
        border-radius: 8px;
        background: #fff;
        color: var(--text);
        font: inherit;
      }

      .toolbar button,
      .action-card button,
      .panel-header button,
      .shortcut-button {
        font: inherit;
      }

      .toolbar button,
      .action-card button {
        padding: 11px 15px;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        color: #fff;
        cursor: pointer;
      }

      .toolbar button:hover,
      .action-card button:hover {
        filter: brightness(1.04);
      }

      .toolbar button:disabled,
      .action-card button:disabled {
        cursor: not-allowed;
        opacity: 0.64;
        filter: grayscale(0.2);
      }

      .panel-header button,
      .shortcut-button {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: #fff;
        color: var(--text);
        cursor: pointer;
      }

      .panel-header button {
        padding: 8px 12px;
      }

      .panel-header button:hover,
      .shortcut-button:hover {
        border-color: #c8d2df;
        background: var(--surface-soft);
      }

      .shortcut-button {
        width: 100%;
        padding: 12px 13px;
        text-align: left;
      }

      .shortcut-list,
      .detail-grid,
      .action-grid {
        display: grid;
        gap: 10px;
      }

      .shortcut-list {
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      }

      .detail-grid,
      .action-grid {
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }

      .detail-card,
      .action-card,
      .event-item {
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
      }

      .detail-card,
      .action-card {
        padding: 14px;
      }

      .detail-card {
        display: grid;
        gap: 8px;
        background: var(--surface-soft);
      }

      .detail-card h3,
      .action-card strong {
        margin: 0;
        font-size: 1rem;
      }

      .detail-item {
        color: var(--muted);
        font-size: 0.92rem;
        line-height: 1.45;
      }

      .detail-item strong {
        color: var(--text);
      }

      .action-card {
        display: grid;
        gap: 10px;
        background: #fff;
      }

      .action-card button {
        justify-self: start;
      }

      .event-item {
        padding: 13px 14px;
        background: var(--surface-muted);
      }

      .event-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 6px;
        color: var(--muted);
        font-size: 0.82rem;
      }

      @media (max-width: 1220px) {
        .stats-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .overview-grid {
          grid-template-columns: 1fr;
        }

        #panel-issue-details,
        #panel-tracked-history,
        #panel-operator-actions,
        #panel-live-events,
        #panel-operator-timeline {
          grid-column: span 6;
        }
      }

      @media (max-width: 980px) {
        .app-shell {
          grid-template-columns: 1fr;
        }

        .sidebar {
          grid-template-rows: auto;
          gap: 16px;
          border-right: 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }

        .hero {
          grid-template-columns: 1fr;
        }

        .stats-grid,
        .details-grid {
          grid-template-columns: 1fr;
        }

        #panel-issue-details,
        #panel-tracked-history,
        #panel-operator-actions,
        #panel-live-events,
        #panel-operator-timeline {
          grid-column: auto;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          scroll-behavior: auto !important;
          transition-duration: 0.01ms !important;
        }
      }
    </style>
  </head>
  <body>
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <p class="brand-kicker">codex-supervisor</p>
          <h1 class="brand-title">Operator Console</h1>
          <p class="brand-note">A fixed-layout admin dashboard inspired by classic control panels and tuned for issue operations.</p>
        </div>

        <section class="nav-block">
          <p class="nav-label">Navigation</p>
          <div class="nav-list">
            <div class="nav-item">
              <strong>Operational Snapshot</strong>
              <small>Selection, readiness, and environment health.</small>
            </div>
            <div class="nav-item">
              <strong>Issue Workbench</strong>
              <small>Issue detail, queue state, and operator actions.</small>
            </div>
            <div class="nav-item">
              <strong>Live Activity</strong>
              <small>Recent events and timeline context.</small>
            </div>
          </div>
        </section>

        <section class="workspace-card">
          <p class="nav-label">Workspace</p>
          <strong>Supervisor workspace</strong>
          <p>Keep overview, actions, and timeline visible without rearranging the dashboard.</p>
        </section>

        <div class="sidebar-footer">Stable panel positions make scanning faster during repeated operator checks.</div>
      </aside>

      <main class="content" data-dashboard-root>
        <header class="topbar">
          <div class="topbar-title">
            <h1>Operator dashboard</h1>
            <p>Monitor the current supervisor state, inspect the selected issue, and run the existing safe commands.</p>
          </div>
          <div class="topbar-meta">
            <div class="topbar-pill">Layout: fixed admin dashboard</div>
            <div class="topbar-pill">Surface: local WebUI</div>
          </div>
        </header>

        <div class="page">
          <section class="hero">
            <article class="hero-card">
              <div class="hero-copy">
                <p class="section-kicker">Supervisor workspace</p>
                <h2>Operational visibility without panel drag-and-drop.</h2>
                <p>Current health, issue context, and safe actions stay in a predictable layout so repeat visits feel familiar.</p>
              </div>
            </article>
            <aside class="summary-card">
              <p class="section-kicker">Operating model</p>
              <strong>Gentelella-inspired structure, supervisor-specific content.</strong>
              <ul class="summary-list">
                <li><strong>Top row:</strong> quick-glance health and selection metrics.</li>
                <li><strong>Main row:</strong> overview on the left, doctor checks on the right.</li>
                <li><strong>Workbench row:</strong> issue detail first, queue and activity panels following.</li>
              </ul>
            </aside>
          </section>

          <section class="stats-grid" aria-label="live summary">
            <article class="stat-card">
              <p class="stat-label">Connection</p>
              <strong id="connection-state" class="live-value">connecting</strong>
            </article>
            <article class="stat-card">
              <p class="stat-label">Freshness</p>
              <strong id="freshness-state" class="live-value">awaiting refresh</strong>
            </article>
            <article class="stat-card">
              <p class="stat-label">Refresh</p>
              <strong id="refresh-state" class="live-value">idle</strong>
            </article>
            <article class="stat-card">
              <p class="stat-label">Selected issue</p>
              <strong id="selected-issue-badge">none</strong>
            </article>
            <article class="stat-card">
              <p class="stat-label">Last refresh</p>
              <strong id="last-refresh-badge">never</strong>
            </article>
          </section>

          <section class="dashboard-section" aria-labelledby="overview-heading">
            <div class="section-header">
              <p class="section-kicker">Overview lane</p>
              <h2 id="overview-heading">Operational snapshot</h2>
              <p class="section-lead">Keep the current selection, readiness summary, and environment diagnostics balanced across one row.</p>
            </div>
            <div id="overview-grid" class="overview-grid" aria-label="overview" data-panel-grid="overview">
${renderDashboardPanelSection("overview")}
            </div>
          </section>

          <section class="dashboard-section" aria-labelledby="details-heading">
            <div class="section-header">
              <p class="section-kicker">Workbench lane</p>
              <h2 id="details-heading">Issue workbench</h2>
              <p class="section-lead">Lead with issue detail, then keep queue state, actions, and live activity in a balanced three-panel row.</p>
            </div>
            <div id="details-grid" class="details-grid" aria-label="details" data-panel-grid="details">
${renderDashboardPanelSection("details")}
            </div>
          </section>
        </div>
      </main>
    </div>

    <script>${renderDashboardBrowserScript()}
    </script>
  </body>
</html>`;
}
